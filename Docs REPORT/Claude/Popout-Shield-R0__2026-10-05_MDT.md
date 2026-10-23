<!-- sideline-provenance: {"gameId":"game_git_042782b8","clientRef":"ref_1791242317875_921f94cb","playerInstanceId":"claude-1352dbb4","playerType":"claude","provider":"claude","model":"sonnet","effort":"medium","at":"2026-10-05T23:18:37.875Z"} -->
# GS3 Popout Shield R0 — Sandbox `allow-popups` Removal

- **Agent / model:** Claude Sonnet 5.5 (medium) — Monday 2026-10-05, ~17:45 MDT (Calgary)
- **Branch / HEAD:** `main` / `f96d712`
- **Result:** the primary hypothesis is **CONFIRMED on the canary**; global removal is **NOT YET PROVEN** safe.

## Method
Lab harness `architecture-lab/popout-shield/` (host page that builds one iframe exactly as `js/launch.js` does — `allow="autoplay; fullscreen"` plus a `sandbox` taken from the URL), driven by the **real installed Chrome (H.264-capable)** with a fresh context per run, real trusted clicks, same sites and same clicks under two policies:
- `CURRENT` = `allow-same-origin allow-scripts allow-forms allow-popups`
- `R0` = `allow-same-origin allow-scripts allow-forms`

Observed per run: new browser pages (popups), Chrome console "Blocked opening…" messages, iframe/top URL changes, and `<video>` playing state in any frame.
**Assumption disclosed:** every watch page tested sends `X-Frame-Options: SAMEORIGIN`, so stock Chrome refuses to frame them (cloudbate home: "refused to connect"). The Human's GS3 evidently frames them (a header-stripping setup I cannot see), so the lab strips `X-Frame-Options`/CSP `frame-ancestors` from third-party document responses. Headless, no logins, no Human profile.
Production was **not modified** for this play.

## Cloudbate (the canary)
- Only `js/launch.js:323` sets a sandbox; no GS3 code uses `window.open` / `_blank`.
- On a video page (`/video/<id>/<slug>/`, KVS "splash" player) the player's Play does `window.open('<same URL>?play=true')`. 
  - **CURRENT:** each Play press opened a new Chrome page at the same URL + `?play=true` (2 presses → 2 tabs; opener = the GS3 host). **The video played in the new tab (t=4.5 s); nothing played inside the Panel.** This reproduces the Human's report.
  - **R0:** **0 new pages.** Chrome logged `Blocked opening '…?play=true' in a new window because the request was made in a sandboxed frame whose 'allow-popups' permission is not set.` The Panel stays on the page; **video does not play in the Panel** (no `<video>` element is created).
- The site also logs an attempt to navigate the top-level window ("Unsafe attempt to initiate navigation for frame with origin 'http://localhost:8080'… top-level window is sandboxed") under **both** policies — neither grants `allow-top-navigation`, so top navigation is already blocked today.
- **Mechanism classification:** **POPUP** (`window.open`, proven by the blocked-opening message and the new page); secondary **TOP NAV attempt**, already blocked in both policies; not SAME-FRAME navigation.
- **Extra finding:** loading `…/?play=true` *directly in the Panel* under R0 shows a paused `<video>`; **one click in the Panel plays it (t=4 s), 0 popups.** So the playback the popup was providing can be delivered inside the Panel by routing that URL into the Panel.
- Verdict class for cloudbate: **B** (popup blocked + video does not play *by that button*), with a proven in-Panel alternative.

