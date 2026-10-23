<!-- sideline-provenance: {"gameId":"game_git_042782b8","clientRef":"ref_1790900782795_6d9fbdec","playerInstanceId":"claude-1352dbb4","playerType":"claude","provider":"claude","model":"sonnet","effort":"medium","at":"2026-10-02T00:26:22.795Z"} -->
# GS3 Live Fill Harness — Real `index3.html` Experiment Report

Agent: Claude Sonnet 5.5 (Experiment Worker) — Result: PASS (instrument built and locally verified; **no real Chaturbate/XVideos result is claimed**)

## Repository state
- Branch: `main`; HEAD: `f96d712`
- Status before: untracked only — two `Docs REPORT/AntiGravity/` files, `Docs REPORT/Claude/`, `architecture-lab/fill-panel/`. No tracked changes.
- Status after: same untracked set (plus this report and the harness inside those folders). Nothing staged, committed or pushed.

## File created
- `architecture-lab/fill-panel/gs3-live-harness.js` (single file)
- this report

**Production untouched:** nothing under `js/`, `test/`, `userscripts/`, `index*.html`, `settings.html`, CSS, JSON data or package files was modified. The earlier lab files were not edited. The harness is removable with `GS3FillLab.destroy()`, a page refresh, or by deleting the file.

## Injection method
Serve the repo (`python -m http.server 8080`), open `http://localhost:8080/index3.html`, then in DevTools:
```javascript
const s=document.createElement('script');
s.src='/architecture-lab/fill-panel/gs3-live-harness.js?'+Date.now();
document.head.appendChild(s);
```
Console shows `[GS3 Fill Lab] HARNESS ACTIVE — N panel(s) found`. Injecting again destroys the old instance first and reinstalls (so code changes load), so controls and listeners never stack. Results held in memory are lost by a re-injection.

