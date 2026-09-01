# Hotswap Chrome

The per-panel control surface.

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

The runway begins approximately 2.5 toolbar heights
below the top of the panel.

Almost every website puts account, settings or notification
controls in its top-right corner.

A GS3 hitbox across them — even a fully transparent one —
would silently steal clicks.

The offset is authored proportionally:

    --shortcut-runway-top-offset: calc(var(--hotswap-toolbar-height) * 2.5)

so it scales with the chrome rather than being a magic pixel count.

The runway is exactly as long as its configured count.

A full-height strip would be an invisible wall
down the side of every website.

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
