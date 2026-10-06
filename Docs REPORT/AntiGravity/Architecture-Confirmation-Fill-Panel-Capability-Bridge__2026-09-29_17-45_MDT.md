<!-- sideline-provenance: {"gameId":"game_git_042782b8","clientRef":"ref_1790724803444_24e189b7","playerInstanceId":"antigravity-3e448157","playerType":"antigravity","provider":"antigravity","model":"gemini-3.8-flash","effort":"high","at":"2026-09-29T23:33:23.444Z"} -->

# Architecture Confirmation Report — Fill Panel Capability Bridge

**Play:** Architecture-Confirmation-Fill-Panel-Capability-Bridge__2026-09-29_17-45_MDT  
**Role:** Narrow Architecture-Confirmation Pass  
**Status:** COMPLETE — ARCHITECTURE LOCKED  

---

## Executive Verdict

1. **Both Surfaces, One Action:** Fill Panel can be integrated into **BOTH** the Hotswap Top toolbar and the Hotswap Runway as **one canonical semantic action** (`fillPanel`) with zero code duplication. The existing Hotswap architecture (`HOTSWAP_ACTIONS` in `js/launch.js`, `buildMirror()` in `js/launch.js`, and `_wireCollection` in `js/settings.js`) automatically projects registered actions to all configurable surfaces and forwards mirror clicks directly to the canonical tray button (`trayBtn.click()`).
2. **One Stateful Control:** A single Hotswap action control can render:
   - **Inactive:** `⛶` / `Fill Panel`
   - **Active:** `✕` / `Exit Fill Panel`
   without introducing a separate `EXIT_FILL_PANEL` registry action.
3. **Honest Degradation:** When capability is absent (no verified capability report from that iframe generation), Fill Panel is **hidden entirely** across all surfaces (Top Toolbar, Runway, and Deep Cuts tray), following the established GS3 convention for host-unsupported actions (`boot-smoke.test.js:1092-1125`).
4. **Cross-Origin Bridge Locked:** The cross-origin capability bridge between GS3 and the child userscript is formally resolved below: fail-closed inbound validation, runtime-derived sender identity (`event.source === iframe.contentWindow`), strict generation-scoped ephemeral state, and zero leakage into persistent Store or Session state.

> **FILL PANEL V1 CAPABILITY BRIDGE ARCHITECTURE LOCKED — SAFE FOR BOUNDED WORKER IMPLEMENTATION**

---

## Final Message Contract

All messages across the capability bridge share a uniform, minimal, versioned JSON envelope using the canonical `source: 'gs3-capability-bridge'`.

### 1. Inbound Reports (Child Userscript → GS3 Parent)

- **Capability Announcement:**
  ```javascript
  {
    source: 'gs3-capability-bridge',
    version: 1,
    type: 'CAPABILITY_PRESENT',
    capability: 'FILL_PANEL'
  }
  ```
- **Active State Report:**
  ```javascript
  {
    source: 'gs3-capability-bridge',
    version: 1,
    type: 'FILL_PANEL_ACTIVE',
    capability: 'FILL_PANEL',
    active: true // boolean: true when filled, false when exited
  }
  ```

### 2. Outbound Commands (GS3 Parent → Child Userscript)

- **Fill Panel Command:**
  ```javascript
  {
    source: 'gs3-capability-bridge',
    version: 1,
    type: 'FILL_PANEL',
    capability: 'FILL_PANEL'
  }
  ```
- **Exit Fill Panel Command:**
  ```javascript
  {
    source: 'gs3-capability-bridge',
    version: 1,
    type: 'EXIT_FILL_PANEL',
    capability: 'FILL_PANEL'
  }
  ```
- **Idempotent Capability Query (Optional Handshake Probe):**
  ```javascript
  {
    source: 'gs3-capability-bridge',
    version: 1,
    type: 'QUERY_CAPABILITY'
  }
  ```

