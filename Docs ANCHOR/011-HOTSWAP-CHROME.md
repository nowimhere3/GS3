# Hotswap Chrome

The per-panel control surface.

## Part 1-6C website click-away breadcrumb

WAS: Utility dismissal correctly handled Escape and parent-document click-away, but website-area dismissal relied on an iframe element `focus` event that real Chromium does not dispatch when a click moves focus into the iframe browsing context.

IS: While a utility is open, GS3 observes parent `window.blur` and checks on the next animation frame whether that panel iframe is `document.activeElement`. That cross-origin-safe transition closes through the same canonical `closePicker()`; direct iframe `focus` remains a fallback. No overlay, event cancellation, iframe mutation, or toolbar reveal is involved.

WHY: Click-away should match normal user expectations wherever the browser provides an honest parent-visible signal, without stealing or delaying the customer's website click or pretending GS3 can observe arbitrary cross-origin DOM events. A later click inside an already-focused cross-origin frame remains unobservable to the parent.

## Part 1-6 utility dismissal + Toolbar Shortcuts toggle breadcrumb

WAS: outside-click dismissal used the whole Hotswap Chrome family (`inChromeFamily`) as its
boundary, so a click on the Top Toolbar rail, the Position button, or the `···` Deep Cuts
trigger left an open utility open — the Runway happened to close correctly only because it had
never been added to that predicate. Assign Folder focused nothing on open, so
`document.activeElement` fell to `BODY` and Escape only worked when a click happened to land on
a focusable child by accident. Separately, Toolbar Shortcuts carried its own ON/OFF switch in
Settings, in addition to a count and an order.

IS: an open utility's dismissal boundary is itself plus the control that invoked it
(`inActiveUtility`) — a narrower, purpose-built predicate, never `inChromeFamily` (which still
answers its own, different question: whether the 850ms retract timer should run). Any other GS3
Chrome closes an open utility without swallowing that control's own click — no `preventDefault`,
so the clicked control still performs its own action in the same gesture. Assign Folder now
takes focus on its own container (`tabIndex=-1`, `focus({preventScroll:true})`) the moment it
opens, matching Edit URL's explicit input focus, which makes Escape deterministic. Both utilities
still share exactly one `closePicker()`. Toolbar Shortcuts no longer has a separate enable
switch — it is structurally available whenever the Top Toolbar is revealed, and the user
configures it through count and order alone; a stale `hotswap_top_shortcuts_enabled=false` left
over from before this pass is now simply ignored rather than deleted or migrated.

WHY: two sibling utilities behaving differently was invisible to the user until they happened to
click in the "wrong" place, and dismissal must never require completing an action. The Top/Deep
Cuts cutoff already expresses how much belongs directly on the Top Toolbar, so a second
independent enable decision for Toolbar Shortcuts only duplicated a choice the user had already
made elsewhere.

## Part 1-5 Runway dice-cuddle breadcrumb

WAS: Right Runway Shuffle All used a vertical pair, but ordinary color-emoji ink inside its glyph line boxes left visibly more spacing than the horizontal Top pair.

IS: the existing two Runway-only spans form a compact upper-left to lower-right pair with a 2px line-box overlap, allowing the dice to slightly kiss while remaining distinct. Top, Deep Cuts, Settings, the 30x30 Runway hitbox, and the canonical `shuffleAll` action are unchanged.

WHY: the same canonical action should read as the same tight paired icon adapted to the orientation of its surface.

## Part 1-4 canonical utility dock breadcrumb

WAS: Edit URL and Assign Folder placement depended on invocation surface: Top opened below, while Runway and Deep Cuts opened leftward. Runway Shuffle All used the same horizontal glyph arrangement as Top.

IS: both picker actions always open at the same compact inset from the current website area's top-right (measured 8px top / 12px right in the bordered panel), independent of the invoking surface and without revealing Top. Completion, Escape, observable outside pointerdown, or iframe focus closes through the canonical picker lifecycle. The canonical Shuffle All action remains horizontal in Top and stacks its two dice only in the vertical Runway presentation.

