<!-- sideline-provenance: {"gameId":"game_git_042782b8","clientRef":"ref_1790776956954_774fc400","playerInstanceId":"claude-7243d6a9","playerType":"claude","provider":"claude","model":"sonnet","effort":"medium","at":"2026-09-30T14:02:36.954Z"} -->
# Pinned-Viewport Chaturbate Lab — Experiment Report

Agent: Claude Sonnet 5.5 (Experiment Worker) — Result: PASS (instrument built and locally verified; **no real Chaturbate result is claimed**)

## Repository state
- Branch: `main`; HEAD: `f96d712`
- Status before: untracked only — two `Docs REPORT/AntiGravity/` files, `Docs REPORT/Claude/`, `architecture-lab/fill-panel/` (earlier lab.html/lab.js). No tracked changes.
- Status after: same, plus the two new files below (untracked). Nothing staged, committed or pushed.

## Files created
- `architecture-lab/fill-panel/pinned-viewport.html` (single file, inline CSS/JS)
- this report

Production untouched: nothing under `js/`, `test/`, HTML pages, JSON data, package files, CSS or `userscripts/` was modified. The earlier `lab.html`/`lab.js` were not edited. Delete `pinned-viewport.html` to remove the lab.

## Implementation summary
Open via `python -m http.server 8080` → `http://localhost:8080/architecture-lab/fill-panel/pinned-viewport.html`. (`file://` also works.) Two independent Panels are created on load; "Add panel" adds more. Each Panel owns its own iframe, state, style snapshot and ResizeObserver. The iframe uses `allow="autoplay; fullscreen"`, `allowfullscreen` and the GS3 sandbox `allow-same-origin allow-scripts allow-forms allow-popups`. Default src is `https://chaturbate.com/followed-cams/`. Panels are `resize: both; overflow: hidden; background: #000`, starting at 640×360, with a "Cycle preset size" button (300×200, 640×360, 1600×900, 360×640, 1000×300, 500×500).

## Geometry model
- V = pinned iframe layout size (default 1920×1080, set by the V inputs on Pin). R = player rect in **V-space**. P = Panel client size.
- `scale = min(P.w/R.w, P.h/R.h)`; `tx = (P.w − R.w·scale)/2 − R.x·scale`; `ty` likewise. Applied as `transform-origin:0 0; transform: translate(tx,ty) scale(scale)`.
- Pin sets the iframe to `position:absolute; left/top:0; width:V.w; height:V.h`. While filled, only scale/tx/ty change on resize. V, R and `src` are never touched.
- Pinned-but-not-filled shows a "fit" view (whole V scaled into the Panel, same formula with R = whole V).

## Calibration
Calibrate Player temporarily pins the iframe to V and shows the whole of V scaled into the Panel (fit view), then puts a transparent parent overlay on the Panel. The human drags a rectangle around the player. Pointer coordinates are converted from Panel px to V-space via the fit transform (dividing out `scale`/`tx`/`ty`, and accounting for the Panel border). On pointerup the overlay is **removed** and the iframe returns to NORMAL, interactive again. R is stored and copied to any other Panel pinned at the same V, so one calibration serves all Panels. Reset Calibration clears R. Show debug geometry outlines R.

## Resize, Exit, multiple Panels
- **Resize:** ResizeObserver on each Panel recomputes the transform only, and logs `{V, R, panel, scale, tx, ty}` per Fill/resize.
- **Exit:** restores the original NORMAL pre-Fill iframe presentation. The iframe returns from pinned viewport V to its ordinary Panel-sized responsive layout. One child responsive reflow on Exit is expected and acceptable. Exit does **not** reload the iframe, change `iframe.src`, recreate it, reparent it, or erase calibration R. The same iframe element/document stays alive, and Fill can be entered again using the existing V/R. State flow: NORMAL → Fill (snapshot, pin to V, crop) → Exit → NORMAL. `Unpin (diag)` is a leftover diagnostic that undoes a manual Pin Viewport (fit view); it is not needed after Exit.
- **Multiple Panels:** state is per-Panel; only R is deliberately shared.
- Also included: Copy Results (JSON: V, R, per-room checklists, layout/multi-panel/quality/back-nav/verdict/notes, drop test); optional "DROP ROOM LINK HERE" target that logs `text/uri-list` and `text/plain`.

