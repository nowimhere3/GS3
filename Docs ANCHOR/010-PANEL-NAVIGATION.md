# Panel Navigation History

GS3 keeps two different histories for a panel.

They answer two different questions and must not be merged.

---

# Panel Action History

Owned by Runtime Session.

Reversible Runtime mutations GS3 itself performed.

Examples:

- Manual URL assignment
- Panel Shuffle
- Copy to Position
- Folder assignment
- Position swap
- A panel's portion of a Master Shuffle
- Kill panel

This is the canonical action history.

Master Undo reads only this.

---

# Panel Navigation History

Browsing that happens inside a panel's live content
after GS3 has loaded it.

Example:

selection page
→ category
→ video

GS3 did not cause any of it.

It is not a Runtime action and must never be recorded as one.

Turning a link click into a synthetic Shuffle would corrupt
the action history and make Master Undo traverse websites.

---

# Smart Panel Undo

Panel Undo answers:

"What is the most recent user-visible reversible thing
that happened to THIS panel?"

Selection rule:

1. If the panel has a pending in-content navigation step,
   navigate backward within its navigation history.

2. Otherwise, reverse the most recent applicable
   Panel Action History entry.

Navigation entries only exist inside the panel's current content
generation, which the most recent GS3 content action opened.

A pending navigation step is therefore always something the user did
after that action, which is what they mean by "back".

This ordering holds even when a newer GS3 action exists that did not
replace content.

Moving a panel to another Position does not undo the user's place
inside it, so Undo steps the browsing back first
and the panel stays where it is.

---

# Smart Panel Redo

The mirror.

1. Navigation forward, if a forward entry exists.

2. Otherwise, Panel Action Redo.

---

# Master Undo Is Not Smart

Master Undo remains:

"Undo the most recent GS3 Runtime action."

It never traverses a website's browsing history.

Panel Undo/Redo are local and smart.

Master Undo is Runtime-action-only.

This distinction is deliberate.

---

# Content Generations

The model is:

panel
→ content generation
→ navigation stack

Every GS3 content assignment opens a new generation
with a fresh single-entry stack.

Browsing done inside the old content cannot leak across
a deliberate content replacement.

After a Panel Shuffle from Site A to Site B,
nothing can navigate back into Site A's pages
except undoing the GS3 action that replaced it.

---

# Navigation Redo Invalidation

Normal browsing semantics.

A new in-content navigation discards the forward path.

Example:

browse
→ category
→ video A
→ back to category
→ user opens video B

The forward path to video A is gone.

Redo cannot resurrect it.

A GS3 content assignment resets the whole stack,
so it invalidates navigation forward state as well.

---

# GS3 Loads Are Not Navigation

When GS3 assigns a URL, that is already represented
in the Panel Action History.

The resulting iframe load must not also become
an independent navigation entry,
or one visible action would undo twice.

Each panel carries a pending-load count.

Assigning a URL raises it.

A load that arrives while it is raised is GS3's own and is not recorded.

This is deterministic rather than a timing guess,
and it works identically for content whose URL cannot be read.

---

# Identity, Not Position

Navigation history is keyed to panel identity.

It is never keyed to Position or grid area.

A panel moving from Position 1 to Position 3
keeps its browsing history,
because it is the same panel.

---

# Browser Capability Limits

These were measured, not assumed.

## What is observable

The parent's iframe load event fires for child-initiated navigation
at any origin.

GS3 can always detect THAT a panel navigated.

## What is not

`iframe.contentWindow.location.href` is readable same-origin
and throws SecurityError cross-origin.

GS3 can only sometimes know WHERE a panel navigated.

## What must never be used

`iframe.contentWindow.history.back()` is not frame-scoped.

It traverses the top-level joint session history,
so it moves whichever browsing context navigated most recently.

Measured behavior: calling `back()` on panel A's window
navigated panel B, because B had navigated more recently.

Using it for a per-panel Back would move an unrelated panel,
or GS3 itself.

It is therefore never used.

A panel-specific Back is only possible by re-assigning a URL
GS3 recorded, which requires having been able to read it.

---

# What Is Observable, Precisely

Measured against a real cross-origin frame.

Observed as a navigation:

- A full frame navigation, at any origin

NOT observed at all:

- A hash change
- An SPA route change via history.pushState
- A navigation inside a nested iframe
- An in-page modal or lightbox

None of these fire a load event on the panel's iframe element,
and cross-origin none of them are readable by any other means.

For those interactions GS3 does not know the panel moved,
so Panel Undo has nothing to reverse
and correctly falls through to the action history.

This is a browser boundary, not a defect.

A single-page application embedded cross-origin is therefore
opaque in both directions: GS3 cannot see where it went,
and cannot see that it went anywhere.

---

# The Generation Anchor

Every content generation has an anchor:
the URL GS3 itself assigned.

It is always safely known,
even when everything the panel does afterwards is unreadable.

Panel Undo availability must never be computed
from whether the CURRENT entry has a readable URL.

An opaque navigation marker plus a known anchor is enough.

Otherwise an untrackable navigation would let Panel Undo
consume an older Runtime action instead —
undoing a Position swap the user never asked to undo.

Navigation must win before canonical action history
whenever any navigation was observed in the current generation.

## Anchor correction

A server-side redirect means the URL GS3 requested
is not the page the panel is actually sitting on.

Once the assignment's own loads have come to rest,
the anchor is corrected to where it landed,
so Undo returns the user to the real page
rather than to a URL that would redirect again.

Only when the URL is readable.

Never guessed, and never for opaque content.

Only the assignment's own loads may correct the anchor.

A later traversal also raises the pending-load count
and legitimately lands somewhere that is not the anchor,
so it must never rewrite it.

---

# Known Residual Boundary

If a GS3 assignment produces no load event at all —
an aborted navigation such as a 204 response, or a download —
its pending-load expectation is never consumed.

The next genuine child navigation is then attributed to GS3
and is not recorded.

Cross-origin this is undecidable:
a first load that differs from the requested URL
is indistinguishable from a redirect.

It is not worked around with a timing heuristic.

---

# Opaque Navigation

A cross-origin navigation is detected but its URL is unknowable.

It is recorded honestly as an opaque entry rather than
dropped or guessed at.

No fabricated URL ever enters Runtime Session.

Undo does not skip an opaque navigation
and jump to an older GS3 action.

That was the human-reported bug and it must not reappear
in the cross-origin case either.

Instead, Undo steps back to the nearest entry that has a real URL.

For a fully opaque journey that is the content GS3 loaded,
so one Undo returns the panel to where GS3 put it,
and the next reaches the action history.

## Honest degradation

For opaque content this collapses an unknown number of steps
into one.

It is not a one-step Back and is not presented as one.

Opaque entries passed over are discarded rather than kept
as unreachable Redo targets,
so navigation Redo is unavailable after such a collapse.

Same-origin and cooperative content gets exact
step-by-step Back and Forward.

---

# Future Sources

The navigation layer takes navigation events from any source.

The iframe load observer is one adapter, not the model.

The same interface can later accept:

- Native WebView navigation callbacks
- Extension or content-script adapters
- Cooperative Layer 2 runtimes reporting via postMessage
- Site adapters

Arbitrary third-party websites are never required to cooperate.

Browser iframe limitations are not baked into the model.

---

# Session Content

In-content navigation does not mutate Runtime Session.

A panel's session URL remains the content source GS3 assigned.

`data-last-src` keeps the same meaning,
which is what Reload, Star, Delete, Purge
and Save Session act on.

Where a user browsed inside that content
belongs to the navigation layer, not to the session.