WHY: one predictable top-right utility location is cleaner than surface-dependent editors; opening an editor must never force completion; and icon orientation should follow its surface without forking action behavior.

WAS: click-away within observable GS3 UI was available, but returning focus to iframe content did not explicitly dismiss an open utility.

IS: iframe focus is used as a non-intercepting dismissal signal. No transparent website overlay or sacrificial first click is introduced.

WHY: the website continues to own its pixels and receives the intended interaction normally, including across the browser's cross-origin event boundary.

## Part 1-3 human UX polish breadcrumb

WAS: Runway pickers opened leftward but could lose their stored invocation anchor and clamp toward panel top; Top controls were visually grouped from the left.

IS: Runway pickers preserve immediate horizontal and centered vertical attachment to the clicked shortcut, clamping only by the required boundary delta. Position remains isolated left while layer scope, configurable actions, Undo, Redo, and Deep Cuts form a right-side cluster.

WHY: the customer should immediately understand which shortcut owns a picker, and the toolbar should share a coherent right-side command language with the Runway.

WAS: Hotswap switches aligned globally but sat against the content edge, and major Settings collapse indicators preceded their titles.

IS: the shared switch axis has one 12px trailing inset. Major section titles remain left while their indicators sit far right; the entire heading button remains clickable and keyboard accessible.

WHY: precise alignment should not look clipped, and a clean title/caret split should not sacrifice the generous interaction target.

## Part 1-2 stable geometry breadcrumb

WAS: Runway was 1.75 toolbar heights from panel top. Focus anywhere in the Chrome family could reveal Top, and the 850ms timer could end an active picker interaction.

IS: Runway is 1.75 toolbar heights from the current website top. Family focus keeps Chrome alive, but only rail-owned focus reveals Top. An active picker owns its interaction until commit, Escape, outside pointerdown, or same-control toggle.

WHY: when Top pushes the website down, Runway must preserve its safe relationship to website UI, and Runway actions must not move underneath the customer while being used.

## Part 1 intelligence and picker geometry breadcrumb

WAS: Top Toolbar and Deep Cuts were independently ordered; responsive pressure hid trailing toolbar buttons; picker shortcuts opened the tray.

IS: one persisted 10-action order is filtered for intentional visibility before the configured Top cutoff. Deep Cuts is the visible remainder, including temporary actual-width responsive overflow, and its structural gateway remains enabled with an empty state. Runway order/count remain independent. Edit URL and Assign Folder use one canonical implementation with a panel-level picker anchored below a Top control or left of a Runway/Deep control, then flipped/clamped inside the panel. Comparable Settings switches share one global right-edge grid axis. The Runway safe zone is 1.75 toolbar heights.

WHY: customers should not count or duplicate-manage membership, shrinking a panel must not make actions unreachable, and pickers should appear at the control that was clicked without colliding with the Runway.

---

# BREADCRUMBS — WAS

Chrome was corner-anchored overlay.

A "···" trigger pinned to the panel's top-right.

A tray popping out beside it.

A Quick Action column beneath it.

Layer 2 was handled by MOVING the whole cluster
to the opposite corner so a nested runtime's controls
would not sit on top of the outer runtime's controls.

Quick Actions were an array of up to three slots,
where a count of 0 also meant "feature off".

---

# BREADCRUMBS — IS

One control surface, in one place, made of two parts.

TOP TOOLBAR
    Retractable, anchored immediately inside the panel's top boundary.
    Zero height at rest.
    When revealed it INSETS the content — the iframe is pushed down.

SHORTCUT RUNWAY
    A vertical overlay down the right edge,
    starting below a deliberate top-right safe zone.

Layer scope is stated explicitly by a highlighted [L2][L1] selector.

Quick Actions have an explicit on/off, a count of 1-8,
and their own drag-ordered list.

---

# BREADCRUMBS — WHY

The website should own essentially all panel real estate
whenever GS3's controls are not in use.

The old model assumed the corners belonged to GS3.

They do not.

An arbitrary website already uses its own top-left and top-right,
and usually its bottom corners too.

Moving controls to dodge a collision only relocated the collision
onto the website.

The panel border is the border.

