# GS3 Stage 2.6 — Runtime Stabilization

**Calgary time:** 2026-09-10 08:54 MDT  
**Branch:** `main`  
**Git:** no commit and no push

## Starting git state

The worktree already contained intentional uncommitted Stage 2.1–2.5 changes:
`Docs ANCHOR/000-INVARIANTS.md`, `006-TERMINOLOGY.md`,
`011-HOTSWAP-CHROME.md`, `999-NEXT.md`, `Docs REPORT/Tests/TESTING.md`,
`index.html`, `index2.html`, `index3.html`, `js/launch.js`, `js/settings.js`,
`js/triple-mode.js`, `settings.html`, and `test/boot-smoke.test.js`, plus the
new Claude and AntiGravity report paths shown by `git status`. They were kept
in place and were not reset, reverted, stashed, cleaned, or committed.

## Findings and implementation

### A. Preset display truth

The canonical selection is `workspace.js:getActiveWorkspaceId()` (persisted
through `Store.activeWorkspaceId`). `app.js:_renderWorkspaceTabs()` projects
the active button from that value and displays the selected preset's canonical
`preset.name`; no parallel display-state owner was found.

A mocked remote preset named `Cleaned Bookmarks` was selected, followed by
Preset 2, Preset 5, and `Cleaned Bookmarks` again, then reloaded. The active
visible label tracked every canonical change. The field symptom could not be
reproduced in the current code, so no speculative production change was made.
Coverage now pins the rendering/projection contract.

### B. L2 Undo / Redo

The existing Layer dispatch sends both actions through the same
`_dispatchMasterToLayerTwo()` route used by Shuffle. A real nested Grid URL
mutation was created, then the outer Master targeted `L2-P1`. Forwarded Undo
restored the nested panel and Redo reapplied it while the outer Runtime and its
siblings were unchanged. The field symptom could not be reproduced; no history
or routing rewrite was warranted. The new browser regression proves real
nested effects rather than only inspecting a sent message.

### C. Top2 <-> Bottom2 visual-role continuity

**Confirmed defect:** the layout switch always reset arrangement to identity.
Top2 and Bottom2 use different grid-area bindings, so identity preserved raw
slot placement instead of wide/left-short/right-short visual roles.

`js/positions.js` now contains the explicit bidirectional mapping for this
pair only. `js/triple-mode.js` supplies that mapped arrangement to
`setSessionLayout`; all other layouts retain their established identity reset.
The mapping changes only presentation grid areas. Panel identity, metadata,
iframe nodes, parents, and load state remain intact.

### D. Routine save success interruption

**Confirmed defect:** `pushDatabaseToRemote()` defaulted to a blocking success
`alert` for ordinary database/folder/playlist writes. It now defaults to silent
success. Its failure `alert` remains unchanged. This is the one shared routine
save path behind the reported interruption; no notification-system audit or
redesign was performed.

## Files changed in this pass

- `js/positions.js`
- `js/grid-session.js`
- `js/triple-mode.js`
- `js/sync.js`
- `test/positions-history.test.js`
- `test/stabilization.test.js`
- `test/boot-smoke.test.js`
- `Docs ANCHOR/000-INVARIANTS.md`
- `Docs ANCHOR/007-PANEL-IDENTITY.md`
- `Docs REPORT/Tests/TESTING.md`
- this report

## Tests

Passed:

```text
node --test test/positions-history.test.js test/stabilization.test.js
57 passing, 0 failing
```

Those include the explicit Top2/Bottom2 mapping and the silent-success /
visible-failure save behavior. `node --check` passed for all changed JavaScript
and test files. `git diff --check` passed.

Attempted but blocked before application tests could run:

```text
node --test test/boot-smoke.test.js --test-name-pattern "workspace selector|Top2|L2 Master Undo"
node --test test/boot-smoke.test.js
```

The local Playwright package requires
`chromium_headless_shell-1234`, which is absent under `%LOCALAPPDATA%\\ms-playwright`.
The available install wrapper did not populate that revision, and PowerShell's
execution policy blocks the `npx.ps1` launcher. Every browser-suite test failed
at `chromium.launch()` before its test body executed; this is an environment
dependency failure, not an application assertion or a known Runway/timer flake.

## Anchors and housekeeping

`000-INVARIANTS.md` now records truthful state projection and silent routine
success. `007-PANEL-IDENTITY.md` records the explicit Top2/Bottom2 role map.
No reports were pruned: the newest Claude reports remain current evidence, and
the Codex report history is already within the requested retention range.

## Scope confirmation

Implemented only preset-label regression coverage, real L2 Undo/Redo coverage,
Top2/Bottom2 continuity, and silent routine save success. Not implemented:
Stage 2.7 Layer/top-Chrome UX, grouped Layer disclosure, local shortcut scope,
Fill Panel, Popup Guard, Browser Gallery Hearts, capability bridge/shortcuts,
`index1.html`, Stream executor split, Ghost, Launcher, Automations,
portrait/orientation, or a universal layout/notification framework.

## Final state

The worktree remains uncommitted and unpushed. The pre-existing dirty files
remain alongside the Stage 2.6 files listed above.
