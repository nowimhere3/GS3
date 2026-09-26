# Terminology

This document defines the project's core architectural language.

These definitions should remain stable over time.

## Position shorthand

`P1`, `P2`, `P3`, and `P4` mean Fixed Position 1–4. They are presentation
addresses, never permanent Panel identities. Use “Panel currently at P1” when
both facts need to be named.

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

# Hotswap Chrome

A Panel's control surface.

Two parts: a retractable TOP TOOLBAR that insets content,
and a SHORTCUT RUNWAY overlaying the right edge.

---

# Layer Scope

Which runtime object a control acts on.

Two scopes only: L1 and L2.

Stated explicitly by a highlighted selector,
never implied by where a control sits.

---

# Content

Information describing what a Panel contains.

Examples:

- URLs
- Folder assignments
- Collections
- Runtime variables

---

# Builder Shuffle Scope

The user's persisted global Builder preference for normal Shuffle:
"which folder should fresh links come from next?"

It changes only when the user changes the main Builder folder dropdown.
It is not row provenance, Preset data, Workspace design, or Runtime Session state.

---

# Row Folder / Runtime ROOT

The known folder assignment carried by a row's content and, after launch, by
the Runtime Panel. Normal Runtime Shuffle draws from this ROOT.

Manual or otherwise unknown content may have no ROOT. Shuffle All may establish
one; Assign Folder may establish or change one; Edit URL preserves an existing
ROOT but never invents one. Copy duplicates ROOT. Position swaps preserve ROOT
with the moving Panel/content because Position never owns it.

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

Canonical executor family:

- index.html = Workspace / Design-Time
- index1.html = Stream Runtime (future; not implemented)
- index2.html = Solo Runtime
- index3.html = Grid Runtime

The assignment-time executor registry distinguishes runtime from design-time. Stream extraction is deferred; current launch navigation still targets index.html.

---

# Layer 1

A Runtime launched directly by the user.

Layer 1 establishes the primary execution environment.

---

# L2-P# addressing

Two distinct vocabularies deliberately share the shape "Layer 2 + a number" and
must never be conflated:

`L2-P#` — in the MASTER conductor selector, names WHICH nested Runtime a
Layer-scoped command addresses: the one entered through outer HOST Position
`#` (e.g. `L2-P1` = the nested Runtime hosted by outer Position 1). Only
rendered for Positions that truthfully host an active nested Runtime — never a
fixed set of slots. `P#` here is the outer Runtime's own Position numbering
(006-TERMINOLOGY.md § Position shorthand); it is re-derived on every refresh,
so a Panel moving P1 -> P4 turns `L2-P1` into `L2-P4` for the SAME nested
Runtime, with nothing recreated or reloaded.

`L2 · P#` — in a NESTED Runtime's own local Chrome (Position labels, the
Position button's tooltip), names an INTERNAL Position of that Layer-2
Runtime — exactly the same fact an un-nested Runtime would call "Position #",
spelled differently only so it is never mistaken for the host's `L2-P#`
addressing of it from outside. Long form: "Layer 2 · Position #".

The hyphen/interpunct distinction is the whole trick: `L2-P1` is an outer
routing target; `L2 · P1` is an inner physical place. Selecting `L2-P1` on the
Master conductor does not mean "go to that Runtime's own Position 1" — it
means "address the Runtime that lives there."

---

# Layer 2

A Runtime executing inside another Runtime.

Layer 2 enables nested execution and Runtime composition.

Eligibility is declared by Panel content metadata in Runtime Session: an explicit Workspace Panel or an assigned Runtime executor carrying options.runtime.layer = 2. Ordinary URL resemblance does not declare Layer 2. Declaration is not runtime confirmation; a cooperative confirmation handshake is deferred.

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
