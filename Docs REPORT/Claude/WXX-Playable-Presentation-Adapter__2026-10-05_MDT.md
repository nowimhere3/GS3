<!-- sideline-provenance: {"gameId":"game_git_042782b8","clientRef":"ref_1791255170215_8b6f0bf6","playerInstanceId":"claude-1352dbb4","playerType":"claude","provider":"claude","model":"sonnet","effort":"medium","at":"2026-10-06T02:52:50.215Z"} -->
# WXX.WTF — Playable Presentation Investigation and Adapter

- **Agent / model:** Claude Sonnet 5.5 (medium) — Monday 2026-10-05, ~00:10 MDT (Calgary)
- **Base:** `HEAD = 4f098c0`; working tree = uncommitted FILL_EMBED candidate + tests. Nothing cleaned/stashed/reset/committed/pushed.
- **Result:** WXX is **not** a Cloudbate-style case (no `?play=true` form), but it has a deterministic, site-sanctioned **player-only embed** that plays in a shielded Panel. I added it as a **FILL_EMBED rule** (user-pressed Fill), not as an always-on Panel rewrite — see the decision note.

## Database (observation only)
`links.json` contains **65** WXX URLs: **62 video pages** — all `https://www.wxx.wtf/videos/<digits>/<slug>/` (47 with a `…-<16 hex>` hash slug, 15 with a plain slug, ids 66611–114117) — and **3 search pages** (`/search/<name>/`, http). The adapter covers **62/65 (95%)**; the 3 search pages correctly stay unsupported. (`/videos/` alone is a 404 index; there are no `links-index.json`/cassette entries in this repo.)

## Playback mechanism (real Chrome, shielded iframe, real trusted clicks)
- Canonical video page: a KVS-style page whose **player is a nested iframe** `https://www.camhub.world/embed/<other id>?skin=black` (camhub id ≠ WXX id, e.g. WXX 96805 → camhub 445721) plus an ad-widget iframe. The old-hash URLs `301` to the current slug.
- The video **autoplays** in the Panel (`<video>` playing, t = 6.5 s, 1920 wide) — but a **click on the player area** triggers a click-jack: `window.open(<same page URL>)` plus a **same-frame navigation of the Panel to an affiliate page** (`https://chaturbate.com/in/?tour=…&campaign=…`). Under Popout Shield the `window.open` is blocked (`Blocked opening '<wxx page>' in a new window …allow-popups…`) but the frame itself is still sent to the ad page, killing the video. Under the old `allow-popups` policy it also opened a tab.
- **Classification:** pop-under click-jack = **POPUP + SAME-FRAME NAVIGATION to an ad URL** (not "popup to a playable URL"). There is no alternate playable target to load: the popup target is the same page; the navigation target is an ad. `?play=true` on WXX changes nothing (same result).
- **Playable presentation found anyway:** the site exposes `https://www.wxx.wtf/embed/<same numeric id>` (a thin page whose only content is that camhub iframe; canonical link back to the video page). Loaded directly in the shielded Panel: **no popup, no navigation, video plays on click, second click pauses** (two specimens). Not a server redirect or Sec-Fetch-Dest trick, no extra headers.

## Decision and what was implemented
`/embed/<id>` is a classic embed, so it belongs in **FILL_EMBED** (`getFillPresentationUrl`, same module as `getPresentationUrl`):
```
wxx.wtf (www. optional)   /videos/<digits>/…   ->   https://www.wxx.wtf/embed/<digits>
```
Exact host after an optional `www.` (so `wxx.wtf.evil.example`, `notwxx.wtf`, `sub.wxx.wtf`, `camhub.world` → null), digits only, only the id reaches the output, query/hash discarded, `/embed/…`, search, home, categories, malformed and non-http → null. Canonical identity untouched; Fill is presentation only.
**I did not add it to `getPresentationUrl()`** (the always-on Panel adapter): that would turn every WXX video Panel into a player-only view with no page UI, a product choice the Human should make. Today the default WXX Panel still autoplays but any click on the player hijacks the frame; Fill gives the clean player. If the Human wants the Cloudbate-style behaviour (Panel always player-only), it is a one-line follow-up using the same rule.

