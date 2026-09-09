# Bottom Shell B.1 Polish + Nested Runtime Activation Repair — implementation

**Calgary time:** 2026-09-08 20:00 MDT
**Branch:** `main` @ `2bf92d7` + uncommitted working tree
**Git:** no commit, no push (per restriction)

---

## 1. Preserved working-tree state

`git status`/`git diff` at the start of this task showed the working tree already
contained, uncommitted:

- Layer 2 Identity repair
- Nested Runtime Launch Handoff
- Bottom Runtime Shell **Stage A** (shell geometry, Dock reserve, z-scale)
- Bottom Runtime Shell **Stage B** (Master Redo, Grid layout shortcut preferences,
  layout/general overflow gateways, Folder demotion)
- The prior report-pruning deletions (6 absorbed Part-1 reports)

All of it was left exactly as found. Nothing was reset, discarded, or reintroduced
independently. This task's own edits are additive on top of that tree, listed in §2/§9
below. `js/grid-layouts.js` was already present (untracked, from Stage B) and is extended,
not replaced.

---

## 2. B.1 files changed

- `js/grid-layouts.js` — registry gained `cells` per layout and a new
  `getLayoutIconMarkup(id)` export.
- `js/hotswap-chrome.js` — `MAX_GRID_LAYOUT_SHORTCUTS`: `3` → `4`.
- `js/triple-mode.js` — visible shortcuts and the gateway's overflow-active icon now
  render the shared mini-floorplan markup instead of the abstract `▦/▤/▥` glyph; the
  outside-click dismissal for the layout and general overflow gateways now tests
  `.contains(event.target)` instead of `event.target !== btn` (see §5).
- `settings.html` — added the `4` slot-count button and updated the section subtitle to
  "Choose 1–4".
- `test/positions-history.test.js` — 2 new unit tests (clamp/reconcile, icon markup).
- `test/boot-smoke.test.js` — 2 new browser tests (1–4 range + readable icons + gateway
  adjacency; "no Hearts implemented yet"), plus updated the existing Settings count
  assertion `3` → `4` and annotated the pre-existing layout test as the regression lock
  for the click-target fix.
- `Docs ANCHOR/000-INVARIANTS.md`, `001-PHILOSOPHY.md`, `999-NEXT.md`,
  `Docs REPORT/Tests/TESTING.md` — breadcrumbs (§7).

---

## 3. Layout count 1–4 implementation

`MAX_GRID_LAYOUT_SHORTCUTS` raised from 3 to 4 in `hotswap-chrome.js`. Both
`getGridLayoutShortcutCount()`'s clamp and `setGridLayoutShortcutCount()`'s clamp read
this one constant, so nothing else needed updating for the ceiling itself. The **default
stays 2** — it's a separate literal (`: 2` in the fallback branch), untouched.

Settings (`settings.html`) gained a fourth `data-count="4"` button inside
`#grid-layout-count-row`, which already used `.slot-count-grid`'s default 4-column grid —
so the new button lands in the same single row with no CSS change. The existing generic
`_wireCollection()` machinery in `settings.js` needed no changes at all; it already reads
count/order through the passed-in getters/setters.

Verified live: `setGridLayoutShortcutCount(99)` clamps to 4, `setGridLayoutShortcutCount(0)`
clamps to 1, and a 4-shortcut configuration renders exactly 4 buttons plus the gateway.

---

## 4. Legacy/readable icon restoration

**Root cause of the "abstract stripes" complaint:** Stage B's `_renderLayoutShortcuts()`
used `GRID_LAYOUTS[i].icon` — a single Unicode glyph (`▦`/`▤`/`▥`) shared across multiple,
visually-unrelated layouts (e.g. `top2`, `bottom2`, and `4grid` all used `▦`). The
**permanent overflow-menu buttons** in `index3.html`, meanwhile, had always used the
older, correct grammar: `<span class="layout-icon li-<id>">` + one `<i>` per mini-panel,
laid out via `grid-template-areas` matching the actual arrangement — exactly what B.1.2
asked to restore.

Rather than a third icon system, `js/grid-layouts.js` now derives that exact markup from
one place:

```js
export function getLayoutIconMarkup(id) {
    const definition = GRID_LAYOUTS.find((layout) => layout.id === id);
    if (!definition) return '';
    return `<span class="layout-icon li-${definition.id}">${'<i></i>'.repeat(definition.cells)}</span>`;
}
```