Chrome lives immediately inside it.

The website is not permanently shrunk.

---

# Chrome retracts itself

## BREADCRUMBS — WAS

Revealed top Chrome stayed open until another panel's Chrome displaced it.

A toolbar could hold a slice of the website's height indefinitely
purely because the user never touched another panel.

## BREADCRUMBS — IS

Each panel's Chrome owns its own lifecycle.

When pointer AND focus leave the whole interaction family,
a countdown starts and Chrome retracts on its own.

Delay: 850ms.

## BREADCRUMBS — WHY

The toolbar temporarily takes height away from the website.

A temporary control surface must give that real estate back
when the customer stops using it,
without depending on an unrelated action to trigger it.

850ms is long enough to cross a gap between two controls,
or to overshoot the rail, without being punished.

Short enough that the website is not left shrunk.

## The interaction family

One family: the activation rail, the toolbar, the Position button
and its menu, the layer selector, Top Shortcuts, Undo, Redo,
the "···" button, Deep Cuts, and every child row it opens.

While pointer or focus is inside it, Chrome stays.

Moving between two members is not leaving.

Returning before the countdown expires cancels it.

The user is never made to race the toolbar.

## Cross-origin reality

A click inside a cross-origin iframe never reaches GS3.

So the countdown is the PRIMARY mechanism, not a fallback.

Observable outside clicks dismiss too, where GS3 can see them.

No transparent glass is placed over the content to capture clicks.

---

# Deep Cuts dismissal

## BREADCRUMBS — WAS

The tray opened on "···" and stayed
until the user hunted down the X.

## BREADCRUMBS — IS

X still closes it.

So does Escape, an observable outside click,
or simply going back to the content.

## BREADCRUMBS — WHY

Resuming work in the website already means
"I am done with GS3 controls".

Making that require a second, precise click
was friction with no purpose.

X is kept as the explicit "close this now" affordance,
not the only one.

## Escape

Escape unwinds UI depth one level at a time:

    submenu -> Deep Cuts -> retract

Presentation only.

Escape never triggers a Runtime action.

---

# The Position button

## BREADCRUMBS — WAS

"Position N" was an inert label,
and the actions about this physical place
lived deeper in the tray.

## BREADCRUMBS — IS

It is the button those actions hang from.

    [ Position 1 ▾ ]
        Swap Position   >  Position 2, Position 3
        Copy To Position >  Position 2, Position 3

Clicking it opens the menu and moves nothing.

## BREADCRUMBS — WHY

The question "what should happen relative to THIS physical place?"
is best answered behind the thing that names the place.

## Position owns those actions outright

Move to Position and Copy To Position were ALSO generic Deep Cuts
entries while [Position N] existed separately.

They are now retired from the Deep Cuts tray
and from its Settings list.

Leaving duplicates behind would be clutter,
and would hide the relationship between
Position identity and Position actions.

Only the PRESENTATION is retired.

The canonical implementations are untouched —
the menu calls the same pathways the tray used to.

Registry entries carry `positionOwned: true`,
which is what excludes them from the tray,
from its ordering, and from Settings.

## Why the button looked inert

The pop-under was originally a child of the toolbar.

The rail is `overflow: hidden` so it can animate from zero height,
and that also clipped anything hanging below it.

The menu opened correctly and was completely invisible
and un-hittable.

It is now a PANEL child, positioned below the rail.

A test that asserted only the menu's text content passed
throughout that bug.

The test now asserts the menu is on screen, below the rail,
and returns itself from `elementFromPoint`.

It is deliberately NOT a general shortcut surface.

Only genuinely Position-owned actions belong here,
or it becomes a second miscellaneous tray.

The menu reuses the existing canonical Swap and Copy pathways.

No second swap engine.

No second copy implementation.

No second history stack.

Position swaps remain atomic, surgical and zero-reload.

---

# One canonical action registry

## BREADCRUMBS — WAS

A single `shortcutable` boolean decided whether an action
could appear on a shortcut surface.

It was hand-maintained, and it drifted.

