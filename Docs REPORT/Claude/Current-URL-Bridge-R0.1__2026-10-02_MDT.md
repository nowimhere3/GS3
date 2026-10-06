<!-- sideline-provenance: {"gameId":"game_git_042782b8","clientRef":"ref_1790958285561_c0284efd","playerInstanceId":"claude-1352dbb4","playerType":"claude","provider":"claude","model":"sonnet","effort":"medium","at":"2026-10-02T16:24:45.561Z"} -->
# GS3 Current-URL Bridge — R0.1 Report (Authorization-Loop Repair)

- **Calgary time:** Friday 2026-10-02, ~10:35 MDT
- **Agent / model:** Claude Sonnet 5.5 (medium)
- **Branch / HEAD:** `main` / `f96d712`
- **Git status before (this session start):** untracked only (`Docs REPORT/*`, `architecture-lab/fill-panel/`, `architecture-lab/current-url-bridge/`). No tracked changes.
- **Status now:** **R0.1 IN PROGRESS — authorization seam NOT YET PROVEN.** Lab repaired and smoke-tested on a private Chrome; waiting for ONE clean Human authorization on the real Chrome. Verdict is therefore **NOT READY FOR SLICE 1 (pending the single-authorization test)**.

## 1. Root cause of the repeated "Allow remote debugging?" prompts
**Most likely cause (strong circumstantial evidence; not yet proven by controlled test): my R0.1 test harness opened a new browser-level CDP WebSocket for almost every diagnostic command.**

Counted from this session's own command history after Remote Debugging was enabled:

| Browser-level WebSocket client | Count |
|---|---|
| `companion.mjs` runs (each opens exactly one connection and holds it) | 2 |
| One-off probe (`probe.mjs`) | 1 |
| Helper scripts, each calling `connect()` → `new WebSocket(browserEndpoint)`: `r01-status`, `r01-snap`, `r01-browse`, `r01-refresh`, `r01-where`, `r01-frames`, and an inline `node -e` | ~28 successful |
| Failed / hung attempts after the companion was killed (`r01-snap`, `r01-refresh`, `r01-browse`, `probe2` ×2) | ~5 |
| **Total** | **~36 top-level browser connections in about 25 minutes**, in bursts of several seconds apart |

That matches the Human's observation (prompt "every few seconds") and the final symptom: after the companion was killed, the next helper connection **hung** instead of failing (a pending Allow dialog), and the earlier timings fit too (first companion connect took 6.8 s — a dialog — later ones 1.5 s).

What the logs do show about the alternative hypotheses:
- **Child sessions under one connection:** the companion held ONE connection and attached/detached at least 5 child sessions (page, 4 OOPIFs, a worker) plus several more across Refresh/navigation swaps. Its log shows `connected to browser endpoint` exactly once per process and no reconnects.
- **Provider navigation / OOPIF swaps:** many provider navigations and two real Refreshes happened inside that single companion connection.
- **Why this is not yet "proven":** I cannot attribute a specific Chrome dialog to a specific connection from my side (Chrome gives no per-dialog log), and during the bursts the companion and helpers were running together. The controlled test below (ONE connection, zero helpers) is what proves or disproves it.

## 2. Repairs made (lab only; production untouched)
- **Connection topology before:** `Chrome ⟵ companion (1 WS)` **plus** `Chrome ⟵ helper (1 new WS per command)` ×~30.
- **Connection topology after:**
  ```
  Chrome ── ONE persistent browser WebSocket ──► companion.mjs
                                                   ├─ host page session (injects real-gs3-harness.js, binding)
                                                   ├─ Panel/OOPIF child sessions via Target.setAutoAttach (flatten)
                                                   ├─ navigation observation → SSE to the GS3 page
                                                   └─ loopback diagnostic API  127.0.0.1:8766/api/*
                                                                 ▲
                                    ctl.mjs / r01-longevity.mjs / r01-degrade.mjs  (HTTP only; NEVER touch Chrome)
  ```