`cells` (3 for top2/bottom2/3col/lefttall/righttall, 2 for vsplit/hsplit, 4 for 4grid)
matches the cell count each `.li-<id>` CSS grid already declares — verified by a unit
test that counts `<i></i>` occurrences against `definition.cells` for all eight. No emoji,
no text labels — only the existing grid-drawn floorplan grammar, reused verbatim by both
the visible shortcuts and the gateway's overflow-active state.

**Visual confirmation** (screenshot, `lefttall`/`3col`/`vsplit`/`4grid` configured as the
four visible shortcuts, active = `lefttall`):

Each shortcut reads immediately as its actual arrangement — one tall left panel with two
stacked right panels, three vertical columns, two side-by-side panels, a 2×2 grid — and
the gateway (last icon) is visually distinct: a small dot-grid "more" mark, never
mistaken for a fifth floorplan. Active state (blue highlight + `.layout-icon i` recolor)
is unchanged from before.

---

## 5. Layout gateway placement — and the real bug this surfaced

**B.1.3/B.1.4 were already satisfied by Stage B's markup and CSS** — verified, not
changed:

- DOM order inside `.master-contextual`: `#master-layout-shortcuts` →
  `#btn-master-layout-overflow` (gateway) → `#master-layer-selector` →
  `#btn-master-overflow` (general). The gateway is the layout shortcuts' immediate DOM
  sibling, never adjacent to Settings/Dock/general overflow.
- `.master-contextual { flex: 0 1 auto; justify-content: flex-end; margin-left: auto; }`
  already right-anchors the whole cluster against the reserved Dock padding — satisfying
  "keep the layout cluster toward the right, near the Orchestration Dock."

No code change was needed for placement itself. **But raising the count to 4 and
restoring the readable gateway icon exposed a genuine, pre-existing bug** while writing
the B.1 regression tests: the pre-existing "Stage B Grid layout shortcuts stay ordered,
configurable, and complete" test started failing under my icon change, with the layout
overflow menu never opening under a real Playwright click.

**Root cause, isolated by a controlled revert** (confirmed the *original* Stage B code —
`gateway.textContent = <plain glyph>` — passed; only my `.innerHTML` change with a nested
`<span>` broke it):

```js
document.addEventListener('click', (event) => {
    if (layoutMenuEl?.classList.contains('open') && !layoutMenuEl.contains(event.target)
        && event.target !== layoutOverflowBtn) layoutMenuEl.classList.remove('open');
    ...
```

When the gateway shows the active-overflow layout's own floorplan (my B.1.2 change), its
content is a nested `<span>`/`<i>` element tree. A real click lands on that child, so
`event.target` is the `<span>`, never the `layoutOverflowBtn` reference — `!==` is
therefore always true, and the outside-click handler closes the menu on the **same
click** that just opened it. A synthetic `element.click()` call never exposes this (it
sets `target` to the element you called it on), which is why this was invisible until a
real-click-driven regression test hit it.

**Fix** (in `triple-mode.js`, both gateways for consistency and future-proofing):

```js
if (layoutMenuEl?.classList.contains('open') && !layoutMenuEl.contains(event.target)
    && !layoutOverflowBtn.contains(event.target)) layoutMenuEl.classList.remove('open');
```

This is now the pre-existing test's regression lock (annotated in-line) plus a durable
invariant in `000-INVARIANTS.md` (§7): any Chrome control whose content can become a
nested icon element must test `.contains()`, never `!==`.

---

## 6. Master Bar geometry / Solo / Hearts checks

- **Stage A Dock-collision tests**: reran the full `Bottom Runtime Shell Stage A…` suite
  — passes unchanged (9 widths, closed/open, dynamic reserve, dropup anchoring, z-scale).
- **Solo unaffected**: `index2.html`/`js/single-mode.js` were not touched this session.
  "Stage B Settings exposes… Solo keeps its own vocabulary" (asserts Solo has an
  Orchestration Dock, a structural `#btn-folder`, and **no** layout gateway) still passes.
- **No Hearts implemented**: new test scans the whole live DOM for any
  `heart|favorite.?current|bg-gallery` id/class fragment — none exist.

---

## 7. Future breadcrumbs (B.1.6–B.1.9, and the Conductor principle)