Edit URL and Assign Folder were reachable in Deep Cuts
but silently absent from Toolbar Shortcuts and the Runway,
because `shortcutable: false` had been set back when a shortcut
was a tiny corner button with nowhere to draw a picker.

## BREADCRUMBS — IS

Each action declares CAPABILITY and STRUCTURAL OWNERSHIP.

Surface eligibility is DERIVED from those, in one place.

    opensPicker   reveals a row inside Deep Cuts rather than
                  firing immediately

    structural    already presented as fixed, non-removable UI
                    'positionButton' — surfaced by [Position N]
                    'toolbarRail'    — a fixed control on the rail

## BREADCRUMBS — WHY

Three hand-curated vocabularies over one set of behaviors
is drift waiting to happen, and it already happened.

Deriving eligibility means adding an action makes it appear
everywhere it is legal, automatically.

## Three different questions

    the action EXISTS
    this SURFACE may present it
    it is STRUCTURALLY OWNED elsewhere

Collapsing these into one boolean is what lost two actions.

Exclusions are presentation decisions.

Every implementation stays reachable, and is never duplicated.

## Eligibility rules

    positionButton-owned  excluded from ALL configurable surfaces
    toolbarRail-owned     excluded from Toolbar Shortcuts only
                          (the rail already shows them; the Runway
                           and Deep Cuts do not)

## Picker actions on a shortcut surface

Edit URL and Assign Folder reveal a row inside the Deep Cuts tray.

Invoked from another surface the tray is closed,
so the row would open where nobody can see it.

The mirror opens the tray first.

That is what makes them genuinely usable as shortcuts,
rather than excluded for lack of somewhere to draw.

---

# Three action surfaces

## BREADCRUMBS — WAS

Common actions were disproportionately routed through "···",
with one limited shortcut mechanism beside it.

## BREADCRUMBS — IS

TOP SHORTCUTS
    Horizontal, on the rail, while it is revealed.
    Frequent actions.

RIGHT RUNWAY
    Vertical overlay, straight over content.
    Fastest access.

DEEP CUTS
    The deeper toolbox.

## BREADCRUMBS — WHY

Different ergonomics deserve different surfaces.

They do not deserve different implementations.

All three invoke the same canonical actions.

Top Shortcuts and the Runway are INDEPENDENT collections:
deliberately exposing the same action on both is
presentation duplication, which is allowed.

## Toolbar capacity: 1-10

BREADCRUMBS — WAS 6, chosen when Undo and Redo were competing
for the same configurable slots.

IS 10.

WHY: Position, Undo, Redo and "···" are structural and no longer
consume configurable capacity, so a wide enough panel can expose
essentially the whole ordinary action vocabulary directly.

## Responsive capacity

Survival priority on a narrow rail:

    1. Position button
    2. [L2][L1] when Layer 2 exists
    3. Undo
    4. Redo
    5. "..."
    6. Top Shortcuts consume what is left

Top Shortcuts drop from the end.

A second row is never wrapped: it would double the height
the toolbar steals from the website.

Nothing is written back to preferences.

A narrow panel renders fewer; widening restores them automatically.

Deep Cuts remains the complete fallback.

---

# Compact rail geometry

## BREADCRUMBS — WAS

The "···" button still carried
`position: absolute; top: 16px; right: 16px`
plus overlay-era padding,
from when it floated in the panel's corner.

Inside the flex rail that took it out of flow
and pushed it 16px DOWN — which is what made it
protrude below the toolbar.

## BREADCRUMBS — IS

An ordinary compact flex child,
vertically centred like its neighbours.

Rail height 30px.

Every control 22px.

## BREADCRUMBS — WHY

The rail was not too short.

The button was carrying spacing for a layout
that no longer exists.

Every unnecessary toolbar pixel is website height
taken away while Chrome is open.

The fix was removing obsolete spacing,
not enlarging the rail to accommodate it.

---

# Top toolbar: inset, not overlay

Revealing the toolbar pushes the iframe down.

It does not cover the site's header.

Overlaying would sit on the website's own controls.

Permanently reserving the strip would shrink every site forever.

Insetting only while revealed does neither.

## Continuity

Reveal and retract are a layout change on a container
the iframe already lives in.

