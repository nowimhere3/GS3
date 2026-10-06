<!-- sideline-provenance: {"gameId":"game_git_042782b8","clientRef":"ref_1790743502390_0e66885a","playerInstanceId":"claude-1f660b52","playerType":"claude","provider":"claude","model":"sonnet","effort":"medium","at":"2026-09-30T04:45:02.390Z"} -->
# Top Toolbar / Runway Visibility Lifecycle Repair

Agent: Claude Sonnet 5.5 (Worker) — Result: PASS

- Branch: `main`; HEAD: `5d04db7`
- Working tree before: only untracked `Docs REPORT/` files (AntiGravity x2, Claude/). No tracked changes.

## Root cause confirmed
1. `layoutTopShortcuts()` unconditionally set `hidden = false` on every Top shortcut, overriding capability hiding.
2. `lastPhysicalFitCutoff` early return fired after the unhide, leaving overflowed shortcuts visible.

## Files changed
- `js/capability-bridge.js` — `_render` sets/clears `data-capability-hidden="true"` next to `hidden`, and dispatches panel-scoped `gs3:fill-capability-changed`.
- `js/launch.js` — `layoutTopShortcuts()` keeps capability-hidden buttons hidden, measures/reveals only eligible ones, removes the memo (final visibility applied every pass), passes the position-in-full-list to `projectDeepCuts`; panel listens for the event and re-lays out.
- `test/capability-bridge.test.js` — `bootGrid` takes optional order/topCount/viewport; 3 new tests.

## Tests added
1. Capability-absent Top + Runway stay hidden through pointerenter/leave cycles and resize.
2. Overflowed Top shortcuts stay hidden across repeated reveal cycles (narrow viewport, 9 shortcuts).
3. CAPABILITY_PRESENT after build reveals Runway and Top (re-layout via event).

All 3 fail on the old code and pass on the new.

## Results
- capability-bridge.test.js: 11/11 pass (3 new, 8 existing).
- Full `node --test`: 181 pass, 3 fail.
- Pre-existing failures (also fail on baseline without my change): "Part 1-2 Runway tracks website top…", "L2 Master Undo and Redo mutate only the selected nested Runtime". Also flaky and varying between runs, including on baseline: "Copy to Position…", "Move to Position…", "Panel Undo walks in-content navigation…".
- New regressions: none identified.

## Git status after
Modified: `js/capability-bridge.js`, `js/launch.js`, `test/capability-bridge.test.js`; plus the same untracked report files and this report. Nothing committed or pushed.

## Recommended next action
Human field check: configure Fill Panel in Settings, hover the toolbar, confirm Top and Runway both hidden until a capable page announces itself. Then commit.
