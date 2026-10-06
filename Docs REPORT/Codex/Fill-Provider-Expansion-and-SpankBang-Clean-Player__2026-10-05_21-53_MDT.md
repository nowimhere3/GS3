# Fill Provider Expansion and SpankBang Clean Player

<!-- sideline-provenance: {"gameId":"game_git_042782b8","clientRef":"ref_1791257468725_a2539b03","playerInstanceId":"codex-998c3b06","playerType":"codex","provider":"codex","model":"gpt-6.1-sol","effort":"medium","at":"2026-10-06T03:31:08.725Z"} -->

Three narrow Fill adapters are added after two real Chrome playback specimens per provider. SpankBang has a provider-specific parent crop based on measured provider CSS. Its live framed playback after cropping still needs Human field confirmation. XCamladyX double audio is reproduced; the underlying-frame lifecycle was left intact.

## Required result

```text
BASE HEAD:
4f098c0

CURRENT WORKING TREE PRESERVED:
YES

SPANKBANG

HUMAN PLAYBACK STATUS:
PASS

CURRENT EMBED:
https://spankbang.com/<id>/embed/

FOOTER MECHANISM:
Provider document: #video-container-embed > .promo, below the player.
The footer is not owned by a nested player iframe.

CLEAN PROVIDER EMBED FOUND:
NO (within the bounded investigation)

CLEAN EMBED RULE:
NONE

PARENT CROP/MASK REQUIRED:
YES

FOOTER REMOVED:
YES in controlled GS3 geometry tests; live confirmation remains BLOCKED.

CONTROLS PRESERVED:
YES in measured geometry and clickable-control tests;
live provider controls/audio/fullscreen require Human field confirmation.

RESIZE:
PASS in controlled GS3 Position drag and viewport tests;
live provider confirmation remains pending.

XCAMLADYX

CANONICAL VIDEO PATTERN:
https://xcamladyx.com/videos/<positive numeric ID>/<single slug>/
Optional trailing slash; http and https accepted. Only the observed bare host.

EMBED FOUND:
YES

EMBED RULE:
https://xcamladyx.com/embed/<ID>

REAL GS3 PLAYBACK:
PASS (two specimens, before adapter enablement and through the actual executor)

DATABASE COVERAGE:
27 / 28 total URLs = 96.43%; 27 / 27 video pages = 100%

ADAPTER ADDED:
YES

STREAM-LEAK

CANONICAL VIDEO PATTERN:
https://stream-leak.com/videos/<positive numeric ID>/<single slug>/
Optional trailing slash; http and https accepted. Only the observed bare host.

EMBED FOUND:
YES

EMBED RULE:
https://stream-leak.com/embed/<ID>

REAL GS3 PLAYBACK:
PASS (two specimens before enablement and through the actual executor).
Separate runs using the frame-header extension stand-in encountered Cloudflare.

DATABASE COVERAGE:
25 / 29 total URLs = 86.21%; 25 / 25 video pages = 100%

ADAPTER ADDED:
YES

WEBPUSSI

PLAYBACK MECHANISM:
Classic provider-sanctioned KVS HTML5 embed, with a native video element,
provider player script/config, and signed provider/CDN MP4 delivery.

DETERMINISTIC FILL PRESENTATION:
YES

PRESENTATION RULE:
http(s)://www.webpussi.com/videos/<positive numeric ID>/<single slug>/
-> https://www.webpussi.com/embed/<ID>
Only the observed www host; optional trailing slash.

REAL GS3 PLAYBACK:
PASS (two specimens before enablement and through the actual executor)

DATABASE COVERAGE:
54 / 56 total URLs = 96.43%; 54 / 54 video pages = 100%

ADAPTER ADDED:
YES

GLOBAL

DOUBLE AUDIO REPRODUCED:
YES — XCamladyX, both specimens, when the underlying page was started first.

CANONICAL URL MUTATED:
NO

POPOUT SHIELD REGRESSION:
NO observed; sandbox tokens unchanged and zero popup pages in completed probes.

CLOUDBATE REGRESSION:
NO in mapping tests; its production transformation is unchanged.

WXX REGRESSION:
NO observed: two live Fill players played and Exit restored the original frame.

PORNTREX REGRESSION:
NO in adapter tests; rule unchanged. Human playback PASS retained;
no fresh live PornTrex playback claim in this Play.

SPANKBANG PLAYBACK REGRESSION:
NO established. Human baseline PASS retained;
post-crop live framed playback is BLOCKED in this clean Chrome profile.

FILL VISIBILITY REGRESSION:
NO in focused real-Runtime tests, including same-Panel reassignment.

PRODUCTION FILES CHANGED:
js/presentation-url.js
js/capability-bridge.js
This Play did not change the incoming js/launch.js candidate.

TEST FILES CHANGED:
test/fill-provider-expansion.test.js (new)
test/fill-visibility.test.js (appended tests)

COMMIT:
NO

PUSH:
NO
```

