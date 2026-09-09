# Panel Identity

Every runtime panel has a permanent identity.

Identity is independent from:

- Screen position
- Layout
- Arrangement
- Workspace
- Collection

Panel identity travels through Position swaps. A future external capability may
display its current presentation address (`P1`/`P4`) without making Position
the owner of that capability or its state.

A panel may move between screen positions without changing identity.

---

## UUID

Each panel owns a UUID.

The UUID never changes during the lifetime of that panel.

The UUID survives:

- Position swaps
- Layout changes
- Session saves
- Session loads

The UUID represents the panel itself,
not where it is displayed.

---

## Slot Identity

A slot is presentation.

A panel is content.

Slots may exchange panels.

Panels never become slots.

---

## Identity vs Position

Panel identity answers "which panel is this".

Position answers "where is it right now".

These are separate questions and must never be conflated in the UI.

A user targeting "Position 3" means the third physical location,
not the panel that happened to begin there.

Panel identity is what history is scoped to.

An action records which panel or panels it affected,
so Undo and Redo can act on one panel
without disturbing anything else that is playing.

When one action affected several panels because they merely
changed at the same moment, each panel owns its own portion
of that action and may reverse it alone.

When an action affected several panels because it could not
have affected one without the other, it reverses as a whole.

---

## Future Uses

Panel UUIDs will enable:

- Runtime Events
- Timers
- Automation targets
- Agents
- Analytics
- Watch history
- Playback history
- Future synchronization

Every runtime object should eventually have a stable identity.

## Durable Layer identity (Tier 1 + Tier 2)

Layer identity is Panel-scoped content metadata. It travels with Panel identity through Position swaps. Undo/Redo restores it with the Panel. Copy duplicates the whole Panel and its ROOT folder. URL Panels declare nested execution in options.runtime = { layer: 2, kind }; explicit Workspace Panels declare it by type. No Position or separate Store key carries Layer identity.

## Nested Runtime launch handoff

A nested Runtime launch replaces Panel content through the canonical assignment
funnel. The resulting Runtime identity travels with that Panel, never with a
Position, grid area, or DOM discovery order.

## Mirrored layout transitions

A layout switch may permute which grid-area name each Panel's slot renders as
(Position plumbing), in order to preserve the Panel's VISUAL ROLE across a
mirrored pair of layouts (e.g. Left Tall <-> Right Tall). The Panel's whole
identity — content, Runtime metadata, ROOT/folder assignment, media playback —
travels through that permutation intact; only presentation (arrangement)
changes, exactly as an ordinary Position swap does. This is not special-cased
plumbing: Left Tall and Right Tall already bind the same grid-area names to
the same visual roles (their own tall cell, top-short cell, bottom-short
cell) in index3.html's CSS, and a layout switch already resets the session
arrangement to identity — so visual-role continuity for that pair falls out
of the existing architecture with no additional permutation logic. A future
layout pair whose area-name bindings do not already align this way would
need an explicit, deliberate permutation, not an assumed one — see
999-NEXT.md.
