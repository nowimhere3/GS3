<!-- sideline-provenance: {"gameId":"game_git_042782b8","clientRef":"ref_1790775403947_357fd402","playerInstanceId":"claude-1f660b52","playerType":"claude","provider":"claude","model":"opus","effort":"high","at":"2026-09-30T13:36:43.947Z"} -->
# Architecture Challenge — Chaturbate Cross-Origin Room Identity

Agent: Claude Opus 5.5 (Architecture / Browser-Capability Scout) · Branch `main` @ `f96d712` · No code changed, nothing committed.

---

## VERDICT

**Can GS3 automatically get the room identity from a normal cross-origin Chaturbate iframe? NO.**

**Is the North-Star experience achievable anyway? PROBABLY YES, but not through identity.**

The plan to "learn the username, then load the embed" cannot work without the child's cooperation. The user experience GS3 actually wants does not need the username, though. The chosen room is already playing inside the Panel's own iframe. GS3 can present that player so it fills the Panel using only powers it has over its own `<iframe>` element: its layout size, its transform, and clipping on the wrapper around it. I call this the **Pinned-Viewport Provider Crop**. It gives zero install, zero identity work and one broadcaster click. The original iframe is the player, so nothing duplicates or reloads, and resizing the Panel does not cause Chaturbate to reflow.

### The exact blocker (not just "cross-origin")

Chaturbate moves from `/followed-cams/` to `/cute_fox_girl/` as an SPA route change using `history.pushState`. I checked every channel a normal parent page could use. **None of them carries any information about which room was chosen:**

| Channel | What the parent actually gets |
|---|---|
| `iframe.contentWindow` (cross-origin `WindowProxy`) | Only the HTML spec's cross-origin allowlist is readable: `window/self/frames/top/parent/opener/closed/length`, `postMessage/focus/blur/close`, the `location` **setter** (for navigation) and indexed or named child frames. The **`location.href` getter is excluded** and throws `SecurityError`. That is the missing capability. |
| iframe `load` event | Fires only for real document navigations. pushState does not fire it, and when it does fire it carries no URL. |
| Resource/Navigation Timing | Each timeline belongs to one navigable. The parent only sees the iframe's *initial* parent-set navigation, never navigations the child starts, and never pushState. |
| Parent `history.length` / Navigation API | The joint session history length goes up when the child calls pushState. That tells GS3 **a** navigation happened in **some** frame, but not what or where. With several Panels the signal is noisy, and it is capped at 50. |
| Pointer/click/focus | Events inside the child never reach the parent. Parent `window.blur` shows *when* the user clicked into the frame, not what they clicked. `elementFromPoint` in the parent returns the `<iframe>` itself, and no web API hit-tests across documents. |
| Transparent parent overlay | It can record coordinates, but GS3 still cannot read the child DOM at those coordinates. It also takes the `click` away from Chaturbate, because click targets come from the pointerdown/pointerup pair. Making it pass-through on pointerdown means the child never receives a `click`. **Dead either way.** |
| Parent CSP `frame-src` + `securitypolicyviolation` | CSP checks navigation *requests*. pushState makes no request, so this channel is dead for Chaturbate. Even for full navigations, blocking the room load would break the one-click flow. |
| Service worker, BroadcastChannel, SharedWorker, Storage Access | These are scoped to an origin or partitioned by top-level site. GS3's origin never shares a scope with `chaturbate.com`. |
| Chrome status-bar link preview | This is browser UI. No web API exposes it. |
| postMessage | The field test found no room handoff, and nothing suggests Chaturbate sends one to an arbitrary parent. |

**Conclusion:** under normal web-platform rules, zero bits of room identity cross the boundary. The only thing that could send them is code running in the chaturbate.com document, meaning a userscript or an extension. That option is rejected as a dependency.

---

## RANKED APPROACHES (max 3)

### 1. Pinned-Viewport Provider Crop (recommended)
- **Feasibility:** Medium–High. The mechanism is certain; how stable Chaturbate's layout is still needs measuring.
- **User friction:** None.
- **Implementation complexity:** Low–Medium. It is a small extension of the Framed Viewport already built in `architecture-lab/fill-panel/`.
- **Browser support:** Any modern browser. It only uses CSS width/height/transform/overflow on parent-owned elements. Chromium hit-tests pointer events through transforms into out-of-process iframes (OOPIFs) and rasterises OOPIFs at the effective compositing scale.
- **How identity is obtained:** It isn't. The user's one click already put the right player inside the Panel's iframe.
- **Original iframe stays alive:** Yes. It *is* the Fill presentation. There is one stream, no second player and no duplicate audio.
- **Arbitrary Panel resize:** Yes, by design. While filled, the iframe's layout viewport is **pinned** to a fixed per-provider calibration size V (for example 1920×1080). Chaturbate therefore never reflows while the Panel changes size. The video's rectangle R in V coordinates stays constant, and a resize only recalculates `scale = min(pw/R.w, ph/R.h)` and the centring translate. A large V means scale is usually ≤ 1. Downscaling stays sharp, and the player's ABR sees a large element and keeps a high rendition.
- **Primary risk:** Chaturbate UI variation at V can move R: promo or notice banners, theater-mode preference, private or password rooms, or a scrolled page. The experiment below measures this.
- **Verdict:** **Winner.** It meets the North Star without solving identity.

