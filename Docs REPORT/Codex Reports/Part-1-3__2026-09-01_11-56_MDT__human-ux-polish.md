# GS3 Codex Implementation Report

**Part:** Part 1-3
**Date:** September 1, 2026
**Time:** 11:56 AM MDT
**Timezone:** Calgary, Alberta — America/Edmonton
**Agent:** Codex
**Role:** Implementation / UX Polish
**Repository:** /home/dmcalorum/GS3

## Breadcrumb

WAS

Runway mirrors stored the correct invocation anchor, but the canonical picker handler cleared it before placement, allowing pickers to appear toward panel top/left. Toolbar controls began beside Position. Hotswap switches touched their content edge, and major collapse carets preceded titles.

IS

Runway pickers preserve the one-shot invoking anchor, sit 6px left, center vertically when possible, and clamp by only the necessary boundary delta. Position stays left while layer scope, configurable actions, Undo, Redo, and Deep Cuts form a right cluster. Every Hotswap switch uses one 12px trailing inset. Major titles remain left and carets sit far right while the whole row remains interactive.

WHY

Picker ownership should be visually obvious, the toolbar should read as structural identity plus a coherent command cluster, and precise Settings alignment should have comfortable spacing and cleaner hierarchy.

## Files changed

Part 1-3 directly changed `js/launch.js`, `js/settings.js`, `settings.html`, `test/boot-smoke.test.js`, `docs/011-HOTSWAP-CHROME.md`, and `docs/Tests/TESTING.md`, plus this report. All earlier intentional Part 1 files remain in the dirty tree.

## Runway picker anchoring

The mirror's invocation context is now preserved across the canonical handler's defensive `closePicker()` call. Runway invocation requests left placement with centered alignment. The existing helper computes `anchorCenterY - pickerHeight/2`, then applies the existing 6px panel clamp. Horizontal placement remains `picker.right = anchor.left - 6px`. Top and Deep placement rules were not redesigned.

Measured Edit URL geometry: 6px horizontal gap; vertical center delta within 1px; inside panel bounds; no Runway overlap. It remains wide, autofocuses, places caret at the URL end, scrolls to the tail, survives beyond 850ms, and does not reveal Top.

Measured Assign Folder geometry: 6px horizontal gap; vertical center delta within 1px with space available; inside panel bounds. A transformed near-bottom test calculated preferred and maximum Y independently and proved actual Y equals the exact clamp result, with the picker bottom inside the panel.

## Toolbar alignment

The existing flexible spacer moved immediately after Position in the toolbar DOM. Position therefore remains fixed left; L2/L1 when present, configurable shortcuts, Undo, Redo, and `···` share the right cluster. No control ownership or action implementation changed. Existing actual-width fitting still demotes configurable actions from the end into Deep Cuts, widening restores them, and order/count remain byte-identical.

## Settings presentation

One `--hotswap-trailing-inset: 12px` token applies to every comparable Hotswap row/header, preserving one global switch axis and preventing clipping without per-row offsets. At the standard test viewport the shared switch right coordinate moved from the Part 1-2 934px axis to approximately 922px; all controls passed within ±1px and measured exactly 12px inside their parent right edge.

Major section toggle markup now orders title then caret, with `grid-template-columns: 1fr auto`. Title is at the far left and caret at the far right. The button still spans the full heading width; off-caret clicks, Enter activation, `aria-expanded`, `aria-controls`, persistence, and the no-child-toggle rule all pass.

## Documentation

Added chronological WAS/IS/WHY breadcrumbs for picker attachment, toolbar grouping, switch breathing room, and caret relocation. Updated the verification guide with the exact geometry and structural assertions.

## Tests

Targeted suite: 4/4 passed, covering Part 1-2 lifecycle/Settings, Part 1-3 anchoring/grouping/spacing/caret, and responsive preference immutability.

Full suite: `npm test` — 113/113 passed, 0 failed, 0 skipped.

`git diff --check` passed with no output.

## Continuity and invariants

Existing continuity probes still prove zero iframe loads, identical iframe nodes and parents, unchanged `src`, unchanged iframe width, and preserved live documents for presentation operations. No presentation Undo checkpoint occurs. Runtime ownership, Workspace isolation, Store preference ownership, unified Top/Deep projection, visibility-before-cutoff, independent Runway, website-relative 1.75H geometry, picker lifecycle, structural controls, persistent collapse state, and Settings-only Ingest/Blacklist remain intact.

## Known limitations

Very tall pickers necessarily cannot remain centered at a boundary; they move only to the computed 6px clamp. Native action reordering remains desktop drag/drop, as previously documented and out of scope.

## Unrelated observations deliberately not pursued

None investigated. All enumerated out-of-scope Runtime, Settings, cursor, touch, L2, and Phase 5 work was left untouched.

## Final git status

```text
 M docs/000-INVARIANTS.md
 M docs/011-HOTSWAP-CHROME.md
 M docs/999-NEXT.md
 M docs/Tests/TESTING.md
 M index.html
 M index3.html
 M js/app.js
 M js/folders.js
 M js/hotswap-chrome.js
 M js/launch.js
 M js/settings.js
 M js/storage.js
 M settings.html
 M test/boot-smoke.test.js
 M test/positions-history.test.js
?? docs/Claude Reports/Part-1-2__2026-09-01_11-08_MDT__settings-chrome-architecture.md
?? docs/Codex Reports/
```

Nothing committed.
Nothing pushed.
