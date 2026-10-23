<!-- sideline-provenance: {"gameId":"game_git_042782b8","clientRef":"ref_1791246708063_4125133d","playerInstanceId":"claude-1352dbb4","playerType":"claude","provider":"claude","model":"sonnet","effort":"medium","at":"2026-10-06T00:31:48.063Z"} -->
# xHamster Full-Page Retention Proof (block the client-side `/embed/<id>` navigation)

- **Agent / model:** Claude Sonnet 5.5 (medium) — Monday 2026-10-05, ~20:15 MDT (Calgary)
- **Base:** `212ddb0` + earlier uncommitted Popout Shield / Cloudbate changes, preserved exactly. **GS3 production not modified.** Lab only (`architecture-lab/xhamster-seam/run2.mjs`, lab extension; the Human's installed extension untouched).
- **Result:** **STOP A.** The block works, but Chrome replaces the full page with a browser error page. The full `/videos/` document does not survive.

## Setup
Playwright **Chromium 151** (branded Chrome ignores `--load-extension`; same declarativeNetRequest code path), temp profile, unpacked lab extension with: rule 1 = copy of the Human's "drop CSP + X-Frame-Options" rule; **Rule A** = request header `Sec-Fetch-Dest: set document` for `requestDomains: xhamster.com`, `sub_frame`; **Rule B** = `block` for `^https://xhamster\.com/embed/`, `sub_frame` only. All three accepted by `updateDynamicRules`. Panel = shielded iframe (`allow-same-origin allow-scripts allow-forms`) built like `launch.js`. Every document gets a random id via an init script so replacement of the document is measurable. Panel document sampled every 250 ms for 14 s.

## Observed timeline (single run, xHamster `/videos/<slug>-<id>`)
```
0.5s  request  /videos/…            Sec-Fetch-Dest=document
0.5s  response 200 /videos/…        (full page)
0.5s  framenavigated -> /videos/…
1.0s  request  /embed/3298012       Sec-Fetch-Dest=(absent)   <- xHamster's client script, same frame
1.0s  REQUEST FAILED /embed/3298012 net::ERR_BLOCKED_BY_CLIENT
1.0s  framenavigated -> chrome-error://chromewebdata/
```
- Server full page: **YES** (200 with `Sec-Fetch-Dest: document`).
- Client embed navigation attempted: **YES, once, ≈0.5 s after the full page committed** (full-page document lifetime ≈ 0.5 s).
- Blocked successfully: **YES** (`ERR_BLOCKED_BY_CLIENT`).
- Result in the iframe: **class B — the iframe becomes Chrome's error document** (`chrome-error://chromewebdata/`, ~42 characters of text). The previous full document was **replaced, not preserved**: the document id sampled for the rest of the run is a single id belonging to the error page; no `/videos/` document id was ever observed after 1.0 s.
- Reload loop: **NO** (exactly one embed attempt; the error page stayed for the remaining 13 s). xHamster did not change strategy, switch domain or retry.
- Mechanism of the loss (Chromium behaviour, not xHamster's): a *navigation* that is blocked by a network rule still commits an error page in the frame — cancelling at the network layer does not cancel the navigation back to the old document.
- Player/Play/popup/focus (Phase 2): **NOT TESTED** (no full page remained). Popups: 0. Panel sandbox unchanged. Only background media request seen: an HLS preview/prefetch URL on `xhcdn.com`. Mirrors (`xhamster2.com`, `xhamster.desi`): not tested (main proof did not succeed).

## Verdict
```
TRANSPORT RULE:
Sec-Fetch-Dest -> document   (works; server returns 200 full page)

EMBED NAVIGATION RULE:
xhamster.com/embed/* sub_frame -> blocked   (works at the network layer)

SERVER FULL PAGE:
YES

CLIENT EMBED NAVIGATION ATTEMPT:
YES (once, ~0.5 s after the full page committed)

BLOCKED SUCCESSFULLY:
YES (net::ERR_BLOCKED_BY_CLIENT)

FULL PAGE PRESERVED AFTER BLOCK:
NO

IF NOT PRESERVED:
The iframe's document was replaced by Chrome's error page (chrome-error://chromewebdata/); no retry, no loop.

PLAYER DOM PRESENT:
NOT TESTED

VIDEO PLAYABLE:
NOT TESTED

POPUP CREATED:
NOT TESTED (0 observed)

FOCUS STAYS IN GS3:
NOT TESTED

POPOUT SHIELD INTACT:
YES

CLOUDBATE CHANGES:
NONE

GS3 PRODUCTION CHANGED:
NO

COMMIT:
NO

PUSH:
NO
```

> **Blocking xHamster's client-triggered `/embed/<id>` sub-frame navigation does not preserve the full `/videos/...` document long enough for in-Panel playback because Chrome commits a blocked sub-frame navigation as an error page (`chrome-error://chromewebdata/`), replacing the full page ~0.5 s after it loaded, so cancelling the request at the network layer cannot stop the script's navigation from destroying the document it started from.**

## Notes (not done — per "do not pile on hacks")
- Blocking the navigation target cannot work by itself. A different approach would have to stop the *script* from navigating (e.g. neutralising the framing-detection script/response, or serving a modified document) — fragile, provider-specific and a heavy-proxy-class change; not attempted.
- Cloudflare-style conclusions unchanged: xHamster remains embed-teaser-only inside a Panel; with Popout Shield its Play does nothing visible.
