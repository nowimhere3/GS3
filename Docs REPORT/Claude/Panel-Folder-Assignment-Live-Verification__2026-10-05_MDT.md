<!-- sideline-provenance: {"gameId":"game_git_042782b8","clientRef":"ref_1791228111312_0376142e","playerInstanceId":"claude-1352dbb4","playerType":"claude","provider":"claude","model":"sonnet","effort":"medium","at":"2026-10-05T19:21:51.312Z"} -->
# GS3 Individual Panel Folder Assignment — Live Runtime Verification

- **Calgary time:** Monday 2026-10-05, ~13:40 MDT
- **Agent / model:** Claude Sonnet 5.5 (medium)
- **Branch / HEAD:** `main` / `f96d712`
- **Git status before:** untracked only (`Docs REPORT/`, `Docs ANCHOR/Breadcrumbs/`, `architecture-lab/current-url-bridge/`, `architecture-lab/fill-panel/`). No tracked changes.
- **Verdict:** **NOT REPRODUCED ON CLEAN LOAD (branch G).** Diagnosis only; no code fix made.

## Method
- Real `index3.html` and the real module graph, served from the repo by `python -m http.server 8080`, in a **fresh headless Chromium profile** (Playwright; no Human Chrome, no remote-debugging connection). `window.GS3R0` was confirmed `undefined` (no Current-URL harness).
- Same setup the repo's own tests use: seeded `loop_matrix_urls` with canary fixtures, and a database `{Alpha, Beta}` (4 distinguishable canary URLs each) set through `state.js`.
- **Log-only probes** were injected into the *served response bytes* (`page.route`, in memory; no file edited) at: folder-item `onclick`, `setIframeUrl`, `onPanelContentChanged`, `updateRenderedPanel`, `beginPanelContent`, `_renderPanels`, and the per-Panel Shuffle reader. All 7 probes applied.
- After every step, state was read from the three projections (`getSessionFolderMap()`, `state.js getUrlFolderMap()`, `iframe[data-source-folder]`) plus `data-last-src`, the session URL, the iframe's actual loaded URL, and the `panel-navigation` generation.
- Lab script: `architecture-lab/folder-assign-verify/run.mjs` (+ `extra.mjs`, `hit.mjs`).

## Evidence (every row is a real run)
| Panel / path | Step | Session | state.js | DOM | Assigned → loaded | Gen | Calls observed |
|---|---|---|---|---|---|---|---|
| slot 0, tray 📁 | before | null | null | "" | A → A | 1 | |
| | **assign Alpha** | **Alpha** | Alpha | Alpha | alpha1 → alpha1 | 2 | setIframeUrl → onPanelContentChanged → updateRenderedPanel → beginPanelContent |
| | **Shuffle** | Alpha | Alpha | Alpha | alpha4 → alpha4 | 3 | Shuffle used **Alpha** pool |
| | **assign Beta** | **Beta** | Beta | Beta | beta4 → beta4 | 4 | same chain |
| | **Shuffle** | Beta | Beta | Beta | beta4 | 5 | **Beta** pool |
| slot 1 (second Panel), tray | Alpha, Shuffle, Beta, Shuffle | all three always equal and correct | | | Shuffle pools Alpha / Beta | 2→5 | same chain every time |
| slot 2, **Top Toolbar folder mirror** | Beta, Shuffle, Alpha, Shuffle | all three equal and correct | | | pools Beta / Alpha | 2→5 | **`folderItem.onclick` fired**, then the full chain, then `shuffle.reads {domFolder}` = the just-assigned folder |
| Master 🎲 rebuild after assigning | `_renderPanels` | slot 0 Beta, slot 1 Beta (kept) | kept | kept | in-folder URLs | 6 | `_renderPanels{map}` preserved assigned roots |

Page errors: none. Dialogs: none.

## Classification
- **A (picker/event failure):** No. Folder item `onclick` fired every time; the picker rows were visible, in-viewport and hittable (`elementFromPoint` = the item).
- **B / C / D:** No. Session, state.js and DOM changed together; `iframe.src`/loaded URL followed; generation advanced by one per assignment.
- **E (rebuild erases it):** Not observed. Master Shuffle re-rendered and kept the assigned folders.
- **F (Shuffle uses wrong root):** No. Shuffle's DOM read equalled the Session folder in all runs; pools matched.
- **G:** **Yes — NOT REPRODUCED ON CLEAN LOAD.**

