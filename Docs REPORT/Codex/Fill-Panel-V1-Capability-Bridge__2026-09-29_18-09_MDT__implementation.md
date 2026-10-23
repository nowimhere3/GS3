# Fill Panel V1 Capability Bridge — Implementation Report

<!-- sideline-provenance: {"gameId":"game_git_042782b8","clientRef":"ref_1790726000710_8e85670d","playerInstanceId":"codex-998c3b06","playerType":"codex","provider":"codex","model":"gpt-5.6-sol","effort":"medium","at":"2026-09-29T23:53:20.710Z"} -->

Calgary / America-Edmonton timestamp: 2026-09-29 18:09:40 MDT (UTC-06:00)

## Repository state

- Branch: `main`
- HEAD before and after implementation: `597ea5b20eb2ff92cfc6c3f67ac50fc42288bc5c`
- No commit or push was performed.
- Working tree before implementation contained one unrelated untracked file: `Docs REPORT/AntiGravity/Architecture-Confirmation-Fill-Panel-Capability-Bridge__2026-09-29_17-45_MDT.md`.
- That pre-existing file was preserved without modification.

## Files changed

New:

- `js/capability-bridge.js`
- `userscripts/gs3-fill-panel.user.js`
- `test/capability-bridge.test.js`
- `Docs REPORT/Codex/Fill-Panel-V1-Capability-Bridge__2026-09-29_18-09_MDT__implementation.md`

Modified:

- `js/launch.js`
- `js/triple-mode.js`
- `index.html`
- `index3.html`
- `test/boot-smoke.test.js`

The small `js/triple-mode.js` change is mechanically required to unregister ephemeral capability state when triple-mode explicitly removes Panels. The HTML changes are limited to Fill Panel hidden/active presentation CSS. The boot smoke change updates the existing canonical Settings action count from 10 to 11.

## Implementation summary

Implemented the locked Fill Panel V1 architecture as one stateful canonical Hotswap action named `fillPanel`. Top, Runway, and canonical tray controls all derive from and dispatch through that single action. The control is hidden everywhere until a live child iframe truthfully announces support, and it changes from `⛶ Fill Panel` to `✕ Exit Fill Panel` only after the child reports confirmed active state.

Capability state is runtime-only and held in a dedicated Map in `js/capability-bridge.js`. It is not persisted, serialized, placed in Runtime Session, or mixed with `panel-navigation.js::_state.capability`.

## Bridge contract implemented

- Accepts child reports only when `source`, `version`, recognized `type`, `capability`, and required boolean `active` are valid.
- Resolves identity exclusively by matching `event.source` to a live Panel iframe's `contentWindow`.
- Drops reports from nonmatching windows and ignores child-supplied identity data.
- Accepts arbitrary child origins when the live window relationship matches.
- Sends `FILL_PANEL`, `EXIT_FILL_PANEL`, and optional `QUERY_CAPABILITY` messages directly to the intended iframe window with `postMessage(..., '*')`.
- Waits 1500 ms for acknowledgment and logs an advisory warning without faking success.
- Treats exit as idempotent.
- Limits inbound reports to ephemeral capability and presentation state; no Store, preset, navigation, layout, workspace, folder, history, or Runtime Session mutation is introduced.

Generation state is reset on URL assignment, iframe load, reload initiation, Panel kill/removal, launch-matrix replacement, and triple-mode Panel teardown. URL assignment temporarily rejects reports until the new iframe load, preventing queued old-generation messages from becoming authoritative.

## Hotswap integration

Added the canonical action:

```javascript
{
    key: 'fillPanel',
    emoji: '⛶',
    title: 'Fill Panel',
    className: 'btn-hotswap-fill-panel'
}
```

Existing `buildMirror()` behavior supplies Top and Runway mirrors. Both mirrors delegate to the same hidden canonical tray button. There is no second exit action, no separate mirror implementation, and no optimistic active-state transition. Existing Settings registry/order reconciliation automatically accepts `fillPanel`.

## Userscript behavior

The canonical Tampermonkey userscript:

- Detects a viable generic HTML5 `<video>` and likely player container using the proven container preference order.
- Announces `CAPABILITY_PRESENT` only when a usable video/container exists.
- Handles bridge query, enter, and exit commands.
- Reports every confirmed active-state change with a boolean `active` value.
- Supports `Shift+F` while focus is inside the child iframe and keeps GS3 Chrome synchronized.
- Uses a debounced `MutationObserver` for dynamically inserted video and SPA changes; it does not use permanent polling.
- Preserves and restores the page's class-based presentation and scroll position on exit.
- Does not render the old floating standalone button, so framed content has no duplicate customer-facing UI.

