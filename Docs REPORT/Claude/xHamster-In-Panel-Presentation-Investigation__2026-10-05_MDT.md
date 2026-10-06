<!-- sideline-provenance: {"gameId":"game_git_042782b8","clientRef":"ref_1791245271880_9ebf746f","playerInstanceId":"claude-1352dbb4","playerType":"claude","provider":"claude","model":"sonnet","effort":"medium","at":"2026-10-06T00:07:51.880Z"} -->
# xHamster In-Panel Presentation Adapter — Investigation (STOP: no deterministic adapter)

- **Agent / model:** Claude Sonnet 5.5 (medium) — Monday 2026-10-05, ~19:10 MDT (Calgary)
- **Base:** `origin/main` = local `main` = `212ddb0`; working tree carries the earlier uncommitted Popout Shield + Cloudbate adapter changes (untouched this Play).
- **Result:** **No deterministic in-Panel presentation URL exists for xHamster. No production change made.**

## Method
Lab harness `architecture-lab/popout-shield/` in real installed Chrome: host page builds the iframe exactly like `js/launch.js`; two sandbox policies (SHIELD = `allow-same-origin allow-scripts allow-forms`, CURRENT = + `allow-popups`); X-Frame-Options / CSP `frame-ancestors` stripped in the lab (assumed equivalent to the Human's setup); real trusted clicks; frame-navigation, request, popup and console logging; plus `curl` with `Sec-Fetch-Dest: iframe` to separate server behaviour from page script. Specimen: `https://xhamster.com/videos/<slug>-<numeric id>` (pattern from `links.json`; database also contains mirrors `xhamster2.com` and `xhamster.desi`).

## Phase 1 — what actually happens
1. Panel loads canonical `https://xhamster.com/videos/<slug>-<id>`.
2. **The server answers the iframe request with `302 → https://xhamster.com/embed/<id>`** (same-frame redirect). Reproduced by `curl`: with `Sec-Fetch-Dest: document` the same URL returns `200` (full page, 289 KB); with `Sec-Fetch-Dest: iframe` it returns `302` to `/embed/<id>`. The decision is made from the browser-set, page-unforgeable `Sec-Fetch-Dest` header, not from query parameters or script.
3. The `/embed/<id>` document is a **poster/teaser page**: `a.xp-poster` (full-viewport), `a.xp-play`, `a.xp-cta`, title/profile links — every one an `<a target="_blank" href="https://<rotating mirror>/videos/<slug>-<id>?utm_campaign=embed&…">`. `xplayerSettings` is `null` in the embed's state, and **no `<video>` element is ever created** (0 videos after two Play clicks). Embed type reported by the page: `"direct"`.
4. Play therefore is an out-link, not a player.
   - **SHIELD:** 0 popups; Chrome: `Blocked opening 'https://b0c4.shop/videos/<slug>-<id>?utm_campaign=embed&utm_content=<id>&utm_medium=referral&utm_source=…'`. Panel stays on the embed teaser; nothing plays.
   - **CURRENT:** 2 popups (two clicks), to `https://xhms.pro/videos/<slug>-<id>?utm_campaign=…` — a *different* mirror domain than the SHIELD run's `b0c4.shop`: the target domain rotates.
5. HLS segment requests to `video-*.xhcdn.com/…/media=hls4/…` occur on the embed (preview/prefetch), but no playable element is attached.
- No top-navigation attempt, no further same-frame navigation after the redirect; the top page stayed unchanged in all runs.
- **Classification:** **PLAYER/EMBED REDIRECT** (server-side, same frame) to an embed that is **POPUP-gated** (Play = `target=_blank` link to a rotating mirror).

## Phase 2 — candidate in-Panel forms (all tested by `curl` with `Sec-Fetch-Dest: iframe`, and the key ones in the Panel)
| Candidate | Result |
|---|---|
| canonical + `?embed=0`, `?play=true`, `?autoplay=1`, `?noembed=1` | all `302 → /embed/<id>` |
| `/embed/<id>` + `?autoplay=1`, `?play=1`, `?mute=1&autoplay=1`, `?embedType=player`, `?type=player`, `?plain=1` | all return the same teaser (`xp-poster`, `xplayerSettings:null`) |
| `m.xhamster.com/videos/…` | `301 →` canonical `xhamster.com` → `302 → embed` |
| `xhamster2.com`, `xhamster.desi`, `xhamster1.desi` (+ `/videos/…`) | each `302 →` its own `/embed/<id>` (same teaser) |
| popup targets `b0c4.shop`, `xhms.pro` (`/videos/…`) | `302 → https://xhamster.com/videos/…?xhms_pro=1` → `302 → embed` |
| `xhamster.one` | 404 |

Every route into an iframe ends at the teaser. There is no `?play=true`-style form (the Cloudbate mechanism was a client-side `window.open` of an in-page-playable URL; xHamster's is a **server-side iframe-detection redirect** to a non-player page).

## STOP condition met
Per the Play: no deterministic in-Panel presentation URL or equivalent adapter seam → **no adapter implemented, `js/presentation-url.js` and all production files untouched.**

```
XHAMSTER MECHANISM:
PLAYER/EMBED REDIRECT (server-side 302 on Sec-Fetch-Dest: iframe) to an embed teaser whose Play is a POPUP (target=_blank) to a rotating mirror

ORIGINAL VIDEO URL:
https://xhamster.com/videos/<slug>-<numeric id>[?query]

PLAY TARGET / PLAYER URL:
embed: https://xhamster.com/embed/<numeric id>  (poster page, no <video>)
Play target: https://<rotating mirror e.g. b0c4.shop | xhms.pro>/videos/<slug>-<id>?utm_campaign=embed&…

DETERMINISTIC ADAPTER FOUND:
NO

ADAPTER RULE:
NONE

CANONICAL ASSIGNED URL MUTATED:
NO

VIDEO PLAYABLE IN PANEL:
NO (neither the canonical page nor the embed yields a playing video inside an iframe)

POPUP CREATED:
NO under Popout Shield (blocked; 2 popups under the old allow-popups policy)

POPOUT SHIELD INTACT:
YES

CLOUDBATE REGRESSION:
NO (nothing changed; not re-run because no code changed)

PRODUCTION FILES CHANGED:
NONE

COMMIT:
NO

PUSH:
NO
```

## What would be needed (not implemented)
The server decision depends on `Sec-Fetch-Dest: iframe`, a forbidden header that page code and an ordinary URL cannot change. Possibilities, all outside this Play and unproven: (a) a header-rewriting layer in the Human's browser setup (the extension that already strips `X-Frame-Options` cannot set `Sec-Fetch-*` via declarativeNetRequest as far as I know — unverified); (b) a different non-iframe presentation (e.g. an explicit "open externally" action, which the product law allows when the Human asks); (c) a provider whose embed actually plays (the Human's earlier embed lab found xHamster "unsuitable" — consistent with this). Current practical effect with Popout Shield: xHamster Panels show the embed teaser and Play does nothing visible (no new tab), which is the intended containment.
