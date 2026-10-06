<!-- sideline-provenance: {"gameId":"game_git_042782b8","clientRef":"ref_1791245803714_2d5f0f42","playerInstanceId":"claude-1352dbb4","playerType":"claude","provider":"claude","model":"sonnet","effort":"medium","at":"2026-10-06T00:16:43.714Z"} -->
# xHamster `Sec-Fetch-Dest` Network-Seam Proof

- **Agent / model:** Claude Sonnet 5.5 (medium) — Monday 2026-10-05, ~19:50 MDT (Calgary)
- **Base:** `212ddb0` + earlier uncommitted Popout Shield / Cloudbate changes (untouched). **GS3 production not modified.** Lab only: `architecture-lab/xhamster-seam/`.
- **Result:** **STOP B.** The network layer *can* change what xHamster's server sees, and the server then returns the full page — but xHamster's own page script then redirects the iframe to `/embed/<id>` anyway.

## Phase 1 — the existing header-stripping mechanism (file inspection of the Human's Chrome profile; no Chrome connection)
- Chrome extension **"Ignore X-Frame headers" v2.0.0** (id `gleekbfjekiniecknbkamfmkohkpodhe`, `Default` profile), Manifest V3, permission `declarativeNetRequest`, `host_permissions: <all_urls>`.
- One static rule (`net_rules.json`): `modifyHeaders` on **response headers**, `remove` `Content-Security-Policy` and `X-Frame-Options`, `condition: {}` (every URL, every resource type). → **Mechanism: declarativeNetRequest** (not webRequest, proxy or CDP). It removes the *entire* CSP, not only `frame-ancestors`.
- Not in the repo; `goonerscroll` has no network rules. Other installed extensions with DNR/webRequest (Adblock Plus, Tampermonkey, Video Downloader, IDM…) are unrelated.

## Phase 2 — can a DNR rule alter `Sec-Fetch-Dest`?
Lab extension (copy of the Human's rule as id 1, plus one candidate rule id 2) scoped to `requestDomains` `xhamster.com` + a local echo server, `resourceTypes: ["sub_frame"]`, loaded in a temp profile. **Caveat:** branded Chrome 152 ignores `--load-extension`, so this ran in Playwright's **Chromium 151** (same DNR/network-service code path; not run in the Human's branded Chrome). Panel = shielded iframe (`allow-same-origin allow-scripts allow-forms`), exactly as in `launch.js`.

| Candidate | Rule accepted (`updateDynamicRules`) | Request type | Server-visible `Sec-Fetch-Dest` (echo server and xHamster request) | xHamster response to `/videos/<slug>-<id>` | Final Panel URL | Full page in Panel |
|---|---|---|---|---|---|---|
| baseline (Human's rule only) | yes | sub_frame | `iframe` | **302 → `/embed/<id>`** | `/embed/<id>` | NO |
| **A** remove `Sec-Fetch-Dest` | **yes** | sub_frame | **absent** | **200** (full page) | `/embed/<id>` | NO |
| **B** set `Sec-Fetch-Dest: document` | **yes** | sub_frame | **`document`** | **200** (full page) | `/embed/<id>` | NO |
| **C** set `Sec-Fetch-Dest: frame` | **yes** | sub_frame | `frame` | **200** (full page) | `/embed/<id>` | NO |

- Chrome **accepts** removing and setting this "forbidden" header through declarativeNetRequest (SUPPORTED), the echo server confirms the change reaches the wire, and **the server response does change** (302 → 200). Plain `curl` also shows the server only redirects for exactly `iframe` (`document`, `frame`, `embed`, `object`, `empty`, none → 200).
- **But the Panel still ends on `/embed/3298012`.** The 200 response has no `Location`, no `Refresh` header and no `<meta http-equiv=refresh>`, and the next navigation is a fresh request for `/embed/<id>` (200) — so it is **script-initiated by the page itself** (a second, client-side iframe detection). I did not locate the detector inside xHamster's bundles (not in `runtime.js`/`start.js`), and did not try to block it (that would be hack-piling).
- Because the full page never persists in the Panel, **Phase 3 (player/Play/popup/focus on the full page) was not applicable → NOT TESTED.**

## Verdict
```
EXISTING HEADER-STRIPPING MECHANISM:
Chrome extension "Ignore X-Frame headers" v2.0.0 — MV3 declarativeNetRequest static rule removing response X-Frame-Options and Content-Security-Policy (all URLs/types)

SEC-FETCH-DEST REMOVE:
SUPPORTED (declarativeNetRequest requestHeaders remove; server saw the header absent) — tested in Chromium 151

SEC-FETCH-DEST SET document:
SUPPORTED (server saw `document`) — tested in Chromium 151

SERVER RESPONSE CHANGED:
YES (302 /embed/<id> → 200 full /videos/ page)

XHAMSTER FULL VIDEO PAGE IN PANEL:
NO (xHamster's own script then navigates the iframe to /embed/<id>)

VIDEO PLAYABLE:
NOT TESTED

POPOUT SHIELD INTACT:
YES

PRODUCTION CHANGED:
NO

COMMIT:
NO

PUSH:
NO
```

> **xHamster cannot bypass its iframe-specific redirect using GS3's existing browser network seam because, although a declarativeNetRequest rule can remove or replace `Sec-Fetch-Dest` and the server then returns the full page (200 instead of 302), xHamster's own page script independently redirects the framed page to `/embed/<id>`, so the seam beats only the server half of the detection.**

## Notes for any later decision (not done here)
- The seam is real and cheap: one additional DNR rule (request-header `set document` for `requestDomains: xhamster.com`, `sub_frame`) would be a transport policy below the URL layer, leaving assigned/Session/history URLs untouched. It is **insufficient alone** for xHamster.
- Remaining obstacle is client-side framing detection. Options (all unproven and beyond this Play): neutralise the detector script via another DNR rule (fragile), or accept xHamster as embed-teaser-only / explicit "open externally". A heavy proxy was not built, per scope.
- Humans' extension changes would be to that extension's `net_rules.json` (or a second extension); GS3 itself cannot set these rules.