- **Deleted** the defective direct-connect helpers (`r01-lib.mjs`, `r01-browse|snap|status|where|frames|refresh.mjs`) so a second Chrome client cannot be created by accident.
- **Companion API:** `/api/snap` (real harness status), `/api/panels` (slot ↔ frame ↔ session type), `/api/browse?slot&filter` (click a real link inside the Panel's provider iframe via its child session), `/api/refresh?slot` (clicks the REAL `.btn-hotswap-reload`), `/api/pause|resume` (simulate bridge-absent without a new Chrome connection), `/api/lifecycle` (timestamped session events + counters).
- **Evidence counters:** `conn.browserWebSockets` (must stay 1), child sessions attached/detached, timestamped `lifecycle` log, so the Human's dialog count can be lined up with events.
- **No reconnect:** if the one connection closes the companion exits instead of reconnecting (a reconnect = a new authorization). Existing-Chrome mode also no longer subscribes to the browser-wide target-discovery stream.
- **Smoke test (private temp-profile Chrome, no Human dialog involved):** the API drove a real in-iframe click through the OOPIF child session; `/api/panels` showed `OOPIF iframe target (child session)`; after assign + browse + pause + resume + lifecycle read, `browserWebSockets = 1`, 3 child sessions. Not yet run against the real Chrome/GS3.

## 3. Real-GS3 evidence already earned (preserved, not redone)
Real Chrome 152 (installed, default profile, `chrome://inspect/#remote-debugging`; connection via the `DevToolsActivePort` browser endpoint; plain CDP WebSocket works, `/json/version` HTTP returns 404 in this mode). Real `http://localhost:8080/index3.html`, 4 Panels.

| # | Check | Result |
|---|---|---|
| A1 | Companion connects to real headed Chrome via the authorized endpoint | PASS (but triggered the prompt loop — see §1) |
| B1 | Real Panels correlated: slot 0 XVideos, 1 SpankBang, 2 XNXX, 3 EliteBabes. Stamp = `data-gs3-slot` from real `data-slot-index`; real generation read from `getPanelNavigationState(slot).generation` | PASS |
| C1 | XNXX search → video (real click), then second video | PASS — Current updated each hop; Assigned `…/search/deepthroat?top` unchanged |
| C2 | XVideos: A→B→C | PASS |
| C3 | SpankBang (a third provider; no provider logic anywhere in bridge) | PASS |
| C4 | EliteBabes (no Fill adapter) — landing observed; no clickable same-host links found for a navigation step | PARTIAL |
| D1 | Multi-panel: independent navigation in slots 0/1/2; others stayed `null` | PASS |
| E1 | `assigned`/`data-last-src` untouched; harness writes no storage/session/presets | PASS |
| F1 | **Real GS3 Refresh** (`.btn-hotswap-reload`) on slot 2: iframe returned to Assigned, Current cleared, real gen 2→3; `src` briefly `about:blank` (GS3's own two-step reload) | PASS |
| G1 | Stale generation: slow (delayed 2.5 s) event for browsed B, real Refresh at +0.5 s → event dropped (`STALE(arrival)`), never accepted under the new gen (gen 4) | PASS |
| H1 | OOPIF: every real provider Panel appeared as an `iframe` target/child session; no same-page-tree provider seen; the bridge tolerates both | PASS |

Findings from the real runs:
- **Real generation hook point (future production):** inside `beginPanelContent(slotIndex, url, expectedLoads)` in `js/panel-navigation.js`, which runs immediately BEFORE `iframe.src` is set, from both `updateRenderedPanel` and the ⟳ Reload handler (`launch.js`; Reload does **not** touch `data-last-src`, so a `data-last-src` observer would miss it). The temporary harness mirrored it with a `MutationObserver` on the iframe `src` attribute (fires in a microtask, before navigation events).
- **Redirect/normalization evidence:** Assigned `…/76484/#gallery-01-1` initially looked "wandered" because CDP's `frame.url` omits the fragment; fixed by appending `frame.urlFragment`. No real provider redirect/normalization of the landing URL (A→A′) was observed on XNXX/XVideos/SpankBang landings.
- **Companion bug found by real testing:** slot **0** is falsy and was ignored by `if (!slot)`; fixed (`slot === null`). Also `about:blank` (Reload's transitional load) is now ignored.
- Real providers emit a trailing `sameDocument` event after each navigation (same URL) — harmless.

## 4. Disclosures
- **My second XNXX hop (before I added a `parentFrameId` filter) clicked inside an unrelated XNXX iframe target in another tab** and navigated that frame to a search page. Cause: the helper picked the first matching iframe target browser-wide. Fixed by restricting to targets whose `parentFrameId` is the real host page's main frame.
- **I printed browser-wide target URLs** (all tabs, including non-GS3) to my terminal while debugging. The companion now only keeps the host page; it still receives `Target.getTargets` metadata for all tabs over the authorized connection and logs none of it. A real CDP connection to the user's everyday Chrome exposes all tabs — a product/security consideration for Slice 1.

## 5. Still to prove (needs the Human, one authorization)
1. **Single-authorization longevity** — start companion once; Human approves ONE dialog; `r01-longevity.mjs` runs ~4 min of navigation + real Refresh through the API; Human reports Allow-dialog count (**pass = 0 after the first**).
2. **Companion-absent graceful degradation on the real GS3** — `r01-degrade.mjs` (bridge paused without a new Chrome connection → real Refresh works → Current null), plus a true companion kill at the end with the Human confirming GS3 still works.
3. **Real F12 coexistence** — Human opens DevTools on the index3 tab while the companion observes; API-driven navigation must still be observed and the companion's host session must not detach.

**Authorization seam status:** UNPROVEN. If Chrome still prompts repeatedly with only one connection, authorization = FAIL ⇒ NOT READY FOR SLICE 1 and the architecture should change (extension `chrome.webNavigation` or a dedicated debug profile).

## 6. Production / git
- **Production files touched: NO.** Only `architecture-lab/current-url-bridge/` (lab) and reports. A read-only `python -m http.server 8080` is serving the repo root. No commit, no push.
- **Git status after:** unchanged tracked tree; untracked lab + reports only.

## 7. Recommendation
**NOT READY FOR SLICE 1 — pending the single-authorization longevity test.** The observation, correlation, generation and Refresh evidence is strong on the real GS3; the open question is purely "does one authorization stay quiet".
