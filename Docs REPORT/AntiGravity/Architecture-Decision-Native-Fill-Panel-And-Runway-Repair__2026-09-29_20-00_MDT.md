<!-- sideline-provenance: {"gameId":"game_git_042782b8","clientRef":"ref_1790732987042_d26b7041","playerInstanceId":"antigravity-3e448157","playerType":"antigravity","provider":"antigravity","model":"gemini-3.8-flash","effort":"high","at":"2026-09-30T01:49:47.042Z"} -->

# Architecture Decision & Forensic Review: Native Fill Panel & Runway Shortcut Repair

**Date:** 2026-09-29  
**Role:** Architect / Forensic Reviewer  
**Status:** ARCHITECTURE LOCKED (Classification: NATIVE-C for DOM-level; NATIVE-B for Frame-level; Surgical repair for Top/Runway divergence)

---

# Executive Verdict

1. **Native Fill Panel Hard Boundary:**
   - **DOM-Level Fill Panel (NATIVE-C):** Cannot be achieved by parent JavaScript alone on arbitrary third-party cross-origin pages hosted from GitHub Pages. The W3C Same-Origin Policy (SOP) strictly prevents the parent document from querying, styling, or executing code inside cross-origin child documents. Expanding a `<video>` element and its player container while hiding third-party page chrome fundamentally requires code running in the child browsing context (a userscript, companion browser extension, or server rewrite proxy).
   - **Frame-Level Fill Panel (NATIVE-B):** GS3 *can* natively manipulate the `<iframe>` element it owns (scaling, translating, cropping, or rewriting site-specific embed URLs) without any user installation. However, this is an optical viewport approximation, not an intelligent player container extractor.
2. **Top Toolbar vs. Runway Divergence Root Cause:**
   - Fill Panel was physically created on both surfaces (`buildMirror('fillPanel', ...)`).
   - At panel initialization, `registerFillPanelCapability(panel)` correctly sets `button.hidden = true` on the canonical tray button, Top mirror, and Runway mirror because capability is absent (`capable: false`).
   - The divergence happens at **layout time**: when a user hovers over a panel (`panel.onpointerenter`), `layoutTopShortcuts()` executes. Lines 608 and 624 of `js/launch.js` unconditionally reset `shortcuts.forEach(b => { b.hidden = false; })` to calculate responsive horizontal fit. Because `fillPanel` fits within the rail width budget, Top Toolbar forces `button.hidden = false`.
   - The Runway surface has no dynamic width reflow engine, so its mirror remained `button.hidden = true`.
3. **Smallest Repair:**
   - Update `layoutTopShortcuts()` to distinguish between **responsive overflow hiding** and **capability-absence hiding**. Capability-hidden buttons must be flagged (e.g. `data-capability-hidden="true"`), excluded from rail width consumption, and kept `hidden = true` during layout passes.
   - When capability is truthfully confirmed via the bridge, `_render` clears the flag, unhides the buttons, and re-triggers `layoutTopShortcuts()` to re-budget the rail.

---

# Native Fill Panel

## Browser Boundary

GS3 is a client-side web application hosted on GitHub Pages (`https://nowimhere3.github.io/GS3/` or local `localhost`). When a panel embeds a third-party website (`https://third-party-site.example/...`):

1. **Cross-Origin SOP Enforcement:**
   - The browser enforces strict process/origin isolation.
   - `iframe.contentDocument` returns `null` or throws `DOMException: SecurityError`.
   - `iframe.contentWindow.document` throws `DOMException: SecurityError: Blocked a frame with origin from accessing a cross-origin frame.`
   - `iframe.contentWindow.location.href` throws `SecurityError` on read.
   - `document.querySelector('video')` in the parent searches only the parent DOM; it has zero access to child elements.
