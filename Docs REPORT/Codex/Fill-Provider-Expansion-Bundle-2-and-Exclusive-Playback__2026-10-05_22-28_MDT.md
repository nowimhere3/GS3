# Fill Provider Expansion Bundle 2 and Exclusive Playback

<!-- sideline-provenance: {"gameId":"game_git_042782b8","clientRef":"ref_1791260133164_b204293b","playerInstanceId":"codex-998c3b06","playerType":"codex","provider":"codex","model":"gpt-6.1-sol","effort":"high","at":"2026-10-06T04:15:33.164Z"} -->

No new production adapters earned playback proof. The three requested providers remain unavailable through URL-derived Fill. The existing candidate, including the Human-confirmed SpankBang crop, is preserved. The exclusive-playback breadcrumb is documentation only. All 31 focused tests pass.

## Required result

```text
BASE HEAD:
4f098c0

CURRENT WORKING TREE PRESERVED:
YES

SPANKBANG

HUMAN FOOTER FIX:
PASS

REGRESSION CHECK:
PASS

XHOMEALONE

CANONICAL VIDEO PATTERN:
https://xhomealone.com/videos/<positive numeric ID>/<slug>/
Only the bare host was observed. No host variant enabled.

PLAYBACK STRATEGY:
NO SAFE PRESENTATION (published FILL_EMBED endpoint denies access)

EMBED / PLAYER FOUND:
YES

PRESENTATION RULE:
NONE enabled. Published candidate: https://xhomealone.com/embed/<ID>

REAL GS3 PLAYBACK:
BLOCKED

DATABASE COVERAGE:
107 URL occurrences; 104 unique; 102 video-page URLs; 5 non-video URLs.
Adapter-covered video URLs: 0 / 102 = 0%.

ADAPTER ADDED:
NO

UNDERLYING MEDIA PLAYING BEFORE FILL:
NO in the observed specimens/window; content video remained paused.

DOUBLE AUDIO POSSIBLE:
UNPROVEN (Fill playback could not start)

CUMCAMS

CANONICAL VIDEO PATTERN:
https://cumcams.cc/video/<positive numeric ID>/play
Only the bare host was observed. No host variant enabled.

PLAYBACK STRATEGY:
NO SAFE PRESENTATION (full watch page; signed API creates the player after Play)

EMBED / PLAYER FOUND:
YES: watch-page player mechanism; NO: proven player-only URL

PRESENTATION RULE:
NONE

REAL GS3 PLAYBACK:
BLOCKED

DATABASE COVERAGE:
40 URL occurrences; 39 unique; 37 video-page URLs; 3 performer pages.
Adapter-covered video URLs: 0 / 37 = 0%.

ADAPTER ADDED:
NO

UNDERLYING MEDIA PLAYING BEFORE FILL:
NO in the native Chrome observations; no video element before Play.

DOUBLE AUDIO POSSIBLE:
UNPROVEN

CAMWHORESHD

CANONICAL VIDEO PATTERN:
https://www.camwhoreshd.com/videos/<positive numeric local ID>/<slug>/
Only the www host was observed. Old slug suffixes may redirect; local ID persists.

PLAYBACK STRATEGY:
NESTED_PLAYER; no safe deterministic GS3 presentation proved

EMBED / PLAYER FOUND:
YES: nested https://www.camwhores.lol/embed/<different remote ID>

PRESENTATION RULE:
NONE (local ID does not determine the observed remote ID)

REAL GS3 PLAYBACK:
FAIL (own same-ID embed errors; direct nested candidates return 404)

DATABASE COVERAGE:
98 URL occurrences; 97 unique; 98 video-page URLs; 0 non-video URLs in database.
Adapter-covered video URLs: 0 / 98 = 0%.

ADAPTER ADDED:
NO

UNDERLYING MEDIA PLAYING BEFORE FILL:
YES for muted advertising media. Main content playback was not proved.

DOUBLE AUDIO POSSIBLE:
UNPROVEN (no audible competing content streams reproduced)

GLOBAL

EXCLUSIVE PLAYBACK BREADCRUMB ADDED:
YES

BREADCRUMB FILE:
Docs ANCHOR/009-AUTOMATIONS.md

CANONICAL URL MUTATED:
NO

POPOUT SHIELD REGRESSION:
NO

CLOUDBATE REGRESSION:
NO

WXX REGRESSION:
NO

SPANKBANG CROP REGRESSION:
NO

FILL VISIBILITY REGRESSION:
NO

PRODUCTION FILES CHANGED:
NONE in this Play. Incoming dirty presentation-url.js, capability-bridge.js
and launch.js are byte-for-byte preserved.

TEST FILES CHANGED:
test/fill-provider-bundle2.test.js (new)
test/fill-visibility.test.js (one additional regression test)

DOCUMENTATION FILES CHANGED:
Docs ANCHOR/009-AUTOMATIONS.md
Docs REPORT/Codex/Fill-Provider-Expansion-Bundle-2-and-Exclusive-Playback__2026-10-05_22-28_MDT.md
Research evidence added under architecture-lab/fill-panel/bundle2-*.

COMMIT:
NO

PUSH:
NO
```

