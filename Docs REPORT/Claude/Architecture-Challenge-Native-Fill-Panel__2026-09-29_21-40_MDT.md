<!-- sideline-provenance: {"gameId":"game_git_042782b8","clientRef":"ref_1790739544986_d3e309f3","playerInstanceId":"claude-7243d6a9","playerType":"claude","provider":"claude","model":"opus","effort":"high","at":"2026-09-30T03:39:04.986Z"} -->

# Architecture Challenge: Native Fill Panel (No Tampermonkey, No Extension)

**Date:** 2026-09-29
**Role:** Senior Product / Browser Architecture Council
**Mode:** Reasoning only. Nothing implemented, committed, or pushed.
**Evidence base:** the current tree (`js/capability-bridge.js`, `js/launch.js`, `js/panel-navigation.js`, `js/triple-mode.js`, `userscripts/gs3-fill-panel.user.js`, `test/capability-bridge.test.js`, `index.html` CSS), both AntiGravity reports from 2026-09-29, and a host tally of the real URL corpus in `links.json` / `presets.json`.

---

## Executive Verdict

1. **The prior framing missed the most important fact: what the user actually loads.** Of the 7,909 unique URLs in `links.json`, 3,674 are image-gallery hosts (elitebabes, imagefap), where Fill Panel doesn't apply. Of the remaining **4,235 video-capable URLs, 2,812 (66%) are single-video pages on just 11 hosts with stable, ID-bearing URL shapes.** 2,094 of those are `xvideos.red`. YouTube, Twitch and Vimeo, the usual "embed adapter" targets, make up about 0.4%.
2. That makes **provider embed normalization (B)** far more valuable here than AntiGravity's "site-specific only, a handful of known sites" suggested. The target is a short list of tube hosts, not the whole web. An embed document holds one player sized to 100% of its viewport, so it **solves the multi-video problem without any detection**.
3. **Parent-side geometry is better than AntiGravity reported, once the video rectangle is known.** Two corrections to the earlier report:
   - A CSS `transform` on the iframe does **not** change the child's layout viewport, so it causes no responsive reflow. Only changing width or height does.
   - Browsers map pointer hit-testing back through CSS transforms into iframes, so the player's controls stay clickable where they appear on screen.

   What parent JavaScript cannot learn is *where the video is*. The zero-install answer is to **let the human mark it**: one drag around the video they can see. I call this *Framed Viewport* (G1). It is lossless and needs no reload.
4. **Winner 1 (best zero-install experience):** a strategy stack of an embed adapter for known hosts at a known URL, then Framed Viewport for everything else. An opt-in DOM executor can slot in later on the same bridge.
5. **Winner 2 (easiest / best value):** **the embed adapter alone.** It is a pure URL→URL table plus a src swap behind the existing `fillPanel` action. There is no UI to invent and no backend. It is unit-testable. **One condition:** its value depends on whether `xvideos.red` has a working embed that keeps the user's premium session. If it doesn't, B's coverage drops from about 66% to about 17% of video URLs, and Winner 2 becomes Framed Viewport.
6. **Don't write production code yet.** The next step is a one-folder lab page in `architecture-lab/` (0 production files touched) that settles both the `xvideos.red` question and Framed Viewport usability in one human session.
7. **The shortcut-bug diagnosis is sound, but incomplete.** A second defect sits in the same function: the `lastPhysicalFitCutoff` early return runs *after* the unconditional unhide. The repair should proceed now, independently.

---

## What the Browser Actually Prevents

This is only what the Tampermonkey version could do that parent JavaScript on `nowimhere3.github.io` cannot, for an arbitrary cross-origin child:

| # | Tampermonkey capability | Why the parent can't |
|---|---|---|
| 1 | **Find the video**: enumerate `<video>`s, read their boxes, `paused`, `muted`, `currentTime`, visibility | No read access to child DOM, layout or media state. |
| 2 | **Re-lay out the player** (`position:fixed; 100vw×100vh`), so the player itself re-renders at panel size, with native-sized controls and an ABR quality step-up | Parent can't restyle child elements. It can only transform the *picture* of the child. |
| 3 | **Suppress page chrome** inside the child (sticky headers, cookie banners, overlays over the player) and lock scroll (`overflow:hidden` on html/body) | Same. The parent can only crop, not delete. |
| 4 | **Keep playback continuous** across enter and exit | Parent can't read `currentTime`, so anything that reloads the child restarts playback. |
| 5 | **Shift+F while focus is inside the content** | Keystrokes with focus in a cross-origin frame go to the child only. The parent never sees them. A parent hotkey works only while GS3 has focus. |
| 6 | **Fill whatever video the user browsed to** | After in-content navigation, the child URL can't be read cross-origin (`_readFrameUrl` returns `null`). GS3 knows *that* the page navigated (load event) but not *where*. |

Everything else about the experience is reproducible.

---

## What Remains Technically Available

- **Full control of the iframe box:** `transform`, `transform-origin`, `clip-path`, size, position, and panel `overflow:hidden` with a black background.
- **Full control of navigation to a URL GS3 chooses:** `iframe.src`, including an embed URL.
- **Knowing whether the panel is still on the URL GS3 assigned.** `panel-navigation.js` already tracks this: `cursor === 0 && pendingLoads === 0` in `getPanelNavigationState()` means the panel is on its known anchor.
- **Parent overlays above the iframe.** They can catch a drag gesture, so a human can mark a rectangle on what they see.
- **Parent-side action plumbing:** the canonical `fillPanel` action, mirrors, active/inactive presentation, and generation-scoped ephemeral state.
- **Same-document fragment navigation** (set `src` to the same URL plus `#id`, with no reload). This can pin the child's scroll to a known element id. It is an enhancement only and **unverified** per host.
- **The postMessage channel**, for any child that cooperates: an embed player API, or an optional executor.

---

## Multi-Video Problem

The main architectural lesson is to **prefer mechanisms that don't need to detect the primary video.**

| Mechanism | How the "right" video is chosen | Quality |
|---|---|---|
| B: Embed adapter | By construction. The embed document holds one player, for the ID taken from the URL GS3 assigned. | Excellent while the panel is on its anchor. Unavailable after in-content navigation, because the ID is unknown. |
| G1: Framed Viewport | The human draws around the video they are watching. They are the only reliable video detector the parent has. | Excellent at framing time. Per-host reuse assumes a stable page template and scroll at top. |
| A0: Blind zoom preset | A guess ("top-center 16:9"). | Poor, and silently wrong on multi-video pages. |
| F / userscript: DOM executor | Heuristic in the child. | Good if scored properly. The current userscript ranks by **full bounding-box area only**. A production executor should score *viewport-intersection area × playing × audible × duration > N s × recent user interaction*, and penalize muted, looping previews. |
| G2: Tab self-capture + motion diff | Largest moving region. | Plausible, but needs a capture permission prompt each session. |

Architectural consequence: the parent-side stack (B, then G1) never runs a heuristic. Heuristics stay confined to the optional in-child executor, where the signals actually exist.

---

## Architecture Candidates

Scale is 1 (poor) to 5 (excellent). "Coverage" means share of *video-capable URLs in this user's corpus*, by URL count, not by viewing frequency.

### A. Pure parent-side iframe manipulation, blind (A0: fixed zoom/crop presets)
- **Experience quality:** 2. Wrong framing on most pages.
- **Coverage:** "works" on a minority (~20–30%, guess) where the player sits where the preset assumes.
- **Multi-video / identification:** 1 / 1.
- **Ease:** 5, tiny.
- **Maintenance:** Low. Per-host presets become a quiet maintenance trap.
- **Zero-install:** Yes.
- **Reuse:** High.
- **Verdict: Reject as a standalone.** Its mechanism, transform plus clip, survives inside G1.