2. **Origin Distinctions:**
   - **Same-Origin Child:** Parent can directly read and mutate child DOM (`iframe.contentDocument.querySelector('video')`).
   - **Nested GS3 Runtime (`index3.html`):** Runs same-origin; parent has full DOM capability (though GS3 cleanly uses `LAYER_MESSAGE_SOURCE = 'gs3-layer-scope'` to avoid tight coupling).
   - **Arbitrary Cross-Origin Third-Party Child:** Zero DOM read, write, or query access. This is an invariant web security barrier.

## What GS3 Can Control Natively

GS3 completely owns the `<iframe>` element inside the `.stream-panel` container in the parent DOM:

1. **Geometry & Dimensions:** GS3 can change `iframe.style.width`, `iframe.style.height`, margins, padding, and position.
2. **CSS Transforms & Scaling:** GS3 can apply `transform: scale(...) translate(...)` and `transform-origin` to magnify or reposition the frame.
3. **Container Clipping & Masking:** The `.stream-panel` container can enforce `overflow: hidden`, clipping out banners, navigation rails, or headers if offsets are known.
4. **Initial Navigation URL:** GS3 can set or rewrite `iframe.src` (e.g. substituting standard URLs for embed player URLs where known).
5. **Iframe Attributes:** GS3 controls `allow="autoplay; fullscreen"`, `sandbox`, and `referrerpolicy`.

## What GS3 Cannot Control Natively

1. **Child DOM Traversal:** GS3 cannot find the `<video>` element, cannot locate `#player`, and cannot read element coordinates within the child page.
2. **Child DOM Styling:** GS3 cannot inject CSS rules into the child page to hide ads, remove sidebars, or expand the player container to `100vw × 100vh`.
3. **Child Navigation State:** Once the user clicks links or navigates inside a cross-origin iframe, GS3 cannot read the active URL or detect whether a video is currently rendering.
4. **Scroll Position & Responsive Breakpoints:** GS3 cannot read or set `window.scrollY` inside the child frame. Scaling an oversized iframe causes the child document to trigger desktop media queries, shifting player layout unpredictably.

## DOM-Level Fill Panel Verdict

> **DOM-Level Fill Panel CANNOT be achieved by ordinary GS3 parent JavaScript alone.**

The proven Tampermonkey interaction works precisely because it executes *inside* the child document's JavaScript realm:
```javascript
const video = document.querySelector('video');
const container = video?.closest('#player') || video?.closest('.video-player') || ...;
container.style.position = 'fixed';
container.style.inset = '0';
container.style.width = '100vw';
container.style.height = '100vh';
container.style.zIndex = '999999';
```
No parent script can execute these DOM operations on an arbitrary cross-origin page without code running inside that child frame.

## Frame-Level Fill Panel Verdict

> **Frame-Level Fill Panel IS natively possible, but it is an optical approximation, NOT a true DOM extractor.**

A frame-level approximation manipulates the parent-owned `<iframe>`:
- **Pan & Zoom (Oversized Viewport):** Setting `iframe.style.width = '140%'`, `iframe.style.height = '140%'`, with negative margins or CSS transforms inside `overflow: hidden`.
- **Known Embed Rewriting:** For specific cooperative domains (e.g. converting `youtube.com/watch?v=ID` to `youtube.com/embed/ID`), the native embed player fills 100% of the iframe naturally.

### Limitations of Frame-Level Approximation:
1. **Layout Blindness:** The parent does not know where the video sits on the page. On sites with top banners, sidebars, or cookie notices, scaling cuts off parts of the player or zooms into blank white space.
2. **Click Disorientation:** CSS scaling distorts mouse hit targets and breaks player interaction (scrubbing, volume, resolution pickers).
3. **Responsive Reflow:** Oversizing the iframe width triggers desktop layout reflow inside the iframe, shifting the player.

## Zero-Install Options