## Exact candidate and preservation

Initial HEAD was `4f098c0f0b4a98b22f97aad59492de8226c46962`. Before edits, the tracked diff already contained 163 insertions and five deletions across `js/capability-bridge.js`, `js/launch.js`, and `js/presentation-url.js`. The incoming candidate already included the eight Fill providers and real-library variants named in the request, along with untracked Fill/visibility/settings tests and architecture labs/reports.

No clean, stash, reset, discard of incoming work, commit, or push was performed. Initial untracked materials remain. SHA-256 checks confirm `links.json`, `js/launch.js`, `test/fill-embed.test.js`, and `test/settings-boot.test.js` are unchanged from the initial inspection. The incoming presentation and capability modules were reconstructed in a separate lab directory and matched their original hashes exactly, allowing comparison without changing the working tree. The copied smoke probe is outside Node's automatic test discovery.

No database, canonical folder assignment, cassette, preset, workspace, history identity, or Runtime Session URL was rewritten. The new adapters discard source query/hash only in the temporary presentation URL. Their exact host checks reject look-alikes and unproven subdomains; IDs are positive decimal strings without leading zeros. Search, category, model/profile, tag, home, embed, malformed-ID, and non-http inputs are rejected. Expiring Stream-Leak CDN media URLs are deliberately unsupported.

## Provider evidence

Installed Chrome was driven through the existing Playwright approach in isolated browser contexts. The Chrome UI connector reported no available browser. Initial candidate embeds were mounted temporarily in the actual `index3.html` Panel with the executor's sandbox, allow attributes, and geometry, before adding their production rules. Subsequent checks invoked the actual canonical Fill executor.

