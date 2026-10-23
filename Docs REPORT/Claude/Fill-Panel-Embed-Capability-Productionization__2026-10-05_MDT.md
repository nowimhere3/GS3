<!-- sideline-provenance: {"gameId":"game_git_042782b8","clientRef":"ref_1791247416758_7b322f67","playerInstanceId":"claude-1352dbb4","playerType":"claude","provider":"claude","model":"sonnet","effort":"medium","at":"2026-10-06T00:43:36.758Z"} -->
# GS3 Fill Panel — FILL_EMBED Capability (production candidate, awaiting Human field test)

- **Agent / model:** Claude Sonnet 5.5 (medium) — Monday 2026-10-05, ~21:10 MDT (Calgary)
- **Base:** `git fetch origin` → `origin/main` = local `main` = **`4f098c0`** ("Add Popout Shield and Cloudbate presentation adapter"); tracked tree clean at start; all untracked labs/reports preserved (no clean/stash/reset).

## Design
One presentation family in `js/presentation-url.js`: `getPresentationUrl(assigned)` (Cloudbate, unchanged) and the new **`getFillPresentationUrl(assigned) → string | null`** (FILL_EMBED). Fill derives a presentation from the **assigned** URL and never writes it.
- **Recovered transformations** (from `architecture-lab/fill-panel/lab.js` and the live-harness/XNXX test), reconciled and hardened: exact-host match (optional `www.`), ID charset-checked (`[A-Za-z0-9_-]+`, digits where the provider is numeric), only the ID reaches the output (source query/hash discarded), xnxx kept as the TLD/subdomain family proven earlier.
- **Integration** (`js/capability-bridge.js`, the existing Fill state machine): a Panel is Fill-capable if the document reports FILL_PANEL (unchanged) **or** its `data-last-src` yields an embed URL. Press Fill → a temporary `<iframe class="gs3-fill-embed">` is appended to the Panel (same box as the real iframe: `top: var(--hotswap-website-inset)`, `width:100%`, `height: calc(100% - inset)`), `allow="autoplay; fullscreen"`, **sandbox `allow-same-origin allow-scripts allow-forms`** (Popout Shield unchanged). Press ✕ → overlay removed. The Panel's real iframe underneath is never touched.
- **Lifecycle:** overlay removed on any new assignment (`resetFillPanelCapability`, incl. ⟳ Reload, Edit URL, Shuffle, folder assign, Undo of assignments), on Panel history traversal (`navigatePanelTo` → `exitFillEmbed`) and on Panel removal; availability is re-derived after `data-last-src` changes (`refreshFillPanelPresentation`).
- **Priority:** embed lane first when available; a live document-level (userscript) Fill keeps its own toggle; Panels with neither keep Fill hidden (existing behaviour and tests intact).