| Option | Classification | Mechanism | Viability for GS3 V1 |
|---|---|---|---|
| **Parent DOM Injection** | **NOT VIABLE** | `iframe.contentDocument` manipulation | Blocked by browser Same-Origin Policy. |
| **Frame-Level Pan/Zoom** | **USEFUL FRAME-LEVEL APPROXIMATION** | CSS `transform: scale() translate()` on `<iframe>` | Natively possible; cannot guarantee video alignment across arbitrary sites. |
| **Site Embed URL Rewriting** | **SITE-SPECIFIC ONLY** | Rewrite URLs to `/embed/...` player endpoints | Works zero-install, but limited to a handful of known sites; fails on generic video sites. |
| **Reverse Proxy / Relay** | **REQUIRES SERVER/PROXY** | Intermediate server rewrites HTML and injects bridge script | Violates static GitHub Pages architecture; high bandwidth and legal overhead. |
| **Userscript (Tampermonkey)** | **REQUIRES BROWSER-SIDE COMPONENT** | Cross-origin capability bridge | Current V1 implementation. Works reliably on 50–60%+ of sites; requires customer setup. |
| **Companion Browser Extension** | **REQUIRES BROWSER-SIDE COMPONENT** | WebExtension content script running in all frames | Zero configuration for user after 1-click install; eliminates Tampermonkey scripts. |

## Native Classification

### **NATIVE-C (for true DOM-Level Fill Panel)**
True DOM-level Fill Panel requires code executing inside the child browsing context. The smallest possible execution mechanisms are:
1. **Userscript (Current V1):** `userscripts/gs3-fill-panel.user.js` via Tampermonkey.
2. **Companion Browser Extension (Future V2):** A lightweight WebExtension with `"content_scripts": [{"matches": ["<all_urls>"], "all_frames": true}]` injecting the exact same bridge script natively.

### **NATIVE-B (for zero-install Frame-Level Approximation)**
If zero customer setup is an absolute product requirement today, GS3 can only offer a frame-level viewport approximation or embed-player URL transformer.

---

# Shortcut / Runway Bug

## Exact Root Cause

The bug is caused by a direct collision between **capability-absence hiding** and **responsive toolbar layout**:

1. **Both Mirrors Are Created:**
   In `js/launch.js`, `buildMirror('fillPanel', ...)` succeeds for both Top (`topShortcutsEl`) and Runway (`runwayEl`). Both buttons are physically appended to the DOM.
2. **Capability Bridge Hides Both:**
   At line 1313 of `js/launch.js`:
   ```javascript
   registerFillPanelCapability(panel);
   ```
   calls `_render(panel, state)` with `state.capable = false`.
   `_render()` sets `button.hidden = true` on:
   - Canonical tray button: `.btn-hotswap-fill-panel`
   - Top mirror: `.hotswap-top-shortcut[data-action-key="fillPanel"]`
   - Runway mirror: `.hotswap-runway-btn[data-action-key="fillPanel"]`
3. **`layoutTopShortcuts()` Blindly Overrides `hidden`:**
   In `js/launch.js` lines 604–626:
   ```javascript
   function layoutTopShortcuts() {
       const shortcuts = [...topShortcutsEl.children];
       const railWidth = toolbar.clientWidth;
       if (railWidth === 0) return;
       shortcuts.forEach((button) => { button.hidden = false; }); // <--- CLOBBERS CAPABILITY STATE
       ...
       shortcuts.forEach((button, i) => { button.hidden = i >= fits; }); // KEEPS HIDDEN=FALSE IF IT FITS
   }
   ```
   Whenever a user hovers over a panel (`panel.onpointerenter`), reveals the toolbar, or resizes the panel, `layoutTopShortcuts()` runs.
   Line 608 unconditionally sets `button.hidden = false` for every shortcut in `topShortcutsEl` so it can measure their widths. Because `fillPanel` is within the physical rail fit count, line 624 leaves `button.hidden = false`.
   `layoutTopShortcuts()` completely overrides the capability bridge's `hidden = true` instruction!
4. **Runway Mirror Stays Hidden:**
   The Runway has no responsive layout loop. It never resets `button.hidden = false`. Therefore, the Runway mirror remains `hidden = true` as set by `capability-bridge.js`.

## Top vs Runway Divergence

