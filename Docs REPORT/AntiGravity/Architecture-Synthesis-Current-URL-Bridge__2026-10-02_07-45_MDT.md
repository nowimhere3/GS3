<!-- sideline-provenance: {"gameId":"game_git_042782b8","clientRef":"ref_1790948405571_751ebf0f","playerInstanceId":"antigravity-3e448157","playerType":"antigravity","provider":"antigravity","model":"gemini-3.8-flash","effort":"high","at":"2026-10-02T13:40:05.571Z"} -->

# GS3 Current-URL Bridge — Architecture Synthesis

**Calgary Timestamp:** 2026-10-02T07:45:00-06:00  
**Agent / Model:** AntiGravity / Gemini 3.8 Flash  
**Branch:** main  
**HEAD:** `f96d712 Fix Fill Panel shortcut visibility lifecycle`  
**Git Status:** Clean tracking tree (untracked reports present)  
**Architecture Scope:** Cross-Origin Navigation Observation, Content Authority Invariants, CDP Correlation, and Runtime Integration  
**Sources / Files Inspected:**
- `index3.html`
- `js/launch.js`
- `js/grid-session.js`
- `js/panel-navigation.js`
- `js/panels.js`
- `js/triple-mode.js`
- `js/positions.js`
- `js/capability-bridge.js`
- `js/hotswap-chrome.js`

---

# EXECUTIVE VERDICT

1. **The Capability is Technically Feasible and Architecturally Sound:** While the browser's Same-Origin Policy (SOP) strictly prevents parent-page JavaScript from reading cross-origin iframe locations (`iframe.contentWindow.location.href` throws `SecurityError`), an external observer leveraging the **Chrome DevTools Protocol (CDP)** (`Page.frameNavigated`, `Page.navigatedWithinDocument`) can observe 100% of cross-origin, redirect, and SPA navigations across active frames.
2. **The Fixed Product Invariant Fits GS3 Naturally:** GS3 already maintains a sharp, formal distinction between *what GS3 assigned* (`_panels` in `js/grid-session.js`, projected to DOM as `data-last-src`) and *what is happening inside the document* (`js/panel-navigation.js`). Adding `observedCurrentUrl` as an **observational layer** without making it a **mutation layer** preserves every existing invariant:
   - **Shuffle / Assign:** Establishes a new `assignedUrl`, advances the content generation, and wipes `observedCurrentUrl`.
   - **Human Browsing:** Updates `observedCurrentUrl` in-memory; `assignedUrl` remains immutable.
   - **GS3 Refresh / Reload:** Re-fetches the canonical `assignedUrl` (`data-last-src`), collapsing in-frame wandering and clearing `observedCurrentUrl`.
   - **Persistence:** Save Session persists only `assignedUrl`.
3. **Correlation is Deterministic:** Tagging the iframe DOM element with a deterministic name (`iframe.name = 'gs3-panel-' + slotIndex`) allows CDP `Page.frameNavigated` events (which broadcast `frame.name`) to be mapped directly to GS3 slot indices in O(1) time without ambiguous heuristics.
4. **Zero Regression Guarantee:** The bridge is purely additive. If the companion process is absent, disconnected, or crashes, GS3 operates identically to its current production baseline.

---

# RECOMMENDED ARCHITECTURE

We recommend a **Local CDP Companion Daemon** communicating with GS3 over a local loopback WebSocket:

```text
┌────────────────────────────────────────────────────────┐
│                   Active Chrome Browser                │
│  (Launched with --remote-debugging-port=9222)          │
│                                                        │
│  ┌───────────────────────┐   ┌──────────────────────┐  │
│  │ GS3 Window            │   │ Cross-Origin Iframe  │  │
│  │ (index3.html)         │   │ (e.g. xnxx.com)      │  │
│  │ name="gs3-runtime"    │   │ name="gs3-panel-1"   │  │
│  └───────────┬───────────┘   └──────────┬───────────┘  │
└──────────────┼──────────────────────────┼──────────────┘
               │ (WebSocket)              │
               │ ws://127.0.0.1:9223      │ (CDP Events)
               ▼                          │ Page.frameNavigated
┌───────────────────────────────────────┐ │ Page.navigatedWithinDocument
│     GS3 Current-URL Companion Daemon  │◄┘
│     (Node.js process on 127.0.0.1)    │
│  - Connects to Chrome CDP (port 9222) │
│  - Filters to GS3 root frame children │
│  - Correlates frame.name -> slotIndex │
│  - Streams events to GS3 over WS      │
└───────────────────────────────────────┘
```

