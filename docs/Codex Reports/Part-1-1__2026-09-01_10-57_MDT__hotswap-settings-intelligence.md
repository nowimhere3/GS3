# GS3 Codex Implementation Report

**Part:** Part 1-1
**Date:** September 1, 2026
**Time:** 10:57 AM MDT
**Timezone:** Calgary, Alberta — America/Edmonton
**Agent:** Codex
**Repository:** /home/dmcalorum/GS3

## Work requested

Implement the Claude/Opus-approved Hotswap Settings intelligence and picker geometry architecture without resetting the intentional dirty tree, committing, or pushing.

## Breadcrumb

WAS

Top Toolbar and Deep Cuts had independently persisted orders. Responsive fitting hid trailing Top buttons. Edit URL and Assign Folder shortcuts opened Deep Cuts to expose tray-bound picker rows. Nested Settings layout put switches on different global axes. The Runway safe zone was 1.5 toolbar heights.

IS

Top and Deep Cuts project from one 10-action order and Top cutoff. Intentional visibility filters before that cutoff. Actual-width overflow is appended to Deep Cuts and widening restores it without preference writes. Settings derives active/grey cutoff rows for this list and for the independent Runway. Picker rows are panel-level popovers anchored to the invoking Top, Runway, or Deep control. Every Hotswap switch shares the same measured right axis. The safe zone is 1.75 toolbar heights.

WHY

Customers should not count or duplicate-manage action membership; responsive layout must not make actions unreachable; and picker actions should open where invoked without tray teleportation or Runway collision.

## Files changed

- `js/storage.js`
- `js/hotswap-chrome.js`
- `js/launch.js`
- `js/settings.js`
- `settings.html`
- `index.html`
- `index3.html`
- `test/positions-history.test.js`
- `test/boot-smoke.test.js`
- `docs/000-INVARIANTS.md`
- `docs/011-HOTSWAP-CHROME.md`
- `docs/Tests/TESTING.md`
- This report.

## Implementation completed

- Preserved `HOTSWAP_ACTIONS` as the canonical registry and singular action implementation.
- Unified Top/Deep vocabulary to the 10 ordinary configurable actions. Position/Copy remain owned by Position; Undo/Redo remain fixed Top controls; `···` remains structural.
- Added `hotswap_action_order` and `hotswap_top_count`. Legacy Top/tray keys remain readable and untouched but are no longer written.
- Deterministic migration chooses the legacy Top prefix, appends unique legacy tray entries, then missing registry entries. Presence of the unified order makes migration one-time.
- Filters `hotswapButtonVisibility` before Top/Deep projection, so a hidden action consumes no Top slot and is not silently restored in Deep Cuts.
- Measures each rendered shortcut's actual width, including wider multi-glyph actions, computes a physical cutoff, guards unchanged cutoff applications, and ignores zero-width retracted rails.
- Deep Cuts receives the visible remainder after the effective configured/physical cutoff. Its gateway stays enabled; an empty tray says `All actions are on the toolbar.`
- Runway retains independent enabled state, order, and count, including Undo/Redo eligibility and intentional duplication with Top/Deep.
- Settings uses one reorderable Top/Deep list. Rows outside each configured cutoff are visually greyed, remain draggable/enabled, and expose descriptive accessibility text. Runway uses the same derived cutoff grammar.
- Repaired the prior nested Settings subsection markup and applied a shared two-column trailing-control grid. Browser measurement found a common switch right edge of 934px; every `.hotswap-panel .switch` passed within ±1px.
- Extracted picker presentation from the tray: the same canonical Edit URL/Assign Folder handler receives invocation context, while panel-level picker rows vary only anchor and placement. Top prefers below; Runway and Deep prefer left. Small flip/clamp logic keeps pickers inside the panel and constrains leftward popovers before the Runway.
- Picker lifecycle participates in Escape, outside pointer, successful choice, and normal 850ms Hotswap family behavior. Opening is presentation-only.
- Updated both runtime CSS copies and documentation/tests from 1.5× to 1.75× Runway safe-zone geometry.

## Architectural decisions inherited from Claude

Runtime Session remains authoritative; Workspace is design-time; Chrome and Position are presentation. Panel identity is stable. Top/Deep are one ordered projection; Runway is independent. Structural ownership and canonical action singularity remain unchanged. Responsive pressure may change only projection, never preferences. No Hotswap presentation operation may reload, rebuild, reparent, re-src, or checkpoint an iframe.

## Tests added or changed

- Added pure-model coverage for deterministic one-time legacy migration and visibility-before-cutoff.
- Updated browser coverage for the unified list, 10-vs-12 surface vocabularies, new storage keys, 1.75× geometry, picker-without-tray behavior, all-switch global alignment, responsive preference immutability, and unified Deep remainder.
- Existing browser continuity tests continue to prove stable iframe nodes/parents/canary contexts and zero loads for presentation operations.

## Test results

- Targeted pure suite: `node test/positions-history.test.js` — 47/47 passed.
- Focused Hotswap browser reruns passed after correcting stale independent-tray expectations and the genuine Settings nesting defect.
- Full suite: `npm test` — 110/110 passed, 0 failed, 0 skipped.
- `git diff --check` — passed with no output.

## Continuity and invariant verification

The full browser suite retained the established continuity proofs: zero iframe reloads for presentation operations; identical iframe nodes and parents; unchanged documents/canary contexts where observable; and unchanged `src`. Picker opening and resize projection do not call Runtime mutation or Undo checkpoint pathways. Structural Position, optional L2/L1, Undo, Redo, and `···` survive narrow layouts. Runway order/count are not mutated by Top changes or resize cycles.

## Known limitations

Native drag/drop remains desktop-only, as explicitly out of scope. Extremely small panels clamp picker width and position within available space; the implementation intentionally remains a small Hotswap-specific popover rather than a generic framework.

## Unrelated observations deliberately not pursued

None investigated. Fill Panel, Preset 7, Automations, Runtime Events, Capability Detection, Builder Duplicate, Phase 5, master Undo cursor styling, touch drag/drop, and L2 receiver expansion remained out of scope.

## Final git status

```text
 M docs/000-INVARIANTS.md
 M docs/011-HOTSWAP-CHROME.md
 M docs/Tests/TESTING.md
 M index.html
 M index3.html
 M js/hotswap-chrome.js
 M js/launch.js
 M js/settings.js
 M js/storage.js
 M settings.html
 M test/boot-smoke.test.js
 M test/positions-history.test.js
?? docs/Codex Reports/Part-1-1__2026-09-01_10-57_MDT__hotswap-settings-intelligence.md
```

Nothing was committed. Nothing was pushed.
