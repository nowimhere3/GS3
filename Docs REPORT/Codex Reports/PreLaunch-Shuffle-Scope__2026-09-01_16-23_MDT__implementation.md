# GS3 Pre-Launch Shuffle Scope + Runtime Root Repair

Calgary Timestamp: 2026-09-01 16:23 MDT
Timezone: America/Edmonton
Agent: Codex
Role: Implementation + Testing

## Verdict

PASS

## WAS / IS / WHY

WAS: The Builder folder dropdown was an unowned DOM value serving simultaneously as user input, generation read-out, and launch provenance fallback. Normal Shuffle randomly chose folders; Shuffle All rewrote the dropdown to an invalid manual/blank value; dropdown rebuild could silently destroy selection; manual URLs could inherit fake provenance from the dropdown; and Runtime Shuffle on an unassigned panel remained clickable until failure. Copy duplicated only URL and left the destination's unrelated ROOT behind.

IS: Builder Shuffle Scope is one persisted preference controlled only by explicit user dropdown selection. Normal Builder Shuffle reads it. Shuffle All ignores it temporarily, enforces a hard maximum of two ordinary unlocked placements per eligible folder, and never mutates it. `folderMap` records actual generated provenance and manual Builder edits clear untruthful provenance. Runtime panels use assigned ROOT: normal Shuffle requires a valid ROOT, all tray/toolbar/runway presentations share one availability derivation, Shuffle All and Assign Folder establish ROOT, Edit URL preserves but does not create ROOT, Position swaps preserve ROOT with content identity, and Copy duplicates URL + ROOT.

WHY: “Where should I shuffle from next?” and “Which folder is this content assigned to?” are different facts. GS3 must not fabricate one from the other.

## Files Changed

- `js/storage.js` — `KEYS`, `DEFAULTS`, `TYPES`: registered the global `builderShuffleFolder` / `builder_shuffle_folder` string preference.
- `js/shuffle-scope.js` — new `getShuffleScopeFolder`, `setShuffleScopeFolder`, `resolveShuffleScope`, `planShuffleAllFolders`: single preference owner and pure hard-cap planner.
- `js/folders.js` — `updateDirectoryDropdown`: restores/resolves the persisted scope after option rebuild by direct value assignment, persists deterministic fallback, and dispatches no synthetic change.
- `js/grid.js` — `renderInputRows`, `_fillInputsFromFolder`, `initGrid`: clears provenance on manual entry; consolidates blacklist-aware folder fills; makes normal Shuffle scope-driven; makes Shuffle All scope-preserving and hard max-2 with one capacity message. Existing `_applyShuffleToInputs` lock behavior and canonical persistence funnel remain intact.
- `js/launch.js` — `updateRenderedPanel`, new `updatePanelActionAvailability`, `_buildPanel`: removes dropdown launch fallback; centrally synchronizes normal Shuffle availability across canonical/mirrored surfaces while preserving Layer 2 forwarding; reads the live database for replacements; keeps Edit URL ROOT semantics.
- `js/triple-mode.js` — `_copyUrlToPosition`: Copy now duplicates URL + ROOT in Runtime Session and rendered panel. Position swap code is unchanged.
- `index.html` — Builder Shuffle tooltips now describe selected-folder and scope-preserving mixed generation behavior.
- `test/shuffle-scope.test.js` — new deterministic scope resolution and hard max-2 planner tests.
- `test/boot-smoke.test.js` — new Builder 50-press scope/rebuild test, Runtime ROOT availability/action test, and owner-approved Copy ROOT expectation.
- `Docs ANCHOR/006-TERMINOLOGY.md` — defines Builder Shuffle Scope and Row Folder / Runtime ROOT.
- `Docs ANCHOR/999-NEXT.md` — compact WAS/IS/WHY architecture breadcrumb.

## Builder Shuffle Scope Implementation

`builder_shuffle_folder` is a Store preference with one accessor module. It is not routed through Workspace persistence, Presets, Runtime Session, `folderMap`, or `matrixUrls`. Database dropdown rebuild resolves stored scope against current folder keys, falls back to the first key deterministically when necessary, persists that fallback, and directly assigns the DOM selection without firing `change`.

## Builder Shuffle / Shuffle All Behavior

Normal Shuffle reads the resolved preference and fills ordinary unlocked rows only from that folder, with blacklist filtering. Explicit dropdown selection writes the preference and performs the same blacklist-aware fill. Shuffle All plans only ordinary unlocked rows across all eligible folders, never uses any folder more than twice, leaves excess rows and provenance unchanged, emits one capacity alert, and never changes the selected/stored scope. Both actions retain the single existing `saveInputsToState()` persistence/Undo checkpoint.