## Compatibility matrix (R0 vs CURRENT, one run each)
| Site | Loads | Popups CURRENT → R0 | Play detected CURRENT / R0 | Same-frame nav | Notes |
|---|---|---|---|---|---|
| cloudbate (video page) | yes | 1–2 → **0** | no / no (plays only in the new tab today) | no | `?play=true` popup blocked; see above |
| cloudbate (home) | yes (with XFO stripped) | 0 → 0 | n/a | no | no player on the page |
| eporner | yes | **2 → 0** (1 blocked message) | **yes / yes** | no | protected, playback unaffected |
| tnaflix | yes | **1 → 0** (blocked message) | no / no | no | protected; generic click did not start play either way |
| porntrex | yes | 0 → 0 | yes / yes | no | unaffected |
| xvideos.com | yes ("Video deleted" page) | 0 → 0 | no / no | yes (same both) | specimen is dead: inconclusive for play |
| xvideos.red | yes (promo/login page) | 0 → 0 | no / no | no | inconclusive for play |
| xnxx | yes | 0 → 0 | no / no | no | generic click did not start play (still "loading"); inconclusive |
| pornhub | yes (cookie banner) | 0 → 0 | no / no | no | inconclusive for play |
| spankbang | **no** — Cloudflare challenge ("Just a moment…") in both | 0 → 0 | n/a | no | inconclusive |

- **Differential regressions caused by removing `allow-popups`: none observed.** Every site's "play detected" and same-frame-navigation result is identical between policies.
- **No top-level URL change** in any run under either policy.
- Limits: absolute playability is unproven for xvideos.com/.red, xnxx, pornhub, spankbang, tnaflix (generic click, headless, specimens, bot challenge); a popup-gated player on one of those would only show up as "popups > 0 under CURRENT", and only eporner, tnaflix and cloudbate did.

## Required report
```
CURRENT POPUP PERMISSION:
iframe.sandbox = 'allow-same-origin allow-scripts allow-forms allow-popups'  (js/launch.js:323)

R0 POLICY:
'allow-same-origin allow-scripts allow-forms'

CLOUDBATE:
popup blocked: YES
video playable in GS3: NO via its Play button (it only plays in the popup today); YES if the ?play=true URL is loaded in the Panel (one click, 0 popups)
mechanism classification: POPUP (window.open ?play=true); plus a TOP NAV attempt blocked under both policies

COMPATIBILITY MATRIX:
see table (no differential regression in 10 site-runs)

SITES PROTECTED:
3 — cloudbate (video page), eporner, tnaflix

SITES BROKEN:
0 regressions by comparison. Cloudbate stops playing in a separate tab (the unwanted behaviour) and does not yet play in-Panel via its own button.

GLOBAL REMOVAL SAFE:
NOT YET PROVEN (sample-safe: no GS3 code uses window.open/_blank, and no differential regression in 9 sites; but headless, no logins/OAuth, 5 sites inconclusive for play, spankbang blocked by a bot challenge)

PRODUCTION CHANGE:
NOT PERFORMED

COMMIT:
NO

PUSH:
NO
```

## Architecture recommendation (next smallest Play)
1. **Ship the one-line sandbox change** (`allow-popups` removed in `js/launch.js:323`; nothing else) after a **Human live check in the real Chrome**: cloudbate Play (expect: no new tab, focus stays in GS3) plus 2–3 favourite sites with the Human's real extensions/logins. No setting or toggle.
2. **Pair it with the smallest in-Panel replacement for the lost behaviour only where a site genuinely needs it:** for cloudbate, a provider URL rule — load video pages as `<url>?play=true` (proven to play in-Panel with one click, 0 popups). This is a provider URL adapter, not a sandbox exception. A general "route blocked popup URL into the Panel" is not available from the page (the URL is only visible in a console message); it would need the Current-URL/companion CDP seam.
3. **Layer 2 (browser-level Popout Containment) is NOT needed** for the class of behaviour tested; keep it as fallback only for sites that escape despite the sandbox (none observed). Notably the sandbox prevents tab *creation* itself, so there is no focus flash.
4. Product law candidate holds on this evidence: "Panel content must not create/focus a separate window/tab unless the Human explicitly asks" — recommend adopting after step 1's live check.

## Production / git
No production file touched by this play (tracked files are clean in the working tree at this point). Lab only: `architecture-lab/popout-shield/` (`host.html`, `run.mjs`, `cloudbate-probe*.mjs`, `shots/`, `results-*.json`). No commit, no push.
