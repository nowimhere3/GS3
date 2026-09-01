# Runtime Invariants

## Hotswap projection invariant

Hotswap Top and Deep Cuts are two projections of one ordered configurable action list. Intentional visibility filters before the Top cutoff; physical overflow changes only the projection and never preferences. Picker opening is presentation-only and may not reload, rebuild, reparent, re-src, or checkpoint an iframe.

Runway top is derived from the website's current top plus 1.75 toolbar heights. An active picker suppresses autonomous Chrome geometry changes and closes only through explicit picker dismissal; toolbar retract is not a picker-dismissal operation.

These are architectural rules.

They are expected to remain true unless intentionally redesigned.

Features should conform to these rules.

If a feature appears to require violating one of these invariants, the architecture should be reconsidered before implementation.

---

# Single Source of Truth

Every layer has exactly one owner.

Workspace owns design.

Runtime owns execution.

GitHub owns persistence.

Store owns user preferences.

Collections own media libraries.

No state should have multiple competing owners.

---

# Runtime Session

The Runtime Session is the authoritative in-memory representation of a running session.

Everything currently visible belongs to Runtime Session.

Every runtime mutation updates Runtime Session first.

UI renders from Runtime Session.

Save Session serializes Runtime Session.

Undo restores Runtime Session.

The DOM is never treated as state.

---

# Runtime Ownership

Every runtime action updates Runtime Session.

Examples include:

- Master Shuffle
- Panel Shuffle
- Manual URL edits
- Folder assignment
- Position swaps
- Kill panel
- Launchpad
- Runtime variables

If the user can currently see it, Runtime Session owns it.

---

# Working Copies

Launching a Workspace creates a working copy.

The running Runtime Session is not the Workspace itself.

It is an isolated execution copy.

Changes remain local until the user explicitly saves.

This applies equally to:

- Saved Workspaces
- The Live Builder

Runtime must never silently modify its source Workspace.

---

# Runtime Boot

Runtime copies its initial state exactly once.

After initialization:

Workspace is no longer consulted.

Runtime owns itself.

All subsequent changes belong only to Runtime Session.

---

# Content vs Presentation

Content State and Presentation State are independent.

Content includes:

- Panels
- URLs
- Folder assignments
- Collections
- Runtime variables

Presentation includes:

- Layout
- Arrangement
- Orientation
- Position assignment

Changing presentation must never require content to reload.

---

# Panel Identity

A panel owns its content.

A slot owns its position.

A panel may move between slots without changing identity.

Position swaps modify presentation only.

The panel itself never changes ownership.

---

# Fixed Positions

A Position is a fixed physical location in a layout.

A Position never moves.

Panel identity and Position are separate concepts.

Targeting "Position N" must resolve to the physical location,
never to whichever panel originally started there.

There is exactly one definition of a layout's Position geometry.

Features must resolve Positions through it
rather than deriving competing geometry of their own.

---

# Undo

Undo is optional.

Runtime synchronization is mandatory.

Undo must never become the mechanism that keeps Runtime synchronized.

The Runtime Session is always updated regardless of whether Undo exists.

---

# History

There is one canonical history.

Every undoable action has identity, scope and state.

Scope names the panel or panels the action affected.

State records whether it is currently applied or undone.

Panel-scoped Undo and master Undo are two ways of selecting from that
one history, never two independent stacks.

An action that has been undone is undone once,
whichever control reversed it.

Applied state is tracked per affected panel, not per action.

A multi-panel content action is a bundle of per-panel effects.

Panel Undo reverses only that panel's portion.

Master Undo reverses every portion still applied,
so it still reverses the whole action as one session step,
while never restoring a panel that already restored itself.

An intrinsically linked action is the exception.

A Position swap cannot be half-undone.

Its panels always transition together,
and it is reversible once, from either participant.

Independent histories that can drift out of sync are not permitted.

---

# Two Histories

A panel has an action history and a navigation history.

The action history holds Runtime mutations GS3 performed.

The navigation history holds browsing that happened
inside the content GS3 loaded.

Website navigation is never recorded as a Runtime action.

Panel Undo and Redo are smart and consult both,
navigation first.

Master Undo is Runtime-action-only
and never traverses browsing history.

Navigation history is keyed to panel identity, never to Position.

See docs/010-PANEL-NAVIGATION.md.

---

# Honest Capability

The Runtime never pretends to observe what the browser does not expose.

Cross-origin navigation is detectable but its URL is not readable.

Such a navigation is recorded as opaque.

No fabricated URL may enter Runtime Session.

A navigation that cannot be reversed precisely
must not silently fall through to an older, unrelated action.

---

# Panel Real Estate

The website owns essentially all panel real estate
whenever GS3's controls are not in use.

GS3 keeps the panel border and the sliver immediately inside it.

Chrome must not permanently occupy a panel corner:
an arbitrary website already uses its own.

Revealing Chrome may temporarily inset content.

Chrome retracts itself once the customer stops using it.

It must never depend on an unrelated interaction
elsewhere in the Runtime to close.

It must never permanently reserve space,
and must never overlay a website's own corner controls
with an invisible hitbox.

Resize and Chrome activation are separate hit targets.

A given pixel means exactly one thing.

---

# Chrome Is Presentation

Revealing, retracting, ghosting or reordering Chrome
is presentation only.

It must never recreate, replace, reparent, re-src or reload an iframe,
and never creates an Undo checkpoint.

Chrome surfaces are ordered VIEWS over one canonical action registry.

Ordering and membership never fork behavior.

Surface eligibility is DERIVED from the registry.

No surface keeps its own list of which actions it may present.

Three questions stay distinct:
the action exists, this surface may present it,
and it is structurally owned elsewhere.

Structural controls — Position, the Layer selector,
Undo, Redo and the Deep Cuts gateway — are fixed.

They are never removable, reorderable,
or sacrificed to responsive pressure,
and they never consume configurable capacity.

See docs/011-HOTSWAP-CHROME.md.

---

# Surgical Restoration

History restoration is surgical.

Undo and Redo never reload unaffected live media.

Restoration mutates only the state, and only the DOM,
that the action itself actually affected.

Untouched live panels must retain their iframe nodes,
their parents, their document contexts, their load state,
and their playback continuity.

A presentation-only operation reloads nothing at all.

A content operation reloads only the panels whose content changed.

---

# Serialization

Saving serializes Runtime Session.

Loading reconstructs Runtime Session.

Serialization never inspects:

- DOM
- Store
- Workspace
- UI

Runtime already contains the complete answer.

---

# Workspace Editor

The Workspace Editor is a design environment.

It edits Workspaces.

It does not execute them.

It never performs autonomous behavior.

---

# Runtime

Runtime is the execution environment.

Timers

Automations

Runtime Events

Agents

Session State

Live orchestration

All runtime behavior belongs here.

---

# Automations

Automations execute only inside Runtime.

The Workspace Editor never executes automation.

A Workspace becomes automatable only after Runtime has been launched.

---

# Future Direction

Runtime Session is expected to eventually own:

- Panels
- Layout
- Arrangement
- Collections
- Runtime Variables
- Timers
- Runtime Events
- Agents
- Event Queue

Everything that is alive belongs here.