The iframe is never recreated, replaced, reparented, re-src'd or reloaded.

No Undo checkpoint is created.

Playback, SPA state and Panel Navigation History all survive.

---

# Resize border vs activation region

Two separate hit targets, deliberately.

The true panel border keeps resize.

The activation region sits just inside it,
clear of the resizer's own grab zone.

A given pixel always means exactly one thing.

Sharing the target would make pointer intent ambiguous —
a drag that sometimes opens a menu instead of resizing.

---

# Why the runway stays an overlay

The toolbar insets. The runway does not.

Insetting from the right would change the iframe's WIDTH.

Width is what triggers substantial responsive reflow on a real website.

Height changes are comparatively cheap.

---

# Top-right safe zone

The runway begins 1.75 toolbar heights
below the top of the panel.

BREADCRUMBS — WAS 2.5 toolbar heights.

IS 1.75.

WHY: a website's own corner controls sit within roughly one
control-row of the top edge. 2.5 surrendered well past them
and cost usable runway height for nothing.

Almost every website puts account, settings or notification
controls in its top-right corner.

A GS3 hitbox across them — even a fully transparent one —
would silently steal clicks.

The offset is authored proportionally:

    --shortcut-runway-top-offset: calc(var(--hotswap-toolbar-height) * 1.75)

so it scales with the chrome rather than being a magic pixel count.

The runway is exactly as long as its configured count.

A full-height strip would be an invisible wall
down the side of every website.

---

# Settings hierarchy

## BREADCRUMBS — WAS

"Top Shortcuts", "Quick Action Shortcut Runway" and "Deep Cuts"
read as three peers, which hid the real structure.

## BREADCRUMBS — IS

Two major SURFACES:

    Top Toolbar
      ├── fixed: Position, [L2][L1], Undo, Redo, ···
      ├── Toolbar Shortcuts   (configurable middle)
      └── ··· Deep Cuts       (fallback child)

    Quick Action Shortcut Runway

## BREADCRUMBS — WHY

Deep Cuts is the toolbar's fallback gateway,
not a third place to put controls.

Presenting it as a peer invited the reading that
the toolbar and the tray were unrelated surfaces.

## Switch alignment

Every Hotswap ON/OFF switch shares ONE grammar:
the heading row is a flex row whose switch is pushed
to the far right by `margin-left: auto`.

A vertical ruler laid against the card's right edge
touches every comparable switch, at any nesting depth,
because they inherit the same card padding.

No per-section pixel offsets.

The switches previously carried an inline `style="margin:0"`
which silently outranked the stylesheet — that is why they sat
at differing left positions determined by heading text width.

---

# Two opacity values — runway only

RESTING and HOVER.

Exactly two customer-facing values.

## BREADCRUMBS — WAS

They governed the top toolbar as well as the runway.

## BREADCRUMBS — IS

They describe the RIGHT RUNWAY only.

The top toolbar is full opacity whenever it is revealed.

## BREADCRUMBS — WHY

Opacity and retraction solve the same problem:
a control surface intruding on the website.

The toolbar already solves it structurally —
when unused it is not faint, it is gone.

Fading a surface that only exists while deliberately in use
just makes it harder to read.

Two mechanisms on one surface is one too many.

    TOP   -> retract
    RIGHT -> ghost

A Resting Opacity of 0% must never dim the toolbar.

The resting value keeps its original storage key
so existing preferences survive.

---

# Quick Actions: on/off, then 1-8

ON/OFF answers "does the runway exist".

1-8 answers "how long is it".

These were previously the same control,
with 0 meaning both "none" and "disabled".

Switching the runway off must not destroy
the arrangement the user built.

Eight is the ceiling because it lays out as two clean rows of four
and is as much runway as a panel edge can carry
without becoming a wall.

---

# Two ordered collections, one registry

The tray and the runway are separate PRESENTATION collections
over the same canonical action registry.

An action may appear in both.

Only the tray button carries a handler.

Every other surface forwards its click to that same button.

Ordering and membership therefore never fork behavior:
there is exactly one implementation of each action.

