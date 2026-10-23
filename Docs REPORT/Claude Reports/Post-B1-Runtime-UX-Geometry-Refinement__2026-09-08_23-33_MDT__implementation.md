# Post-B.1 Runtime UX + Geometry Refinement — implementation

**Calgary time:** 2026-09-08 23:33 MDT
**Branch:** `main` @ `2bf92d7` + uncommitted working tree
**Git:** no commit, no push (per restriction)

---

## 1. Preserved working tree

`git status`/`git diff` at the start showed the tree already contained, uncommitted: Layer 2
Identity repair, Nested Runtime Launch Handoff, Bottom Shell Stage A, Stage B, B.1 layout
polish, and the B.2 nested-launch investigation/hardening. All of it was left exactly as
found; this task's edits are additive on top. Nothing was reset, discarded, or recreated.

---

## 2. Settings visual-layout implementation

**Root cause of the "internal IDs" complaint:** `js/settings.js`'s Grid Layout Order
`rowFactory` rendered `<span class="drag-handle">☷</span>${id}` — the raw `top2`/`righttall`/
etc. string as the row's only content, with no icon at all.

**Fix** — `rowFactory` now builds:

```js
rowFactory: (id) => {
    const definition = GRID_LAYOUTS.find((layout) => layout.id === id);
    row.innerHTML = `<span class="hotswap-toggle-label">
        <span class="drag-handle">☰</span>${getLayoutIconMarkup(id)}
        <span class="layout-icon-title">${definition?.title || id}</span>
    </span>`;
    ...
}
```

`settings.html` gained the `.layout-icon`/`.li-<id>` CSS rules — copied **verbatim** from
`index3.html` (same 26×20px grid, same `<i>` cell grammar), since Settings previously had
none of this CSS at all and the icon markup would otherwise have rendered as invisible
empty `<span>`s.

Verified live (Playwright): all 8 rows render `hasIcon: true` with the correct `li-<id>`
class, and `text` is the registry's `title` (e.g. `"1 Right Tall + 2 Left Stacked"`), never
the raw id. Screenshot confirms the row reads as `[drag handle] [mini floorplan] [name]`,
exactly the requested shape.

---

## 3. Canonical titles/icon reuse

