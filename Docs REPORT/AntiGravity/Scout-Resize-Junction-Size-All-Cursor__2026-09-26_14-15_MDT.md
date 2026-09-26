<!-- sideline-provenance: {"gameId":"game_git_042782b8","clientRef":"ref_1790453553986_dd3bc61a","playerInstanceId":"antigravity-9d249c31","playerType":"antigravity","provider":"antigravity","model":"gemini-3.8-flash","effort":"high","at":"2026-09-26T20:12:33.986Z"} -->

# GS3 Scout Report — Resize Junction / Size-All Cursor Reconnaissance

**Date:** 2026-09-26  
**Role:** Read-Only GS3 Reconnaissance Scout  
**Location:** `Docs REPORT/AntiGravity/Scout-Resize-Junction-Size-All-Cursor__2026-09-26_14-15_MDT.md`  
**Target:** Explicit Move / Size-All (`cursor: all-scroll`) 4-way resize junction across adjustable Grid seams  

---

## Executive Recommendation

**Classification:** **C. Small dedicated junction hitbox** (composed with a small combined-resize interaction helper in JS).

**Verdict:** **SAFE FOR BOUNDED WORKER IMPLEMENTATION**

The implementation is surprisingly compact and completely self-contained. It requires **zero changes to CSS Grid area definitions (`grid-template-areas`)**, zero changes to session models, zero changes to iframe loading/lifecycle, and zero changes to surrounding Chrome.

Because all 5 eligible multi-axis Grid layouts (`4grid`, `top2`, `bottom2`, `lefttall`, `righttall`) share the exact same structural grid track lines—column track 2 is the 6px vertical seam, and row track 2 is the 6px horizontal seam—a dedicated `<div class="resizer resizer-junc">` placed at `grid-column: 2; grid-row: 2;` with `z-index: 60` and `cursor: all-scroll`:
1. Truthfully occupies the exact 6px × 6px seam intersection (with an identical ±4px grab zone reaching 14px × 14px);
2. Completely resolves the current hit-target collision/overlap between vertical and horizontal resizers;
3. Composes existing independent column and row math into a single simultaneous drag gesture;
4. Leaves 1-axis layouts (`3col`, `vsplit`, `hsplit`) completely untouched without a misleading cursor.

---

## Exact Files

Only two production files and one test file are involved:

1. [`index3.html`](file:///c:/Users/dmcal/Documents/GitHub/GS3/index3.html)
   * CSS rules for `.resizer-junc` and `.resizer-junc::after` (cursor, z-index, hit-box).
2. [`js/triple-mode.js`](file:///c:/Users/dmcal/Documents/GitHub/GS3/js/triple-mode.js)
   * `_injectResizers`: inject junction element only for layouts with both axes.
   * `_startCombinedResizeDrag`: combined 2-axis drag loop composing column and row track adjustments.
3. [`test/boot-smoke.test.js`](file:///c:/Users/dmcal/Documents/GitHub/GS3/test/boot-smoke.test.js)
   * Automated browser acceptance tests for junction presence, cursor, combined drag, and nested isolation.

---

## Exact Functions / Selectors

### CSS Selectors in [`index3.html`](file:///c:/Users/dmcal/Documents/GitHub/GS3/index3.html)
* **Existing:**
  * `.resizer` (line 127): `background: #1d1d1d; position: relative; z-index: 50; transition: background 0.15s;`
  * `.resizer:hover, .resizer.active` (line 128): `background: #0095f6;`
  * `.resizer-v` (line 129): `cursor: col-resize;`
  * `.resizer-h` (line 130): `cursor: row-resize;`
  * `.resizer-v::after` (line 131): `content: ''; position: absolute; top: 0; bottom: 0; left: -4px; right: -4px;`
  * `.resizer-h::after` (line 132): `content: ''; position: absolute; left: 0; right: 0; top: -4px; bottom: -4px;`
  * `#resizer-drag-overlay` (line 136): `display: none; position: fixed; inset: 0; z-index: 40000;`
  * `html:not(.is-nested) .resizer` (line 631): `display: none !important;` (small-screen fallback)
* **New Selectors Required:**
  * `.resizer-junc`:
    ```css
    .resizer-junc {
        grid-column: 2;
        grid-row: 2;
        cursor: all-scroll;
        position: relative;
        z-index: 60;
    }
    .resizer-junc::after {
        content: '';
        position: absolute;
        top: -4px; bottom: -4px;
        left: -4px; right: -4px;
    }
    ```

### Functions in [`js/triple-mode.js`](file:///c:/Users/dmcal/Documents/GitHub/GS3/js/triple-mode.js)
* **Existing:**
  * `_clearResizers(tripleLayoutEl)` (line 291): Clears all `.resizer` elements (already cleans up `.resizer-junc` automatically).
  * `_ensureDragOverlay()` (line 283): Ensures `#resizer-drag-overlay` exists in DOM.
  * `_startResizeDrag(e, resizerEl, axis, beforeIdx, afterIdx, trackTypes, tripleLayoutEl)` (line 303): Single-axis drag handler.
  * `_injectResizers(layoutName, tripleLayoutEl)` (line 350): Injects layout resizer elements.
  * `_applyLayout(layoutName, tripleLayoutEl, layoutBtns)` (line 553): Swaps layout classes, applies saved dimensions, and calls `_injectResizers`.
* **New / Extended Functions:**
  * `_startCombinedResizeDrag(e, resizerEl, tripleLayoutEl)`: Reads both `gridTemplateColumns` and `gridTemplateRows` computed tracks, drives delta X and delta Y simultaneously, and updates both style properties in `onMove`.
  * Extension in `_injectResizers`: If layout config has both column and row resizers, append `<div class="resizer resizer-junc"></div>` and wire `mousedown`.

---

## Current Resize Flow

```text
[User mousedown on .resizer-v or .resizer-h]
  │
  ├─► e.preventDefault()
  ├─► propName = (axis === 'col' ? 'gridTemplateColumns' : 'gridTemplateRows')
  ├─► computed = getComputedStyle(tripleLayoutEl)[propName].split(' ').map(parseFloat)
  ├─► startBefore = computed[beforeIdx], startAfter = computed[afterIdx]
  ├─► startPos = (axis === 'col' ? e.clientX : e.clientY)
  ├─► overlay = _ensureDragOverlay()
  │     overlay.style.cursor = (col-resize or row-resize)
  │     overlay.classList.add('active') (z-index 40000 covers all iframes)
  │     resizerEl.classList.add('active') (blue highlight)
  │
  ├─► [mousemove on document]
  │     delta = currentPos - startPos
  │     newBefore = clamp(startBefore + delta, MIN_TRACK_SIZE=80)
  │     newAfter  = clamp(startAfter - delta, MIN_TRACK_SIZE=80)
  │     tripleLayoutEl.style[propName] = `${newBefore}fr 6px ${newAfter}fr`
  │
  └─► [mouseup on document]
        removeEventListener('mousemove'), removeEventListener('mouseup')
        overlay.classList.remove('active')
        resizerEl.classList.remove('active')
        _customLayoutSizes[_currentLayout][propName] = tripleLayoutEl.style[propName]
```

---

## Junction Ownership by Layout

GS3 has 8 canonical Grid layouts defined in [`js/grid-layouts.js`](file:///c:/Users/dmcal/Documents/GitHub/GS3/js/grid-layouts.js). Here is the exact ground truth of seam geometry and crossing ownership:

| Layout ID | Title | Seam Tracks in Grid | Current Intersection Owner | Horizontal Resize Meaningful? | Vertical Resize Meaningful? | 2-Axis Junction Appropriate? |
|---|---|---|---|:---:|:---:|:---:|
| `4grid` | 4 Screen Grid | Col 2 (6px), Row 2 (6px) | `vres` (spans rows 0–2; `hresL`/`hresR` pseudo-elements overlap it) | **YES** | **YES** | **YES** |
| `top2` | 2 Top + 1 Bottom Wide | Col 2 (6px, top half), Row 2 (6px, full width) | `hres` (spans cols 0–2; `vres` ends above it) | **YES** | **YES** | **YES** |
| `bottom2` | 1 Top Wide + 2 Bottom | Col 2 (6px, bottom half), Row 2 (6px, full width) | `hres` (spans cols 0–2; `vres` ends below it) | **YES** | **YES** | **YES** |
| `lefttall` | 1 Left Tall + 2 Right Stacked | Col 2 (6px, full height), Row 2 (6px, right half) | `vres` (spans rows 0–2; `hres` ends at its right edge) | **YES** | **YES** | **YES** |
| `righttall` | 1 Right Tall + 2 Left Stacked | Col 2 (6px, full height), Row 2 (6px, left half) | `vres` (spans rows 0–2; `hres` ends at its left edge) | **YES** | **YES** | **YES** |
| `3col` | 3 Equal Columns | Col 2 (6px), Col 4 (6px); Row 1 only | None (parallel vertical seams only) | **YES** | **NO** | **NO** |
| `vsplit` | Vertical 50/50 Split | Col 2 (6px); Row 1 only | None (single vertical seam) | **YES** | **NO** | **NO** |
| `hsplit` | Horizontal 50/50 Split | Col 1 only; Row 2 (6px) | None (single horizontal seam) | **NO** | **YES** | **NO** |

### Key Architectural Discovery:
* In `4grid`, `vres` claims the crossing cell in `grid-template-areas`, but `hresL::after` and `hresR::after` reach 4px into the cell, creating a conflicting overlap.
* In `top2` and `bottom2`, `hres` claims the crossing cell in `grid-template-areas`.
* In `lefttall` and `righttall`, `vres` claims the crossing cell in `grid-template-areas`.
* **Crucially**: In all 5 eligible layouts, the vertical resizer is ALWAYS track index 1 (between grid lines 2 and 3), and the horizontal resizer is ALWAYS track index 1 (between grid lines 2 and 3).
* Therefore, `grid-column: 2; grid-row: 2;` targets the exact 6px × 6px intersection in **all 5 layouts** identically without altering any layout's `grid-template-areas`.

---

## Recommended Junction DOM / Geometry

### Option Selected: Option A / C Hybrid (CSS Grid Track Overlay Element)

Instead of re-writing `grid-template-areas` strings across CSS and JS:
1. In `_injectResizers`, after creating the linear resizers, check if the layout has both column and row resizers:
   ```javascript
   const hasColResizer = config.columns.includes('resizer');
   const hasRowResizer = config.rows.includes('resizer');
   if (hasColResizer && hasRowResizer) {
       const junc = document.createElement('div');
       junc.className = 'resizer resizer-junc';
       junc.addEventListener('mousedown', (e) => _startCombinedResizeDrag(e, junc, tripleLayoutEl));
       tripleLayoutEl.appendChild(junc);
   }
   ```
2. CSS handles placement and hit testing:
   ```css
   .resizer-junc {
       grid-column: 2;
       grid-row: 2;
       cursor: all-scroll;
       background: #1d1d1d;
       position: relative;
       z-index: 60; /* above linear resizers (z-index: 50) */
       transition: background 0.15s;
   }
   .resizer-junc:hover, .resizer-junc.active {
       background: #0095f6;
   }
   .resizer-junc::after {
       content: '';
       position: absolute;
       top: -4px; bottom: -4px;
       left: -4px; right: -4px;
   }
   ```

### Hit-Testing & Invariant Verification:
* **Dimensions:** 6px × 6px visually. Grab zone via `::after` is exactly 14px × 14px.
* **Stacking:** `z-index: 60` ensures that within the 14px × 14px crossing box, the junction is always the topmost hit target (`elementFromPoint` resolves directly to `resizer-junc`).
* **Seam Continuity:** Outside the 14px × 14px junction box, `elementFromPoint` cleanly resolves to `resizer-v` (vertical) or `resizer-h` (horizontal).
* **Activation Strip Safety:** Invariant `test('the resize border and the Chrome activation region are separate hit targets')` verifies that the grab zone extends at most 4px into panels, leaving the 6px activation inset clean. The junction's `::after` reaches exactly 4px, identical to `.resizer-v` and `.resizer-h`. It never encroaches on Chrome activation.

---

## Recommended Combined Drag Flow

```text
[User mousedown on .resizer-junc]
  │
  ├─► e.preventDefault()
  ├─► colComputed = getComputedStyle(tripleLayoutEl).gridTemplateColumns.split(' ').map(parseFloat)
  ├─► rowComputed = getComputedStyle(tripleLayoutEl).gridTemplateRows.split(' ').map(parseFloat)
  ├─► startColBefore = colComputed[0], startColAfter = colComputed[2]
  ├─► startRowBefore = rowComputed[0], startRowAfter = rowComputed[2]
  ├─► startX = e.clientX, startY = e.clientY
  │
  ├─► overlay = _ensureDragOverlay()
  ├─► overlay.style.cursor = 'all-scroll'
  ├─► overlay.classList.add('active')
  ├─► resizerEl.classList.add('active')
  │
  ├─► [mousemove on document]
  │     deltaX = moveEvt.clientX - startX
  │     deltaY = moveEvt.clientY - startY
  │
  │     // Column update (X)
  │     newColBefore = clamp(startColBefore + deltaX, MIN_TRACK_SIZE)
  │     newColAfter  = clamp(startColAfter - deltaX, MIN_TRACK_SIZE)
  │     tripleLayoutEl.style.gridTemplateColumns = `${newColBefore}fr 6px ${newColAfter}fr`
  │
  │     // Row update (Y)
  │     newRowBefore = clamp(startRowBefore + deltaY, MIN_TRACK_SIZE)
  │     newRowAfter  = clamp(startRowAfter - deltaY, MIN_TRACK_SIZE)
  │     tripleLayoutEl.style.gridTemplateRows = `${newRowBefore}fr 6px ${newRowAfter}fr`
  │
  └─► [mouseup on document]
        removeEventListener('mousemove'), removeEventListener('mouseup')
        overlay.classList.remove('active')
        resizerEl.classList.remove('active')
        if (!_customLayoutSizes[_currentLayout]) _customLayoutSizes[_currentLayout] = {}
        _customLayoutSizes[_currentLayout].gridTemplateColumns = tripleLayoutEl.style.gridTemplateColumns
        _customLayoutSizes[_currentLayout].gridTemplateRows = tripleLayoutEl.style.gridTemplateRows
```

---

## State / Persistence Impact

* **Zero Store / Persistence schema changes.**
* Existing GS3 architecture deliberately stores custom drag sizes in session memory only:
  ```javascript
  // Session-only memory of custom drag positions, keyed by layout name. Never
  // written to Store — a fresh visit to this page starts with none of this, by design.
  const _customLayoutSizes = {};
  ```
* When restoring a layout, lines 563–565 of `_applyLayout`:
  ```javascript
  const saved = _customLayoutSizes[safeName];
  tripleLayoutEl.style.gridTemplateColumns = saved?.gridTemplateColumns || '';
  tripleLayoutEl.style.gridTemplateRows    = saved?.gridTemplateRows    || '';
  ```
  already independently restores both `gridTemplateColumns` and `gridTemplateRows`.
* Writing both properties during combined drag integrates seamlessly with the existing layout restoration mechanism.

---

## Nested Grid Impact

* **Isolation:** A nested Grid runtime is an independent document inside an iframe with its own `#triple-layout` and its own resizer drag overlay.
* Dragging an inner junction only adjusts the inner Grid's tracks; the outer document's tracks are untouched.
* Dragging an outer junction activates the outer document's `#resizer-drag-overlay` (z-index 40000), preventing the inner iframe from capturing pointer events.
* **Small-Screen Resilience:** In `index3.html`, resizer hiding is scoped:
  ```css
  html:not(.is-nested) .resizer { display: none !important; }
  ```
  Because the junction has class `.resizer`, it is automatically preserved in nested Grids (even when the iframe width is < 900px), while still being suppressed on real mobile viewports.

---

## Regression Risks

| Risk Area | Severity | Mitigation in Recommended Design |
|---|:---:|---|
| **Iframe pointer swallowing** | Low | `#resizer-drag-overlay` with `cursor: all-scroll` intercepts all viewport pointer events during drag. |
| **Hotswap activation conflict** | None | Junction grab zone is restricted to ±4px via `::after`, staying clear of the 6px Hotswap activation inset. |
| **Panel content reload / flicker** | None | Only inline `gridTemplateColumns` and `gridTemplateRows` strings on `#triple-layout` change; iframes and panel containers are never touched or reparented. |
| **Position swaps (`🖥`)** | None | Position swaps rebind `slotEl.style.gridArea`; they do not touch the grid tracks or resizers. |
| **Non-junction layouts (`3col`, `vsplit`, `hsplit`)** | None | Junction element is conditionally injected only when both `columns` and `rows` contain a `'resizer'` track. |

---

## Tests That Should Be Added

Add to [`test/boot-smoke.test.js`](file:///c:/Users/dmcal/Documents/GitHub/GS3/test/boot-smoke.test.js):
1. **Junction Presence Assertion:**
   * In `4grid`, `top2`, `bottom2`, `lefttall`, `righttall`: exactly ONE `.resizer-junc` is present in `#triple-layout`.
   * In `3col`, `vsplit`, `hsplit`: ZERO `.resizer-junc` elements exist.
2. **Cursor & Hit-Target Verification:**
   * `getComputedStyle(junc).cursor === 'all-scroll'`.
   * `elementFromPoint(centerX, centerY)` returns `.resizer-junc`.
   * Points 15px above/below return `.resizer-v` (`col-resize`).
   * Points 15px left/right return `.resizer-h` (`row-resize`).
3. **Simultaneous 2-Axis Resize Action:**
   * Perform diagonal mouse drag on `.resizer-junc`.
   * Assert both `gridTemplateColumns` and `gridTemplateRows` changed from initial state.
4. **Nested Grid Isolation:**
   * Drag inner nested junction: assert inner tracks change, outer tracks remain identical.

---

## FACTS

1. GS3 currently injects only linear resizers (`.resizer-v` and `.resizer-h`) into `#triple-layout`.
2. In `4grid`, the center crossing pixel is currently claimed in CSS by `vres`, but `hresL::after` and `hresR::after` overlap it by 4px in paint order.
3. In `top2` and `bottom2`, `hres` claims the crossing cell.
4. In `lefttall` and `righttall`, `vres` claims the crossing cell.
5. In all 5 layouts with crossing seams (`4grid`, `top2`, `bottom2`, `lefttall`, `righttall`), the vertical seam track is column line 2 to 3, and the horizontal seam track is row line 2 to 3.
6. `_startResizeDrag` currently supports only one axis at a time (`col` or `row`).
7. `_customLayoutSizes` already stores both `gridTemplateColumns` and `gridTemplateRows` per layout name.

---

## INFERENCES

1. Adding `<div class="resizer resizer-junc">` at `grid-column: 2; grid-row: 2;` with `z-index: 60` satisfies "a pixel means exactly one thing" by explicitly defining the intersection owner.
2. Composing column and row updates in a single `mousemove` handler introduces no performance overhead because both style properties are updated on the same grid container element in the same tick.

---

## UNKNOWNS

* None identified. The CSS Grid placement, hit-testing, and simultaneous track calculation were mechanically verified in headless Chromium.

---

## CONTRADICTIONS

* Prior reconnaissance speculated that adding an intersection might require redesigning `grid-template-areas` strings to carve out new named cells. **This is false.** CSS numerical track lines (`grid-column: 2; grid-row: 2;`) place the element at the exact crossing across all 5 layouts without touching existing area names.

---

## What Does NOT Need Architecture

* No session serialization changes (`js/grid-session.js` is untouched).
* No Position/Role changes (`js/positions.js` is untouched).
* No changes to `GRID_LAYOUTS` in `js/grid-layouts.js`.
* No changes to `grid-template-areas` strings in `index3.html`.
* No changes to Hotswap Chrome activation rails.
* No changes to iframe loading or DOM persistence.

---

## What a Bounded Worker Can Safely Implement

A bounded worker can implement this in a single small PR:
1. Add `.resizer-junc` and `.resizer-junc::after` CSS rules in `index3.html`.
2. Add combined drag logic (`_startCombinedResizeDrag`) and junction injection in `_injectResizers` in `js/triple-mode.js`.
3. Add 4 test assertions in `test/boot-smoke.test.js`.

---

## Recommended Next Step

> **SAFE FOR BOUNDED WORKER IMPLEMENTATION**
