<!-- sideline-provenance: {"gameId":"game_git_042782b8","clientRef":"ref_1790747465625_aa9535ae","playerInstanceId":"claude-1f660b52","playerType":"claude","provider":"claude","model":"sonnet","effort":"medium","at":"2026-09-30T05:51:05.625Z"} -->
# Fill Panel Architecture Lab — Implementation Report

Agent: Claude Sonnet 5.5 (Experiment Worker) — Result: PASS (instrument built; no field results claimed)

- Branch: `main`; HEAD: `f96d712`
- Working tree before: only untracked `Docs REPORT/` files (AntiGravity x2, Claude/). No tracked changes.

## Files created
- `architecture-lab/fill-panel/lab.html`
- `architecture-lab/fill-panel/lab.js`

Production files untouched: nothing under `js/`, `test/`, HTML pages, JSON data, package files or CSS was modified. `links.json` was only read. Delete `architecture-lab/fill-panel/` to remove the lab.

## Lab structure
Serve the repo over http (e.g. `python -m http.server`) and open `/architecture-lab/fill-panel/lab.html`.

**Probe 1 — Embed Adapter.** 12 real source URLs from `links.json` are preloaded (2 xvideos.red, 1 each for xvideos.com, xnxx, pornhub, xhamster, spankbang, eporner, porntrex, camwhoreshd, tnaflix, youtube control). The URL box adds more, and the size is selectable (480×270 / 640×360). Each case shows source, provider, extracted ID/key and generated embed URL(s). xvideos.red shows both the `.red` and `.com` `embedframe` candidates. Buttons: Load Source, Load Embed, and Source + Embed side-by-side. All iframes use `allow="autoplay; fullscreen"`, `allowfullscreen` and the real GS3 sandbox (`allow-same-origin allow-scripts allow-forms allow-popups`). Unparseable URLs are labelled unrecognised and get no embed. Each candidate has the requested checklist (loads, correct video, plays, fills panel, controls, login/premium, survives sandbox) plus notes. "Copy Embed Results" copies JSON of source, provider, candidate, embed URL, answers and notes.

**Probe 2 — Framed Viewport.** A green-bordered panel (640×360, 480×270 or 800×450) with `overflow:hidden` and a black background holds one iframe. Controls: URL + Load, Frame Video, Exit Frame, Re-frame, Reuse Last Frame. Frame Video adds a transparent parent-owned overlay above the iframe. You drag a rectangle, and on pointerup the overlay is removed. The iframe then gets `transform-origin:0 0; transform: translate(tx,ty) scale(s)`, with `s = min(pw/w, ph/h)` and `t = (P − w·s)/2 − x·s` per axis. The iframe's `src` is never touched except by Load, and its layout size, DOM position and parent are unchanged. The iframe's original inline styles (transform, origin, left, top, width, height) are snapshotted before the first frame and restored on Exit and Re-frame. Frame memory is an in-memory `Map` keyed by host + panel width. The 10-item checklist, notes and "Copy Framed Viewport Results" (URL, host, rect, scale, translation, checklist, notes) are included. The optional `#player` fragment experiment was skipped.

## Smoke checks performed (Playwright, local only)
- Lab loads with no page errors.
- URL input adds a case, and source/embed iframe switching works.
- Generated embed URLs for all 12 samples match the specified patterns.
- Embed iframes carry the real sandbox attribute.
- Drag-select on a local fixture page applies the expected transform (scale 4, translate −392,−192 for a 160×90 rect at 98,48 in a 640×360 panel), and the overlay is removed afterwards.
- `computeFrame` math verified for the same rect.
- Exit Frame leaves `iframe.src` unchanged and the inline transform empty. My strict string compare of the `style` attribute reported a difference only because a never-set attribute became `style=""`. That is cosmetic, and the properties themselves are restored.
- Reuse Last Frame re-applies the remembered rect.
- Both copy buttons write to the clipboard.

## Known limitations
- No cross-origin provider playback, premium/login behaviour or control hit-testing was verified. Those are Human Head Coach field tests.
- The frame rectangle is in un-scrolled iframe coordinates. If the page is scrolled inside the iframe, or a sticky layout shifts, the frame can drift. The checklist records this.
- Scaling up a page raster-scales it, so sharpness depends on the provider. Whether the transform maps pointer hit-testing correctly into the iframe is unproven until manually tested.
- Frame memory records only the rectangle, not the page scroll position.
- Provider embed patterns are candidates only. Some hosts may send `X-Frame-Options`/CSP `frame-ancestors`, which would show as "LOADS: no".
- The lab was not run inside GS3 itself.

## What the Human Head Coach must test
1. xvideos.red `.red` vs `.com` embedframe: loads, correct video, fills the panel, logged-in/premium content, and whether the sandbox breaks it.
2. Each of the other provider embeds against the checklist. Use "Copy Embed Results".
3. Framed Viewport on known multi-video pages: drag around the main video, then check playback continuity, play/pause, scrubber, volume and menus, scroll drift, sticky overlays, sharpness, Exit restore, and Reuse Last Frame on a second video on the same host. Use "Copy Framed Viewport Results".

## Git status after
Untracked: `architecture-lab/fill-panel/`, plus the existing `Docs REPORT/` untracked items (including this report). No tracked file modified. Nothing committed or pushed.

## Recommended next action
Run the field tests and paste both JSON results back for the architecture follow-up. Decide adapter-first (if xvideos.red embeds work logged-in) with Framed Viewport as the fallback.
