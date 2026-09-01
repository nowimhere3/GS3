# Panel Identity

Every runtime panel has a permanent identity.

Identity is independent from:

- Screen position
- Layout
- Arrangement
- Workspace
- Collection

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