## Provider evidence and limits

XHomeAlone watch pages for [162980](https://xhomealone.com/videos/162980/meadowthayer-chaturbate-cam-clip-live-cams-panties/) and [214910](https://xhomealone.com/videos/214910/neli-elinek-chaturbate-new-record-clip-crazy-webcam-goddes/) publish `getEmbed()` using `/embed/<local ID>`. Both [first embed](https://xhomealone.com/embed/162980) and [second embed](https://xhomealone.com/embed/214910) display “You are not allowed to watch this video.” inside the actual GS3 Fill executor. Watch pages expose a KVS HTML5 player and signed MP4/CDN requests; those media links are not stable presentation identities. No parameter or alternate player-only endpoint was established. The database's non-video URLs are three tag pages and two search pages.

CumCams specimens [190505100](https://cumcams.cc/video/190505100/play) and [189616780](https://cumcams.cc/video/189616780/play) have full watch-page chrome and a Play button. The provider's [player script](https://cdn.cumcams.cc/p/cc/589ffbd/js/main-plyr.js) requests `/api/video/<ID>?token=<page token>`, replaces the splash with returned markup, and initializes Plyr/HLS or MP4. It also pauses its player on window blur. A `tv` control preset exists in that shared script, but no corresponding sanctioned video player URL was found; no route was guessed from that name. Native Chrome loaded both pages in the actual overlay. After dismissing the site dialog through its normal control, trusted Play clicks sent the signed API requests. Both underlying and Fill requests returned HTTP 200 with the body `wrong_token`; no video element or media playback resulted. The reason for token rejection is unproven. An earlier header-interception run reached a browser security challenge; native Chrome resolved that limitation. Neither HTTP 200 nor an accessible watch page proves playback or a player-only mapping.

CamWhoresHD specimens [1892550](https://www.camwhoreshd.com/videos/1892550/neli-elinek-armpits-4-0f973bf750cd54bd/) and [1946972](https://www.camwhoreshd.com/videos/1946972/neli-elinek-123-26fa0aea70d3fc63/) embed remote IDs `16296779` and `16330489`, respectively. The site's own `/embed/<local ID>` returns “Video is not found.” Both discovered remote URLs return “404 / Page not found” when loaded directly from GS3. One nested watch-page player reached decoded media readiness, but its clock did not advance; readiness and media requests are not playback proof. Different nesting/referrer context is a possible explanation for the direct failures, not a proven cause. Muted Flirtify advertising videos were observed playing underneath. No remote-ID lookup table, signed media rule, or live scraping adapter was added.

## Validation

Research used installed Chrome in headed, isolated contexts and the real `index3.html` executor. Exact-specimen mappings were served only into the research browser through a module response override; production URL rules were never changed. This allowed testing candidate presentations without prematurely shipping an adapter. CamWhoresHD's remote ID pairs were research observations only.

For XHomeAlone and CamWhoresHD, document-header interception modeled the Human's existing Ignore X-Frame Headers extension because normal pages send `X-Frame-Options: SAMEORIGIN`. All three providers were also retried with native Chrome network/header behavior: XHomeAlone embeds still denied access, CamWhoresHD's direct remote players still returned 404, and CumCams' Play API still rejected its tokens. No provider script, player CSS, or age gate was modified. Every GS3 iframe kept `sandbox="allow-same-origin allow-scripts allow-forms"`.

Observed popup count was zero for every recorded research row. Completed overlay checks preserved the top GS3 URL, original iframe object/src, `data-last-src`, and Runtime Session identity; Exit removed the overlay. Viewport changes retained the overlay's Panel geometry. These checks do not establish usable provider controls, audio, fullscreen, or absence of operating-system focus theft when playback itself fails.

Focused suite: **31/31 PASS**:

```text
node --test test/fill-embed.test.js test/fill-provider-expansion.test.js test/fill-provider-bundle2.test.js test/fill-visibility.test.js test/capability-bridge.test.js test/settings-boot.test.js
```

The added checks keep all three unproven providers unavailable, reject query/host/path/scheme attempts to accidentally grant capability, preserve normal presentation strings, and drive supported → unsupported → supported assignments in the same live Panel without reloading Runtime. Existing tests verify all eleven provider rules, Cloudbate behavior, Top/Runway/Deep Cuts delegation to the canonical executor, identity preservation, shield, and Exit. There are no newly supported providers for which a new positive visibility test would be justified.

SpankBang's existing geometry fixture verifies footer clipping, clickable controls, fractional viewport sizes, actual Position drag, Exit and reassignment cleanup, and isolation from other providers. It passed unchanged. Human-confirmed playback/footer removal supersedes the previous report's pending field status. This Play did not redo live SpankBang playback, broaden its crop, or claim fixture playback as provider playback.

SHA-256 comparisons against the incoming snapshot confirm that `links.json`, `presets.json`, all three dirty production files, and the existing crop/provider/settings tests are unchanged. Only the intended visibility-test addition and architecture breadcrumb differ among those snapshotted files. The incoming tracked and untracked candidate was retained.

The breadcrumb records remembered underlying state, pause/suspend by default, mute fallback, optional leave-playing preference, policy-based Exit restoration, and the CPU/GPU/network rationale. The future Stream Loop chain includes EXCLUSIVE PLAYBACK before delay/autoplay. No Auto Fill, autoplay, delay, smart delay, or exclusive-playback behavior was implemented.

Evidence: [coverage](../../architecture-lab/fill-panel/bundle2-coverage.json), [XHomeAlone executor observations](../../architecture-lab/fill-panel/bundle2-browser-xhomealone.com.json), [XHomeAlone native Chrome confirmation](../../architecture-lab/fill-panel/bundle2-browser-xhomealone.com-native.json), [CumCams native Chrome observations](../../architecture-lab/fill-panel/bundle2-browser-cumcams.cc-native.json), [CamWhoresHD own embed observations](../../architecture-lab/fill-panel/bundle2-browser-camwhoreshd.com.json), [nested-player observations](../../architecture-lab/fill-panel/bundle2-browser-camwhoreshd.com-nested.json), [native nested-player confirmation](../../architecture-lab/fill-panel/bundle2-browser-camwhoreshd.com-nested-native.json), [focused tests](../../architecture-lab/fill-panel/bundle2-focused-tests.json), and [candidate preservation](../../architecture-lab/fill-panel/bundle2-preservation.json).

Stopped for Human field testing. There is no new provider adapter to enable in this candidate. Further CumCams proof needs working player-token requests and an observed sanctioned player-only URL; XHomeAlone needs an embed that permits playback; CamWhoresHD needs a supported deterministic route that resolves its remote player safely.