### Envelope Specifications:
- `source`: Strict constant `'gs3-capability-bridge'` (distinct from internal same-origin `'gs3-layer-scope'`).
- `version`: Integer `1`.
- `type`: String matching one of the five canonical types above.
- `capability`: String constant `'FILL_PANEL'`.
- `active`: Boolean (only present on `FILL_PANEL_ACTIVE`).
- **No identity fields in payload:** No `slotIndex`, `panelId`, `url`, or `generation` in message data. All identity is runtime-derived by GS3.

---

## Frame / Panel Targeting Rule

1. **`event.source` as Primary Identity Anchor:**
   In the browser security model, `event.source` on a `MessageEvent` is an unforgeable `WindowProxy` reference to the sending window. Comparing `event.source === iframe.contentWindow` provides 100% tamper-proof verification of sender identity across origins.
2. **Reverse Resolution:**
   Upon receiving a valid message, GS3 scans active panels (`document.querySelectorAll('.stream-panel')`):
   ```javascript
   function findPanelForSourceWindow(sourceWindow) {
       for (const panel of document.querySelectorAll('.stream-panel')) {
           const iframe = panel.querySelector('iframe');
           if (iframe && iframe.contentWindow === sourceWindow) {
               return panel;
           }
       }
       return null;
   }
   ```
3. **Derived vs. Payload Authority:**
   - **Derived from runtime:** Panel DOM node, `slotIndex` (`panel.dataset.slotIndex`), content generation ID, and iframe element.
   - **Payload fields:** Advisory payload only. Any payload field attempting to assert slot, panel, generation, or URL identity is strictly ignored.
   - If `findPanelForSourceWindow(event.source)` returns `null`, the message is dropped immediately (fail-closed).

---

## Generation-Scoped State Model

Capability state belongs strictly to the **current content generation** of a given slot and must never survive content transitions.

### Lifecycle Phases:
1. **Creation / Generation Inception:**
   - When a panel loads or updates content via GS3 (`updateRenderedPanel` calling `beginPanelContent(slotIndex, url)`), `state.generation` advances.
   - Ephemeral capability state is immediately reset to:
     ```javascript
     { capable: false, active: false, generation: state.generation }
     ```
   - Control presentation on Top Toolbar, Runway, and tray is immediately reset to **hidden** (`display: none`).
2. **Capability Discovery:**
   - When `CAPABILITY_PRESENT` is received and verified for that panel:
     - `capable` becomes `true`.
     - Presentation updates: button is revealed with inactive glyph `⛶` and title `Fill Panel`.
3. **Active Toggle:**
   - On inbound `FILL_PANEL_ACTIVE { active: true }`: `active` becomes `true`; glyph updates to `✕`, title to `Exit Fill Panel`, class `.active` added.
   - On inbound `FILL_PANEL_ACTIVE { active: false }`: `active` becomes `false`; glyph reverts to `⛶`, title to `Fill Panel`, class `.active` removed.
4. **Invalidation & Cleanup:**
   - **Child Navigation / Reload:** When `iframe.addEventListener('load')` fires or `notePanelLoad` executes, the child DOM document has been replaced or refreshed. Capability state is immediately reset (`capable: false`, `active: false`), and controls are hidden until the new document announces `CAPABILITY_PRESENT`.
   - **Panel Removal (`kill`):** The panel is removed from the DOM; ephemeral map entry for that slot is cleared.
   - **Content Replacement (Shuffle / Swap / URL edit):** `beginPanelContent` increments generation and resets state; stale active state from the previous site is wiped before the new URL begins loading.

---

## State Ownership

1. **Owner Location:**
   State is owned by a dedicated ephemeral module: `js/capability-bridge.js`.
2. **Structure:**
   An internal in-memory Map:
   ```javascript
   // slotIndex -> { generation: number, capable: boolean, active: boolean }
   const _slotCapabilityState = new Map();
   ```
3. **Strict Invariant Adherence:**
   - **DO NOT** overload `_state.capability` in `js/panel-navigation.js`. (That field is reserved exclusively for URL observability: `'unknown'` | `'opaque'` | `'observable'`).
   - **DO NOT** persist to `Store` / `localStorage`.
   - **DO NOT** serialize into Runtime Session (`_runtimeSession`, presets, workspaces).
   - **DO NOT** treat as content identity.
   - It is purely ephemeral runtime UI state.

