# Terminology

This document defines the project's core architectural language.

These definitions should remain stable over time.

---

# Workspace

A persistent editable design.

A Workspace describes a future Runtime.

A Workspace never executes.

---

# Runtime

A live executing Workspace.

Runtime owns the Runtime Session.

Timers, Events, Automations and Agents execute here.

---

# Runtime Session

The authoritative in-memory state of a live Runtime.

Everything currently visible should be represented here.

---

# Panel

A Panel owns content.

Examples:

- URL
- Workspace
- Future runtime object

Panels should not own presentation.

A Panel owns runtime media identity.

Panels are what Undo and Redo are scoped to.

---

# Slot

A Slot owns presentation.

Slots determine where Panels appear.

Panels may move between Slots without changing their content.

---

# Position

A fixed physical location in a Runtime layout.

Position 1 is always the first physical place.

Position 2 is always the second.

Media changes.

Panels visually move.

The Position itself never moves.

Positions are numbered in the layout's established visual order,
beginning from the top-left and continuing clockwise.

Positions are scoped to a layout.

Changing layout redefines them.

---

# Position Assignment

Which Position a Panel is currently rendered in.

Position assignment is presentation.

Changing it never changes content,
and never reloads media.

Resolution is always:

Position -> fixed grid-area -> whichever Panel currently renders as that area.

A user should never have to ask where a screen currently is.

They should be able to say "send this to Position 1"
and know exactly where it will appear.

---

# Panel Action History

Reversible Runtime mutations GS3 performed on a Panel.

Owned by Runtime Session.

Master Undo reads only this.

---

# Panel Navigation History

Reversible browsing that occurred inside a Panel's
current content generation.

GS3 observes it but does not cause it.

It is not a Runtime action.

---

# Content Generation

One GS3 content assignment and the browsing done inside it.

A new assignment opens a new generation,
so browsing cannot leak across a deliberate content replacement.

---

# Content

Information describing what a Panel contains.

Examples:

- URLs
- Folder assignments
- Collections
- Runtime variables

---

# Presentation

Information describing how Panels are displayed.

Examples:

- Layout
- Arrangement
- Orientation
- Visibility

Presentation should never require content reloads.

---

# Design-Time

The editing environment.

Currently represented by:

index.html

Responsibilities:

- Edit Workspaces
- Configure layouts
- Organize collections

Design-Time never performs autonomous behavior.

---

# Runtime Executor

A page responsible for executing a Runtime.

Current executors:

- index.html (Stream Runtime)
- index2.html (Solo Runtime)
- index3.html (Grid Runtime)

Long-term these should become sibling runtimes.

---

# Layer 1

A Runtime launched directly by the user.

Layer 1 establishes the primary execution environment.

---

# Layer 2

A Runtime executing inside another Runtime.

Layer 2 enables nested execution and Runtime composition.

Only Layer 2 objects participate in Runtime automation.

---

# Collection

A logical grouping of content.

Collections may eventually support:

- Favorites
- Shuffle weighting
- Skip rules
- Automation rules

---

# Folder

A storage grouping used for content organization.

Folders provide the source material for Runtime behavior.

---

# Automation

A rule executed by Runtime.

Automations only execute inside Runtime.

Design-Time never executes automations.

---

# Runtime Event

A significant occurrence within Runtime.

Examples:

- Timer fired
- Panel loaded
- Panel completed
- Shuffle completed
- User interaction

Automations respond to Runtime Events.

---

# Agent

An autonomous system capable of interacting with Runtime.

Agents observe Runtime Events and perform Runtime actions.

Agents never bypass the Runtime Session.