Added to **`001-PHILOSOPHY.md`** — a new "§ The Conductor" section stating the durable
product model verbatim from the brief: Panels are the talent, the bottom Runtime shell is
the conductor; mouse and keyboard are two invocation surfaces for the same semantic
action, never separate implementations.

Extended **`999-NEXT.md`**'s existing "Future Browser Gallery Dock contract" with:

- the approved permanent physical order —
  `[visible layouts] [layout gateway] | [dynamic Hearts] [🎬] [⚙]` — and that Stage A's
  measured reserve already needs no new geometry to accommodate it, only population;
- that only recognized live instances get a control (no reserved invisible slots — B.1.9);
- the keyboard-shortcut contract: mouse-click and configured-shortcut both dispatch the
  same `FAVORITE_CURRENT` semantic action targeting the live instance whose host Panel is
  currently at that Heart's Position; bindings are not yet decided (B.1.8).

`P1`–`P4` Position-shorthand terminology (B.1.7) was **already** durably recorded in
`006-TERMINOLOGY.md`/`007-PANEL-IDENTITY.md` by the prior Stage B pass — verified present,
not duplicated.

---

## 8. B.2 — exact nested launch root cause

### 8.1 What I actually did before touching any code

Read the architecture report, the Stage A/B and Nested Launch Handoff implementation
reports, and the relevant anchors, confirming the current code already:

- resolves the launch request's target Panel from `event.source` (sender-frame identity)
  alone — `_handleRuntimeLaunchRequest` in `triple-mode.js` never reads
  `_masterLayerScope` or any selector state;
- treats `'live'` as a first-class workspace identity in `_normalizeLaunchWorkspace`;
- declares Layer 2 only after the parent performs the assignment (`getPanelRuntimeLayer`
  reads Runtime Session Panel metadata, never DOM/URL resemblance).

So before assuming a defect, I traced the reported symptom **mechanically**, live, against
this exact working tree.

### 8.2 Mechanical trace performed