## Observations worth keeping (no fix made)
1. **"Chooser opens and I can pick, but the Panel doesn't route" has a by-design lookalike.** `launch.js` folder `onclick` does `setIframeUrl(loadReplacement(folder) || currentUrl, folder)`: if the chosen folder has no routable URL (empty, or all blacklisted) the folder IS adopted but the iframe stays on its current URL. Measured: assign "Empty" on slot 0 → Session/DOM = `Empty`, `data-last-src` unchanged, gen 1→2. A single-URL folder whose URL equals the current one also looks like "nothing happened" (folder = `One`, same URL, gen 2→3).
2. **Real mouse click on the Top Toolbar folder mirror was blocked in my headless run for slot 2** (Playwright: element covered by `.resizer.resizer-h`); I dispatched the click to continue. For slots 0/1 the mirror was "covered by `post-iframe`" with the rail closed. **Inconclusive:** I did not open the toolbar rail with real pointer movement, so I do not claim a hit-test defect — but this is the one place a real-mouse path differs from my dispatched click, and the Human's report says the chooser did open.
3. **Latent re-inference (static reading only, not exercised at runtime):** `_buildTripleSet()` (initial boot at `triple-mode.js` ~1515 and Master Folder at ~1279) infers each Panel's root from `urls[i]` via `_inferFolderForUrl` and does not read the session `_folderMap` for non-empty Panels; first matching folder wins when a URL lives in several folders. This could drop a Panel assignment on boot/workspace load — a different symptom than the one reported.
4. Per-Panel Shuffle reads `iframe[data-source-folder]`, not the Runtime Session. They stayed identical in every tested flow, so this is a design smell, not a failure here.

## Required output
```
REPRODUCED:
NO (clean load, real index3.html)

FIRST FAILING TRANSITION:
none observed

PICKER CLICK FIRED:
YES (folderItem.onclick fired on every selection, via tray and via Top Toolbar mirror)

RUNTIME SESSION ROOT:
null → Alpha → Beta (slot 0); null → Alpha → Beta (slot 1); null → Beta → Alpha (slot 2)

STATE.JS ROOT:
identical to Session at every step

DOM ROOT:
"" → Alpha → Beta, identical to Session at every step

ASSIGNED URL:
A → alpha1 → (Shuffle) alpha4 → beta4 ...; always inside the assigned folder

IFRAME ACTUAL LOAD:
followed the assigned URL every time

GENERATION:
1 → 2 per assignment, +1 per Shuffle (1→2→3→4→5)

NEXT PANEL SHUFFLE USED:
the just-assigned folder (Alpha pool after Alpha; Beta pool after Beta)

SECOND PANEL RESULT:
slot 1 and slot 2 behave identically; no slot-specific corruption

CURRENT-URL HARNESS INVOLVEMENT:
NO in this run (GS3R0 undefined). I could not inspect the Human's live tab: Remote Debugging is off and I opened no connection to the Human's Chrome. My earlier Current-URL harness was an observer only (it never calls the folder/assignment path), so it is an unlikely cause but is not ruled out for that specific tab.

ROOT CAUSE:
No defect reproduced; the Human's symptom is most likely state specific to their live tab (stale instrumentation/older page state), or a folder with no routable URL (adopted but not routed), or a panel aimed at Layer 2 — none of which I could observe.

MINIMUM FIX SURFACE:
none identified. If the Human reproduces it on a clean reload of the tab, capture: which control (tray 📁, Top Toolbar mirror, Runway), the chosen folder's size, and whether the Panel hosts a nested GS3 (Layer 2); then re-run this script's probes against that exact state.

IMPLEMENTATION:
NOT PERFORMED
```

> **The individual Panel Folder Assignment fails because it does not fail on a clean load of the real index3.html: the folder click, session write, state.js and DOM projections, route, generation and next Shuffle were all consistent and correct across three Panels and both entry points, so the Human's symptom depends on live-tab state I could not see (stale page or instrumentation, an unroutable folder, or Layer-2 scope), not on the code path I could execute.**

## Production / git
- **Production files touched: NO.** Probes were injected in memory per response; only `architecture-lab/folder-assign-verify/` and this report were created. No commit, no push.
- **Git status after:** unchanged tracked tree; untracked lab folders + reports only. A read-only `python -m http.server 8080` is running on 127.0.0.1.
- **Unfinished earlier play:** the Current-URL Bridge R0.1 was left waiting for the Human's dialog count and real-F12 check; no new Chrome connection was made in this play.