---

## Inbound Validation Rule

Cross-origin child reports (`CAPABILITY_PRESENT`, `FILL_PANEL_ACTIVE`) must pass a strict fail-closed boundary:

1. **Validation Checks:**
   - `typeof event.data === 'object' && event.data !== null`.
   - `event.data.source === 'gs3-capability-bridge'`.
   - `event.data.version === 1`.
   - `event.data.type === 'CAPABILITY_PRESENT' || event.data.type === 'FILL_PANEL_ACTIVE'`.
   - `event.data.capability === 'FILL_PANEL'`.
   - If `type === 'FILL_PANEL_ACTIVE'`, verify `typeof event.data.active === 'boolean'`.
2. **Sender Identity Check:**
   - `findPanelForSourceWindow(event.source)` must return an active `.stream-panel`.
3. **Dynamic Origin Acceptance:**
   - `event.origin` is accepted dynamically without domain whitelisting, because framed media hosts vary arbitrarily across third-party domains and CDNs. Trust is anchored by `event.source` matching an embedded iframe, not by origin string matching.
4. **Absolute Mutation Wall (Fail-Closed Sandbox):**
   Inbound messages are **advisory only**. They may only affect the panel's ephemeral `capable` and `active` presentation flags.
   Under no circumstances may an inbound bridge message read or mutate:
   - Runtime Session
   - Store / localStorage
   - Presets or Workspaces
   - Folder assignments or database
   - Grid layout tracks or dimensions
   - Panel navigation history stacks

---

## Outbound Command Rule

For parent commands (`FILL_PANEL`, `EXIT_FILL_PANEL`):

1. **Target Window:**
   - `panel.querySelector('iframe').contentWindow.postMessage(message, '*')`.
2. **Target Origin Strategy:**
   - Target origin is `'*'`.
   - **Justification:**
     - The third-party iframe's final origin is unreadable cross-origin (`_readFrameUrl` throws `SecurityError` and returns `null`).
     - Calling `postMessage` directly on `iframe.contentWindow` routes the message strictly to that specific child window; no other frames can intercept it.
     - The command payload contains zero secrets, tokens, or credentials.
3. **Nonce / Token:**
   - No capability token or nonce is required for V1. Adding a nonce introduces unnecessary handshake round-trips without adding security value to a direct child window handle.

---

## Userscript Responsibilities

The content-side userscript running inside the child frame has the following responsibilities:

1. **Generic Video Detection:**
   - Locate HTML5 `<video>` elements in the document.
   - Verify viability (ignore invisible 0×0 tracking pixels without sources).
   - Identify player container:
     ```javascript
     const video = document.querySelector('video');
     const container = video?.closest('#player') ||
                       video?.closest('.video-player') ||
                       video?.closest('.vjs-tech')?.parentElement ||
                       video?.parentElement ||
                       video;
     ```
2. **Announcement:**
   - Announce `CAPABILITY_PRESENT` when a viable video and container are detected.
   - Respond to parent `QUERY_CAPABILITY` probes if received.
   - Use a debounced `MutationObserver` on `document.body` to detect dynamically inserted player elements (SPAs) without running continuous polling loops.
3. **Execution:**
   - On `FILL_PANEL`: Apply `100vw × 100vh` styling with `object-fit: contain` and high `z-index` to the player container inside the iframe. Then post `FILL_PANEL_ACTIVE { active: true }`.
   - On `EXIT_FILL_PANEL`: Revert container styling to its original inline/computed presentation. Then post `FILL_PANEL_ACTIVE { active: false }`.
4. **GS3-Hosted Frame Detection & Floating Button Suppression:**
   - Detect whether running inside an iframe: `const isFramed = window.self !== window.top;`.
   - **When framed (`isFramed === true`):** The userscript **MUST NOT** render its standalone floating Tampermonkey button. Native GS3 Chrome owns the presentation.
   - When top-level (`isFramed === false`): The script may retain its standalone floating UI for ordinary browsing outside GS3.