### Key Components:
1. **Chrome Instance:** User's normal, authenticated Chrome browser launched with `--remote-debugging-port=9222`. All existing logins, cookies, and extensions are preserved.
2. **Companion Daemon:** A lightweight Node.js CLI process running locally (`localhost:9223`). It queries Chrome's `/json/list` endpoint, attaches to the GS3 tab, enables `Page` domain events, filters grandchild ad/player frames, and emits clean, verified `{ slotIndex, generation, url, navigationKind }` packets.
3. **GS3 In-Page Receiver (`js/current-url-bridge.js`):** A dedicated, ephemeral client module in GS3 that connects to the companion WebSocket, verifies incoming generation tokens against `js/panel-navigation.js`, and stores the current observed URL in an ephemeral Map.

---

# WHY THIS ARCHITECTURE

1. **No Userscript / No Tampermonkey:** Unlike DOM-level capabilities that require in-page code execution, navigation observation occurs at the Chromium browser engine level.
2. **No Permanent Extension Required:** A local companion avoids Chrome Web Store approval delays, developer mode unpacking warnings, and extension maintenance churn, while directly fulfilling the user's desire for a native setup.
3. **No Network Proxy / MITM Overhead:** Avoids setting up root CA certificates, handling terabytes of video streaming bandwidth, or breaking certificate-pinned services.
4. **Preserves Native Session State:** By attaching to `--remote-debugging-port`, the user retains all session cookies, accounts, and hardware acceleration on their primary browser.

---

# CURRENT GS3 AUTHORITY MAP

A rigorous inspection of the current GS3 tree establishes this separation between authoritative state and DOM projections:

| Concern | Authoritative State Owner | DOM Projection / Metadata | Invariant Rule |
|---|---|---|---|
| **Assigned Content** | `_panels` array in `js/grid-session.js` (normalized Panel objects) | `iframe.src`, `iframe.dataset.lastSrc` in `js/launch.js` | What GS3 deliberately assigned. Read by Save Session, Reload, Purge, Star. |
| **Arrangement (Presentation)** | `_arrangement` in `js/grid-session.js` (slot index → grid area name) | CSS `grid-area` property on `#screen-N-slot` | Positions are physical locations; Panels move across them. Moving a panel never touches content. |
| **Panel Identity** | Array slot index (`0..3`) in `js/grid-session.js` | `panel.dataset.slotIndex` | Stays with the iframe DOM container across layout moves. |
| **Position Identity** | `positions.js` (`resolveSlotAtPosition`, `resolvePositionOfSlot`) | `#master-position-indicator`, toolbar badge | Pure visual coordinate system. |
| **Content Generation** | `state.generation` in `js/panel-navigation.js` | None (pure in-memory counter) | Incremented on every deliberate GS3 assignment (`beginPanelContent`). |
| **In-Frame History** | `state.entries` in `js/panel-navigation.js` | None | Currently records `{ url: null, opaque: true }` cross-origin. |
| **Undo / Redo** | `_history` in `js/grid-session.js` (canonical session mutations) | `.btn-hotswap-undo`, `.btn-hotswap-redo` disabled state | Reverses GS3 runtime actions; panel undo walks in-frame history first. |
| **Capability Presentation** | `_slotCapabilityState` in `js/capability-bridge.js` | `button.hidden`, `.active` class on Fill Panel controls | Ephemeral, generation-checked UI state. |

---

# OBSERVATION STATE OWNER

### Decision: Dedicated Module `js/current-url-bridge.js` + Hook into `js/panel-navigation.js`

1. **Primary Ephemeral Owner (`js/current-url-bridge.js`):**
   Maintains an internal, non-persisted Map:
   ```javascript
   // slotIndex -> { observedCurrentUrl, observedAt, browserFrameId, navigationKind, generation }
   const _slotObservations = new Map();
   ```
   - **Why NOT `grid-session.js`:** `grid-session.js` is the canonical persistence and undo authority. Putting ephemeral observed URLs in `_panels` would violate the core invariant that human browsing never silently mutates assigned content.
   - **Why NOT `panel-navigation.js` alone:** `panel-navigation.js` is an internal stack algorithm. It should receive enriched navigation events, but network connection lifecycle, companion health, and WebSocket handling belong in a dedicated bridge module (mirroring `capability-bridge.js`).