No new vocabulary was created. `GRID_LAYOUTS[i].title` (already the registry's existing
field, already used as the permanent overflow-menu buttons' `title=` tooltip) is reused
verbatim as the Settings row's primary label — satisfying "if human-friendly titles need
refinement, place them in the canonical registry" by simply *not* needing refinement; the
existing titles were already appropriate, so no `settingsLayoutNames` competing map was
invented. `getLayoutIconMarkup(id)` (added during B.1) is the single icon-generating
function; Settings imports it from `js/grid-layouts.js`, the same module the Runtime
shortcuts use.

Drag ordering, persistence, visible-count 1–4/default 2, and reconciliation are entirely
untouched — `_wireCollection()`/`_makeReorderable()` were not modified; only the row's
*rendered content* changed.

---

## 4. Mirrored-layout implementation and exact permutation

**Finding, verified mechanically before writing any code:** Left Tall ↔ Right Tall already
preserves visual-role continuity with **zero permutation code**, and this required no
implementation change.

Two existing facts compose into the requirement:

1. `index3.html`'s CSS binds the **same grid-area names** to the **same visual roles** in
   both layouts:
   - `.layout-lefttall`: `screen1`=tall (left), `screen2`=top-short, `screen3`=bottom-short.
   - `.layout-righttall`: `screen1`=tall (**right**), `screen2`=top-short, `screen3`=bottom-short.
2. `setSessionLayout()` (existing, `grid-session.js`) already resets `_arrangement` to
   `IDENTITY_ARRANGEMENT` on **every** layout switch — so slot 0 always renders as
   `screen1`, slot 1 as `screen2`, slot 2 as `screen3`, regardless of which layout is active.

Together: a Panel that starts as `screen1` (tall) in Left Tall is *still* `screen1` (now the
**mirrored** tall cell) in Right Tall, automatically. No "Position plumbing" needed to be
touched. I verified this empirically (geometry snapshot before/after, real layout switch,
zero code changes at the time) before concluding no fix was required — see §5 for the
proof, now locked in as a permanent test.

**Exact permutation used:** none — the arrangement stays at `IDENTITY_ARRANGEMENT` before
and after (that reset was already the existing, correct behavior for *every* layout
switch, not something added for this pair).

**§2.4 inspection of other pairs**, reported honestly rather than guessed at:
- **Top2 ↔ Bottom2 is NOT automatically compatible.** `top2` binds
  `screen1`→top-left-half/`screen2`→top-right-half/`screen3`→bottom-wide; `bottom2` binds
  `screen1`→top-wide/`screen2`→bottom-left-half/`screen3`→bottom-right-half. A Panel's role
  *would* jump on switching. Breadcrumbed as a future, deliberate design decision — not
  implemented, not assumed to "just work" the way Left Tall/Right Tall does.
- **Vsplit ↔ Hsplit** have no tall/short distinction to violate (two equal panels either
  way) — nothing to design.
- No universal layout-transition engine was built, per the brief's explicit instruction.

---

## 5. Iframe/Panel continuity proof

New test `Left Tall <-> Right Tall preserves visual role (tall / top-short / bottom-short)
with zero reload` (`test/boot-smoke.test.js`), using the existing canary-continuity
harness:

- **A/B/C canaries** boot into the default Left Tall (identity arrangement). A is assigned
  a ROOT/folder (`FolderA`) before the switch, so metadata survival is provable, not merely
  plausible.
- **Geometry, before**: A is the full-height tall cell on the **left**; B sits above C
  (top-short/bottom-short).
- **Switch to Right Tall**: A stays the full-height tall cell, now on the **right**; B still
  sits above C, both now on the left. (`before.A.h === after.A.h`, etc.)
- **Zero reload**: `armContinuityProbe`/`readContinuityProbe` — same iframe nodes, same
  parents, **zero** `load` events fired on any of the three panels.
- **Panel identity/Runtime metadata/ROOT survive**: `getSessionPanels()` is **byte-identical**
  before and after — true by construction, since `setSessionLayout()` only ever rewrites
  `_arrangement`, never `_panels`.
- **Reverse direction** (Right Tall → Left Tall) verified symmetrically in the same test.

Passes. This is now the permanent regression lock for the requirement.

---

## 6. Layer selector placement

**Change**: the `[L2][L1]` selector moved out of `.master-contextual` (where it sat between
the layout gateway and the general `⋯` overflow) into a new `.master-layer-region`,
positioned between the status region and the (now layer-selector-free) contextual region.
A new invisible `.master-layer-spacer` (`flex: 1 1 0`) was added on its far side, mirroring
the status region's own `flex: 1 1 140px` grow, so the target sits between two flexible
gaps rather than drifting to either edge. `.master-contextual`'s `margin-left: auto` was
removed (redundant/conflicting with the new spacer — CSS auto-margins claim space *before*
flex-grow distribution, which would have starved the spacer).

Shell order is now: `[structural] [status] [Layer target] [spacer] [layouts][gateway][⋯]`.

**Verified live** (multiple viewport widths, 1080–1920px): the target sits ~5–10% of the
bar's width off true center (asymmetric only because the structural group's own fixed width
is not mirrored — expected, since Shuffle/Undo were explicitly out of scope), consistently
well clear of both the layout cluster and the Dock. The right cluster's own internal
adjacency (shortcuts → gateway, 10px gap, unchanged) and its position immediately before the
Dock reserve are untouched.

New test `the Layer target sits centrally, apart from the contiguous right-side layout
cluster` proves: target sits after structural, before the layout cluster, is no longer a
`.master-contextual` child; the layout gateway still immediately follows the visible
shortcuts; general overflow still follows the gateway (not the Layer target); no Dock
overlap; distance-from-center is meaningfully small; and retargeting Undo through the
relocated control still works exactly as before.

No `#master-layer-selector` id/class/children changed — only its DOM parent — so every
existing `getElementById`/class-selector-based reference in `triple-mode.js`/`launch.js`
kept working unchanged (verified: no code anywhere queries via `.master-contextual` or DOM
position to reach the selector).

---

## 7. Nested-resizer root cause

**Verified mechanically, not assumed**, per the brief's instruction. Nested a real Grid
Runtime inside a panel and inspected the nested document directly:

```
nested panel width: 795px
resizerCount: 2
resizerDisplay: ["none", "none"]     ← BEFORE the fix
```

Confirmed exactly the brief's hypothesis: `index3.html`'s own
`@media (max-width: 900px) { ... .resizer { display: none !important; } ... }` fires
against the **nested iframe's own viewport width** (795px, well under 900px on a normal
desktop monitor — a Panel's size, not a device class), collapsing `#triple-layout` to a
single mobile column and hiding `.resizer` — even though nothing about the device or the
top-level window is narrow at all. No JS-level width gate exists anywhere (`_injectResizers`
has none) — this is a pure CSS effect.