5. **Keyboard Handling:**
   - Capture `Shift+F` within the iframe, toggle fill state, and post `FILL_PANEL_ACTIVE` to parent to update GS3's controls.

---

## Hotswap Stateful Presentation Contract

1. **Single Registry Entry (`js/launch.js`):**
   ```javascript
   {
       key: 'fillPanel',
       emoji: '⛶',
       title: 'Fill Panel',
       className: 'btn-hotswap-fill-panel',
   }
   ```
   - No `structural` property (automatically eligible for Top Toolbar, Runway, and Deep Cuts).
   - No `opensPicker` property (executes immediately).
2. **Presentation States:**
   - **Absent (`capable === false`):**
     - Button hidden: `style.display = 'none'` on canonical tray button.
     - `unsupported.has('fillPanel') === true` causes `buildMirror()` to return `null` on Top and Runway.
   - **Inactive (`capable === true, active === false`):**
     - Tray and mirror buttons visible (`style.display = ''`).
     - Glyph: `⛶`
     - Title: `Fill Panel`
     - Class: `.active` removed.
     - Attribute: `disabled = false`.
   - **Active (`capable === true, active === true`):**
     - Tray and mirror buttons visible.
     - Glyph: `✕`
     - Title: `Exit Fill Panel`
     - Class: `.active` added (lit state styling).
     - Attribute: `disabled = false`.
3. **Synchronized Multi-Surface Update Helper:**
   ```javascript
   export function updatePanelFillPresentation(panel, { capable, active }) {
       const trayBtn = panel.querySelector('.btn-hotswap-fill-panel');
       const mirrors = panel.querySelectorAll('.hotswap-mirror-btn[data-action-key="fillPanel"]');
       const allControls = [trayBtn, ...mirrors].filter(Boolean);

       if (!capable) {
           allControls.forEach(el => { el.style.display = 'none'; });
           return;
       }

       allControls.forEach(el => {
           el.style.display = '';
           el.textContent = active ? '✕' : '⛶';
           el.title = active ? 'Exit Fill Panel' : 'Fill Panel';
           el.classList.toggle('active', active);
           el.disabled = false;
       });
   }
   ```
4. **Canonical Tray as Single Dispatch Owner:**
   - Canonical tray button `onclick` checks `active`: sends `FILL_PANEL` if false, `EXIT_FILL_PANEL` if true.
   - Top and Runway mirrors invoke `trayBtn.click()`. Zero duplicated dispatch code.

---

## Shift+F Decision

**Decision: Choice C (Userscript owns `Shift+F` in V1; dual-path compatible).**

- **Rationale:** When a user interacts with video media (scrubbing, volume, playback), browser focus is trapped inside the cross-origin iframe. Cross-origin security prevents keyboard events from bubbling to the GS3 parent window. Capturing `Shift+F` in the userscript ensures instantaneous responsiveness when viewing content.
- **Synchronization:** When toggled via `Shift+F` in the child frame, the userscript posts `FILL_PANEL_ACTIVE` to GS3. GS3 receives the message and updates Top/Runway mirrors in lockstep.
- **Future Alignment:** When GS3 implements global capability shortcuts (Stage 2.11), GS3 can bind `Shift+F` in parent focus to forward to `trayBtn.click()`, completing full dual-focus coverage without rewriting the bridge contract.

---

## Nested Runtime Rule

1. **Outer Container Panel:**
   - When a panel hosts a nested Runtime (`index3.html`), the container does not contain video media. No userscript runs against the outer container, and no `CAPABILITY_PRESENT` is sent.
   - Its Fill Panel button remains honestly absent (`display: none`).
2. **Leaf Panel in Nested Runtime:**
   - Leaf panels inside the nested Grid run their own local `launch.js` instance.
   - The leaf iframe communicates with its immediate parent (`window.parent`, the nested Runtime).
   - Local Top Toolbar and Runway in the nested Runtime reflect and toggle Fill Panel independently.