### B. Provider/embed URL normalization
- **Mechanism:** a pure `toFillUrl(anchorUrl) → embedUrl | null` table. Fill swaps `iframe.src` to the embed as a *presentation load*: no new content generation, no persistence, `data-last-src` untouched. Exit restores the anchor.
- **Experience quality:** 4. The player is truly sized to the panel: native controls, correct ABR quality, no page chrome, no drift. Loses playback position on enter and exit (reload).
- **Coverage:** **~66%** of video URLs if `xvideos.red` embeds work with the premium session, **~17%** if not.
- **Multi-video / identification:** 5 / 5, by construction.
- **Player interaction:** 5, since it's the provider's own embed player.
- **Ease:** 5. One small pure module, a few dozen lines of integration, no new UI.
- **Maintenance:** Low–medium. Embed endpoints are among the most stable URLs a host offers, because third-party sites depend on them. The table holds ~11 entries.
- **Failure modes:**
  - Host disables embedding for a video.
  - Embed shows an ad pre-roll or a related-videos end screen.
  - Premium or login content not served in the embed.
  - Some embeds refuse under `sandbox`.
  - Unavailable after in-content navigation.
- **Zero-install:** Yes.
- **Reuse:** Very high. Same action, same presentation, same generation reset.
- **Verdict: Winner 2, conditional on `xvideos.red`.**

Candidate embed patterns for the lab. **All unverified; that is the point of the experiment:**

| Host | Page shape | Embed candidate(s) |
|---|---|---|
| xvideos.red | `/video.{id}/slug` | `https://www.xvideos.red/embedframe/{id}` and `https://www.xvideos.com/embedframe/{id}` |
| xvideos.com | `/video.{id}/slug` | `https://www.xvideos.com/embedframe/{id}` |
| xnxx.com | `/video-{id}/slug` | `https://www.xnxx.com/embedframe/{id}` |
| pornhub.com | `/view_video.php?viewkey={k}` | `https://www.pornhub.com/embed/{k}` |
| xhamster.com | `/videos/slug-{id}` | `https://xhamster.com/embed/{id}` |
| spankbang.com | `/{id}/video/slug` | `https://spankbang.com/{id}/embed/` |
| eporner.com | `/video-{id}/slug/` | `https://www.eporner.com/embed/{id}/` |
| porntrex.com | `/video/{n}/slug` | `https://www.porntrex.com/embed/{n}` |
| camwhoreshd.com | `/videos/{n}/slug/` | `https://www.camwhoreshd.com/embed/{n}` |
| tnaflix.com | `…/video{n}` | `https://player.tnaflix.com/video/{n}` |
| youtube.com | `/watch?v={id}` | `https://www.youtube.com/embed/{id}` |

Several of these hosts appear to share a common tube CMS with a uniform `/embed/{numeric id}` route. If the lab confirms that, one "family" adapter covers a long tail of smaller hosts.

### C. A + B hybrid (blind zoom fallback)
- **Experience quality:** B where it applies; A0's poor framing elsewhere.
- **Verdict: Superseded by B + G1.** Human framing costs little more than blind zoom and is correct instead of approximate.