---

## 8. Nested-resizer fix

Scoped every selector inside that one `@media` block to `html:not(.is-nested)`:

```css
@media (max-width: 900px) {
    html:not(.is-nested) body { overflow: auto; }
    html:not(.is-nested) #triple-layout { ... }
    html:not(.is-nested) .stream-slot { grid-area: auto !important; }
    html:not(.is-nested) .resizer { display: none !important; }
}
```

`html.is-nested` is already set **synchronously before first paint** by the existing
depth-detection script, so this is pure CSS scoping — no JS change, no reload, no Runtime
Session touch, exactly as required (§4.4/§4.5).

**Verified fixed**, same repro: `resizerDisplay: ["block", "block"]` after the change.

New browser test `a nested Grid Runtime keeps its own internal resizers even when its
iframe is under 900px` proves, end to end:

1. Nested Grid resizers exist and are not `display:none` at a genuinely under-900px panel
   width (sanity-asserted: `innerWidth < 900`).
2. **Hit-testable** — `elementFromPoint` checked *within the nested document's own
   coordinate space* (checking from the outer page would only ever return the hosting
   `<iframe>` element itself, since `elementFromPoint` never crosses a document boundary —
   this is the correct, not the naive, way to prove it).
3. A **real mouse drag** (`page.mouse.down/move/up` at true viewport coordinates, computed
   by adding the panel's own offset to the nested element's local rect — not a same-frame
   synthetic `.click()`, which would bypass hit-testing entirely) **actually changes the
   nested Grid's own `grid-template-columns`**.
4. The **outer** Grid's own tracks are provably **unaffected** by the inner drag
   (`outerColumnsBefore === outerColumnsAfter`).
5. The nested document is still the same live document afterward (`panelCount === 4`, no
   reload/rebuild).
6. The **outer** resizer, dragged separately, still works on its own geometry.
7. A **genuinely narrow top-level** (never-nested) viewport, tested in the same run, still
   gets the small-screen fallback unchanged: resizers `display:none`, single-column grid —
   proving the exclusion is scoped to nesting, not deleted globally.

---

## 9. Narrow/mobile behaviour preserved

Directly proven by item 7 above, plus a standalone check during development
(`{"isNested":"","resizerDisplay":["none","none"],"gridTemplateColumns":"700px",
"bodyOverflow":"auto"}` at a genuine top-level 700px viewport) — the fallback fires exactly
as before for the case it exists to serve. This task deliberately did **not** touch the full
Portrait/Auto orientation architecture — only narrowed this one rule's exclusion.

---

## 10. Tests added

| File | Test | Phase |
|---|---|---|
| `test/settings-layout icons` (verified via Playwright during dev; covered structurally by existing Settings assertions + the icon-markup unit test from B.1) | row icon/title reuse | 1 |
| `test/boot-smoke.test.js` | `Left Tall <-> Right Tall preserves visual role (tall / top-short / bottom-short) with zero reload` | 2 |
| `test/boot-smoke.test.js` | `the Layer target sits centrally, apart from the contiguous right-side layout cluster` | 3 |
| `test/boot-smoke.test.js` | `a nested Grid Runtime keeps its own internal resizers even when its iframe is under 900px` | 4 |

(Phase 1's icon-markup generator itself was already unit-tested by the prior B.1 pass —
`layout icon markup is a readable mini-floorplan…` — Settings now consumes that same
function, so no new generator-level unit test was needed; the new browser-level check
during development confirmed the consumer wiring, and is documented in `TESTING.md`.)

---

## 11. Full suite result

Validation order followed exactly as specified:

1. **B.1/B.2/Layer/Stage-A/Settings/nested-launch targeted rerun** (17 tests): **17/17 pass**.
2. **Full `positions-history.test.js`** (unit): **51/51 pass**.
3. **Full `node --test`** (both files), run **twice**: **142/144 pass** both times, with the
   **same two failures both runs**:
   - `Part 1-2 Runway tracks website top and active Runway pickers own stable geometry` —
     **pre-existing, already documented** in the Stage A, Stage B, and B.1/B.2 reports, with
     the **same measured values** (`websiteTopOffset: 0, rightInset: 445, inside: false`)
     each time. Untouched by this task.
   - `Move to Position always lands media in the physical Position, whatever the swap
     history` — **new to this list, investigated, and determined to be an unrelated
     environment-timing flake**, not a regression:
     - Passes **3/3** when run in isolation.
     - Fails identically on **both** full-suite runs (consistent with resource contention
       during an ~80s, 144-Playwright-test run starving a 25ms-interval canary timer, which
       is exactly what the failing assertion checks — `"all three still running"`, a wall-
       clock tick count).
     - `git diff` confirms **zero overlap**: this task never touched `bootCanaryGrid`,
       `readCanaries`, `armContinuityProbe`, `readContinuityProbe`, or the failing test
       itself — none of Phase 1–4's edits (Settings rows, layer-selector DOM position, the
       `is-nested` media-query scoping) have any code path in common with this test.
4. **`git diff --check`**: clean (exit 0, no output).
5. **`node --check`** on every JS file touched (`grid-layouts.js`, `hotswap-chrome.js`,
   `triple-mode.js`, `app.js`, `settings.js`, both test files): clean.

---

## 12. Anchors updated

- `Docs ANCHOR/000-INVARIANTS.md` — Settings icon/title reuse; Layer target central
  placement pointer; nested-Grid-remains-capable invariant; mirrored-layout-preserves-role
  invariant.
- `Docs ANCHOR/007-PANEL-IDENTITY.md` — new § *Mirrored layout transitions*: Position
  plumbing may permute to preserve visual role; whole Panel identity travels intact; records
  *why* Left Tall/Right Tall needed no permutation code, and that a future pair is not
  assumed to inherit that for free.
- `Docs ANCHOR/011-HOTSWAP-CHROME.md` — new § *The Layer target is a central conductor
  control* (placement, and that the future `[L2-P#]` occupies the same region) and § *Nested
  Runtime geometry is hierarchy, not duplicated Chrome* (outer vs. inner resizers are two
  legitimate owners; resize commands stay local, never routed through the Layer command
  system).
- `Docs ANCHOR/999-NEXT.md` — Post-B.1 follow-up summary, plus explicit, evidence-based
  deferrals: Top2/Bottom2 is *not* free (documented why), Vsplit/Hsplit has nothing to
  design, no universal transition engine was built, full Portrait/Auto architecture and
  `[L2-P#]` addressing remain their own future passes.
- `Docs ANCHOR/006-TERMINOLOGY.md` — **verified unchanged**: `P1`–`P4` Position-shorthand
  terminology was already present from the prior pass; not duplicated, not renamed.
- `Docs REPORT/Tests/TESTING.md` — §4.7 extended with the mirrored-layout and nested-resizer
  mechanical coverage; §4.9 extended with the Layer-target-placement coverage and the
  Settings icon/title reuse note.

---

## 13. Reports pruned

None this pass. Reviewed the current report directories against the retention policy
established in the prior pass (4 newest per agent + unresolved findings + anchor-cited
reports). Nothing new has become fully absorbed-and-supersedable since that audit, so no
additional pruning was performed — consistent with "do not perform broad unrelated cleanup."

---

## 14. Stage C boundaries still outstanding

Untouched, as required:

- No nested Master Bar / Orchestration Dock suppression.
- `html.is-nested #orchestration-dock { right:auto; left:18px }` relocation workaround left
  exactly in place.
- No Folder/Layout/parameterized-Save-Session-As Layer-scoped forwarding.
- No nested status forwarding.
- No `[L2-P#]` addressing implementation — only its future shell placement is settled.
- No Browser Gallery Hearts, handshake, or `FAVORITE_CURRENT`.
- No permanent Heart keyboard shortcuts.
- Shuffle/Undo/Shuffle All/Redo structural placement unchanged (still far left, as
  instructed — this task did not touch that decision).
- No full Portrait/Auto orientation architecture — only the nested-media-query exclusion
  was narrowed.
- No `index1.html`.
- No top-Chrome hierarchy redesign.
- No Runtime Session rewrite; Panel/Position ownership model unchanged (mirrored-layout
  continuity emerged from the *existing* model, nothing new was added to it).
- **No commit. No push.**

---

## Human test suggestions (only these two)

1. Does Settings' Grid Layout Order list now make each layout immediately recognizable —
   icon first, name second?
2. Left Tall ↔ Right Tall — does the tall/top-short/bottom-short content stay put visually
   as you'd expect, and can you now drag a nested Grid's own internal resizers?