3. **No Master Conductor Routing:**
   - Fill Panel is strictly excluded from `LAYER_SCOPED_ACTIONS` and `MASTER_LAYER_ACTIONS`. It cannot be triggered via `L2-P#`.
4. **Chrome Yielding Compatibility:**
   - Planned Stage 2.7 Chrome-yielding retracts container Chrome when hosting a nested Runtime. Because the container panel's Fill Panel is already absent, there is zero collision.

---

## Failure / Timeout Behavior

GS3 fails closed and honestly under all failure conditions:

1. **Userscript Absent:** No report is received. Controls remain hidden. No dead or non-functional buttons.
2. **Page Navigation / Generation Advance:** Immediate reset to `capable: false, active: false`. No stale active state or stuck `✕` icons survive page changes.
3. **Unresponsive Child / Crash on `FILL_PANEL`:**
   - GS3 does **NOT** optimistically update its UI to active upon clicking.
   - GS3 dispatches the command and starts a **1500ms command acknowledgment timer**.
   - If no `FILL_PANEL_ACTIVE` report arrives within 1500ms, the command expires, logging an advisory warning. The UI remains inactive (`⛶`).
4. **Lost `EXIT_FILL_PANEL` Report:**
   - Clicking `✕ Exit Fill Panel` again re-sends `EXIT_FILL_PANEL` (idempotent in userscript).
   - If iframe reloads, `load` listener immediately resets state to inactive.

---

## Exact Worker Implementation Boundary

| File / Component | Classification | Responsibilities |
|---|---|---|
| `js/capability-bridge.js` | **NEW** | Ephemeral capability state map (`_slotCapabilityState`), `postMessage` listener for `gs3-capability-bridge`, fail-closed validation, sender resolution (`findPanelForSourceWindow`), command dispatch (`sendCommand`), and `updatePanelFillPresentation` helper. |
| `js/launch.js` | **MODIFY** | Add `fillPanel` to `HOTSWAP_ACTIONS`. Inject canonical tray button in `_buildPanel`. Integrate capability registration and wire lifecycle reset in `updateRenderedPanel` and iframe `load` handler. |
| `index.html` / `index3.html` | **MODIFY (CSS)** | Ensure `.btn-hotswap-fill-panel.active` and `.hotswap-mirror-btn.active` have active highlight styling matching `.btn-hotswap-toggle.active`. |
| `userscripts/gs3-fill-panel.user.js` | **USERSCRIPT-SIDE** | Canonical V1 userscript: HTML5 `<video>` + container heuristic, debounced MutationObserver, message handler for `FILL_PANEL`/`EXIT_FILL_PANEL`/`QUERY_CAPABILITY`, floating button suppression when framed, `Shift+F` handler. |
| `test/capability-bridge.test.js` | **TEST ONLY (NEW)** | Full automated unit & integration suite for capability bridge, message validation, honest degradation, generation lifecycle reset, and mirror synchronization. |

---

## Tests the Worker Must Add

1. **Honest Absence Default:** When no userscript report is received, Fill Panel is hidden from Top Toolbar, Runway, and Deep Cuts tray.
2. **Capability Revelation:** Inbound `CAPABILITY_PRESENT` reveals the button with glyph `⛶` and title `Fill Panel` on both Top and Runway simultaneously.
3. **Dispatch & Active Transition:** Clicking Top mirror forwards to canonical tray, sends `FILL_PANEL` to iframe; simulated child `FILL_PANEL_ACTIVE { active: true }` flips Top and Runway glyphs to `✕` and title to `Exit Fill Panel`.
4. **Runway Mirror Equality:** Clicking Runway mirror invokes the exact same canonical handler and sends the exact same command.
5. **Exit Dispatch & Reversion:** Clicking `✕ Exit Fill Panel` sends `EXIT_FILL_PANEL`; simulated child report flips glyphs back to `⛶`.
6. **Generation Reset on URL Assignment:** Calling `updateRenderedPanel` with a new URL immediately resets capability to absent and hides controls.
7. **Generation Reset on Iframe Load:** Iframe `load` event immediately resets capability and active state.
8. **Iframe Continuity:** Verifying iframe is not reloaded or reparented during Fill Panel toggles.
9. **Origin Agnostic Security:** Validates messages from arbitrary origins are accepted if `event.source` matches live iframe, and rejected if `event.source` does not match.
10. **State Mutation Wall:** Asserts inbound capability messages cannot modify Store, Runtime Session, presets, or navigation history.
11. **Nested Runtime Isolation:** Asserts outer container panel remains absent while nested leaf panel exposes Fill Panel locally.
12. **Settings Compatibility:** Asserts `fillPanel` reconciles cleanly in `hotswapActionOrder` and `quickActionOrder`.