### D. Cooperative player APIs
- **Experience quality:** Could add playback continuity (e.g. the YouTube IFrame API's `getCurrentTime`/`seekTo`), but only between API-enabled embeds, not from a watch page.
- **Coverage:** ≈0% of this corpus. None of the dominant hosts expose a documented postMessage control API.
- **Ease:** Medium per provider.
- **Verdict: Reject for now.** The existing `LAUNCHPAD_PLAY`/`LAUNCHPAD_PAUSE` Viewport Director messages have no third-party listener either. Revisit only if a dominant host publishes an API.

### E. GS3-owned proxy / rewrite
- **Experience quality:** Would be 5 on paper (inject the executor server-side).
- **Coverage:** Low in practice, and fatal for the largest slice:
  - `xvideos.red` is a **logged-in premium** site. A proxy is a different origin with none of the user's cookies, so it can't show premium content without handling credentials.
  - Video CDNs use signed or referer-bound URLs and anti-bot defenses.
  - Heavy JS apps break under rewriting.
- **Ease:** 1. Needs a backend, bandwidth, hosting and legal exposure, and breaks GS3's static GitHub Pages model.
- **Verdict: Reject.** This is the cathedral.

### F. Companion browser extension (userscript → MV3 content script, `all_frames`)
- **Experience quality:** 5. It *is* the Tampermonkey behavior, including Shift+F inside content and playback continuity.
- **Coverage:** Tampermonkey's 50–60%+, improvable with a better scorer and a fix for the `position:fixed`-under-transformed-ancestor failure class.
- **Ease:** 5. A manifest plus the existing userscript. The bridge is unchanged.
- **Zero-install:** **No.** Store listing or developer-mode unpacked install.
- **Maintenance:** Low code, plus store-review overhead.
- **Verdict: Keep as a future opt-in "power tier".** It is the only path to 100% parity, and the existing bridge already *is* its protocol. It is not the default.

### G1. Framed Viewport (human-marked rectangle + transform + clip). *Discovered.*
- **Mechanism:**
  1. Fill with no adapter shows a transparent parent overlay above the iframe.
  2. The user drags once around the video they see, giving rect `r` in iframe CSS px.
  3. GS3 freezes the iframe's box so a toolbar reveal can't resize it, then applies:
     ```
     s  = min(P.w / r.w, P.h / r.h)
     tx = (P.w - r.w*s)/2 - r.x*s
     ty = (P.h - r.h*s)/2 - r.y*s
     iframe: transform-origin:0 0; transform:translate(tx,ty) scale(s);
             clip-path: inset(r.y  (W-r.x-r.w)  (H-r.y-r.h)  r.x)
     panel:  overflow:hidden; background:#000
     ```
  4. Exit removes the three styles. The rect is remembered **per host + iframe width** (ephemeral or session-scoped), so the next page on the same host fills in one click. Re-frame is always available.
- **Experience quality:** 3.5–4.
  - Pluses: instant enter and exit, **no reload, playback continuous, page state preserved**. Works after in-content navigation. Immune to the DOM-fill failure class where `position:fixed` breaks under transformed or `contain` ancestors.
  - Minuses: upscaled rather than re-rendered, so it's softer where the player picked a small stream, and the controls scale up. Wheel over the content can scroll the child page and drift the video out of frame, with no fix except re-framing. Sticky overlays inside the rect stay visible. Players that resize themselves (ad → content, theater mode) break the frame.
- **Coverage:** Essentially every framable page where the video is visible. Coverage stops being the limit; tolerance of drift and softness is.
- **Multi-video / identification:** 5 / 5 at framing time (human).
- **Ease:** 3–4. A small gesture overlay, geometry, and resize recompute. Perhaps 150–250 lines plus CSS. No site knowledge at all.
- **Maintenance:** Very low.
- **Zero-install:** Yes.
- **Reuse:** High. Same action, presentation and generation reset. Any new assignment or load clears it.
- **Verdict: Universal fallback in Winner 1.** It becomes Winner 2 if `xvideos.red` fails in B.

### G2. Tab self-capture + motion detection (`getDisplayMedia({preferCurrentTab})` + Region/Element Capture)
- Could auto-locate the playing video and feed G1's geometry with no gesture.
- A permission prompt every session, heavy code, and Chrome-only APIs.
- **Verdict: Research curiosity. Not now.**

### G3. Fragment scroll anchoring (`src = anchor + '#player'`)
- Same-document fragment navigation scrolls the child so a known element id sits at the top, with no reload and **no load event**.
- Could make G1's per-host rects robust to scroll.
- Needs a per-host element id, only works on the anchor URL, and SPAs may hijack the hash.
- **Verdict: Optional G1 enhancement.** Verify in the lab if cheap.

### G4. "Player-first" load mode (B applied at load time)
- A preference, per panel, per folder or global: load the embed URL *instead of* the page when an adapter exists. The playback-restart cost of B disappears, because there is no mid-playback swap.
- For a loop launchpad this may be what the user actually wants most of the time.
- Zero extra mechanism beyond B.
- **Verdict: Natural V2 of B.**

### G5. App shells (Electron/WebView2, Chrome Isolated Web App `<controlledframe>`)
- Can inject scripts into cross-origin frames, but only by installing GS3 as an app.
- **Verdict: Reject.** A larger install than an extension.

### Value per implementation complexity (ranked)

| Rank | Option | Value (corpus-weighted) | Complexity | Notes |
|---|---|---|---|---|
| 1 | **B** Embed adapter | High *if* `xvideos.red` passes | Very low | Best ratio, but conditional |
| 2 | **G1** Framed Viewport | Medium-high, universal | Low-medium | Best ratio if B's key host fails |
| 3 | **B + G1** | Highest zero-install | Medium (sum of the two, no coupling) | Winner 1 |
| 4 | **G4** Player-first | Multiplies B | Trivial after B | |
| 5 | **F** Extension | Parity | Very low code, install friction | Opt-in tier only |
| 6 | A0, D, G2, G3 (standalone) | Low | Low–medium | |
| 7 | **E** Proxy | Low in practice | Very high | Reject |

---

## WINNER 1: Best Experience (zero-install)

**B + G1 strategy stack, dispatched per panel at click time:**

1. **Bridge capable?** (Only if the user ever opts into an executor.) Use DOM fill: parity plus continuity.
2. **Adapter matches the anchor, and the panel is still on its anchor?** Use the embed: real player at panel size, one video by construction.
3. **Otherwise**, use Framed Viewport: one drag, or zero if this host's rect is remembered. Lossless toggle.

Taken strictly regardless of install, the closest match to Tampermonkey is **F**, because it is literally the same code. It fails the product constraint, and the stack above keeps its door open at zero cost.

## WINNER 2: Easiest / Best Value

**B, the embed adapter alone**, *if* the lab shows `xvideos.red` (or its `.com` embed) plays premium content with the user's session. Otherwise **G1 alone**.

For the quickest genuinely useful native prototype, I'd build B: a pure function, ~11 table rows, a src swap, and a presentation-load flag. The whole thing can be unit-tested with a URL list and demonstrated in thirty seconds.

---

## Recommended Hybrid Strategy

- **Selection rule:** bridge > embed > framed. It is evaluated at click time from parent-known facts only (bridge report, anchor URL, navigation cursor). Nothing requires detecting a video in the parent.
- **Button visibility:** once G1 exists, Fill Panel is *always available* on a panel with content, and capability-hiding disappears for Fill. Until G1 exists, the button shows only when an adapter matches and the panel is on its anchor.
- **Integration invariants the embed swap must respect** (the one place B is subtle):
  1. **It is not a content assignment.** Don't call `updateRenderedPanel({url})` or `setIframeUrl`. Those open a new generation and persist. Session, bookmark (`data-last-src`) and Undo keep seeing the page URL.
  2. **Tell navigation to expect the load.** Add a tiny `expectPanelLoads(slot, n)` to `panel-navigation.js` that raises `pendingLoads` without opening a generation. Otherwise the embed load is recorded as user navigation, and Panel Undo turns into a disguised "exit Fill".
  3. **The iframe `load` handler currently calls `resetFillPanelCapability`**, which would clear `active` on the very load that entered Fill. The handler must recognise an expected presentation load and preserve the Fill state through it.
  4. **Any real assignment** (Shuffle, Undo, Copy-to-Position, ⟳ Reload) already resets the generation. That correctly ends Fill with no extra code.
- **Hotkey:** a parent-level Shift+F on the hovered or focused panel is possible when GS3 has focus. Shift+F *inside* content is executor-only. Say so in the UI copy; don't pretend.

---

## Existing GS3 Work

### KEEP
- The `fillPanel` entry in `HOTSWAP_ACTIONS`, Settings registration and ordering, and Deep Cuts projection.
- Top and Runway mirrors delegating to the one canonical tray button (`buildMirror` → `trayBtn.click()`).
- Active/inactive presentation (⛶ ↔ ✕, `aria-pressed`, `.active` CSS in `index.html`/`index3.html`).
- Slot-keyed, generation-scoped, ephemeral, non-persisted state, reset on assignment, reload and load.
- Leaf-local, non-L2, non-Master routing and nested-runtime isolation (`triple-mode.js` unregister on teardown).
- The tests covering all of the above.

### REPURPOSE
- **`js/capability-bridge.js` → the Fill state owner, with a `source` field** (`'bridge' | 'embed' | 'framed'`). Parent-derived sources set `capable` synchronously. The postMessage protocol (`CAPABILITY_PRESENT`, `FILL_PANEL_ACTIVE`, `FILL_PANEL`, `EXIT_FILL_PANEL`, `QUERY_CAPABILITY`) stays exactly as is, for the bridge source only. The 1500 ms ack timeout applies only to bridge.
- **`requestFillPanelToggle`** → dispatches by source.
- **`userscripts/gs3-fill-panel.user.js`** → the *reference executor* and developer tool, and the literal payload of a future extension. It is not a product dependency. Improve its scorer only if F is ever pursued.
- **The userscript contract test** → an executor-protocol test.

### DELETE
- **No code.** Delete the *product assumption* instead: any UI copy, docs or prompts implying the userscript is Fill Panel's native home, or that users should install it.

### REPLACE
- **Where capability comes from:** "child announces, parent waits" is replaced by "parent derives from what it knows (adapter + anchor), child may augment". Concretely, the load handler's unconditional `resetFillPanelCapability(panel, { acceptingReports: true })` becomes "reset, then derive local capability, then accept bridge reports".

---

## Shortcut Bug Confirmation

**The diagnosis is sound.** `_render` sets `hidden = true` on all three renderings. `layoutTopShortcuts()` (`js/launch.js:604`) unconditionally unhides every Top shortcut and re-hides only past the fit count, so the Top mirror appears. The Runway has no layout pass, so it stays hidden.

**The diagnosis is incomplete.** Three additions, all from code reading and not runtime-verified:

1. **A second defect in the same function.** `shortcuts.forEach(b => b.hidden = false)` runs *before* `if (fits === lastPhysicalFitCutoff) return;` (`js/launch.js:608` / `:622`). On any reveal after the first with an unchanged fit count, **all** Top shortcuts, including overflowed ones, are left visible. The repair must apply the final `hidden` state unconditionally. AntiGravity's proposed snippet silently drops the memo, which fixes this by accident; call it out explicitly.
2. **The memo must also be invalidated when capability changes.** Otherwise the re-layout on `CAPABILITY_PRESENT` early-returns, because the fit count can be unchanged while the eligible set has changed.
3. **`capability-bridge.js` can't call the closure-local `layoutTopShortcuts`.** It needs a hook: a panel-scoped event such as `gs3:fill-capability-changed`, or a method on the panel element.

**The repair should proceed now, independently.** It is orthogonal to the architecture decision. The overflow defect affects every Top shortcut. Even under B, Fill availability stays conditional until G1 exists. The regression test should cover both the capability case (hover → still hidden) and an overflow case (narrow panel, reveal twice → overflowed shortcut still hidden).

---

## Smallest Next Experiment

**Where:** `architecture-lab/fill-panel/lab.html`, optionally with a sibling `lab.js`. That is one or two new files, **zero production files touched**, deletable in one command, following the existing lab convention: `python -m http.server 8080` → `http://localhost:8080/architecture-lab/fill-panel/lab.html`.

Every test iframe uses GS3's **exact** attributes (`allow="autoplay; fullscreen"`, `sandbox="allow-same-origin allow-scripts allow-forms allow-popups"`) at realistic panel sizes (e.g. 480×270 and 640×360).

**Probe 1: Embed adapter (answers B).**
- Pre-filled with ~2 real URLs per host from `links.json` for the 11 hosts above. The human can paste more.
- For each URL, render the embed candidate(s) side by side. `xvideos.red` shows *both* `.red` and `.com` embedframe variants.
- One-click ✓/✗ per row for:
  - loads
  - plays
  - **premium content plays while logged in** (`xvideos.red` only)
  - fills the panel
  - the right video, with no related-video grid taking over
  - survives the sandbox
- "Copy results" button → JSON to paste into the follow-up report.

**Probe 2: Framed Viewport (answers G1).**
- One panel-sized iframe loaded with a **multi-video page** (a watch page with a recommendation grid and autoplaying previews) from 3–4 hosts that worked under Tampermonkey.
- A "Frame" button → drag rect → apply transform + clip → "Exit".
- Checklist:
  - the correct video fills the panel
  - controls clickable where they appear
  - sharpness acceptable
  - wheel-scroll drift tolerable
  - exit restores with **playback uninterrupted**
  - the remembered rect is correct on a *second* video from the same host (template stability)
- Optional: try the G3 `#player` fragment on one host.

**Caveat:** a few embed hosts whitelist referrers. If Probe 1 is surprising, re-check the winning hosts from the real GS3 origin before building.

**Decision rules:**

| Result | Build next |
|---|---|
| `xvideos.red` embed ✓ (premium plays), and ≥ ~6 of the other 10 hosts ✓ | **B first** (Winner 2 confirmed), then G1 as fallback, then G4 player-first mode |
| `xvideos.red` ✗, G1 usable | **G1 first**, then B only for the hosts that passed |
| B passes, G1 intolerable (drift/softness) | **B only.** Fill hidden elsewhere. Offer F as the explicit opt-in trade for the rest |
| Both fail | **F** is the only honest path to the experience. The bridge is already built for it |

---

## If Experiment Succeeds

B first:
- Implementation shape: 1 new pure module (`js/fill-panel-adapters.js`, table + `toFillUrl`), small edits to `capability-bridge.js` (source field, local capability), `launch.js` (toggle dispatch, presentation-load awareness in the load handler) and `panel-navigation.js` (`expectPanelLoads`).
- One new unit test over the URL table, plus adjustments to existing capability tests.
- **Dependencies: none. Backend: no. Browser install: no.**
- Rollback: remove the table rows, or the module.

Then G1 as the always-available fallback. That retires capability-hiding for Fill. Then G4, a "Player-first" preference that loads the embed directly.

## If Experiment Fails

- If only B fails, G1 carries Fill alone. It is still zero-install and still universal, with a softer picture.
- If G1 is also unusable, the honest product statement is: **"DOM-level Fill Panel requires code inside the page."** Offer F as an opt-in companion. The bridge, action, presentation and tests all carry over unchanged. None of the previous Worker's plumbing is wasted in any branch.

---

## Final Recommendation

Stop framing this as "SOP says no, so extension". The user's corpus is concentrated on a handful of tube hosts with ID-bearing URLs. That makes a **URL-table embed adapter** the cheapest high-value native Fill Panel. It sidesteps the multi-video problem entirely, and a **human-framed viewport** covers everything else without site knowledge.

Keep all the existing Fill Panel plumbing. Change only where capability comes from.

Fix the shortcut layout bug now, including the memo defect. Then spend one human session in a throwaway lab page, answering the single question that decides the build order: **does `xvideos.red` embed work with the user's premium session?**

---

ARCHITECTURE DECISION:
Zero-install strategy stack on the existing `fillPanel` action: embed adapter for known hosts while the panel is on its anchor, human-framed viewport (transform + clip) for everything else, and the existing postMessage bridge kept as an optional executor slot. No proxy, no default extension.

EASIEST CODE-WISE ROUTE:
A pure URL→embed table (~11 hosts) plus a non-persisted, generation-preserving `iframe.src` swap behind the current Fill Panel button. That is a few files, no dependencies, no backend and no install. Fall back to Framed Viewport as the first build only if `xvideos.red` embeds fail.

NEXT EXPERIMENT:
`architecture-lab/fill-panel/lab.html`, with 0 production files touched. Probe 1 renders embed candidates for ~2 real URLs per host under GS3's exact iframe attributes, checking `xvideos.red` premium playback first. Probe 2 human-frames a multi-video page and checks click-through, sharpness, drift and uninterrupted exit. Apply the decision table above.
