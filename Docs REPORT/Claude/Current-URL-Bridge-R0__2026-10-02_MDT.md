<!-- sideline-provenance: {"gameId":"game_git_042782b8","clientRef":"ref_1790954331217_42853da0","playerInstanceId":"claude-1352dbb4","playerType":"claude","provider":"claude","model":"sonnet","effort":"medium","at":"2026-10-02T15:18:51.217Z"} -->
# GS3 Current-URL Bridge — R0 Experiment Report

- **Calgary time:** Friday 2026-10-02, ~09:45 MDT
- **Agent / model:** Claude Sonnet 5.5 (medium)
- **Difficulty:** medium
- **Branch / HEAD:** `main` / `f96d712`
- **Git status before:** untracked only — two older `Docs REPORT/AntiGravity/` files, the AGY Current-URL synthesis, `Docs REPORT/Claude/`, `architecture-lab/fill-panel/`. No tracked changes.
- **Result:** PASS (15/15 lab checks), with the caveats in "What this does not prove".

## Files created (all under `architecture-lab/current-url-bridge/`)
| File | Role |
|---|---|
| `companion.mjs` | The R0 bridge: raw CDP client (Node's built-in WebSocket, zero deps) → SSE on `127.0.0.1:8766` |
| `lab-receiver.js` + `host.html` | Stand-in for GS3 bookkeeping (assigned/generation/Shuffle/Refresh) and the future `js/current-url-bridge.js` receiver |
| `fixture-server.mjs` | Local sites `a.test`/`b.test`/`c.test` + host `gs3.test` on one port |
| `run-r0.mjs` | Launches Chrome + companion, drives the scenario, writes `results.json` |

Run: `node architecture-lab/current-url-bridge/run-r0.mjs`

**Production files touched: NO.** Nothing in `js/`, `index*.html`, `test/`, CSS, JSON, package files. No commit, no push. No UI built, nothing persisted.

## Connection path tested
- **Tested:** the classic route on installed Chrome **152.0.7977.83** (`/json/version`): `--remote-debugging-port=9333` with a **non-default `--user-data-dir`** (temp profile), `--headless=new`. Companion connects to the browser WebSocket and uses flattened sessions.
- **Not tested (deliberately):** attaching to the Human's everyday default profile. Per the handoff correction, Chrome 136+ ignores the debugging switch there, and probing it could hijack the Human's running Chrome.
- **Seam 1 (Chrome 144+ authorized flow) — desk research only, not run:** per Chrome's docs, `chrome://inspect/#remote-debugging` enables it; `chrome-devtools-mcp --autoConnect` reads the `DevToolsActivePort` file from the profile directory to find the WebSocket endpoint, and Chrome shows an allow-dialog for each session. That is a plain CDP WebSocket, so a custom companion plausibly can use the same file + dialog, but I did **not** verify it, and a report of a Windows `--autoConnect` timeout bug exists upstream (Issue #2675). Needs a short headed test with the Human at the keyboard.

## Design as built
- **Observation:** `Target.setAutoAttach {flatten:true}` on the host page, applied **recursively** to every session. Per-session `Page.frameNavigated` and `Page.navigatedWithinDocument`. Companion contains no provider logic.
- **OOPIF:** a.test/b.test/c.test are different sites from gs3.test, so each Panel is a separate `iframe` target. State showed sessions `["page","iframe","iframe"]`; navigation events came from the child sessions and were normalised to one stream of `{slot, gen, url, kind}`. Cross-site navigation inside a Panel (a.test → b.test) swaps the process and was still captured. Initial `Page.getFrameTree` snapshot covers frames that exist before attach.
- **Frame ↔ Panel mapping:** `DOM.getFrameOwner(frameId)` on the host session → `DOM.describeNode` → the **host-owned `<iframe data-gs3-slot>` attribute**. Not `frame.name`/`window.name`. Test M: a child page setting `window.name='gs3-panel-slot-2'` did not change attribution. Only direct children of the host main frame count as Panels (supports the "no nested leakage" rule).
- **Generation guard (two layers):** GS3 calls a bridge binding (`Runtime.addBinding`, optional no-op if no companion) *before* every Shuffle/Assign/Refresh navigation. (1) **Arrival stamp:** each CDP event is stamped with the per-slot rollover count when it arrives; if a rollover occurred before processing finishes, it is dropped. (2) **Loader fence:** the last document seen for the slot is fenced against late events. (3) The receiver additionally drops any observation whose generation ≠ current. A first attempt that read the browser's "current loader" at rollover raced the new document and wrongly fenced the new landing; it was replaced with the bridge-known loader.
- **Receiver rule:** observation equal to `assignedUrl` shows as Observed = null (not wandered); anything else is stored in memory only. `assigned`/`data-last-src` are never written by observation.

## Assigned vs Current evidence (slot 1, gen 1)
```
Assigned : http://a.test/search/deepthroat?top      (data-last-src identical, gen 1)
Browse   : → http://a.test/video-zz81k2/another_slug?x=1   Observed Current
Browse   : → http://b.test/                                Observed Current (cross-site)
Assigned still: http://a.test/search/deepthroat?top, gen still 1
```

## Results
| # | Criterion | Result |
|---|---|---|
| 0 | Landing at assigned ⇒ Observed null | PASS |
| 1 | Cross-origin A→B observed | PASS |
| 2 | B→C (cross-site, process swap) updates Current | PASS |
| 3 | Correct panel (a: slot 2 unaffected; b: slot 2 nav leaves slot 1) | PASS |
| 4 | assignedUrl / `data-last-src` / generation untouched | PASS |
| 5 | Refresh: iframe returns to Assigned, Current null (immediately and after load), gen 2→3 | PASS |
| 6 | Slow event vs Shuffle: stale event dropped, new gen not contaminated | PASS — stale-drop count 1. Negative control (`R0_NO_GUARD=1`) fails this check with 0 drops |
| 7 | Provider independence: a.test, b.test, c.test same mechanism, no regex | PASS |
| 8 | OOPIF captured (2 iframe sessions) | PASS |
| 9 | Companion killed: receiver shows offline/Current null; Shuffle + Refresh still work; 0 page errors | PASS |
| 10 | DevTools coexistence (simulated second CDP client with Page/Runtime/Network/DOM/Log + auto-attach; Playwright also attached throughout) | PASS — bridge kept observing, no disconnect |
| M | Child `window.name` spoof does not mis-attribute | PASS |
| B1 | Bonus: pushState + hash change observed as `sameDocument` | PASS |
| R | Companion restart (after browsing while down) re-attaches and recovers Current via snapshot | PASS |

## What this does not prove (be honest)
- **Not the real `index3.html`**: a stand-in host page with the same data attributes was used, so Panel slot/gen come from my shim, not GS3's real Runtime Session/`panel-navigation.js`. Production wiring (where `data-gs3-slot`/the rollover hook live) is unverified.
- **Not real providers**: sites are synthetic localhost origins (cross-site, OOPIF-producing) so no real XNXX/XVideos page was loaded. Real provider behaviours (redirects, in-page player frames, anti-frame scripts) are untested.
- **F12 is simulated**: a second CDP client, headless. Real headed DevTools was not opened.
- **Headless** Chrome only; the stale test uses an artificial processing delay. Cross-session event reordering (child-session event vs host binding call) is only covered by the loader fence and not directly exercised.
- Redirect landings: a landing URL that differs from `assignedUrl` (redirect, normalisation) will display as Observed ≠ Assigned; a policy decision for later.
- Seam 1 (default-profile existing-Chrome connection) is unresolved experimentally.

## Remaining seams
1. Existing-Chrome authorized connection from a custom companion (Chrome 144+; headed, with Human).
2. Real index3.html wiring and real-provider checks, including multiple layers/nested Runtime.
3. Cross-session ordering of rollover vs child events under real load.
4. Companion lifecycle/packaging (who starts it; Windows Chrome launch profile story).

## Recommended next step
Short Human-attended R0.1: (a) headed Chrome with the 144+ `chrome://inspect/#remote-debugging` flow, pointing `companion.mjs` at the profile's `DevToolsActivePort` endpoint; (b) inject the lab receiver into real `index3.html` with `data-gs3-slot` stamping via a temporary harness, load real XNXX/XVideos, and open real F12. Only then plan `js/current-url-bridge.js`.

**Git status after:** same as before plus untracked `architecture-lab/current-url-bridge/` and this report. Nothing staged, committed or pushed.

Sources for seam 1 (research only): [Chrome DevTools auto-connect](https://developer.chrome.com/docs/devtools/agents/use-cases/auto-connect), [Chrome DevTools MCP configuration](https://developer.chrome.com/docs/devtools/agents/get-started/configuration), [Windows autoConnect issue #2675](https://github.com/ChromeDevTools/chrome-devtools-mcp/issues/2675).