XCamladyX IDs `270156` and `269402` publish their matching embed links in watch-page `getEmbed()`. Both played with advancing time, readyState 4, unmuted volume 1, decoded audio bytes, and zero popup pages. Actual-executor runs also verified pause controls and Exit restoration. [Provider specimen](https://xcamladyx.com/videos/270156/iris-vega-live-chaturbate-cumface-panty-showershow-recorded-interaction/).

Stream-Leak IDs `156860` and `132563` played in shielded GS3 Panels. Their embed documents publish matching `getEmbed()` markup, content IDs, and canonical metadata. Actual-executor runs without header rewriting also played both, with unmuted decoded audio, pause controls, and Exit restoration. Watch-page fetches and separate header-rewriting probes hit Cloudflare, so those unsuccessful runs are retained rather than interpreted as successful playback. The embed offers a higher-quality link back to a watch page in a new window; the existing sandbox continues to block that escape. [Provider embed](https://stream-leak.com/embed/156860).

Webpussi IDs `57354` and `43813` publish their matching embed links in watch-page `getEmbed()`. Watch-page slugs redirected to newer suffixes while preserving numeric content IDs; this supports extraction from the stable ID instead of slug text or transient media tokens. Both embeds played before enablement and through the executor, with unmuted decoded audio, usable pause controls, and Exit restoration. [Provider embed](https://www.webpussi.com/embed/57354).

Audio evidence establishes decoding and an unmuted player, not a human listening test. Provider focus theft was not observed through popup creation or top-page navigation; operating-system focus was not independently certified. Fullscreen for the new players was not certified.

## SpankBang clean presentation

The successful top-level embed specimens were `1hh0h` and `5dew5`. At 800×450, 640×360, and 480×270, both video boxes measured 405, 324, and 243 pixels high respectively. Footer links began below those player boxes. These measurements match the provider's published stylesheet: the player receives `90vh` and the separate promo region is limited to `10vh`. Its height is proportional, not a fixed pixel footer.

The embed bootstrap loads Video.js and obtains streams from the provider's stream API. The inspected bootstrap did not expose a clean/footer/branding query option. The inspected embed markup and public script did not advertise an alternate sanctioned player-only endpoint. No invented parameters were tried. [Provider embed](https://spankbang.com/5dew5/embed/), [provider stylesheet](https://assets.sb-cd.com/static/dist/style.BiGqqoX-.css), [provider embed bootstrap](https://assets.sb-cd.com/static/dist/desktop/js/player.embed.e64676ffed.js).

GS3 now places only SpankBang's Fill iframe inside a clipping viewport. The iframe height is `111.111112% + 1px`: its provider-owned 90vh player therefore occupies the viewport, with a one-pixel rounding allowance at the bottom edge. The promo region falls below the clip. There is no CSS injection into the provider document, cross-origin DOM access in production, video stretching, or overlay mask that intercepts controls. Exit and content reassignment remove the whole viewport; other providers retain their existing geometry.

Controlled real-Runtime tests prove the footer region stays outside the clip during an actual Position drag and at multiple viewport sizes, controls remain clickable, Exit leaves the original iframe connected and canonical assignment intact, reassignment removes the crop, and subsequent XVideos Fill has no crop wrapper.

Live framed SpankBang embeds in the clean Chrome profile refused framing; other specimens showed Cloudflare. Top-level players loaded, but that is not a post-crop playback PASS. An additional cached-response/frame-header stand-in probe stalled and was terminated. Its result is not counted as successful validation. Human playback PASS supersedes the earlier automated uncertainty for normal SpankBang; the new crop's sound, native controls, fullscreen, and live resizing remain field checks.

## Database observation

Coverage uses the repository's current `links.json`, counting URL occurrences. No local `links-index.json` or cassette files were present. The Human's active browser database or remote cassette index was not accessible through the browser connector, so these numbers do not assert parity with an independently updated remote database.

- XCamladyX: 28 total, 27 video pages, one tag page; observed host `xcamladyx.com`; shapes `/videos/<ID>/<slug>/` and `/tags/<tag>/`; 27 covered, 96.43% of all URLs, 100% of video pages.
- Stream-Leak: 29 total, 25 video pages, four non-video inputs (two signed CDN media URLs, one search page, one model page); observed canonical host `stream-leak.com`, media hosts `cdn7.stream-leak.com` and `cdn9.stream-leak.com`; 25 covered, 86.21% of all URLs, 100% of video pages.
- Webpussi: 56 total, 54 video pages, one model page, one search page; observed host `www.webpussi.com`, with both http and https canonical specimens; 54 covered, 96.43% of all URLs, 100% of video pages.

## Double audio and next Play

XCamladyX double audio is YES on both specimens after a trusted click starts the normal page, followed by Fill and Play. For ID `270156`, the underlying player advanced from approximately 2.46s before Fill to 16.51s during Fill; the overlay reached approximately 4.96s. Both were playing, unmuted, volume 1, and decoding audio. ID `269402` reproduced the same mechanism. The executor adds another iframe while leaving the original live, so neither player is paused by the overlay.

WXX Fill played on IDs `66611` and `96801` and produced zero popup pages. No double audio was reproduced: the observed continuing underlying media was a volume-zero live-widget stream. This does not certify the Human's known WXX autoplay case as safe. Stream-Leak's underlying-page scenario was blocked by Cloudflare. Webpussi's watch-page player did not materialize in the attempted pre-Fill media check, so its already-playing scenario remains unproven. No generic double-audio safety claim is made for the remaining existing providers.

Smallest next Play: isolate exclusive playback in the shared Fill executor, prove a way to suspend the underlying cross-origin presentation during Fill, and define restoration on Exit while retaining canonical assignment/session/history. If cooperation cannot pause it, a temporary presentation unload/reload needs explicit evaluation of playhead loss and capability/load handling. Hiding a frame alone is insufficient. Do not put audio lifecycle or autoplay policy into URL adapters.

## Validation and remaining work

Focused adapter, capability, runtime visibility, settings boot, and crop tests: **28/28 pass**. The last crop-only rerun also passed after adding drag-time footer checks and reassignment/provider-isolation assertions. Top Toolbar, Runway, and Deep Cuts invoke the same executor; their existing canonical control remains the shared action.

The broader boot-smoke plus visibility run returned **106/109 pass**. Runway picker geometry and L2 Master Undo/Redo failures reproduce against the hash-verified incoming candidate. Copy-to-Position failed a tick-progress assertion in the broad run and one isolated rerun, then passed on another rerun; the incoming candidate also passed that targeted check. This timing-sensitive test and the two incoming failures were not rewritten in this bounded provider Play. `git diff --check` reports no whitespace errors.

The future Stream Loop chain was appended to `Docs ANCHOR/009-AUTOMATIONS.md` as documentation only. No autoplay, delay, smart delay, or automatic Fill behavior was implemented.

Research snapshots, source documents, browser results, baseline hashes, and repeatable probes live under `architecture-lab/fill-panel/`. Some earlier result filenames were shared by overlapping research processes; the distinct final executor/underlying result files and captured run outputs supply the evidence above. Failed/stalled probes are excluded from PASS claims.

Stop for Human field testing: hard-refresh GS3, try the three supported provider video shapes, confirm audible sound and resize/Exit, then check SpankBang's footer, native controls and fullscreen at several Position sizes. On XCamladyX, explicitly test starting the normal page before Fill and observe the documented double audio. No commit or push was performed.