## Runtime ROOT Semantics

Launch ROOT now comes only from actual row `folderMap`; the Builder dropdown fallback is removed. Runtime Edit URL omits a folder mutation, preserving an existing ROOT and leaving NONE unchanged. Shuffle All and Assign Folder update URL + ROOT together. Replacement lookup reads the current database rather than a panel-construction snapshot.

## Unassigned Runtime Shuffle Availability

`updatePanelActionAvailability()` is the canonical derivation. L1 normal Shuffle is enabled only when the panel has a ROOT that exists in the current database. The canonical tray button and every configured mirror share disabled state and explanatory title. Shuffle All, Assign Folder, and Edit URL remain enabled. A legitimately forwarded Layer 2 Shuffle remains enabled when the selector is visibly aimed at L2.

## Swap / Copy Root Preservation

Position swap logic remains pure presentation: it changes CSS grid-area arrangement only and does not touch URL, ROOT, iframe node, parent, or `src`. ROOT therefore stays with panel/content identity. Copy now duplicates the source URL and ROOT; an unassigned source clears destination ROOT. Existing action history remains the sole Runtime history mechanism.

## Tests Added / Updated

- 50 consecutive normal Builder Shuffles assert dropdown, stored scope, and every ordinary row remain in A.
- Shuffle All scope preservation followed by normal Shuffle return to A.
- Non-mutating dropdown rebuild, deleted-folder deterministic fallback, and Store/DOM agreement.
- Pure planner repeated-generation max-2 checks and deterministic 2-folder/6-row exhaustion (`[4,5]` untouched).
- Runtime unassigned disabled state across canonical and mirrored Shuffle controls; other actions remain enabled.
- Shuffle All establishes ROOT and immediately enables normal Shuffle.
- Edit URL preserves assigned ROOT and does not create an unassigned ROOT.
- Copy expectation updated from obsolete URL-only behavior to URL + ROOT.
- Existing lock, blacklist, Undo, Runtime isolation, Layer 2, swap continuity, navigation, Hotswap, Preset, and cassette coverage retained.

## Automated Test Results

- Targeted pure suite: 2 test files passed (`positions-history`, `shuffle-scope`), 0 failed.
- Targeted browser rerun: 5 selected tests; 4 passed and one unrelated geometry assertion varied by 4 px. The same isolated geometry test immediately passed on rerun. No production change was made for this pre-existing timing/geometry variance.
- Final complete `npm test`: 124 tests, 124 passed, 0 failed, 0 cancelled, 0 skipped, 0 todo. Duration: 103905.066375 ms.

## git diff --check

PASS — no whitespace errors.

## Regression Audit

- Preset schema unchanged: confirmed.
- Builder Scope not Runtime state: confirmed.
- Scope change not Undoable: confirmed; its Store write bypasses Workspace mutation/history.
- Runtime Grid isolation preserved: confirmed by architecture and full regression suite.
- Layer 2 preserved: confirmed; visible L2 targeting remains forwardable and is not disabled by outer ROOT.
- Position swaps preserve iframe identity: confirmed by existing continuity tests.
- No new iframe reload/rebuild/reparent/re-src from swaps: confirmed; swap implementation untouched.
- Curated mode preserved: confirmed; existing provenance rendering/re-render remains.
- Lock semantics preserved: confirmed; `_applyShuffleToInputs` was not rewritten.
- Blacklist behavior preserved/improved as specified: confirmed; dropdown fill now filters blacklist too.
- Cassette persistence untouched: confirmed; >1 MB indexed-cassette regression passes.
- No unrelated implementation files changed: confirmed. The untracked Opus diagnosis was present before implementation and was not modified.

## Human Tests Recommended

None. Requested behavior is mechanically covered.

## Known Limitations / Notes

One pre-existing picker geometry assertion showed a transient 4 px variance during a targeted multi-test run and passed immediately in isolation and in the final full suite. No product behavior failure remained.

## Git Status

```text
 M "Docs ANCHOR/006-TERMINOLOGY.md"
 M "Docs ANCHOR/999-NEXT.md"
 M index.html
 M js/folders.js
 M js/grid.js
 M js/launch.js
 M js/storage.js
 M js/triple-mode.js
 M test/boot-smoke.test.js
?? "Docs REPORT/Claude Reports/PreLaunch-Shuffle-Scope__2026-09-01_15-37_MDT__architecture-diagnosis.md"
?? "Docs REPORT/Codex Reports/PreLaunch-Shuffle-Scope__2026-09-01_16-23_MDT__implementation.md"
?? js/shuffle-scope.js
?? test/shuffle-scope.test.js
```

No commit performed.
Nothing pushed.