### 2. GS3-owned LIVE-Followed chooser + embed overlay
- **Feasibility:** Low–Medium.
- **User friction:** Minimal to Significant: a one-time follow-list import, then re-importing after new follows.
- **Implementation complexity:** High.
- **Browser support:** Blocked by CORS/SameSite without a relay.
- **How identity is obtained:** GS3 renders the chooser, so GS3 owns the click.
- **Why it ranks second:** the key data, "followed AND live", depends on the session. Chaturbate's followed-rooms endpoint needs the user's chaturbate.com cookies. A GS3-origin `fetch(..., {credentials:'include'})` is blocked twice: by CORS (no `Access-Control-Allow-Origin: <gs3>` with credentials) and by third-party/SameSite cookie rules. The only workaround is to extract credentials, which is rejected. What remains is the public online-rooms feed (unauthenticated; the affiliate API returns `username`, thumbnails and embed HTML) intersected with a **duplicate follow list**. `links.json` holds only 2 Chaturbate URLs, so that list does not exist today. The feed's CORS status is also unverified and may need a local relay.
- **Original iframe stays alive:** Yes if the embed is laid over it. But then **two live streams play**, and the parent cannot mute a cross-origin iframe. The result is double bandwidth and either audio echo or audio from the underlying room that is out of sync with the embed's video.
- **Arbitrary resize:** Yes. The embed is 100%×100%.
- **Primary risk:** keeping the follow list in sync, the feed's CORS, and double-stream audio.
- **Verdict:** Fallback only if approach 1 fails the stability test.

### 3. Optional extension power tier
- **Feasibility:** High. **User friction:** Significant (install). **Complexity:** Low.
- **How identity is obtained:** `webNavigation.onHistoryStateUpdated`, or an `all_frames` content script, reads the frame URL (including pushState changes) and posts it into the existing capability bridge.
- **Verdict:** The only way to get *true* identity handoff. Keep it as an opt-in upgrade, never a dependency.

**Evaluated and bounded rather than ranked:** dragging the username link out of the iframe onto a GS3 drop target would, where allowed, put `text/uri-list` in the parent's `drop` event. Chromium's `IsValidDragTarget` deliberately blocks drops from a cross-site subframe into its own page. It is also a different gesture from "click". I expect it to fail on Chrome; there is a 2-minute kill test below.

**Embed facts (for approaches 2 and 3 only):** the Chaturbate player-only embed is keyed by **username alone**: `https://chaturbate.com/embed/{username}/?…&embed_video_only=1`, with optional `campaign`/`tour`/`disable_sound`/`join_overlay` parameters. No other ID is believed to be required. The exact parameter set and framing headers are unverified.

---

## BROWSER SECURITY PROOF (preferred solution)

- **APIs used:** CSS on elements the parent owns: the iframe's `width`/`height`, which the spec defines as the child's layout viewport size, plus `transform`/`transform-origin` on the iframe and `overflow:hidden` on the Panel wrapper.
- **What crosses the boundary:** Parent → child: only a viewport size, and the child receives an ordinary `resize` event, as with any window resize. Child → parent: **nothing**. The parent never reads child pixels, DOM, URL or events.
- **Why SOP does not block it:** SOP protects the child document's *contents*. Presenting and sizing an embedded browsing context belongs entirely to the embedder. The compositor renders the transformed OOPIF surface. Input goes to the browser, which inverse-transforms pointer coordinates into the child's space, and the child receives trusted events as usual. That is why player controls stay clickable.

---

## FINAL VERDICT

Automatic cross-origin room-identity handoff: **NO**. The cross-origin `WindowProxy` excludes the `location` getter, pushState produces no parent-visible event, request or timing entry, and Chaturbate sends no postMessage.

North-Star experience: **PROBABLY YES** with the Pinned-Viewport Provider Crop, which does not need identity.

## WINNING ARCHITECTURE

Pinned-Viewport Provider Crop. It is a per-provider profile `{ hostMatch, V: {w,h}, R: {x,y,w,h} }`, e.g. `chaturbate.com → V 1920×1080, R = measured #VideoPanel box at V`. The developer measures it once with DevTools, or the Human calibrates once and it is kept. It is applied by the existing single canonical Fill Panel action. Unknown hosts fall back to the lab's generic Framed Viewport (drag once).