## Nested Runtime behavior

Fill Panel remains Panel-local and leaf-content-local. No Master conductor, `L2-P#`, `MASTER_LAYER_ACTION`, or `LAYER_SCOPED_ACTION` routing was changed. An outer Panel containing a nested Runtime does not inherit a deeper video's capability; a leaf iframe inside that nested Runtime can announce and control its own local Fill Panel action.

## Tests added

`test/capability-bridge.test.js` adds eight browser-level acceptance tests covering:

- hidden capability-absent presentation and malformed-message rejection;
- arbitrary-origin live sender acceptance and nonmatching sender rejection;
- canonical, Top, and Runway single-action delegation;
- enter/exit payloads, no optimistic state, confirmed synchronized presentation, and timeout behavior;
- absence of iframe reload/reparent during toggles;
- no persistence, Runtime Session, or navigation-history mutation;
- URL/load generation resets and queued old-generation rejection;
- nested outer absence and nested leaf-local behavior;
- Settings reconciliation;
- dynamic userscript discovery, no polling/floating button, `Shift+F`, and exit restoration;
- unchanged existing registry controls and absence of Master/L2 routing.

The existing Settings boot-smoke assertion was extended to account for the new canonical registry action.

## Tests executed

- `node --test test/capability-bridge.test.js` — 8 passed, 0 failed.
- `node --check js/capability-bridge.js` — passed.
- `node --check js/launch.js` — passed.
- `node --check js/triple-mode.js` — passed.
- `node --check userscripts/gs3-fill-panel.user.js` — passed.
- Targeted existing Hotswap, Settings, Stage C, and copy-position coverage — passed except the two baseline failures listed below.
- `node --test --test-concurrency=1` — 181 total, 179 passed, 2 failed.
- `git diff --check` — no whitespace errors; Git emitted only existing-platform LF-to-CRLF conversion warnings.

## Pre-existing failures

The final serial suite's two failures were independently reproduced in a clean temporary worktree at the untouched baseline HEAD `597ea5b20eb2ff92cfc6c3f67ac50fc42288bc5c`:

1. `Part 1-2 Runway tracks website top and active Runway pickers own stable geometry` — folder-picker geometry is reported at top `0` / right `445` and outside the expected bounds instead of `8` / `8` / inside.
2. `L2 Master Undo and Redo mutate only selected nested Runtime` — test timeout.

The temporary baseline worktree was removed after comparison. These failures were not repaired because they are unrelated to Fill Panel and were present before this Worker implementation.

## New regressions

None observed. The dedicated feature suite passes 8/8, syntax checks pass, and the full serial suite has only the two failures reproduced at baseline.

## Manual verification still required

- Install or update `userscripts/gs3-fill-panel.user.js` in the intended Tampermonkey browser profile.
- Exercise representative real third-party video sites inside GS3, including a dynamically inserted SPA player.
- Verify Top, Runway, and Deep Cuts visibility/state in the real browser Chrome.
- Verify enter, `Shift+F`, exit, navigation reset, and restoration of the original page presentation on representative sites.

## Remaining risks

- V1 intentionally supports generic HTML5 video only; canvas, DRM/custom-rendered, deeply encapsulated shadow-DOM, or hostile player implementations may not expose a viable container.
- Player-container selection is heuristic and may need future site-specific refinements based on field evidence.
- Bridge reports are advisory and intentionally use live WindowProxy identity rather than origin allowlists or a nonce. The implementation confines their effects to ephemeral presentation state as designed.
- Real-world Tampermonkey execution can vary with iframe sandboxing, userscript manager settings, and site policy, so live-browser acceptance remains important.

## Git status after implementation

```text
 M index.html
 M index3.html
 M js/launch.js
 M js/triple-mode.js
 M test/boot-smoke.test.js
?? Docs REPORT/AntiGravity/Architecture-Confirmation-Fill-Panel-Capability-Bridge__2026-09-29_17-45_MDT.md
?? Docs REPORT/Codex/Fill-Panel-V1-Capability-Bridge__2026-09-29_18-09_MDT__implementation.md
?? js/capability-bridge.js
?? test/capability-bridge.test.js
?? userscripts/gs3-fill-panel.user.js
```

## Recommended next action

Perform the manual Tampermonkey/real-site acceptance pass, then have the Human Head Coach review the bounded diff and baseline-failure evidence before authorizing any commit or push.

Calgary / America-Edmonton completion timestamp: 2026-09-29 18:09:40 MDT (UTC-06:00)
