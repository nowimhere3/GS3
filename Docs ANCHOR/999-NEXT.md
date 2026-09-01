# Next

This document tracks upcoming work.

Items are grouped by architectural phase rather than priority.

---

# Phase 1 — Runtime Foundation (Current)

## Runtime Session

- [ ] Finish Runtime Session ownership
- [ ] Finish Session Serialization
- [ ] Verify every runtime action updates Runtime Session
- [ ] Confirm Runtime as the single source of truth
- [ ] Investigate GitHub sync failure (after Runtime Session is complete)

---

# Phase 2 — Runtime Polish

## User Experience

- [ ] Duplicate/Copy control on the pre-launch Builder, beside Lock/X.
      Deliberately deferred: the Builder's control layout is expected to be
      reorganized, and the runtime "Copy to Position" behavior should be
      settled first so the Builder can reuse it rather than grow a second
      implementation.
- [ ] Quick Favourite
- [ ] Favourite Panel collection
- [ ] Runtime zoom in/out
- [ ] Adjustable (stream) runtime panel borders

---

# Phase 3 — Runtime Intelligence

## Runtime Systems

- [ ] Capability detection
- [ ] Runtime Events
- [ ] Timer engine
- [ ] Automation engine

---

# Phase 4 — Library Improvements

## Collections

- [x] Move Blacklist into Settings
- [x] Move "Ingest Extracted Directories" into Settings

## Part 1-2 Settings breadcrumb

WAS: all major Settings sections were always expanded, while Ingest Extracted Directories and Domain Blacklist occupied primary-page UI.

IS: each top-level Settings card collapses independently and remembers collapsed state in Store; children have no separate collapse state. Ingest is the second Settings card and Domain Blacklist is the final card, with their canonical behavior moved rather than copied.

WHY: Settings exposes complexity on demand and remembers how the customer left it; administrative functions no longer consume primary workflow real estate.
- [ ] Paste-from-clipboard ingest mode
- [ ] Skip selected collections during Shuffle
- [ ] Less-played shuffle mode
- [ ] Shuffle weighting algorithms
- [ ] Favourite collections

---

# Phase 5 — Architecture

## Runtime Separation

- [ ] Extract Stream Runtime from index.html
- [ ] Separate Design-Time from Runtime
- [ ] Make all Runtime executors siblings

Prerequisites:

- Runtime Session complete
- Timer engine complete
- Automation engine underway

---

# Phase 6 — Long-Term

- [ ] Agent framework
- [ ] Media capability scanner
- [ ] NEAR integration

---

# Deferred

Ideas intentionally postponed until the architecture is ready.

- Advanced Runtime Events
- Cloud synchronization
- Autosave
- Crash recovery
- Version history
- Collaborative Runtime

These features should be built on top of Runtime Session rather than before it.
# Pre-launch Shuffle Scope + Runtime ROOT repair breadcrumb

WAS: the Builder dropdown simultaneously acted as user intent, generation
read-out, and launch provenance fallback; Runtime normal Shuffle stayed active
for content with no assigned folder, and Copy duplicated only the URL.

IS: Builder Shuffle Scope is one persisted preference changed only by explicit
dropdown selection. Row folder / Runtime ROOT remains independent and truthful.
Unknown content stays unassigned, normal Runtime Shuffle derives availability
from ROOT, and URL + ROOT travel together through Copy and Position swaps.

WHY: "where should the next Builder Shuffle draw from?" and "which ROOT is this
content assigned to?" are different facts and GS3 must not fabricate either.

---