## Panel discovery
On install, every `.stream-panel` is scanned and gets a compact purple/yellow dashed "🧪 Fill Lab" bar (bottom-left). A `MutationObserver` on `document.body` queues a `requestAnimationFrame` rescan; the rescan is idempotent (adds a bar only where missing, re-attaches it if GS3 rebuilt the panel's children, and cleans up state for removed panels). No production function is patched.

## Per-panel state and isolation
Each panel has its own state object: mode (`normal | calibrating | pinned | embed`), iframe style snapshot, R, `ResizeObserver`, embed iframe reference, calibration overlay, and checklist results. The only shared item is the calibrated Chaturbate R, and only when V matches (default V = 1920×1080). Panel 1's actions do not alter another panel's iframe, styles or overlays.

## Mode A — Pinned Viewport (Chaturbate)
- **Pinned** (single action): snapshots the real `.post-iframe`'s `style` attribute, then applies inline `flex:none; position:absolute; left/top:0; width/height = V; max-width:none; transform-origin:0 0` plus `transform: translate(tx,ty) scale(scale)`. Geometry is the same as `pinned-viewport.html`, using the real `.stream-panel` client size as P. The real panel already clips via its `overflow:hidden`; no production CSS is edited.
- **Calibrate:** exits any mode, temporarily pins the real iframe to V, shows the whole of V scaled to fit the Position, and overlays a parent-owned drag layer. The drag is converted from screen px into V-space (dividing out the fit scale/translation relative to the overlay's own rect). On release the overlay is removed and the iframe returns to NORMAL. R is stored and shared with other panels at the same V.
- **Real GS3 resize hookup:** `ResizeObserver` on each `.stream-panel`. While pinned, only `scale/tx/ty` are recomputed. V, R and `iframe.src` are not touched. Each Fill/resize logs `{V, R, panel, scale, tx, ty}` to the console.
- **Exit:** removes any calibration/embed overlay and restores the pre-Fill inline style snapshot. The same iframe element/document stays alive: no reload, no `src` change, no recreate, no reparent. The child reflows once as its viewport returns from V to the Position size (expected). R is preserved.

## Mode B — Embed Overlay (XVideos)
- Source is the iframe's own `data-last-src` (read-only). If missing or unsupported, Embed refuses with a lab message and does nothing.
- Adapter (copied from `lab.js`): `xvideos.com`/`xvideos.red` `/video.{id}/…` → `https://www.xvideos.com/embedframe/{id}` (for `.red` sources, the `.red` embedframe is first and Shift-click Embed uses the `.com` one); `xnxx.com` `/video-{id}/…` → `https://www.xnxx.com/embedframe/{id}`.
- Adds one lab-owned iframe (`position:absolute; inset:0; 100%×100%; border:0`, `allow="autoplay; fullscreen"`, `allowfullscreen`, sandbox `allow-same-origin allow-scripts allow-forms allow-popups`, z-index 1 so GS3 chrome stays above) over the untouched original iframe. It follows the Position size naturally.
- **Exit** removes the overlay; the original page underneath was never navigated. `data-last-src`, `iframe.src`, Runtime Session, history and Undo/Redo are not touched.
- **Double audio** is *not* handled or hidden; it is a checklist outcome for the human.

## Checklists, results, cleanup API
- 📋 on each bar opens a checkbox popover with the Pinned list (calibration, alignment, horizontal/vertical/junction resize, wide/narrow/tall, controls, stream continuity, Exit, back navigation, second/third/fourth room) and the Embed list (adapter, load, correct video, fills Position, resize, controls, Exit, source preserved, re-enter), a double-audio yes/no selector, and a notes box. A fixed top-right widget has multiple-panel result, global notes, Copy Results, and Destroy.
- `GS3FillLab.copyResults()` (clipboard, falling back to a prompt) returns JSON: per-panel slot, mode, V, R, `data-last-src`, embed source/URL, checklists, double audio, notes, plus the multi-panel result.
- `GS3FillLab.status()` lists per-panel mode, R, iframe style, embed overlay and `data-last-src`.
- `GS3FillLab.destroy()` exits every mode (restoring iframe styles), removes bars, popovers, overlays, widget and style tag, disconnects all `ResizeObserver`s and the `MutationObserver`, restores any `position` it had to set, and deletes the global.

## Smoke tests performed (Playwright against the real `index3.html`, local fixtures only)
Grid booted with fixture URLs (a data: page with a 1280×720 box at (100,50) in slot 0; local canary pages in the others). Harness injected exactly as above. All checks passed with no page errors:
- Harness injects and logs `HARNESS ACTIVE`; controls appear on all 4 real panels.
- Duplicate injection does not duplicate controls or the widget.
- Calibration overlay appears, R is captured by dragging in the fit view, the overlay is removed, and the iframe returns to NORMAL (no inline style).
- Pinned: the real iframe gets width/height = V and the child viewport is 1920×1080; only the target iframe is modified; `src` and `data-last-src` unchanged; the calibrated box lands aligned in the Position.
- **Real GS3 resizer drag** (Position width 745 → 895): the child viewport stayed 1920×1080, the transform was recomputed and the calibrated box fits the new size, `src` unchanged.
- Exit restores the iframe (no inline style) and the child reflows to the Position size (895×898); R kept.
- Shared R adopted by another panel at the same V; panel 0 unaffected.
- Embed refused for an unsupported source; Embed on a supported source creates exactly one overlay with the correct `embedframe` URL; original iframe `src`/`data-last-src`/style unchanged; other panels get no overlay; Exit removes it.
- A dynamically added `.stream-panel` gets controls; `status()` counts it.
- `destroy()` removes all lab elements and the global; every iframe style is restored and `src`/`data-last-src` unchanged.

Not verified: any real Chaturbate/XVideos behavior (player alignment across rooms, control hit-testing through the transform, playback continuity, embed loading in the GS3 sandbox, double audio), the junction resizer, hover-chrome interaction with a pinned iframe, and the clipboard path (the smoke run does not exercise Copy Results).

## Known limitations
- The pinned iframe is absolutely positioned above the panel's flex flow, so GS3's own toolbar-inset height behaviour is bypassed while pinned. The Hotswap chrome (z-index 10000+) still paints above it.
- A 1920×1080 iframe scaled down may cost rendering performance with several Positions at once.
- If GS3 replaces the panel's iframe while pinned, the harness drops that panel's state without touching the new iframe.
- Embed supports xvideos.com/.red and xnxx only; no sources beyond `data-last-src` are read.
- The lab bar overlaps the bottom-left of each Position and can sit under the fixed master bar when it is open.
- R is in-memory only and is lost on page reload or re-injection.

## Human field-test steps
1. Serve the repo, open `index3.html`, log into Chaturbate in that browser, and set up Positions: Panel 1 = Chaturbate Followed Cams, Panel 2 = an `xvideos.com` video page, Panel 3 = another Chaturbate room.
2. Inject the harness (snippet above).
3. **Pinned (Chaturbate):** open a live room in Panel 1, click **Calibrate**, and drag around the player. Click **Pinned**. Check alignment, controls, and that the stream does not restart. Drag real GS3 horizontal, vertical and junction resizers and make Positions wide, narrow and tall.
4. **Exit**; confirm the same room and chat, and that back to Followed Cams works. Pick other rooms in Panel 1 and Panel 3 and press **Pinned** without recalibrating.
5. **Embed (XVideos):** in Panel 2, click **Embed**. Check the video, resize, controls, and whether audio doubles. **Exit** and confirm the original page is intact; re-enter Embed.
6. Run Pinned and Embed on different Positions at the same time.
7. Tick the 📋 checklists, then click **Copy Results** and bring the JSON back to the architecture chat.
8. `GS3FillLab.destroy()` when finished.

## XNXX LIVE GS3 FIELD TEST — INITIAL

- Real XNXX video page loaded successfully in GS3.
- Embed initially refused the source as unsupported.
- Standalone lab had already proven XNXX embedding works.
- Root cause was adapter/source recognition, not Embed architecture.
- Adapter repaired using validated standalone logic.
- Awaiting Human live re-test.

Investigation detail (honest scope): the XNXX regex in the harness (`^/video-([^/]+)`, host `xnxx.com`, id not assumed numeric) was byte-for-byte the same as `lab.js`, and all ~80 XNXX video URLs in `links.json` (`https://www.xnxx.com/video-<alnum id>/<slug>[#show-related]`) are accepted by it. The exact failing `data-last-src` was **not observed** in this session, so the precise mismatch is unconfirmed. The only difference left that the lab could not have exercised is the host: the harness required exactly `xnxx.com` (after stripping `www.`). The repair therefore (a) accepts XNXX's other TLDs (`xnxx.<tld>`, e.g. `.tv`, `.es`, `.health`) while still requiring the strict `/video-<id>` path and always emitting the validated `https://www.xnxx.com/embedframe/<id>`; and (b) adds diagnostics: every Embed attempt logs `[GS3 Fill Lab] Embed source:` + the exact `data-last-src`, and a refusal logs `[GS3 Fill Lab] Unsupported embed source:` + the exact URL (works for all providers). If the retest still refuses, the console line gives the real shape to fix.

Adapter regression (node, function extracted from the harness): `www.xnxx.com/video-1164yzbf/…` → xnxx, `embedframe/1164yzbf`; `…#show-related` accepted; `xnxx.health/video-abc12/…` accepted → `www.xnxx.com/embedframe/abc12`; homepage, `/search/…`, `/porn-maker/…`, `/tags/…`, `/video-` all rejected; xvideos.com and xvideos.red outputs unchanged. Not re-run in a browser: overlay count, Exit removal, iframe survival and generic Position resizing (embed/Exit code paths untouched; covered by the earlier Playwright smoke run).

## XNXX ADAPTER — PATTERN-BASED REQUIREMENT CHANGE

The adapter must accept any future valid XNXX video page, not a corpus of known URLs. Implementation in `adaptEmbed`:
- **Provider family:** host matches `(^|\.)xnxx\.<tld>(\.<2-letter>)?$` — any subdomain (`www`, `es`, `www3`…), any TLD, optional second-level (`.co.uk`). Look-alikes (`notxnxx.com`, `xnxx.com.evil.net`, `example.com/xnxx.com/…`) are rejected.
- **Video identity:** structural `^/video-<id>` path; `<id>` is any opaque non-empty segment (not assumed numeric, may contain hyphens/underscores/uppercase). Slug, query string and fragment are ignored.
- **Output:** always `https://www.xnxx.com/embedframe/<id>`, provider `xnxx`.
- **Rejected (no single video identity):** homepage, `/search/…` (even `/search/video-abc`), `/tags/…`, `/porn-maker/…`, `/best/…`, `/c/…`, `/videos/…`, bare `/video-`, `video-` only in query/fragment, unparsable input.

Regression: `architecture-lab/fill-panel/xnxx-adapter.test.cjs` (`node architecture-lab/fill-panel/xnxx-adapter.test.cjs`; `.cjs` because the repo `package.json` is `"type":"module"`). It extracts `adaptEmbed` from the harness and uses only synthetic IDs (e.g. `zq9x`, `ZZZZ`, `0`, `a1B2c3D4e5`, `q_w-e_r`) across 12 host variants, with slug/query/fragment variants, plus rejection cases and unchanged XVideos (.com/.red) output. Result: 336 assertions passed. Not browser-tested; the real failing `data-last-src` is still unobserved, so Human retest remains required.

## Recommended next action
Run the field test. If Pinned holds one R across four rooms under real resizing, and Embed avoids unacceptable double audio, plan production integration behind the canonical `fillPanel` action. If either fails, return the specific numbers and observations rather than adding fallbacks.