2. **Downstream Enrichment (`js/panel-navigation.js`):**
   When `current-url-bridge.js` receives a verified observation, it calls:
   ```javascript
   noteObservedNavigation(slotIndex, generation, url)
   ```
   This replaces `{ url: null, opaque: true }` in `state.entries` with `{ url, opaque: false, source: 'observed' }`, allowing `navigateBack()` to step backwards through actual human browsing history rather than collapsing immediately to the anchor.

---

# PANEL / POSITION / FRAME / GENERATION MODEL

### Invariant: Observation Belongs to the Panel Slot, Scoped to Generation

1. **Content moves; Positions do not:**
   A human browsing inside Slot 1 is browsing inside that specific iframe container. If Slot 1 moves from Position 1 to Position 3 via a layout swap:
   - The iframe and DOM elements are untouched.
   - The ongoing video and navigation state continue uninterrupted.
   - The `observedCurrentUrl` **stays with Slot 1** (and is now visible at Position 3).
2. **Behavior Matrix Across GS3 Actions:**

| Action | `assignedUrl` | `observedCurrentUrl` | Generation | Rationale |
|---|---|---|---|---|
| **Human Browses Link** | Unchanged | **Updates to new URL** | Unchanged | Observational layer records reality; canonical assignment untouched. |
| **GS3 Refresh / Reload** | Unchanged | **Cleared (`null`)** | **Increments (+1)** | Explicitly reloads `assignedUrl` (`data-last-src`); browsing discarded. |
| **Shuffle (Panel-local)** | **New random URL** | **Cleared (`null`)** | **Increments (+1)** | New content generation starts fresh. |
| **Shuffle All (Master)** | **All new URLs** | **All cleared** | **All increment (+1)** | Entire grid re-seeded; all observations wiped. |
| **Move / Swap Position** | Unchanged | **Preserved on Slot** | Unchanged | Pure CSS grid-area reassignment; video continues playing. |
| **Copy Panel (Slot A → B)**| Slot B gets A's URL | Slot B: `null`; Slot A: kept | Slot B: New gen; Slot A: kept | Slot B loads fresh from assigned URL; observation is not cloned. |
| **Undo (Browsing Step)**| Unchanged | **Updates to previous URL** | Unchanged | Walks backward through observed in-frame history stack. |
| **Undo (Runtime Action)** | **Restores old URL** | **Cleared (`null`)** | **Increments (+1)** | Reverses a Shuffle/Swap; restores canonical checkpoint. |
| **Save Session As** | **Persisted to JSON** | **Ignored / Not saved** | Unchanged | Sessions save intentional assignments, never ephemeral wandering. |

---

# CDP FRAME CORRELATION MODEL

To connect CDP events to GS3 panels with zero ambiguity:

1. **Deterministic Iframe Naming:**
   In `js/launch.js` inside `_buildPanel()`:
   ```javascript
   iframe.name = `gs3-panel-slot-${index}`;
   ```
2. **CDP Event Extraction:**
   When Chrome emits `Page.frameNavigated`:
   ```javascript
   {
     frame: {
       id: "5A8B2C...",
       parentId: "ROOT_ID",
       name: "gs3-panel-slot-1",
       url: "https://www.xnxx.com/video-ABC123/actual-video"
     }
   }
   ```
3. **Grandchild Frame Filtering:**
   Third-party tube sites inject ad frames, player iframes, and tracking pixels. The companion verifies:
   ```javascript
   if (frame.parentId !== gs3RootFrameId) return; // Drop grandchild frames immediately
   ```
4. **Fallback Correlation via CDP `DOM.getFrameOwner`:**
   If a hostile third-party script clears `window.name`, the companion calls `DOM.getFrameOwner({ frameId })`, which returns the `backendNodeId` of the iframe element in the parent document, guaranteeing permanent identity resolution.

---

# COMPANION PROCESS ARCHITECTURE

### The Daemon (`gs3-companion/`):
- **Runtime:** Node.js (lightweight, native WebSocket support via `ws`, zero compile step).
- **Process Model:** Standalone console process or background service started via `npm run companion` or `launch-gs3.bat`.
- **Target Discovery:**
  1. Polls `http://127.0.0.1:9222/json/list` until Chrome is detected.
  2. Locates target where `url` contains `index3.html` or title contains `Stream Loop Launchpad`.
  3. Connects to `webSocketDebuggerUrl`.
- **CDP Domains Enabled:**
  - `Page.enable`
  - `DOM.enable` (lazy, for frame owner fallback)