| Lifecycle Phase | Canonical Tray Button | Top Toolbar Mirror | Runway Mirror |
|---|---|---|---|
| **Build Time (`_buildPanel`)** | Created in overlay DOM | Created in `topShortcutsEl` | Created in `runwayEl` |
| **Capability Registration (`capable: false`)** | `button.hidden = true` | `button.hidden = true` | `button.hidden = true` |
| **Pointer Hover / Layout (`layoutTopShortcuts`)** | Untouched (`hidden = true`) | **Overridden to `hidden = false`** | Untouched (`hidden = true`) |
| **User Experience in Field Test** | Hidden in tray | **Visible on Top rail (broken)** | **Hidden on Runway** |

## Smallest Repair

The smallest repair that preserves all Hotswap architectural invariants:

### 1. In `js/capability-bridge.js`:
Mark capability-hidden buttons explicitly so layout passes know they are semantically suppressed:
```javascript
function _render(panel, state) {
    const active = Boolean(state?.capable && state.active);
    _fillPanelButtons(panel).forEach((button) => {
        if (!state?.capable) {
            button.hidden = true;
            button.dataset.capabilityHidden = 'true';
        } else {
            delete button.dataset.capabilityHidden;
            button.hidden = false;
            button.textContent = active ? '✕' : '⛶';
            button.title = active ? 'Exit Fill Panel' : 'Fill Panel';
            button.classList.toggle('active', active);
            button.setAttribute('aria-pressed', String(active));
        }
    });
}
```

### 2. In `js/launch.js` (`layoutTopShortcuts`):
Respect capability suppression during responsive rail budgeting:
```javascript
function layoutTopShortcuts() {
    const shortcuts = [...topShortcutsEl.children];
    const railWidth = toolbar.clientWidth;
    if (railWidth === 0) return;

    // Only unhide buttons that are NOT suppressed by capability absence
    const eligible = shortcuts.filter((button) => button.dataset.capabilityHidden !== 'true');
    shortcuts.filter((button) => button.dataset.capabilityHidden === 'true')
             .forEach((button) => { button.hidden = true; });

    eligible.forEach((button) => { button.hidden = false; });

    const reserved = positionBtnEl.offsetWidth
        + (layerSelectorEl.hidden ? 0 : layerSelectorEl.offsetWidth)
        + toolbarActionsEl.offsetWidth
        + 40;
    const budget = Math.max(0, railWidth - reserved);
    let used = 0;
    let fits = 0;
    for (const button of eligible) {
        const width = button.getBoundingClientRect().width + (fits > 0 ? 6 : 0);
        if (used + width > budget) break;
        used += width;
        fits += 1;
    }
    eligible.forEach((button, i) => { button.hidden = i >= fits; });
    projectDeepCuts(fits);
}
```

### 3. Trigger Layout on Capability Change:
When `state.capable` becomes `true` via inbound `CAPABILITY_PRESENT` message, call `layoutTopShortcuts()` so the Top rail dynamically recalculates width and reveals the button.

## Missing Regression Test

`test/capability-bridge.test.js` checked `nodes.map(n => n.hidden)` only once immediately after `bootGrid()`, without ever hovering, resizing, or revealing the toolbar.

The concrete test that reproduces and protects against this divergence:
```javascript
test('Top and Runway Fill Panel mirrors stay hidden when capability is absent, even after pointerenter and layoutTopShortcuts', async () => {
    const page = await bootGrid(`${CROSS_ORIGIN}/test/fixtures/canary.html?id=idle`);
    const panel = await firstPanel(page);
    const topMirror = panel.locator('.hotswap-top-shortcut[data-action-key="fillPanel"]');
    const runwayMirror = panel.locator('.hotswap-runway-btn[data-action-key="fillPanel"]');

    // 1. Initial boot check
    assert.equal(await topMirror.evaluate((el) => el.hidden), true);
    assert.equal(await runwayMirror.evaluate((el) => el.hidden), true);

    // 2. Trigger user hover (calls panel.onpointerenter -> layoutTopShortcuts)
    await panel.hover();
    await page.waitForTimeout(50);

    // 3. Top mirror must NOT be forced visible by layoutTopShortcuts
    assert.equal(
        await topMirror.evaluate((el) => el.hidden),
        true,
        'Top mirror must remain hidden after hover/layout when capability is absent'
    );
    assert.equal(
        await runwayMirror.evaluate((el) => el.hidden),
        true,
        'Runway mirror must remain hidden'
    );
});
```