---

## FACTS

1. `HOTSWAP_ACTIONS` in `js/launch.js` is the single canonical action registry for GS3 Hotswap controls.
2. Surface eligibility is derived programmatically in `js/hotswap-chrome.js` via `isEligibleFor()`. Actions lacking `structural` restrictions are automatically eligible for Top Toolbar, Runway, and Deep Cuts.
3. `buildMirror()` in `js/launch.js` forwards mirror clicks directly to `trayBtn.click()`.
4. Settings drag-and-drop ordering in `js/settings.js` derives rows dynamically from `HOTSWAP_ACTIONS` and requires zero hardcoded action updates.
5. `_state.capability` in `js/panel-navigation.js` already represents URL observability (`'opaque'` vs `'observable'`) and cannot be repurposed.
6. GS3 currently has no production capability-bridge code; prior references were architecture breadcrumbs only.

---

## ARCHITECTURE DECISIONS

1. **Canonical Action Identifier:** `fillPanel` in `HOTSWAP_ACTIONS`.
2. **Bridge Source Identifier:** `'gs3-capability-bridge'` with version `1`.
3. **Identity Derivation:** Strictly derived via `event.source === iframe.contentWindow`. No child-supplied identity accepted.
4. **State Ownership:** Dedicated ephemeral module `js/capability-bridge.js`. Never persisted to Store or Runtime Session.
5. **Honest Degradation:** Absent capability -> controls hidden (`display: none`).
6. **Userscript Framing Rule:** Standalone floating button is suppressed when running in an iframe (`window.self !== window.top`).
7. **Keyboard Ownership:** Userscript captures `Shift+F` inside child frame for V1 and reports active status to GS3.

---

## UNKNOWNS

*(None remaining for V1 execution. All 12 architectural seams are resolved).*

---

## RISKS

1. **Eager Optimistic UI Flipping:** Flipping the button to `✕ Exit Fill Panel` before child confirmation would cause stuck controls on unresponsive sites. *Mitigation:* Require child `FILL_PANEL_ACTIVE` confirmation with 1500ms timeout.
2. **State Leakage Across Navigation:** Stale active state persisting into a new site. *Mitigation:* Explicit reset inside `updateRenderedPanel` and iframe `load` handler.
3. **Colliding with URL Observability:** Accidental collision with `_state.capability`. *Mitigation:* Dedicated state Map in `js/capability-bridge.js`.

---

## What the Worker Must NOT Redesign

1. **Do NOT redesign `HOTSWAP_ACTIONS` or `buildMirror()`:** Use the established mirror-to-tray pattern.
2. **Do NOT invent a second `EXIT_FILL_PANEL` registry action:** Use stateful presentation on `fillPanel`.
3. **Do NOT build a browser extension:** V1 is strictly userscript-based.
4. **Do NOT touch Master Conductor routing or `L2-P#`:** Fill Panel is strictly leaf-content-local.
5. **Do NOT modify Settings persistence:** Existing Store reconciliation handles `fillPanel` automatically.

---

## Classification

**A. Architecture locked — safe for bounded Worker**

> **FILL PANEL V1 CAPABILITY BRIDGE ARCHITECTURE LOCKED — SAFE FOR BOUNDED WORKER IMPLEMENTATION**
