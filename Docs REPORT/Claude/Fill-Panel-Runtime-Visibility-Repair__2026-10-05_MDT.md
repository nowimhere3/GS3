<!-- sideline-provenance: {"gameId":"game_git_042782b8","clientRef":"ref_1791252925933_6290f108","playerInstanceId":"claude-1352dbb4","playerType":"claude","provider":"claude","model":"sonnet","effort":"medium","at":"2026-10-06T02:15:25.933Z"} -->
# GS3 Fill Panel — Runtime Visibility Repair

- **Agent / model:** Claude Sonnet 5.5 (medium) — Monday 2026-10-05, ~22:45 MDT (Calgary)
- **Base:** `HEAD = 4f098c0`; working tree = uncommitted FILL_EMBED candidate + `test/settings-boot.test.js`. Nothing cleaned/stashed/reset/committed/pushed.
- **Result:** **NOT REPRODUCED on the current tree with a supported URL.** With Fill configured 6th (Top = 8, Runway = 8) the Runtime shows Fill on Top and Runway for a supported video URL, and capability re-derives correctly through every assignment. **No production fix made.** What *does* make Fill disappear at Runtime while Settings still lists it is **URL-shape coverage** (below). A regression test was added.

## Reproduction (real `index3.html`, config seeded exactly as described: order `…shuffleAll, fillPanel, reload, launchpad`, Top 8, Runway 8)
`architecture-lab/fill-panel/verify-fill-visibility.mjs`, including a timeline of every write to the Fill projections' `hidden` / `data-capability-hidden` from construction on.

- **Adapter** for `https://www.xvideos.com/video.ufplmdf83c4/<slug>` → `https://www.xvideos.com/embedframe/ufplmdf83c4` (not null).
- **Projections exist:** canonical tray button YES; Top mirror YES; Runway mirror YES. Top order and Runway order at Runtime = `toggle, folder, star, shuffle, shuffleAll, fillPanel, reload, launchpad` (Fill in the 6th slot, as configured).
- **A–E timeline (panel 0):** all three projections are added together at ~94 ms with `hidden=false`; no later write to `hidden`/`data-capability-hidden` occurs (no re-hiding by any layout pass, responsive logic or other writer). Capability state: `capable=false` (no cooperating document — expected for the embed lane), `embedAvailable=true`; `_render()` treats `capable || embedAvailable` as available.
- **After toolbar reveal:** Top = visible, Runway = visible. The canonical tray button reads "hidden" only because it is a **Deep Cuts-only** projection and Fill sits inside the Top cutoff (`projectDeepCuts` sets `style.display:none` for actions already on the rail) — by design, not a defect.
- H1 (never capable): no — `embedAvailable` true. H2 (refresh timing): no — `refreshFillPanelPresentation` runs after `data-last-src` is set; verified by the transitions. H3 (mirrors created after render): no — mirrors are built before `registerFillPanelCapability` (end of `_buildPanel`). H4: `_fillPanelButtons` sees canonical + Top + Runway (+ Deep Cuts = canonical). H5 (re-hide): no writer found/observed.

## Live transition test (one Panel, no Runtime reload)
| Step | Adapter | Canonical | Top | Runway |
|---|---|---|---|---|
| xHamster URL | null | hidden | **HIDDEN** | **HIDDEN** |
| assign XVideos video | embed | (Deep Cuts-only) | **VISIBLE** | **VISIBLE** |
| assign unsupported URL | null | hidden | **HIDDEN** | **HIDDEN** |
| assign XNXX video | embed | (Deep Cuts-only) | **VISIBLE** | **VISIBLE** |

Deep Cuts case (Top = 2, Runway = 2 so Fill falls outside): unsupported → hidden; XVideos → canonical visible in Deep Cuts, no Top/Runway mirror; xHamster → hidden again. Same executor from every surface: pressing Top, Runway and the Deep Cuts button each produced exactly one overlay with the same src (`embedframe/<id>`) and each exits it again.

## What probably hid Fill in the Human's Panels
Fill is shown only if `getFillPresentationUrl(data-last-src)` is non-null, and the Human's real database contains many URL shapes the adapter (deliberately) does not match. A scan of the live `links.json` (URLs on supported hosts):

