<!-- sideline-provenance: {"gameId":"game_git_042782b8","clientRef":"ref_1791244907148_92b95b6b","playerInstanceId":"claude-1352dbb4","playerType":"claude","provider":"claude","model":"sonnet","effort":"medium","at":"2026-10-06T00:01:47.148Z"} -->
# GS3 Cloudbate In-Panel Play Adapter — Production Candidate

- **Agent / model:** Claude Sonnet 5.5 (medium) — Monday 2026-10-05, ~18:40 MDT (Calgary)
- **Base:** `origin/main` = local `main` = `212ddb0`; the uncommitted Popout Shield change in `js/launch.js` (sandbox without `allow-popups`) is present in the working tree and kept.

## Seam
`assignedUrl -> getPresentationUrl() -> effective iframe URL`. A new pure module `js/presentation-url.js` is applied only where `iframe.src` is set for Panel content in `js/launch.js`: initial build, `updateRenderedPanel` (every GS3 assignment, incl. Edit URL, folder assign, Shuffle, Undo/Redo of assignments), `navigatePanelTo` (Panel history traversal) and the ⟳ Reload re-load. `data-last-src`, the Runtime Session URL, panel-navigation anchor/history, links.json, folders and presets are **not touched** — they keep the assigned URL.

## Rule
Hostname `cloudbate.com` or `*.cloudbate.com`, **and** pathname matches `^/video/\d+(/|$)` (the pattern seen in R0: `/video/1136214/<slug>/`) → `URL.searchParams.set('play','true')`; existing query params and hash preserved. Everything else is returned as the identical string (other providers, Cloudbate home/search/categories/`/videos/…`, `/video/abc`, look-alike hosts, relative/unparsable strings). Idempotent.

## Validation
- **Adapter unit cases:** 21/21 (video page, bare and `m.` hosts, params + hash preserved `?a=1&b=two#t=5` → `…&play=true#t=5`, `play=false` → `true`, already-true unchanged; home, `/latest-updates/`, `/categories/`, search, `/videos/12/`, `/video/abc`, `/model/video/12/`, look-alikes, xnxx, xvideos, `index.html`, `about:blank`, empty, garbage all unchanged); idempotent.
- **Real `index3.html` + live Cloudbate in real Chrome** (X-Frame-Options stripped in the lab, same assumption as before), slots = Cloudbate video / Cloudbate home / XNXX video:
  - Cloudbate video: assigned (`data-last-src`) = original URL; **effective iframe `src` = same URL + `?play=true`**; Runtime Session URL and panel-navigation anchor = original.
  - Cloudbate home: iframe src unchanged. XNXX: unchanged.
  - Sandbox on all Panels: `allow-same-origin allow-scripts allow-forms` (Popout Shield intact).
  - **One real Play click in the Panel → `<video>` playing (t = 5 s); 0 new tabs/windows; 0 "Blocked opening" messages; GS3 host page unchanged.**
  - After playing, assigned/session URLs still original. After GS3 ⟳ Reload: iframe src again the `?play=true` form, assigned still original.
- **Tests:** boot-smoke subset (boot ×4, Undo/Redo, navigation, Reload, history, folder) 28/29; the single failure is the pre-existing `L2 Master Undo and Redo mutate only the selected nested Runtime`, which also fails on unmodified `212ddb0` (shown in the previous Play). Full suite not run.

## Required report
```
BASE HEAD: 212ddb0 (working tree also carries the uncommitted Popout Shield sandbox change)
POPOUT SHIELD PRESENT: YES (sandbox = allow-same-origin allow-scripts allow-forms)
PROVIDER: cloudbate.com
CANONICAL ASSIGNED URL MUTATED: NO
PRESENTATION URL ADAPTED: YES
ADAPTER RULE: host cloudbate.com or *.cloudbate.com AND path ^/video/\d+(/|$)  =>  searchParams.set('play','true'); query/hash preserved; all else unchanged
VIDEO PLAYABLE IN PANEL: YES (live Cloudbate, real Chrome, one click)
POPUP CREATED: NO
OTHER PROVIDERS CHANGED: NO
PRODUCTION FILES CHANGED: js/launch.js (4 src assignments + 1 import, plus the earlier sandbox line), js/presentation-url.js (new)
COMMIT: NO
PUSH: NO
```

## Human field test (real Chrome, local build)
Serve the repo, hard-refresh `http://localhost:8080/index3.html`, load a Cloudbate **video** page in a Panel → press Play. Success: **no new tab, no focus theft, video plays inside GS3.** Also glance at: the Panel's URL/Edit field still shows the original (no `?play=true`), another provider still plays, and Cloudbate home still loads.
Notes: Single mode (`single-launch.js`) is a separate iframe path and was not changed. If the Human browses inside Cloudbate to another video, that is site navigation (not a GS3 assignment) and is not rewritten.