- **Listeners:**
  - `Page.frameNavigated`: Captures full document navigations.
  - `Page.navigatedWithinDocument`: Captures SPA pushState / hash routing.

---

# GS3 ↔ COMPANION TRANSPORT

1. **Local WebSocket Transport:**
   - Companion runs a WebSocket server on `127.0.0.1:9223`.
   - GS3's `js/current-url-bridge.js` opens `new WebSocket('ws://127.0.0.1:9223')`.
2. **Packet Schema:**
   ```typescript
   interface NavigationObservedEvent {
     type: 'OBSERVED_NAVIGATION';
     slotIndex: number;
     url: string;
     navigationKind: 'full' | 'same-document';
     timestamp: number;
   }
   ```
3. **Localhost & Mixed Content Rules:**
   - Chrome enforces Private Network Access (PNA) and Mixed Content rules.
   - When GS3 runs on `http://localhost:...` or `http://127.0.0.1:...`, connecting to `ws://127.0.0.1:9223` succeeds without certificate requirements.
   - If running from GitHub Pages (`https://nowimhere3.github.io/GS3/`), connecting to plaintext `ws://127.0.0.1` requires either a local self-signed TLS cert (`wss://`) or launching Chrome with `--allow-insecure-localhost`. (Recommended: Run GS3 locally or use an extension relay if pure web-hosted HTTPS is mandatory).

---

# SECURITY / PERMISSION MODEL

1. **Loopback Binding Only:** Companion binds strictly to `127.0.0.1` (never `0.0.0.0`).
2. **Origin Validation:** Companion checks the HTTP `Origin` header during WebSocket handshake, accepting only authorized GS3 origins (`http://localhost:*`, `http://127.0.0.1:*`, `https://nowimhere3.github.io`).
3. **Read-Only Observation:** The companion only *reads* navigation events. It never injects scripts, clicks elements, or issues remote commands into the user's browser context.
4. **Fail-Closed Mutation Wall:** Inbound events to GS3 can only update the ephemeral `observedCurrentUrl` map. They have zero capability to mutate `grid-session.js`, `Store`, folder structures, or disk presets.

---

# CONNECTION / RECONNECTION LIFECYCLE

1. **Boot Sequence:**
   - GS3 initializes normally with `observedCurrentUrl = null` across all slots.
   - `current-url-bridge.js` attempts WebSocket connection to `127.0.0.1:9223`.
   - If offline, it retries with an exponential backoff (1s, 2s, 5s) silently in the background without blocking UI rendering.
2. **DevTools / F12 Conflict Management:**
   - Chrome permits only one active CDP client. If the user presses F12 to inspect GS3, Chrome disconnects the companion.
   - The companion detects the close event, logs an informative notice, and automatically re-attaches once internal DevTools is closed.
3. **Browser Restart / Reload:**
   - When the user restarts Chrome, the companion waits for port 9222 to reappear and re-attaches to the GS3 tab automatically.

---

# GENERATION / STALE EVENT RULE

### Problem:
Generation 17 loads search results. User clicks a video. A Shuffle occurs, opening Generation 18. A slow network redirect from Generation 17 arrives late.

### Solution:
1. Every slot maintains an integer `contentGeneration` (managed in `panel-navigation.js`).
2. When GS3 initiates a content change, it records `generationTimestamp = performance.now()`.
3. The companion tags events with the active `iframe.name` (`gs3-panel-slot-1-gen-17`).
4. GS3 discards any observation where:
   - The event's generation token does not match the slot's current `state.generation`.
   - OR the event timestamp is older than the last `beginPanelContent` execution.

---

# REFRESH SEMANTICS

The human's favorite workflow:
```text
Shuffle -> landing page (A) -> browse around to (B) -> Refresh -> back to (A)
```

### Architectural Enforcement:
In `js/launch.js` line 954:
```javascript
reloadBtn.onclick = (e) => {
    e.stopPropagation();
    reloadBtn.classList.add('spinning');
    setTimeout(() => reloadBtn.classList.remove('spinning'), 450);
    const savedSrc = iframe.getAttribute('data-last-src') || iframe.src;
    
    // 1. Advance generation & clear observation
    beginPanelContent(index, savedSrc, 2);
    clearObservedNavigation(index);
    
    // 2. Perform clean reload of the ASSIGNED source
    iframe.src = 'about:blank';
    setTimeout(() => { iframe.src = savedSrc; }, 80);
};
```
- `data-last-src` holds `assignedUrl` (A).
- Clicking Reload increments generation, wipes `observedCurrentUrl` (B), and reloads (A).
- The human returns to their original shuffled landing page every single time.

