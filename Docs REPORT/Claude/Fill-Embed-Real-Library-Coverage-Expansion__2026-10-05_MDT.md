<!-- sideline-provenance: {"gameId":"game_git_042782b8","clientRef":"ref_1791253222577_00a406c8","playerInstanceId":"claude-1352dbb4","playerType":"claude","provider":"claude","model":"sonnet","effort":"medium","at":"2026-10-06T02:20:22.577Z"} -->
# FILL_EMBED Real-Library Coverage Expansion

- **Agent / model:** Claude Sonnet 5.5 (medium) — Monday 2026-10-05, ~23:30 MDT (Calgary)
- **Base:** `HEAD = 4f098c0`; working tree = uncommitted FILL_EMBED candidate + the three test files. Nothing cleaned/stashed/reset/committed/pushed.
- **Method:** classified every unmatched supported-host URL in the Human's `links.json`; for each real video shape, derived the embed URL and proved **playback inside the real GS3 Fill overlay** (real `index3.html`, real Chrome, real Fill button, specimens taken from the database) *before* keeping the adapter rule. Scripts: `architecture-lab/fill-panel/verify-fill-embed.mjs` (now takes `SPEC_FILE`, `HEADED`), `coverage-specimens.json`.

## Classification of the unmatched library URLs
Real video pages found: xvideos.com legacy `/video<digits>/<slug>` (73), `de.xvideos.com/video.<id>/…` (4), eporner `/hd-porn/<id>/<slug>/` (10), `m.tnaflix.com` (2) and `morigin.tnaflix.com/br/…/video<digits>` (1), `ru.spankbang.com/<id>/video/<slug>` (1). Everything else is **not** a single video page and stays unsupported: SpankBang playlists/search/tags (≈100), PornTrex search/tags, Pornhub channels/search/`/model/`, XNXX `/porn-maker/`, XVideos `/favorite/…`, `xvideos.red` `/account`, `/favorite`, `/my-feed`, eporner `/cat/`, `/pornstar/`, `/profile/…/playlist/…`, TNAFlix `search`. **XNXX, Pornhub, PornTrex: no new video shapes** (all remaining unmatched are non-video).

