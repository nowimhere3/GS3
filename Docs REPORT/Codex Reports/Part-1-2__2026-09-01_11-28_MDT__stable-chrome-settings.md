# GS3 Codex Implementation Report

**Part:** Part 1-2
**Date:** September 1, 2026
**Time:** 11:28 AM MDT
**Timezone:** Calgary, Alberta — America/Edmonton
**Agent:** Codex
**Role:** Implementation
**Repository:** /home/dmcalorum/GS3

## Breadcrumb

WAS

Part 1-1 positioned Runway 1.75 toolbar heights from panel top. Edit URL autofocus from Runway revealed Top, autonomous retract could terminate a picker, URL editing showed the URL start in a narrow field, Settings cards were always open, and Ingest/Blacklist occupied index.html.

IS

Runway is derived from current website top plus 1.75 toolbar heights. Chrome-family focus keeps interaction alive while only rail-family focus reveals Top. An open picker yields the existing retract timer until explicit dismissal. URL editing is responsive, focused at the tail, and scrolled to the tail. Seven major Settings cards independently collapse with persisted state. Ingest and Blacklist live only in Settings in the required order.

WHY

Chrome geometry must remain stable under the customer during interaction, Settings complexity should be available on demand and remembered, and administrative tools should not consume primary workflow space.

## Files changed

Part 1-2 directly changed `js/launch.js`, `index.html`, `index3.html`, `js/settings.js`, `js/storage.js`, `js/app.js`, `js/folders.js`, `settings.html`, `test/boot-smoke.test.js`, `docs/000-INVARIANTS.md`, `docs/011-HOTSWAP-CHROME.md`, `docs/Tests/TESTING.md`, and `docs/999-NEXT.md`, plus this report. The working tree also retains all intentional Part 1-1 changes and the Claude Part 1-2 architecture report.

## Runway website-relative geometry

Both runtime CSS copies define one `--hotswap-website-inset`, defaulting to `0px` and becoming `--hotswap-toolbar-height` only under `.chrome-revealed`. `--shortcut-runway-top-offset` derives inset + height × 1.75; no 2.75 magic factor exists in product CSS. Runway `top` transitions over the same 0.16s as the toolbar. It remains absolute and overlay-only.

Chromium measured a 30px toolbar: retracted Runway top 53px, revealed top 83px, reveal delta 30px, and retracted restoration 53px. Iframe width was unchanged.

## Focus/reveal correction and final Runway behavior

The root cause was canonical Edit URL autofocus bubbling `focusin` to a handler that conflated cancelling retract with revealing Top. `inChromeFamily` still includes picker rows, but a new rail-family predicate limits physical reveal to toolbar, activation, Deep Cuts, and Position menu ownership. All family focus cancels retract. Runway Edit URL now opens leftward, focuses its input, and leaves Top closed. Runway Assign Folder also opens leftward with Top closed. The invoking Runway anchor retained the same measured Y coordinate.

## Picker ownership and dismissal

One `hasOpenPicker()` guard makes the existing 850ms timer yield without introducing another timer or controller. One `closePicker()` clears picker rows, active canonical controls, and pending invocation state.

Exact dismissal paths are successful URL commit/folder selection, Escape, deliberate outside pointerdown, same invoking control toggle, and eventual panel destruction through normal teardown. Pointer leave, anchor-to-picker travel, focus, typing, pauses, timers, Deep Cuts closing, and `setToolbarRevealed(false)` do not dismiss. Toolbar retract is explicitly not a picker-dismissal mechanism.

## Edit URL UX

The URL picker uses `width: clamp(280px, 60%, 560px)` and an input with `flex: 1 1 auto; min-width: 0`. Existing boundary clamping keeps it inside the panel. After layout, `focus({preventScroll:true})`, `setSelectionRange(end,end)`, and `scrollLeft = scrollWidth` focus the canonical URL tail. Tests prove width at least 280px and within bounds, active focus, both selection endpoints equal value length, and positive horizontal scroll for a long URL.

## Persistent collapsible Settings

Every top-level `.config-card[data-section]` receives one real button with `aria-expanded`, `aria-controls`, caret, and a persistent `.section-body`. Children remain in the DOM and are never reconstructed. Hotswap children have no nested collapse controls. Expansion of a previously hidden Hotswap body defers its resize refresh through `requestAnimationFrame`, preventing zero-box measurement from becoming meaningful state. Form and drag/order DOM state survive collapse cycles.

Persistence uses Store key `settings_section_state`, canonical name `settingsSectionState`, JSON type, default `{}`. Values are a map of `{ sectionId: true }`, where true means collapsed and missing means open. Multiple cards remember independently; first-run and future sections default open.

Final Settings order is: GitHub Cloud Sync Pipeline; Ingest Extracted Directories; Hotswap Overlay Controls; Folder Manager; Frame Height Settings; Ghost Mode; Domain Blacklist.

## Administrative relocation

Ingest markup and IDs were removed from index.html and added once to Settings. Settings initializes the existing `initDropzone` only after database state exists, supplies the same state/sync context, and uses the canonical `updateDirectoryDropdown` folder pathway. A small null-safe adjustment lets that canonical helper populate the Settings ingest selector without requiring the index directory selector. Browser tests imported a real text file through the canonical parser, state merge, dropdown refresh, and mocked GitHub PUT.

Domain Blacklist markup was removed from index.html and added once as the final Settings card. Settings calls the existing `initBlacklist`, `initBlacklistUI`, and `renderBlacklistDisplay`; Runtime state-loading calls remain. Browser tests passed add, render, remove, and clear. `js/blacklist.js` semantics were unchanged.

## Documentation

Added chronological WAS/IS/WHY breadcrumbs for website-relative Runway geometry, picker ownership, persistent Settings collapse, and administrative relocation. Marked only the two completed relocation roadmap items in `docs/999-NEXT.md`.

## Tests

Targeted Part 1-2 browser suite: 2/2 passed. It covers Runway closed/open/restored positions, exact delta, overlay-only width, Runway invocation isolation and anchor stability, >850ms ownership, typing pause, focus/caret/scroll/width, Escape/outside dismissal, continuity, all-card collapse/expand, keyboard/ARIA, persistence, independent state, Hotswap deferred alignment, exact section order, unique relocation IDs, ingest, and Blacklist behavior.

Full suite: `npm test` — 112/112 passed, 0 failed, 0 skipped.

`git diff --check` passed with no output.

## Continuity and invariants

The Part 1-2 continuity probe recorded zero iframe loads, identical iframe node and parent, unchanged `src`, unchanged iframe width, and preserved live document. No geometry, picker-open/close, or Settings-collapse pathway invokes a Runtime mutation or Undo checkpoint. Runtime Session, Workspace, Store, panel identity, Position ownership, canonical action singularity, Part 1-1 Top/Deep projection, independent Runway preferences, and the 1.75 factor remain intact.

## Known limitations

Native Settings action reordering remains desktop drag/drop, as already documented and out of scope. Collapsed-card transitions intentionally use immediate `display:none` rather than animated height. Picker geometry remains the deliberately small Hotswap-specific system.

## Unrelated observations deliberately not pursued

The architecture report noted the master Undo cursor and Ghost card's separate axis; both remain out of scope. Fill Panel, Preset 7, Automations, Runtime Events, Capability Detection, Builder Duplicate, Phase 5, touch drag/drop, and L2 receiver expansion were not investigated.

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