## Adapter API and rules
```
getFillPresentationUrl(assignedUrl: string): string | null   // pure, deterministic, host-exact, ID-only output
xvideos.com|.red  /video.<id>/…              -> https://www.xvideos.com/embedframe/<id>
xnxx.<tld>        /video-<id>/…              -> https://www.xnxx.com/embedframe/<id>
pornhub.com       /view_video.php?viewkey=K  -> https://www.pornhub.com/embed/K
spankbang.com     /<id>/video/…              -> https://spankbang.com/<id>/embed/
eporner.com       /video-<id>/…              -> https://www.eporner.com/embed/<id>/
porntrex.com      /video/<digits>/…          -> https://www.porntrex.com/embed/<digits>
tnaflix.com       …/video<digits>            -> https://player.tnaflix.com/video/<digits>
```
`.red` sources deliberately map to the **.com** embedframe (works without the .red site's login/promo wall; verified below). xHamster, Cloudbate and every other host return `null`. XNXX search/list pages return `null` (Fill is hidden there; `Fill Current` on `observedCurrentUrl` is a future consumer of the same function).

## Validation
- **Unit** (`test/fill-embed.test.js`, synthetic IDs): 12 positive cases (query/hash, no-www, other xnxx TLD/subdomain), ~38 rejection cases (home/search/tag/category/profile pages, malformed IDs and `../` smuggling, look-alike hosts such as `xvideos.com.evil.net`, `notxvideos.com`, `xvideos.com@evil.net`, xHamster, Cloudbate, non-http schemes, undefined/null/number), purity, and the Cloudbate adapter unchanged. **4/4 pass.**
- **Real `index3.html` (working tree) + real Chrome + live providers**, headless, automated trusted clicks, X-Frame-Options/CSP stripped in the lab as a stand-in for the Human's extension (`architecture-lab/fill-panel/verify-fill-embed.mjs`). Per provider: Panel 0 = provider watch URL, Panel 1 = another provider, Panel 2 = local canary. Fill button visible on Panel 0 and **hidden on the canary Panel**; the real Fill button pressed.

| Provider | Embed overlay URL | Plays in overlay | Audio state | Controls | Resize while filled | Exit restores | Canonical / Session / gen unchanged | Other Panel untouched | Popups | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| xvideos.com | `/embedframe/<id>` | yes (t 4.5 s) | not muted, vol 1 | play overlay present; pause-by-click not confirmed | match (real resizer drag + viewport change) | yes (same iframe element) | yes | yes | 0 | **PASS** (controls partly UNPROVEN) |
| xvideos.red (assigned .red) | `www.xvideos.com/embedframe/<id>` | yes (4.5 s) | not muted, vol 1 | as above | match | yes | yes | yes | 0 | **PASS** (via the .com embed) |
| xnxx.com | `/embedframe/<id>` | yes (4.5 s) | not muted, vol 1 | as above | match | yes | yes | yes | 0 | **PASS** |
| pornhub.com | `/embed/<key>` | yes (2.8 s) | not muted, vol 1 | custom play/pause button toggled pause | match | yes | yes | yes | 0 | **PASS** |
| spankbang.com | `/<id>/embed/` | n/a — overlay shows a Cloudflare "Just a moment…" challenge in this headless environment | — | — | match | yes | yes | yes | 0 | **BLOCKED** (bot challenge; adapter output and lifecycle fine; playback needs the Human's real browser) |
| eporner.com | `/embed/<id>/` | yes (2.2 s) | **starts muted (vol 0.8)** | video.js control toggled pause | match | yes | yes | yes | 0 | **PASS** (Human to confirm audio after unmute) |
| porntrex.com | `/embed/<digits>` | yes (3.8 s, player in a nested frame) | not muted, vol 1 | KVS player control toggled pause | match | yes | yes | yes | 0 | **PASS** |
| tnaflix.com | `player.tnaflix.com/video/<digits>` | yes (playing flag true; one of two video elements advancing) | not muted, vol 1 | Plyr control toggled pause | match | yes | yes | yes | 0 | **PASS** |

"Audio" = `<video>.muted/volume` state; no sound was actually heard (headless). "Real GS3" = the real index3 module graph and Fill button, but automated, not a Human field run.
- **Lifecycle probe (real GS3):** Fill on an xvideos Panel → overlay present, title "Exit Fill Panel"; assign an xHamster URL → overlay removed and the Fill button hidden; assign an XNXX video URL → Fill available again; Fill → overlay; ⟳ Reload → overlay cleared.
- **Popout Shield regression:** `popout-shield/verify-candidate.mjs` — all Panel iframes `allow-same-origin allow-scripts allow-forms`, `allow` unchanged, 0 popups; the embed overlay uses the same sandbox. **No regression.**
- **Cloudbate regression:** `popout-shield/verify-cloudbate-adapter.mjs` — effective src still `…?play=true`, assigned/session unchanged, one Play click plays, 0 popups, Reload path intact. **No regression.**
- **Existing tests:** `capability-bridge.test.js` + new unit tests 15/15; boot-smoke subset (boot ×4, Undo/Redo, navigation, Reload, history, folder, Fill) 28/29 — the only failure is the pre-existing `L2 Master Undo and Redo mutate only the selected nested Runtime` (fails the same on unmodified `212ddb0`). Full suite not run.
- **Bug found and fixed during validation:** an iframe with `width/height:auto` falls back to 300×150 even with left/right/top/bottom set; the overlay first appeared 300×150 (still playing). Fixed with explicit `width:100%; height:calc(100% - inset)`, then re-verified with a real resizer drag.
- Also fixed before test: a template-literal escape (`\.`) that would have loosened the xvideos path match.

## Required report
```
BASE HEAD: 4f098c0
ADAPTER API: getFillPresentationUrl(assignedUrl) -> embed URL | null   (js/presentation-url.js; companion of getPresentationUrl)
PROVIDERS TESTED: xvideos.com (+ .red source), xnxx.com, pornhub.com, spankbang.com, eporner.com, porntrex.com, tnaflix.com

REAL GS3 RESULTS (automated, real index3 + real Chrome + live providers):
xvideos.com:   PASS (controls partly unproven)
xnxx.com:      PASS
pornhub.com:   PASS
spankbang.com: BLOCKED (Cloudflare challenge in the headless lab; adapter + lifecycle verified)
eporner.com:   PASS (embed starts muted)
porntrex.com:  PASS
tnaflix.com:   PASS

CANONICAL URL MUTATED: NO
LINKS.JSON MUTATED: NO
RUNTIME SESSION MUTATED BY FILL PRESENTATION: NO (assigned, session URL and generation unchanged during Fill and after Exit)
EXIT RESTORES NORMAL PANEL: YES (overlay removed; same original iframe element, src, data-last-src)
RESIZE WHILE FILLED: YES (overlay box equals the real iframe box after a real resizer drag and a viewport change)
VIDEO CONTROLS: pornhub, eporner, porntrex, tnaflix: provider control toggled pause; xvideos/xnxx/.red: playback works, pause control not confirmed by automation
AUDIO: video element not muted at volume 1 for all but eporner (starts muted, volume 0.8); no sound heard (headless); the Panel's original iframe keeps running underneath (possible double audio if the Human had started it)
POPOUT SHIELD REGRESSION: NO
CLOUDBATE REGRESSION: NO
XHAMSTER: EXCLUDED (adapter returns null; Fill hidden; overlay removed on assigning it)
PRODUCTION FILES CHANGED: js/presentation-url.js, js/capability-bridge.js, js/launch.js, test/fill-embed.test.js (new, tests only)
COMMIT: NO
PUSH: NO
```

## Human field test (real Chrome, local build)
Serve the repo, hard-refresh `http://localhost:8080/index3.html`. For xvideos, xnxx, pornhub, eporner, porntrex, tnaflix, spankbang: put a normal watch-page URL in a Panel → press ⛶ Fill → expect the provider player to fill the Panel; press Play; check sound; resize a Position while Filled; press ✕ Exit. Watch for: any new tab, a Panel that needs a second click, **double audio** (the normal page keeps running underneath), eporner starting muted, spankbang's challenge page. On an XNXX *search/list* page Fill is intentionally absent until the Current-URL work lands.
