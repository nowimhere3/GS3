<!-- sideline-provenance: {"gameId":"game_git_042782b8","clientRef":"ref_1791251728545_c8e4453c","playerInstanceId":"claude-1352dbb4","playerType":"claude","provider":"claude","model":"sonnet","effort":"medium","at":"2026-10-06T01:55:28.545Z"} -->
# Settings "Connect & Fetch Database" — Regression Diagnosis

- **Agent / model:** Claude Sonnet 5.5 (medium) — Monday 2026-10-05, ~22:10 MDT (Calgary)
- **Base:** `HEAD = 4f098c0`; working tree = uncommitted FILL_EMBED candidate. Nothing cleaned/stashed/reset; a temporary git worktree for the baseline was created and removed.
- **Verdict:** **The FILL_EMBED candidate does not break Settings.** Settings boots and the Connect button works on the committed baseline, on the live GitHub Pages site and on the current working tree. I could not reproduce "nothing happens" with current code; I found and proved the mechanism that produces exactly that symptom (a stale/mismatched cached module), plus two other silent paths. **No production fix was made** (the fix policy applies only if FILL_EMBED broke Settings). A regression test was added.

## Phase 1 — production diff inventory (working tree vs `4f098c0`)
```
M js/capability-bridge.js   (+78/-5)  FILL_EMBED overlay, new exports refreshFillPanelPresentation, exitFillEmbed
M js/launch.js              (+4/-2)   imports those two exports; calls them
M js/presentation-url.js    (+80)     getFillPresentationUrl
?? test/fill-embed.test.js            (new, tests only)
```
`js/settings.js`, `js/sync.js`, `settings.html`: **UNCHANGED** vs `4f098c0` (verified with `git diff HEAD`). `launch.js` is statically imported by `settings.js` (`HOTSWAP_ACTIONS`), so a failure anywhere in `launch.js -> capability-bridge.js -> presentation-url.js` would stop `settings.js` from running.

## Phase 2/3 — Settings boot and the button (no real credentials)
Playwright, Chromium and the **installed Chrome 152**, current working tree served at `http://localhost:8080/settings.html`:
- No module import failure, no page/console error. `#btn-connect-git` exists and its `onclick` **is attached**.
- Click with blank token/repo → alert `Please populate both Token and Repository target strings.`
- Hotswap Settings renders: `HOTSWAP_ACTIONS` has 15 entries incl. `fillPanel`; 35 toggle rows; Fill Panel appears in both lists.
- With a **fake token and a mocked GitHub API** (no real call): success path → `Database synchronized successfully! Directory pools populated.`; HTTP 401 → `Sync Error: Could not read links-index.json.`; network failure → `Sync Error: Failed to fetch`; **a request that never answers → no dialog at all** (the only silent path in the code).
- First error captured: **none** on the current tree.

## Phase 4 — baseline vs candidate
| Target | Settings boots | Connect handler attached | Blank-credential click |
|---|---|---|---|
| `4f098c0` (temporary worktree on port 8091) | PASS | YES | alert shown |
| Live `https://nowimhere3.github.io/GS3/settings.html` (committed code) | PASS | YES | alert shown |
| Current working tree (candidate) | PASS | YES | alert shown |

Baseline PASS and candidate PASS → no bisect needed.

## The mechanism that does produce "inert button" (proved, not assumed to be the Human's cause)
Because `settings.js` depends on `launch.js`, a **mismatched module set** kills it. I served the current tree but substituted the OLD `capability-bridge.js` (as a stale browser-cached copy would be, next to the newly edited `launch.js`):
```
pageerror: SyntaxError: The requested module './capability-bridge.js' does not provide an export named 'exitFillEmbed'
#btn-connect-git.onclick -> null   (typeof document.getElementById('btn-connect-git').onclick = "object", i.e. null)
```
settings.js never runs, nothing is attached, the button is inert with no dialog — exactly the reported symptom. The local `python -m http.server` sends no cache headers (only `Last-Modified`), so Chrome may reuse a previously cached module for a while after a file is edited; two files edited at different times can then be served from different generations. Hard-reloading the page (Ctrl+Shift+R) or "Disable cache" in DevTools refreshes the whole graph. This is a plausible explanation for a tab opened/refreshed around the time `launch.js` and `capability-bridge.js` were changed, but I could not inspect the Human's browser to confirm it.

Other silent paths (by code reading + the mock): a GitHub request that never completes shows nothing (no timeout or progress UI), and Chrome's "Prevent this page from creating additional dialogs" suppresses `alert()` silently — both look like "nothing happens". `Store.set` has no try/catch, but a near-full `localStorage` quota test still produced the normal Sync Error dialog (not reproduced).

## Sync path check
Not involved in the boot: `sync.js` unchanged; with a mocked remote it reads `links-index.json` (404 → legacy fallback `links.json`), reports success/error normally. No `launcher.json` dependency. I touched no database files and used no real PAT.

## Regression test added
`test/settings-boot.test.js` (own server on port 4175; 4/4 pass): (1) `settings.html` boots with zero page/console errors; (2) `#btn-connect-git` has a function handler and a blank-credentials click yields the expected alert; (3) with a mocked GitHub API and a fake token, success shows the success alert and a 401 shows `Sync Error: …`; (4) the Hotswap Settings lists render the `HOTSWAP_ACTIONS` registry including **Fill Panel**. The stale-module scenario above is caught by (1) and (2) (module SyntaxError / no handler).

## Required report
```
BASE HEAD: 4f098c0
CURRENT PRODUCTION DIFF: js/capability-bridge.js, js/launch.js, js/presentation-url.js (+ new test/fill-embed.test.js)
SETTINGS BASELINE 4f098c0: PASS
SETTINGS CURRENT CANDIDATE: PASS
FIRST ERROR: none on current code. (With a stale capability-bridge.js: SyntaxError: module './capability-bridge.js' does not provide an export named 'exitFillEmbed')
ROOT CAUSE: not reproduced; the mismatched/stale cached module graph (launch.js newer than capability-bridge.js) is the proven way to get an inert Connect button; a hung GitHub request or suppressed alert() are the other silent paths
CONNECT HANDLER ATTACHED BEFORE FIX: YES (on current code); NO under the stale-module scenario
SYNC.JS BROKEN: NO
LINKS-INDEX / CASSETTES BROKEN: NOT INVOLVED
FIX: none (not needed; no production change)
SETTINGS BOOT AFTER FIX: PASS (no change)
CONNECT BUTTON AFTER FIX: PASS (no change)
FILL_EMBED REGRESSION: NO
CLOUDBATE REGRESSION: NO (no code touched; adapter unchanged)
POPOUT SHIELD REGRESSION: NO
PRODUCTION FILES CHANGED BY FIX: NONE (test added: test/settings-boot.test.js)
COMMIT: NO
PUSH: NO
```

## What the Human can check on the failing Settings tab (read-only)
1. Hard-reload the Settings tab (Ctrl+Shift+R), open DevTools → Console, click the button again. A red `SyntaxError … does not provide an export named …` or `onclick` being null confirms the stale-module case.
2. To tell "dialog suppressed" from "no response": paste `window.alert = (m) => console.log('ALERT:', m);` then click. (Console-only; remove by reloading.)
3. In DevTools → Network, look for `api.github.com` requests left "pending" after the click (hung request, no timeout in the UI).