## Real GS3 validation (real `index3.html`, real Chrome; 3 specimens spread across the id range: 66611, 96801, 114117)
| Check | Result |
|---|---|
| `data-last-src` and Runtime Session URL canonical during Fill and after Exit | unchanged (3/3) |
| Fill button visible for the WXX Panel; overlay src | `https://www.wxx.wtf/embed/<id>` (3/3) |
| Video plays in the overlay (nested player frame) | yes, t = 2.8–3.2 s, 1280–1920 wide, not muted, vol 1 (3/3) |
| Provider control toggles pause | yes (3/3) |
| Popups / new tabs | 0 |
| Resize while filled (real resizer drag, viewport change) | overlay box = real iframe box |
| Exit restores the same original iframe element, generation unchanged | yes |
| Other Panel untouched | yes |
| Sandbox | `allow-same-origin allow-scripts allow-forms` everywhere (Popout Shield intact) |
The default (non-Fill) WXX Panel was **not** changed; the click-jack reproduction above is the unchanged behaviour. Item "Reload reapplies presentation adaptation" is N/A (no always-on rule; Reload clears the Fill overlay as for every provider).

## Regression
- Unit/browser tests: `fill-embed` (3 new WXX positives; 11 new WXX rejections), `fill-visibility` (WXX video → Fill visible; WXX search → hidden, same live Panel), `settings-boot`, `capability-bridge`: **24/24 pass**.
- Popout Shield (`verify-candidate.mjs`): sandbox unchanged, 0 popups. Cloudbate (`verify-cloudbate-adapter.mjs`): effective src still `?play=true`, one Play click plays, 0 popups. Other providers' adapters untouched (covered by the existing unit cases).

## Required report
```
BASE HEAD: 4f098c0
PROVIDER: wxx.wtf
CANONICAL VIDEO URL PATTERN: https://www.wxx.wtf/videos/<digits>/<slug>/   (slug may carry a 16-hex hash; old hashes 301 to the current slug)
PLAYBACK MECHANISM: pop-under click-jack — window.open(same page) + same-frame navigation to an affiliate ad URL on click; the player itself is a nested camhub.world embed iframe that autoplays (classification: POPUP + SAME-FRAME NAVIGATION; also EMBED/PLAYER URL available)
PLAY TARGET / ALTERNATE URL: popup target = same page; frame target = https://chaturbate.com/in/?tour=… (ad); playable alternate = https://www.wxx.wtf/embed/<id>
DETERMINISTIC PRESENTATION FOUND: YES (embed by the same numeric id)
PRESENTATION RULE: host wxx.wtf (optional www.) + path ^/videos/(\d+)(/|$)  ->  https://www.wxx.wtf/embed/<id>   [FILL_EMBED lane only; not applied to the always-on Panel presentation]
CANONICAL ASSIGNED URL MUTATED: NO
VIDEO PLAYABLE IN PANEL: YES (shielded overlay via Fill, 3/3; default Panel autoplays but click-jack on first click)
POPUP CREATED: NO (0 in Fill; the default page's own click still tries window.open, blocked by the shield)
FOCUS STAYS IN GS3: YES
POPOUT SHIELD INTACT: YES
WXX DATABASE URL COUNT: 65 (62 video pages, 3 search pages)
DATABASE VIDEO SHAPES COVERED: 62 / 62 video pages (95% of all WXX URLs)
FILL-CAPABLE PRESENTATION: YES (implemented as FILL_EMBED)
CLOUDBATE REGRESSION: NO
FILL_EMBED REGRESSION: NO
PRODUCTION FILES CHANGED: js/presentation-url.js (this Play); tests: test/fill-embed.test.js, test/fill-visibility.test.js
COMMIT: NO
PUSH: NO
```

> **WXX can use GS3's provider presentation adapter because its video pages have a deterministic, site-provided player-only embed at `/embed/<same id>` that plays inside the shielded Panel without any popup, even though its normal page cannot be fixed by a URL tweak (a click on its player triggers an ad click-jack that sends the frame to an affiliate page), so the adapter is applied as a user-pressed Fill rather than an always-on rewrite.**

## Human field test
Hard-refresh `http://localhost:8080/index3.html`, load a `https://www.wxx.wtf/videos/<id>/…` link in a Panel and press ⛶ Fill: the player should fill the Panel, play on click, with sound, resize cleanly, and ✕ Exit should return the normal page. Also note what the plain WXX Panel does when you click its player (expected: the click-jack sends the frame to a chaturbate page; no new tab). Tell me if you want WXX Panels to always load as the player-only embed (Cloudbate-style) instead.