## WHY IT WINS

- Zero install, zero identity work, one broadcaster click.
- The player already on screen is the one shown, so it is always "THAT CURRENT ROOM", even after the user moves between rooms inside Chaturbate.
- One stream and one audio source.
- Resizing is pure parent-side math because the child's viewport is pinned.
- Exit is only a style restore.
- It reuses the Framed Viewport mechanism already built. No backend, relay, follow list or feed is needed.

## WHAT GS3 NEEDS TO KNOW AT RUNTIME

- Which provider profile applies. GS3 cannot read the child URL, but it does know the host of the `src` it last assigned (`chaturbate.com`). Every Chaturbate SPA route stays on that host, and the user presses Fill only once they are in a room.
- The profile's V and R.
- The Panel's current size, from the existing ResizeObserver.
- A snapshot of the iframe's pre-Fill inline styles.

GS3 needs no username, no child URL and no child DOM.

## WHAT HAPPENS ON FILL

1. Snapshot the iframe's inline `width/height/transform/transform-origin`.
2. Set the iframe to exactly V × V (the pinned layout viewport; Chaturbate reflows once to V).
3. Set `transform-origin: 0 0; transform: translate(tx,ty) scale(s)` with `s = min(pw/R.w, ph/R.h)` and `t = (P − R·s)/2 − R.xy·s`.
4. The wrapper is `overflow:hidden; background:#000`.
5. On a Panel resize, recalculate only `s` and `t`; V is unchanged, so the child does not reflow.
6. The button projects to `✕ Exit Fill Panel` through the existing active-state machinery.

## WHAT HAPPENS ON EXIT

Restore the snapshotted inline styles. The child reflows once to the Panel size. The same document, stream, chat and joint session history carry on, and Chaturbate's own back navigation returns to Followed Cams. There is no reload, recreation or reparenting, and `src` is never touched.

## WHAT REMAINS UNKNOWN

1. **Whether R stays stable at V** across rooms, logged-in banners, theater-mode preference, private or password rooms, and room pages that auto-scroll. This is the decisive unknown.
2. Whether the page has been scrolled before Fill. The parent can neither read nor reset the child's scroll position (resetting it by fragment needs the URL). I expect room pages to open at the top.
3. Rendering cost of several Panels each laying out at V (for example four Panels at 1920×1080).
4. Whether Chaturbate's player adjusts ABR or layout when the viewport changes from panel size to V. I expect it to keep playing, but need to confirm.
5. For the fallbacks only: whether the online-rooms feed is CORS-open, the exact embed parameters, and whether a cross-frame drag-drop is blocked in the Human's browser.

## SMALLEST NEXT EXPERIMENT

**Setup:** a new throwaway lab file `architecture-lab/fill-panel/pinned-viewport.html` (inline JS, no production changes). It contains:
- One wrapper `div` with `resize: both; overflow: hidden`, holding a Chaturbate iframe with GS3's exact `allow`/`sandbox`, `src = https://chaturbate.com/followed-cams/`.
- Inputs for V (default 1920×1080) and R.
- Buttons: **Calibrate** (drag R once while pinned at V), **Fill**, **Exit**.
- A ResizeObserver that recalculates the transform.
- Console output on every Fill or resize: `{V, R, panel:{w,h}, scale, tx, ty}`.
- Kill-test drop zone: a `div` whose `drop` handler logs `dataTransfer.getData('text/uri-list')`.

**User actions:**
1. Log in normally. In the lab Panel, open Followed Cams and click a live broadcaster once.
2. Click Fill, then Calibrate once (the only calibration for the whole test).
3. Resize the wrapper through extremes: 300×200, 1600×900, tall portrait.
4. Use play/pause, volume, the quality menu and hover controls.
5. Click Exit. Confirm the chat log is still there and the stream did not restart, then use Chaturbate's back navigation to reach Followed Cams.
6. Enter 3 more live rooms and Fill each **without recalibrating**. Repeat in 2 lab wrappers side by side.
7. Kill test: drag a broadcaster name from Followed Cams onto the drop zone.

**PASS:**
- In ≥ 4 different rooms, one calibration makes the video fill the Panel within a few pixels at every size.
- Controls work.
- The stream never restarts.
- Exit brings back the untouched room, and back navigation reaches Followed Cams.

**FAIL:**
- R shifts between rooms or states so that recalibration is needed.
- The page scrolls or reflows at V so the video leaves R.
- Playback restarts or drops to a visibly low quality when pinned.

**If FAIL:** try an R profile per mode (for example theater-mode on vs off) once. If it still fails, move to approach 2 and verify the feed's CORS first. The drag-drop kill test only decides whether a drag gesture could feed approach 2. I expect it to log nothing on Chromium.