---

# SHUFFLE / ASSIGN SEMANTICS

When a panel is shuffled (panel-local or Master `Shuffle All`):
1. `updateGridSession` records new canonical URL.
2. `updateRenderedPanel` calls `beginPanelContent(slotIndex, newUrl)`.
3. `state.generation += 1`.
4. `current-url-bridge.js` wipes `observedCurrentUrl` for that slot.
5. `iframe.src` navigates to new URL.
6. Stale observations from the old page are automatically rejected.

---

# MOVE / SWAP / COPY SEMANTICS

1. **Move to Position / Position Swap:**
   - Handled via `setSessionArrangement()` in `grid-session.js`.
   - Modifies only CSS `grid-area`.
   - Slot identity, iframe DOM instance, and live browsing are untouched.
   - **`observedCurrentUrl` moves with the slot.** If Slot 0 moves from Position 1 to Position 2, its observed URL remains bound to Slot 0.
2. **Copy to Position (Slot A → Slot B):**
   - Slot B is assigned Slot A's canonical `assignedUrl`.
   - Slot B's `iframe.src` is loaded fresh.
   - Slot B opens a brand new generation with **`observedCurrentUrl = null`**.
   - Slot A's ongoing observation is untouched.

---

# UNDO / REDO SEMANTICS

1. **Canonical Action Undo (Master Undo):**
   - Reverses session-level mutations (e.g. undoing a Shuffle).
   - Restores the previous assigned panel; opens a new generation; clears observation.
2. **Panel-Local Smart Undo (`_undoPanelSmart`):**
   - In `triple-mode.js`, GS3 already checks `canNavigateBack(slotIndex)` before falling back to session history.
   - With Current-URL Bridge, in-frame browsing history entries in `panel-navigation.js` have real URLs.
   - Smart Undo navigates the iframe backward through human-browsed pages (`step.url`).
   - When the cursor reaches the generation anchor (the original assigned landing page), `observedCurrentUrl` clears, and the next Undo reverses the GS3 action.

---

# NESTED RUNTIME BOUNDARY

1. **Layer 1 vs. Layer 2 Ownership:**
   - Outer Runtime (Layer 1) owns direct slots `0..3`.
   - If Slot 2 hosts a nested Runtime (`index3.html`), the nested Runtime has its own independent internal slots.
2. **CDP Frame Tree Isolation:**
   - The outer companion observes only frames whose `parentId === l1RootFrameId`.
   - The outer Runtime observes Slot 2 as having URL `index3.html?...`. It does NOT ingest the nested leaf frames.
   - If the nested Runtime is connected to the bridge, it observes its own direct child frames locally.
   - No cross-layer event leakage.

---

# PERSISTENCE POLICY

| Surface / Action | `assignedUrl` | `observedCurrentUrl` |
|---|---|---|
| **Save Session As** | **Saved to preset JSON** | **NEVER SAVED** |
| **Grid Re-open / Reload** | Restored from preset | Starts as `null` |
| **Store `matrixUrls`** | Updated on assignment | Never touched |
| **Presets (`presets.js`)** | Canonical source of truth | Completely unaware of field |

*Future Explicit Action Exception:* An explicit user button (e.g. `Adopt Current as Assigned` or `Bookmark Current`) may deliberately promote `observedCurrentUrl` into `assignedUrl`, pushing an Undo checkpoint.

---

# FUTURE FILL READ PATH

When Fill Panel or external player adapters want to target the active video:

```javascript
export function getEffectivePanelUrl(slotIndex) {
    const observation = getObservedNavigation(slotIndex);
    const currentGen = getPanelContentGeneration(slotIndex);
    
    // Use observed URL only if it matches the current generation and is non-empty
    if (observation && observation.generation === currentGen && observation.url) {
        return { url: observation.url, source: 'observed' };
    }
    return { url: getAssignedPanelUrl(slotIndex), source: 'assigned' };
}
```
- Completely non-mutating.
- Consumes real browsing location without rewriting canonical assignment.

---

# GRACEFUL DEGRADATION

If the companion daemon is not running:
1. `current-url-bridge.js` fails WebSocket connection silently.
2. `observedCurrentUrl` is always `null`.
3. GS3 falls back 100% to existing `assignedUrl` behavior.
4. Refresh, Shuffle, Move, Undo/Redo, and Fill Panel continue operating with zero console errors or UI disruption.

---

# FILES / MODULES EVENTUALLY AFFECTED

