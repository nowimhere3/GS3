# Project Philosophy

This project is not a browser.

It is not a gallery.

It is not a bookmark manager.

It is a Runtime Orchestration Engine.

The browser is simply one runtime implementation.

---

# Architecture First

Every feature should improve the architecture.

Avoid temporary fixes.

Prefer structural improvements over local patches.

Good architecture compounds.

---

# Runtime First

Never ask:

"How should we save this?"

Instead ask:

"What does Runtime currently believe?"

Save becomes serialization.

Load becomes reconstruction.

Everything else follows naturally.

---

# Single Responsibility

Each major subsystem has one responsibility.

Workspace designs.

Runtime executes.

GitHub persists.

Collections organize media.

Settings configure behavior.

Reducing ownership overlap reduces complexity.

---

# Working Copies

A running Runtime Session is a working copy.

It is not the original Workspace.

Users should be free to experiment without risking the source.

Saving is an intentional action.

---

# Build Foundations

Features should emerge naturally from the architecture.

Examples include:

- Autosave
- Crash Recovery
- Session Restore
- Version History
- Cloud Sync
- Runtime Events
- Agents
- Automations

If a feature feels difficult to implement, improve the architecture first.

---

# Runtime Over UI

UI changes frequently.

Architecture changes rarely.

When choosing between improving architecture or improving UI, architecture usually produces greater long-term value.

The best UI is often a consequence of good architecture.

---

# Reduce Friction

The application should gradually require fewer user actions.

Automation should increase over time.

Manual work should decrease.

The software should eventually feel alive rather than reactive.

---

# Runtime Evolves

Runtime should become increasingly capable without increasing complexity.

Each new capability should integrate into the existing architecture rather than creating parallel systems.

Complex behavior should emerge from simple primitives.

---

# The Conductor

Panels are the talent. The bottom Runtime shell is the conductor.

Panel Chrome controls one Panel and its local content.

The global bottom Runtime shell orchestrates the Runtime as a whole, and — as
Layer routing matures — becomes the one coherent place to address nested
Runtimes and external application capabilities.

The user should never need to reason about iframe ownership, message
plumbing, or which document rendered which control. Ownership must be
visually and behaviorally coherent, not merely internally correct.

Mouse controls and keyboard shortcuts are two invocation surfaces for the
same semantic orchestration action, never two separate implementations of it.
A shortcut invokes what the action means — "favorite the thing currently at
Position 3" — not a DOM node. This is what keeps a shortcut binding portable
across a UI that will keep rearranging itself.

---

# Design for the Future

Every major decision should make future development easier.

The goal is not simply to build features.

The goal is to build an engine that makes future features straightforward to implement.

Architecture is the product.

Features are consequences of the architecture.