| Host | URLs | Adapter matches |
|---|---|---|
| xvideos.red | 2241 | 2236 |
| **xvideos.com** | 144 | **70** — 73 are the older shape `/video<digits>/<slug>` (e.g. `…/video7461269/mary_anne…`), 4 are `de.xvideos.com/video.<id>/…` |
| xnxx.com | 79 | 78 |
| pornhub.com | 89 | 86 |
| eporner.com | 86 | 72 — 10 are `/hd-porn/<id>/<slug>/`, 2 are category pages |
| porntrex.com | 138 | 132 (the rest are search pages) |
| tnaflix.com | 33 | 31 (+3 on `m.`/`morigin.` subdomains, 0 matched) |
| spankbang.com | 195 | 97 (the rest are playlist/search pages; + localized `ru./tr./la.` subdomains unmatched) |

So an XVideos Panel assigned a `/video<digits>/…` URL (half of the Human's xvideos.com links) has Fill hidden at Runtime even though Settings correctly lists it. Quick live checks (headers only, not playback): `embedframe/7461269` (numeric id) returns the XVideos embed page; the numeric page 301-redirects to `/video.<newid>/…`; `eporner.com/embed/2KQFuGdodJO/` and `player.tnaflix.com/video/7123328` also return real embed pages; `de.xvideos.com` ids work with the `.com` embedframe. These are **candidates**, not yet playback-proven or implemented — adding them would change the adapter set, which is beyond this repair play and needs its own proof pass.

## Regression test
`test/fill-visibility.test.js` (own server port 4176; **4/4 pass**), on the real Runtime projection path with Fill configured 6th and real Edit-URL assignments: configured + unsupported → Top/Runway/canonical hidden; same live Panel → supported (XVideos) → Top + Runway visible; → unsupported → hidden; → second supported provider (XNXX) → visible; Deep Cuts-only configuration shows the canonical button only when supported; Top, Runway and Deep Cuts all produce the same overlay; assignment (`data-last-src`) unchanged.
Other suites: `fill-embed` 4/4, `settings-boot` 4/4, `capability-bridge` 11/11 (all green together).

## Required report
```
BASE HEAD: 4f098c0
REPRODUCED: NO (supported XVideos video URL; all projections behave as designed)
SUPPORTED TEST URL ADAPTER RESULT: https://www.xvideos.com/embedframe/ufplmdf83c4
CANONICAL FILL EXISTS: YES
TOP MIRROR EXISTS: YES
RUNWAY MIRROR EXISTS: YES
STATE.capable BEFORE REFRESH: false (embed lane; availability comes from embedAvailable=true)
STATE.capable AFTER REFRESH: false (unchanged; embedAvailable=true; buttons visible)
ROOT CAUSE: no Runtime lifecycle defect found. Fill is hidden whenever the Panel's assigned URL is not a recognised video shape; ~half of the Human's xvideos.com links (/video<digits>/…) and several localized/other shapes are not matched by getFillPresentationUrl
FIX: none (no production change); candidate adapter extensions identified for a separate Play
XHAMSTER -> FILL: HIDDEN
XVIDEOS -> FILL: VISIBLE
UNSUPPORTED -> FILL: HIDDEN
XNXX -> FILL: VISIBLE
TOP TOOLBAR: PASS
RUNWAY: PASS
DEEP CUTS: PASS
SAME EXECUTOR: YES
FILL PLAYBACK REGRESSION: NO
SETTINGS REGRESSION: NO
PRODUCTION FILES CHANGED: NONE (test added: test/fill-visibility.test.js)
COMMIT: NO
PUSH: NO
```

## For the Human's field verification
On the Panel where Fill is missing, in the Console: `document.querySelector('.stream-panel[data-slot-index="0"] iframe').getAttribute('data-last-src')` (change the slot index to that Panel's). If that URL looks like `…xvideos.com/video<digits>/<slug>` (no dot after `video`) or is a search/playlist/category page, Fill is hidden by design today. With an `xvideos.red/video.<id>/…`, `xnxx.com/video-<id>/…`, `pornhub …view_video.php?viewkey=…` etc. URL, Fill should appear on Top and Runway immediately. If Fill is still missing on a supported-shape URL, send me that URL and the Panel's Top/Runway settings.