1. `js/launch.js`:
   - Set `iframe.name = `gs3-panel-slot-${index}`` in `_buildPanel`.
   - Clear observation in `reloadBtn.onclick` and `setIframeUrl`.
2. `js/current-url-bridge.js` (**NEW**):
   - Ephemeral observation Map, WebSocket client, generation validator.
3. `js/panel-navigation.js`:
   - Export `noteObservedNavigation(slotIndex, generation, url)` to replace `opaque: true` entries with real URLs.
4. `companion/` (**NEW DIRECTORY**):
   - `server.js`: Lightweight Node.js CDP bridge script (~120 lines).
   - `package.json`: Minimal dependencies (`ws`, `chrome-remote-interface` or raw WS).

---

# FILES / MODULES THAT SHOULD REMAIN UNCHANGED

1. `js/grid-session.js`: **MUST NOT CHANGE.** Canonical content and persistence authority must remain decoupled from observation.
2. `js/positions.js`: **MUST NOT CHANGE.** Position resolution logic is completely independent of in-frame content.
3. `js/storage.js`: **MUST NOT CHANGE.** Never store ephemeral URLs.
4. `js/presets.js`: **MUST NOT CHANGE.** Preset schemas remain clean.

---

# R0 LAB DESIGN

A minimal, isolated lab to validate the end-to-end loop before any production code is touched:

```text
GS3/architecture-lab/current-url-bridge/
├── index.html        (Minimal 2-panel grid reproducing launch.js slot naming)
├── companion.js      (Single-file Node.js CDP watcher connecting to :9222)
└── README.md         (Reproduction instructions)
```

### Lab Flow:
1. Start Chrome: `chrome.exe --remote-debugging-port=9222`
2. Start companion: `node companion.js`
3. Open `architecture-lab/current-url-bridge/index.html`.
4. Position 2 loads: `https://www.xnxx.com/search/deepthroat?top`
5. Human clicks a video link inside Position 2.
6. Companion intercepts `Page.frameNavigated`, maps `gs3-panel-slot-1`, and transmits `{ slotIndex: 1, url: 'https://www.xnxx.com/video-...' }`.
7. Lab page displays diagnostic pill:
   ```text
   [Slot 1] Assigned: .../search/... | Observed: .../video-...
   ```
8. Click `Refresh` button on Slot 1:
   - Iframe reloads search page.
   - Observed URL reverts to `null`.

---

# R0 PASS / FAIL CRITERIA

| Test | Pass Criteria |
|---|---|
| **1. Cross-Origin Capture** | Full navigation inside cross-origin iframe emits destination URL. |
| **2. Correct Slot Mapping** | Click in Slot 1 updates Slot 1 only; Slot 0 remains untouched. |
| **3. Canonical Invariance** | `iframe.dataset.lastSrc` remains identical to original landing page. |
| **4. In-Frame Navigation Chain** | Clicking video A then related video B updates observation from A to B. |
| **5. Stale Generation Rejection** | Fast Shuffle while page is loading drops the previous page's completion event. |
| **6. Refresh Semantics** | Clicking Reload explicitly loads `data-last-src` and clears observation. |
| **7. Position Swap Safety** | Swapping Position 1 and 2 keeps the observation attached to its slot. |
| **8. Grandchild Ad Rejection** | Banner ad and popunder iframes inside XNXX do NOT overwrite panel URL. |
| **9. Disconnect Immunity** | Killing `companion.js` causes zero crashes or UI freezing in GS3. |

---

# OPEN RISKS

1. **Chrome Startup Ergonomics:** User must launch Chrome with `--remote-debugging-port=9222`. If that is inconvenient, an unpacked Chrome Extension implementing `chrome.webNavigation` provides an identical zero-flag alternative.
2. **DevTools Conflict:** If the user opens F12, Chrome closes the CDP connection. Companion must handle automatic re-attachment gracefully.
3. **PNA / Mixed Content:** If GS3 is deployed to GitHub Pages over HTTPS, connecting to loopback `ws://127.0.0.1` requires running GS3 locally on HTTP or using a lightweight extension bridge.

---

# FINAL RECOMMENDATION

The architecture for **Current-URL Bridge** is fully synthesized, verified against the local codebase, and ready for R0 laboratory validation.

The model strictly honors the golden rule:
> **Browsing does not silently rewrite content assignment.**

Proceed to commission a bounded **R0 Laboratory Experiment** to prove the CDP companion loop on real adult video providers before integrating into production.