## Smoke tests performed (Playwright, local data: fixture only; final run after the Exit correction)
Fixture: a page with a 1280×720 box at (100,50). All results below are from the completed Exit-semantics version.
- Lab loads; no page errors.
- **NORMAL:** the iframe starts in an ordinary Panel-sized layout (640×360, no inline style). Calibration drag (V-space conversion) works, removes its overlay, and returns the iframe to NORMAL.
- **NORMAL → Fill:** iframe viewport becomes V (child `innerWidth×innerHeight` = 1920×1080).
- **Resize during Fill:** Panel resized to 300×200 and 360×640; child viewport remained 1920×1080 (no reflow), only the transform was recomputed.
- **Exit:** the iframe returned to normal Panel-sized presentation (360×640, the Panel's size at that moment), and the child viewport matched (360×640), i.e. one reflow to the ordinary layout. Inline pinned sizing and transform removed.
- **`iframe.src` unchanged** across calibrate/Fill/resize/Exit.
- **iframe element identity unchanged** (same element object before and after).
- **Fill again:** the saved R (100,50,1280,720) and V were reused with no recalibration; child viewport back to 1920×1080.
- **Other Panel unaffected:** Panel 2 stayed unpinned, unfilled, with no inline style and its own element marker intact throughout Panel 1's operations. (R is intentionally shared across Panels pinned at the same V.)
- Cosmetic: after style restoration Chromium reports `getAttribute('style')` as `""` rather than `null`; layout is identical.
- Not automated: Copy Results clipboard output, drag-drop, and all real Chaturbate behaviour (hit-testing, playback continuity, R stability across rooms).

## Known limitations
- Cross-origin behaviour is unverified: hit-testing through the transform, playback continuity, and whether Chaturbate keeps the player at a stable R across rooms. A 1920×1080 iframe rendered scaled may cost performance, especially with several Panels.
- Chaturbate promo banners or layout shifts inside V would move R, and that is exactly what the field test looks for.
- Browser zoom or `devicePixelRatio` changes on the outer page alter nothing in V-space but may change sharpness.
- Exit reflows the child once, as its viewport returns from V to the Panel's normal size. This is expected and acceptable.
- Local scroll inside the child is not controlled.

## Human field-test steps
1. Serve the repo and open the lab. Log into Chaturbate in that browser.
2. Load Followed Cams in Panel 1, pick a live room, click **Pin Viewport** (V 1920×1080).
3. **Calibrate Player** and drag around the video. Enable debug geometry to check the outline.
4. **Fill**. Try play/pause, volume, quality menu, hover controls. Confirm the stream did not restart.
5. Drag-resize the Panel to wide, square, portrait and tiny; check alignment and controls each time.
6. **Exit**; confirm the same room/chat. Use Chaturbate's back link to Followed Cams, pick Room B, Fill again **without recalibrating**. Repeat for C and D. Tick the checklist.
7. Load Panel 2 with a different room, pinned and filled at a different size; note any degradation.
8. Optionally drag a broadcaster link onto the drop box and record the result.
9. Click **Copy Results** and bring the JSON back to the architecture chat.

## Recommended next action
Run the field test. If one calibration holds across four rooms and controls work, promote a fixed provider profile (V, R) into a design pass. If R drifts or controls miss, bring the specific numbers back rather than adding fallbacks.

## Delta — Exit semantics (2026-09-30)
An earlier revision of this report said Exit "returns to pinned fit view". That was wrong and has been corrected throughout: Exit restores the NORMAL pre-Fill presentation (see "Resize, Exit, multiple Panels" and the smoke-test section). Calibration also now returns to NORMAL when finished, and the lab's normal iframe is `100% × 100%` of the Panel via stylesheet so NORMAL is genuinely Panel-sized. Only the lab file and this report changed; production is untouched.
