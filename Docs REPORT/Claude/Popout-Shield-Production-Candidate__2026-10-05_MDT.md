<!-- sideline-provenance: {"gameId":"game_git_042782b8","clientRef":"ref_1791243133608_20a6c7f1","playerInstanceId":"claude-1352dbb4","playerType":"claude","provider":"claude","model":"sonnet","effort":"medium","at":"2026-10-05T23:32:13.608Z"} -->
# GS3 Popout Shield — Production Candidate (awaiting Human field test)

- **Agent / model:** Claude Sonnet 5.5 (medium) — Monday 2026-10-05, ~18:10 MDT (Calgary)
- **Base:** `git fetch origin` → `origin/main` = `212ddb0` = local `main`; tracked tree clean before the change; all untracked labs/reports preserved (nothing stashed, reset or cleaned).

## Change (the whole production behaviour change)
`js/launch.js:323` (`_buildPanel`, the canonical Panel iframe creation path):
```diff
-    iframe.sandbox   = 'allow-same-origin allow-scripts allow-forms allow-popups';
+    iframe.sandbox   = 'allow-same-origin allow-scripts allow-forms';
```
Diff: 1 file, 1 line. No provider logic, no `?play=true`, no setting, no CDP, no Current-URL or Fill changes.

## Validation on the real index3.html (`architecture-lab/popout-shield/verify-candidate.mjs`)
- All 4 Panel iframes: `sandbox="allow-same-origin allow-scripts allow-forms"`, `allow="autoplay; fullscreen"` (unchanged).
- Present: `allow-scripts`, `allow-same-origin`, `allow-forms`. **Absent:** `allow-popups`, `allow-popups-to-escape-sandbox`, `allow-top-navigation`, `allow-top-navigation-by-user-activation`.
- Behaviour with a same-origin test Panel: scripts run (timers advance); same-origin parent access works; form submit navigates the Panel frame itself; top page unchanged; `window.open()` + `target=_blank` produced **0 new pages** and 2 Chrome "Blocked opening…" messages.

## Focused tests (`node --test`)
| Run | Result |
|---|---|
| boot-smoke: 4 page boot tests, metadata folder Undo, Master-Shuffle Panel Undo, Stage C folder routing, Assign Folder Escape | 8/8 PASS |
| `test/capability-bridge.test.js` (whole file) | 11/11 PASS (one test failed once in a combined run, passed alone and in the file run: timing flake) |
| `L2 Master Undo and Redo mutate only the selected nested Runtime` | **FAILS — also fails on unmodified `212ddb0`** (I reverted my one line temporarily and re-ran it twice: same `waitForFunction` 5 s timeout). Pre-existing, unrelated to this change. |

The full boot-smoke suite was not run.

## Result block
```
BASE HEAD: 212ddb0
PRODUCTION FILE CHANGED: js/launch.js
OLD SANDBOX: allow-same-origin allow-scripts allow-forms allow-popups
NEW SANDBOX: allow-same-origin allow-scripts allow-forms
OTHER PRODUCTION CHANGES: NONE
FOCUSED TESTS: PASS (one pre-existing failure, reproduced on 212ddb0: L2 Master Undo and Redo)
READY FOR HUMAN FIELD TEST: YES
COMMIT: NO
PUSH: NO
```

## Human field test (real Chrome, current working-tree build)
Serve this repo (e.g. `python -m http.server 8080`), open `http://localhost:8080/index3.html` (hard refresh), load:
1. **Canary:** a Cloudbate **video page** in a Panel → press Play (twice). Expect: **no new tab, browser focus stays on GS3.** Not playing is acceptable (provider adapter is a later Play).
2. **Smoke:** 2–3 sites that normally play in GS3. Expect: playback still works, no unexpected navigation, no new tab.
Report back: any new tab/focus change, any site whose playback or navigation regressed.

Note: GS3's own code uses no `window.open`/`_blank`; sites relying on popups (OAuth/login windows, ad-gated players) will now be blocked inside Panels by design.