Using Playwright against a local server, driving the *real* interaction path (not the
test helpers' shortcuts) end to end — 🚀 in a panel → nested `index.html` boots → select
a Workspace or leave Live Builder → click Launch Grid — I ran:

1. **Baseline, synthetic clicks**: full round trip via `.click()` on the real DOM
   elements — succeeded, message received, Panel reassigned, Runtime metadata declared,
   zero console/page errors, doubly-nested Grid boots and renders 4 panels correctly.
2. **Real mouse clicks at true viewport coordinates**, computed by adding each panel
   iframe's actual offset to the nested document's local element rect (the only way to
   faithfully simulate what a literal mouse click would hit, since a same-frame
   `element.click()` bypasses all hit-testing) — across **8 layouts × up to 4 slots**,
   with the outer Master Bar both **open and closed**: `lefttall` (slots 0–2), `4grid`
   (slots 0–3, with and without master open), `bottom2`, `top2`, `righttall`, `vsplit`,
   `hsplit`. In every case: the button's true-viewport point resolved to the panel's own
   `<iframe>` (never occluded by the outer Dock or Master Bar), the click succeeded, and
   the message + reassignment completed.
3. **Occlusion hypotheses tested directly**: computed the Orchestration Dock's and open
   Master Bar's true-viewport rects and checked whether `#btn-launch-grid`'s true
   position ever fell inside either — it never did, at any layout/slot/width combination
   tried (1280–1920px).
4. **GitHub-sync race hypothesis**: `presets.json` has exactly 9 presets (ids 1–9);
   `ensureMinimumPresetCount` guarantees ids 1–9 exist in `getPresets()` synchronously
   even before any remote fetch resolves, and the parent's own boot already
   `await`s `loadPresetsSilently()` before its panels render — so `_normalizeLaunchWorkspace`
   cannot be starved by sync timing for any workspace id that exists in this repo's data.
5. **Full B.2 test matrix (A–I from the brief)** executed live before writing any
   assertions: two saved Workspaces, Live Builder, the Master selector explicitly set to
   L1 across the launch, the activation boundary from both sides, exact parent-source
   truth, sibling preservation, and the existing security negatives — all passed.

### 8.3 Finding

**I could not reproduce "Launch Grid does nothing" anywhere in the current working
tree.** Every mechanism the brief asks me to verify (activation boundary, L1/L2
independence, saved-Workspace and Live-Builder launch, security contract) was already
correctly implemented and is now covered by an explicit, passing regression test (§8.5).

This is reported as fact, not assumption, per the brief's own instruction: I am not
claiming the human's observation was mistaken — only that the mechanical trace performed
here, across a wide and realistic interaction space, found the current tree's launch
mechanism sound. Two honest possibilities remain open, neither fixable from inside the
app: (a) the observation predates the Nested Runtime Launch Handoff / Stage B work
landing in the working tree, or (b) an environment factor outside this repo's control
(browser extension, a dev-server header, a stale cached module) is involved. Both are
outside what static/mechanical tracing inside this repo can settle further.

### 8.4 A real, adjacent defect found and fixed instead

The mechanical trace's real yield was §5's click-target bug — a genuine, reproducible,
now-fixed defect in the *same family* of symptom ("a real click silently does nothing, no
error, only a synthetic click succeeds"), just in the layout gateway rather than Launch
Grid. `#btn-launch-grid` itself has plain-text content (no nested icon element), so this
exact bug class does **not** apply to it — checked directly.

### 8.5 Hardening added regardless

Given the failure mode's shape ("nothing happens, no visible error"), `app.js`'s Launch
Grid handler now wraps its **local** bookkeeping (`saveInputsToState`,
`flushPendingWorkspaceSync`) in a `try/catch` that logs and continues rather than letting
a local-save failure silently swallow the actual navigation/launch intent below it. This
is defense-in-depth, not a claimed fix for an unreproduced defect — stated as such in the
code comment and here.

---

## 9. Activation-boundary implementation

No architectural change was required — the boundary the brief describes was already the
implemented behavior from the Layer 2 Identity + Nested Launch Handoff work:

- **Before launch**: a Panel holding only `index.html` (Design-Time) is `role:
  'design-time'` in the executor registry; `getPanelRuntimeLayer()` returns `null` for it;
  both Master and panel Layer selectors stay hidden. Verified live:
  `readLayerTruth(page).masterHidden === true` immediately after 🚀, before any launch.
- **After launch**: the parent assigns `index3.html?workspace=<id>` through the existing
  checkpoint + `onPanelContentChanged` + rendered-panel path, which runs
  `createAssignedUrlPanel()` → `classifyRuntimeExecutorUrl()` → `markPanelRuntime()`,
  declaring `{ layer: 2, kind: 'grid' }` on that Panel. Only then does the selector
  become available. Verified live and by the new test in §9.1.

I made this explicit in durable prose (`011-HOTSWAP-CHROME.md` § *The selector has no
jurisdiction over launch*) rather than leaving it implicit in the code's behavior alone.

### 9.1 New test coverage (B.2 matrix)

`nested Design-Time Grid launch does not depend on the Master [L2][L1] selector, and Live
Builder is a valid source` (`test/boot-smoke.test.js`), covering the matrix items the
existing test didn't already prove:

- **C — Live Builder**: no workspace tab clicked (nested page's own default); Launch Grid
  produces `index3.html?workspace=live` with `{ layer: 2, kind: 'grid' }` declared.
- **F — activation boundary, both directions**: `masterHidden === true` before any
  launch; `false` immediately after the first one.
- **D/E — selector independence**: after the first launch makes the Master selector
  exist, it is explicitly clicked to **L1** — then a **second**, independent nested
  Design-Time Panel is launched from a **saved Workspace** (Preset 3). It succeeds
  identically; the selector is asserted to still read L1 afterward (never rewritten by
  the launch).
- **H — sibling preservation**: the third, ordinary panel is asserted untouched.
- **A/B/G/I** were already covered by the pre-existing `nested Design-Time Grid launch
  hands intent to the parent Session` test (two saved Workspaces, exact parent source,
  and the untrusted-origin/malformed/unrelated-frame security negatives) — left as-is.

Both tests pass; ran together and in the full suite (§11).

---

## 10. Saved Workspace / Live Builder / selector-independence — summary

| Matrix item | Result |
|---|---|
| A. Saved Workspace 2 | ✅ pre-existing test |
| B. Saved Workspace 7 | ✅ pre-existing test |
| C. Live Builder (`workspace=live`) | ✅ new test |
| D. Selector = L1, launch still works | ✅ new test |
| E. Selector = L2 / absent, launch still works | ✅ pre-existing + new test |
| F. Activation boundary (before/after) | ✅ pre-existing + new test (explicit both sides) |
| G. Exact parent source truth | ✅ pre-existing test |
| H. Sibling preservation | ✅ pre-existing (continuity probe) + new test |
| I. Security negatives | ✅ pre-existing test, re-verified unchanged |

---

## 11. Full validation results (brief's order)

1. **B.1 targeted tests** — 2 unit + 2 browser: **4/4 pass**.
2. **Stage A geometry regressions** — `Bottom Runtime Shell Stage A…`: **pass**.
3. **B.2 nested-launch regressions** — both nested-launch browser tests: **2/2 pass**.
4. **Layer 2 identity regressions** — 4 browser + 2 unit (classifier + full round-trip):
   **all pass**.
5. **Runtime Session / history regressions** — full `positions-history.test.js` unit
   suite: **51/51 pass**.
6. **Settings regressions** — Settings/Solo browser tests: **all pass**.
7. **Full `node --test`** (both files): **140 pass / 1 fail out of 141.**
   The sole failure — `Part 1-2 Runway tracks website top and active Runway pickers own
   stable geometry` — reproduces with **byte-identical measured values**
   (`websiteTopOffset: 0, rightInset: 445, inside: false`) to the ones recorded as
   pre-existing and unrelated in **both** the Stage A and Stage B implementation reports.
   Not touched by this task; not caused by it.
8. **`git diff --check`**: clean (exit 0, no output).
9. **`node --check`** on every JS file this task touched: clean.

---

## 12. Anchors updated

- `Docs ANCHOR/000-INVARIANTS.md` — layout shortcut range corrected to 1-4; Grid/Solo
  shared-shell-different-relevance principle; the `.contains()` click-target invariant.
- `Docs ANCHOR/001-PHILOSOPHY.md` — new § *The Conductor*.
- `Docs ANCHOR/011-HOTSWAP-CHROME.md` — new § *The selector has no jurisdiction over
  launch*, cross-referencing `010-PANEL-NAVIGATION.md`.
- `Docs ANCHOR/999-NEXT.md` — Dock physical order, Heart keyboard-shortcut contract,
  and a B.2 breadcrumb recording the mechanical trace's finding and the hardening added.
- `Docs REPORT/Tests/TESTING.md` — §4.9 extended with the nested-launch-handoff and Grid
  layout-shortcut mechanical coverage summaries.

`006-TERMINOLOGY.md`, `007-PANEL-IDENTITY.md`, `004-RUNTIME-SESSION.md`,
`010-PANEL-NAVIGATION.md` already carried the relevant durable truth from the prior
Layer 2 / Nested Launch Handoff / Stage A / Stage B passes (P# terminology, Panel-owned
Layer identity, the handoff-is-parent-owned-assignment distinction) — verified present,
not duplicated.

---

## 13. Reports pruned

None. The 6 reports already deleted by the prior (preserved) working-tree state were left
as they were; no additional pruning was performed this task, per the brief's narrow scope.

---

## 14. Stage C boundaries still outstanding

Untouched, as required:

- No nested Master Bar / Orchestration Dock suppression.
- `html.is-nested #orchestration-dock { right:auto; left:18px }` relocation workaround
  left exactly in place in all three pages.
- No Folder/Layout/parameterized-Save-Session-As Layer-scoped forwarding added.
- No nested status forwarding.
- No `[L2-P#]` addressing.
- No Browser Gallery Hearts, handshake, or `FAVORITE_CURRENT` implementation — only the
  durable contract breadcrumb (§7).
- No permanent Heart keyboard shortcuts assigned.
- Shuffle/Undo/Shuffle All/Redo structural placement unchanged (still far-left).
- No Portrait/Auto orientation work.
- No `index1.html`.
- No top-Chrome hierarchy redesign.
- No Runtime Session rewrite; Panel/Position ownership unchanged.
- **No commit. No push.**

---

## Human test suggestions (only these two)

1. Do the restored mini-layout icons read clearly to you at your normal Master Bar size?
2. Nested Workspace / Live Builder → Launch Grid — does it work for you now, in your real
   browser? (If it still doesn't, the exact browser/OS/interaction sequence would be the
   single most useful thing to capture next, since the mechanical trace above could not
   reproduce a failure from inside this repository.)