---

# FACTS

1. Ordinary parent JavaScript running on GitHub Pages cannot access, query, or style the DOM of an arbitrary third-party cross-origin iframe due to the W3C Same-Origin Policy.
2. `HOTSWAP_ACTIONS` in `js/launch.js` defines `fillPanel`, which is registered and eligible for both Top Toolbar and Runway surfaces.
3. Both Top and Runway mirrors are successfully instantiated as DOM nodes by `buildMirror()` in `_buildPanel()`.
4. `registerFillPanelCapability(panel)` initializes `state.capable = false` and hides all three controls (`.btn-hotswap-fill-panel` and both mirrors).
5. `layoutTopShortcuts()` executes on `pointerenter` and unconditionally sets `button.hidden = false` on all child elements of `topShortcutsEl`, overriding the capability bridge.
6. Existing tests in `test/capability-bridge.test.js` passed because they checked `hidden` state statically at boot time without hovering or triggering `layoutTopShortcuts()`.

---

# INFERENCES

1. The Human Head Coach's desire for a "zero-install native Fill Panel" reflects natural user resistance to installing Tampermonkey.
2. True DOM-level Fill Panel (scaling only the video container and stripping surrounding page elements) is technically impossible as pure client-side parent JavaScript under browser security constraints.
3. The shortcut divergence observed in human testing was a timing/lifecycle bug between `capability-bridge.js` and `layoutTopShortcuts()`, not a fundamental flaw in the canonical action registry.

---

# UNKNOWNS

1. Whether a **Frame-Level Pan/Zoom approximation** (magnifying the iframe rectangular bounding box natively) satisfies the user experience, or if the user considers the Tampermonkey DOM-level extraction non-negotiable.
2. Whether packaging the capability bridge into an official **GS3 Companion Browser Extension** (Chrome Web Store / unpacked) would be acceptable to the user as a seamless alternative to Tampermonkey.

---

# CONTRADICTIONS

- **Top vs. Runway Visibility:** `test/capability-bridge.test.js` asserted that Top and Runway visibility move in lockstep, but real runtime hover events immediately broke that lockstep by invoking `layoutTopShortcuts()`.
- **Zero-Install Expectation vs. Web Security Model:** Expecting parent-only JavaScript on GitHub Pages to extract and style video elements inside arbitrary cross-origin iframes contradicts the browser Same-Origin Policy.

---

# Recommended Implementation Path

1. **Phase 1 (Immediate Runway / Top Bug Fix):**
   - Implement the surgical repair in `js/launch.js` and `js/capability-bridge.js` using `data-capability-hidden`.
   - Add the missing hover/layout regression test in `test/capability-bridge.test.js`.
   - Result: Top and Runway mirrors remain 100% in lockstep and hidden until capability is truthfully announced.
2. **Phase 2 (Product Decision on Native Fill Panel):**
   - Present the Head Coach with the two viable options:
     - **Option 1 (Companion Extension):** Package `gs3-fill-panel.user.js` as a native Chrome extension. Eliminates Tampermonkey, provides seamless 1-click install, and preserves full DOM-level Fill Panel.
     - **Option 2 (Native Frame-Level Approximation):** Build a parent-side pan/zoom or crop tool that manipulates `iframe.style.transform`. Zero-install, but crops the frame optically rather than extracting the player cleanly.

---

## Architecture Status

**LOCKED**

*(The only remaining product uncertainty is whether a frame-level approximation is visually acceptable to the user, or if full DOM extraction via a companion extension is required).*