## Coverage matrix
| Provider / URL shape | DB count | Real video page | Embed URL derived | Real GS3 playback (Fill overlay) | Adapter added |
|---|---|---|---|---|---|
| xvideos.com `/video<digits>/<slug>` (legacy) | 73 | YES | `www.xvideos.com/embedframe/<digits>` | **PASS** (3/3 specimens, t = 4.5 s, 0 popups) | **YES** |
| de.xvideos.com `/video.<id>/<slug>` | 4 | YES | `www.xvideos.com/embedframe/<id>` | **PASS** (2/2) | **YES** (exact host `de.` only) |
| eporner.com `/hd-porn/<id>/<slug>/` | 10 | YES | `www.eporner.com/embed/<id>/` | **PASS** (2/3 played; the third specimen's embed answers 302 — a removed video, not a shape problem) | **YES** |
| m.tnaflix.com `…/video<digits>` | 2 | YES | `player.tnaflix.com/video/<digits>` | **PASS** (2/2; one of the two `<video>` elements advancing, as with www) | **YES** |
| morigin.tnaflix.com `/br/…/video<digits>` | 1 | YES | `player.tnaflix.com/video/<digits>` | **PASS** (1/1) | **YES** |
| ru.spankbang.com `/<id>/video/<slug>` | 1 | YES | `spankbang.com/<id>/embed/` | **BLOCKED / HUMAN FIELD REQUIRED** — in headed real Chrome the *framed* embed in the Fill overlay shows Cloudflare "Just a moment…" (the same URL opened top-level did load a player, `Embed Player` with a `<video>`, so the Human's real browser may pass) | **NO** (not added without playback proof; rule was tried then reverted) |
| tr./la. spankbang | playlists only | NO | — | — | NO |
| XNXX / Pornhub / PornTrex leftovers | ~9 | NO (search/channel/maker/model pages) | — | — | NO |
| SpankBang playlist/search/tag; eporner cat/pornstar/profile; tnaflix search; xvideos favorite/account; xvideos.red account/favorite/my-feed | ≈125 | NO | — | — | NO (verified `null`) |

Coverage after the change (supported hosts, share of URLs that now show Fill): xvideos.com 145/148, xvideos.red 2236/2241, eporner 82/86, tnaflix 34/36 (the 2 left are search pages), xnxx 78/79, pornhub 86/89, porntrex 132/138, spankbang 97/199 (rest are playlists/search + the one `ru.` video).

## Adapter changes (`js/presentation-url.js`, rules only; hardening unchanged)
- xvideos rule: hosts `xvideos.com`, `xvideos.red`, **`de.xvideos.com`** (exact); paths `/video.<id>/…` **or** `/video<digits>/…` → `https://www.xvideos.com/embedframe/<id>`. `fr.`/other subdomains stay `null`.
- eporner rule: `/video-<id>/…` **or** `/hd-porn/<id>/…`.
- tnaflix rule: hosts `tnaflix.com`, **`m.tnaflix.com`**, **`morigin.tnaflix.com`** (exact), path ending `/video<digits>`.
- Still exact-host matching, strict path parsing, ID-charset check, only the extracted ID reaches the output, non-http rejected, look-alikes (`de.xvideos.com.evil.net`, `m.tnaflix.com.evil.net`, `evil.tnaflix.com`) rejected.
- Nothing else touched (Settings, Hotswap order, Runway, Top Toolbar, capability lifecycle, Cloudbate, Popout Shield, Current-URL, xHamster, icon).

## Capability visibility and canonical identity
New test in the real Runtime path (one live Panel, no reload): legacy xvideos → Fill visible; xvideos `/favorite/…` → hidden; eporner `/hd-porn/` → visible; eporner `/cat/…` → hidden; `m.tnaflix.com …/video<digits>` → visible; spankbang playlist → hidden; `de.xvideos.com/video.<id>` → visible. In every playback run the assigned URL (`data-last-src`), Runtime Session URL, generation and original iframe element were unchanged during Fill and after Exit; `links.json` untouched.

## Tests
`test/fill-embed.test.js` (new real-shape positives incl. query/hash, 28 added rejections: favorites, categories, profiles, playlists, `fr.xvideos.com`, `ru./tr./la.` spankbang, tnaflix look-alikes, `<` injection), `test/fill-visibility.test.js` (new library-shape test), `test/settings-boot.test.js`, `test/capability-bridge.test.js`: **24/24 pass**. Playback regression re-run on the original providers after the rule changes (xvideos.com, pornhub, eporner, tnaflix): all playing, 0 popups, Exit restores, resize matches. (Boot-smoke suite not re-run; no lifecycle code changed.)

## Required report
```
BASE HEAD: 4f098c0
XVIDEOS LEGACY /video<digits>: PASS
XVIDEOS LOCALIZED HOST: PASS (de. only; other localizations not added)
EPORNER /hd-porn/: PASS
TNAFLIX MOBILE/ORIGIN: PASS
SPANKBANG LOCALIZED VIDEO HOSTS: HUMAN FIELD REQUIRED (framed embed hits a Cloudflare challenge even in headed Chrome; not added)
XNXX NEW VIDEO SHAPES: NONE
PORNHUB NEW VIDEO SHAPES: NONE
PORNTREX NEW VIDEO SHAPES: NONE
SEARCH/CATEGORY/PLAYLIST URLS REMAIN UNSUPPORTED: YES
CANONICAL URL MUTATED: NO
RUNTIME VISIBILITY REGRESSION: NO
FILL PLAYBACK REGRESSION: NO
PRODUCTION FILES CHANGED (this Play): js/presentation-url.js (plus tests: test/fill-embed.test.js, test/fill-visibility.test.js); cumulative candidate also: js/capability-bridge.js, js/launch.js
COMMIT: NO
PUSH: NO
```

## For the Human's field verification
Hard-refresh (Ctrl+Shift+R) `http://localhost:8080/index3.html`. Put one of each in a Panel and press Fill: an `xvideos.com/video<digits>/…` link, a `de.xvideos.com/video.<id>/…` link, an eporner `/hd-porn/<id>/…` link, an `m.tnaflix.com` link. For the one `ru.spankbang.com/<id>/video/…` link, try Fill in your own Chrome (it is not enabled yet; if the framed embed plays for you, say so and it can be added). Search, category, playlist and favorites pages should still show no Fill.