A stored order is reconciled against the registry on every read —
unknown keys are dropped, missing keys are appended —
so an order can never desynchronize from the actions that exist.

---

# Layer scope

Two scopes. L1 and L2.

Deliberately not a generic nesting selector.

Layer 2 exists to run another Workspace inside a panel.

There is no Layer 3 in the product and none is planned,
so a depth-generic control would be speculative surface
with no user meaning.

## Hidden when there is no Layer 2

With only one possible target there is no choice to present.

A permanently-lit lone [L1] would be clutter,
and would imply a decision the user does not actually have.

## The scope is a preference

It is never overwritten merely because Layer 2 is currently absent.

Forcing it to L1 while nothing is nested would make the default
silently stick at L1 the moment a Layer 2 appeared.

Absence is handled at dispatch instead:
forwarding requires Layer 2 to actually exist,
so an L2 preference with nothing nested simply acts here.

## What actually forwards

    undo, redo, shuffle, shuffleAll, reload

The rest act on the CONTAINER — which URL this panel holds,
which folder it draws from, where it sits, whether it still exists.

Those have exactly one sensible target regardless of scope.

Forwarding them would be inventing a meaning:
"Copy to Position 3" inside a nested grid
is not the same request.

Being honest about which actions are scopable
beats pretending every button changes meaning.

## Master scope

The master bar carries the same selector, with the same visual grammar.

Master means "all panels" at Layer 1,
so at Layer 2 it means "every nested runtime" —
the same breadth, one layer down.

There is no separate Layer 2 master bar to keep in sync.

---

# Small panels

The user's configuration is kept; the presentation adapts.

A short panel clips the runway rather than spilling controls
over the layout.

Very short panels hide it entirely.

Nothing is silently deleted, and the "···" tray
remains the complete fallback path to every action.

---

# Terminology

POSITION / SLOT      owns physical placement
PANEL                owns content identity
LAYER SCOPE          which runtime object actions target
HOTSWAP CHROME       the control surface
TOP TOOLBAR          retractable push-down inset
SHORTCUT RUNWAY      right-side overlay below the safe zone
RESIZE BORDER        structural resizing boundary

"Hotswap Overlay Controls" remains the customer-facing Settings label
and the storage key prefix.

The architecture is documented as Hotswap Chrome.

No customer-facing rename has been made.


---

# The crossed-out artifact near ···

## BREADCRUMBS — WAS

A human saw a crossed-out, unavailable-looking artifact
when moving the pointer toward the "···" gateway,
with a flicker as the pointer crossed it.

It reproduced on two independent panels.

A screenshot captured the toolbar
but did NOT contain the artifact at all.

## BREADCRUMBS — IS

The "···" gateway was never the problem.

Measured, it is `disabled: false`, `cursor: pointer`, `opacity: 1`.

Undo and Redo sit immediately to its LEFT and are disabled
whenever a panel has no history yet — which is every fresh session.

They carried `cursor: not-allowed` plus `filter: grayscale(1)`,
occupying a roughly 50px band directly on the approach path:

    dx = -50 .. -10   not-allowed
    dx =   0 .. +20   pointer

Crossing that band changed the cursor three times
in about 60px of travel.

Disabled controls now use the ordinary cursor and dimming alone.

`user-select: none` was also restored across the rail —
the corner-era "···" had it, and the rewrite into a flex rail
dropped it, leaving the controls able to begin a text selection
or a native text drag.

## BREADCRUMBS — WHY the screenshot was empty

A CSS cursor is drawn by the compositor.

It is not part of the page bitmap,
so no ordinary screenshot can ever contain it.

The greyed-out neighbours WERE in the capture,
but read as normal dimming rather than as the artifact.

This is worth recording precisely because the evidence
looked contradictory: visible to the eye, absent from the file.
That combination is a strong signal for a cursor
or another compositor-drawn surface — not for a DOM bug.

## BREADCRUMBS — WHY the change

Dimming already communicates "unavailable".

`not-allowed` added alarm rather than information,
and aimed it at the wrong control — the one control
that must stay trustworthy, because it is the fallback gateway
to every action on a narrow panel.
