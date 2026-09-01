# TESTING.md — Verification Guide for Stream Loop Launchpad

Part 1 Hotswap verification proves one Top/Deep order with visibility-before-cutoff, actual-width responsive demotion and widening restoration without preference writes; independent Runway cutoff visualization; anchored picker geometry; one global Hotswap switch right edge within 1px; the structural empty Deep Cuts state; and a 1.75× toolbar-height Runway safe zone. Presentation-only resize, menu, and picker operations retain the same iframe nodes, parents, documents, and `src` values with zero loads.

Part 1-2 additionally measures Runway at website-top + 1.75H in both rail states, proves Runway picker focus cannot reveal Top, waits beyond 850ms to prove picker ownership, checks URL focus/caret/tail scrolling, and verifies persistent major-card collapse plus the single Settings-owned Ingest and Blacklist implementations.

Part 1-3 established Runway-attached picker geometry. It also proves Position-left/actions-right toolbar grouping without preference writes, a common Hotswap switch axis with one 12px trailing inset, and title-left/caret-right major headings whose full row and keyboard behavior remain active.

Part 1-4 supersedes only the picker-location portion of Part 1-3: Top, Runway, and Deep Cuts now resolve Edit URL and Assign Folder to one compact website-top-right dock (measured 8px top / 12px right in the bordered panel). Tests normalize against `--hotswap-website-inset`, prove Runway invocation leaves Top closed, exercise document click-away and non-intercepting iframe-focus dismissal, retain timer/focus/caret/continuity checks, and prove the same Shuffle All handler renders horizontal dice in Top but vertical dice inside the unchanged 30×30 Runway button.

Part 1-5 tightens only the two existing Runway Shuffle All spans: their measured line boxes overlap by 2px on an upper-left to lower-right diagonal. Focused coverage keeps Top horizontal, proves two distinct glyph nodes, the unchanged 30×30 button and 6px neighbour spacing, and exact forwarding from both surfaces to the same canonical action.

**Audience:** an AI coding agent (Claude Code, Codex, Antigravity, etc.) with shell access to this repo.

**Prime directive:** *Prove it, don't eyeball it.* Do not ask the human to manually verify
anything you can demonstrate programmatically. Most behaviors in this app that feel like they
need human eyes — "does the video keep playing," "did the panel reload," "did the preset get
overwritten" — are directly observable via DOM inspection, event counting, and storage
snapshots. Section 6 lists the genuinely-human-only items; it is deliberately short, and you
should try hard to shrink it further rather than grow it.

**Context:** this repo just completed a multi-week architectural refactor ("Phase 4D — Runtime
Session Ownership"). Much of the code is shaped by deliberate, hard-won decisions that look
like bugs if you don't know the history. Section 7 lists those explicitly. **Read Section 7
before reporting anything as a defect.**

---

## 0. Environment setup

This is a dependency-free vanilla-JS app served as static files. It uses ES modules
(`<script type="module">`), which means:

- **`file://` will not work.** Module loading requires a real HTTP origin. Serve the repo:
  ```bash
  npx serve -l 8080 .        # or: python3 -m http.server 8080
  ```
- For DOM/browser tests, install throwaway dev tooling (do not commit these to
  `package.json` unless the human asks):
  ```bash
  npm i -D playwright && npx playwright install chromium
  npm i -D jsdom
  ```
- Node 18+ assumed (for native `fetch` mocking in unit harnesses).

If any of the above cannot be installed in your environment, say so explicitly and fall back
to the tiers you *can* run — do not silently skip a tier.

---

## 1. Tier 0 — Static analysis (fast, run first, always)

### 1.1 Syntax validation
```bash
find . -name "*.js" -not -path "./node_modules/*" -print0 \
  | xargs -0 -I{} sh -c 'node --check "{}" || echo "FAIL: {}"'
```
Report every failure with file, line, and ±5 lines of context.

### 1.2 JSON validation
```bash
for f in $(find . -name "*.json" -not -path "./node_modules/*"); do
  python3 -c "import json,sys; json.load(open('$f'))" || echo "INVALID: $f"
done
```
`links.json` and `presets.json` are load-bearing data files — malformed JSON breaks the app
silently at fetch/decode time, not at load time.

### 1.3 Import/export contract audit
For every `js/*.js`, extract each named import and confirm a matching named export exists in
the target module. Report mismatches by name **and by arity** (a function imported and called
with 3 args that only accepts 2 is a real defect even though it won't throw).

Pay special attention to these cross-module contracts, which are the seams the refactor
touched:

| Consumer | Provider | Contract |
|---|---|---|
| `triple-mode.js` | `grid-session.js` | `initGridSession(defaultLayout)` returns `{urls, folderMap, layout}`; `undoGridSession()` / `undoPanelHistory(n)` / `redoPanelHistory(n)` all return the same `{urls, folderMap, arrangement, changedUrlIndices, changedFolderIndices, arrangementChanged}` descriptor, or `null`; `canUndoGridSession`/`canUndoPanelHistory`/`canRedoPanelHistory`/`beginGridAction`/`getSessionArrangement`/`setSessionArrangement`/`setSessionLayout`/`pushGridSessionCheckpoint`/`updateGridSession`/`setGridSessionSilently`/`getGridHistory` all exist |
| `triple-mode.js` / `grid-session.js` | `positions.js` | `getLayoutSlotOrder`, `getPositionAreas`, `listPositions`, `resolvePositionOfSlot`, `resolveSlotAtPosition`, `IDENTITY_ARRANGEMENT`, `LAYOUT_POSITION_ORDER` |
| `launch.js` | `triple-mode.js`'s `ctx` object | `ctx.onPanelContentChanged(index, url, folder)`, `ctx.onPanelRemoved(index)`, `ctx.pushUndoCheckpoint()`, `ctx.getPositionOptions(index)`, `ctx.moveToPosition(index, position)`, `ctx.copyUrlToPosition(index, position)`, `ctx.getPanelHistory(index)`, `ctx.undoPanel(index)`, `ctx.redoPanel(index)`. Each group is optional — a host page that omits it gets those buttons hidden |
| `triple-mode.js` | `launch.js` | `buildStreamPanel`, `updateRenderedPanel`, `updatePanelHistoryButtons`, `navigatePanelTo`, `HOTSWAP_ACTIONS` |
| `launch.js` / `settings.js` | `hotswap-chrome.js` | `SURFACES`, `isEligibleFor`, `getEligibleActions`, `MAX_TOP_SHORTCUTS`, `getHotswapTrayOrder`, `setHotswapTrayOrder`, `getOrderedHotswapActions`, `getActiveQuickActions`, `getQuickActionOrder`, `setQuickActionOrder`, `getQuickActionCount`, `setQuickActionCount`, `isQuickActionRunwayEnabled`, `setQuickActionRunwayEnabled`, `getChromeOpacity`, `setChromeOpacity`, `isLayerTwoUrl`, `LAYER_1`, `LAYER_2`, `MAX_QUICK_ACTIONS` |
| `triple-mode.js` | `launch.js` (Chrome) | `updatePanelToolbar`, `refreshPanelLayerScope`, `LAYER_MESSAGE_SOURCE`, `LAYER_SCOPED_ACTIONS` |
| `launch.js` / `triple-mode.js` | `panel-navigation.js` | `beginPanelContent`, `notePanelLoad`, `canNavigateBack`, `canNavigateForward`, `navigateBack`, `navigateForward`, `resetPanelNavigation`, `getPanelNavigationState` |
| `grid-session.js` / `workspace.js` | `presets.js` | `getPresetById`, `getPresetPanels`, `saveWorkspaceToPreset`, `getPresets`, `getPresetSummary` |
| `presets.js` / `state.js` | `panels.js` | `normalizePanelsArray`, `isEmptyPanel`, `getUrlPanelSource` |
| `workspace.js` / `grid-session.js` | `undo-stack.js` | `createUndoStack(maxSize)` → `{push, pop, peek, canPop, clear, size}` |

**Note:** `launch.js`'s ctx capabilities are *optional by design* — it checks
`typeof ctx.X === 'function'` before calling, because `index.html` deliberately does not
provide them. An absent capability on `index.html` is correct, not a bug.

### 1.4 HTML integrity
For `index.html`, `index2.html`, `index3.html`, `settings.html`:
- Every `<script type="module" src="...">` resolves to a real file on disk.
- Tag balance: counts of `<div>`/`</div>`, `<button>`/`</button>`, `<style>`/`</style>`,
  `<script>`/`</script>` match. (Beware false positives: these files contain tag names inside
  JS strings and CSS comments. Parse, or at minimum discount matches inside comments/strings.)
- **ID reachability:** every `document.getElementById('X')` / `querySelector('#X')` in the JS
  loaded by that page corresponds to an element that exists in that page's markup. This class
  of bug is silent (`null` → handler never wired → button does nothing) and has bitten this
  project before.

### 1.5 CSS class reachability
`launch.js` generates panel overlay markup at runtime. Confirm every class it emits has a
matching CSS rule in *both* `index.html` and `index3.html` (they maintain parallel copies):
`hotswap-overlay`, `hotswap-trigger`, `hotswap-shortcut-row`, `hotswap-shortcut-btn`,
`btn-hotswap-toggle`, `btn-hotswap-star`, `btn-hotswap-reload`, `btn-hotswap-shuffle`,
`btn-hotswap-shuffle-all`, `btn-hotswap-delete`, `btn-hotswap-kill`, `btn-purge`,
`btn-hotswap-position`, `btn-hotswap-folder`, `btn-hotswap-launchpad`,
`hotswap-position-row`, `hotswap-folder-row`, `hotswap-url-row`.

Also confirm the layer/ghost hooks exist: `html.is-nested`, `html.layer-2`,
`html.ghost-trigger`, `html.ghost-master`, `html.ghost-stream`, `html.ghost-solo`, and the
`--ghost-opacity` custom property.

### 1.6 Repo hygiene
Flag (do not delete without approval):
- Known legacy debris: `1.html`, `content.js`, `extension/`, `test*.js`
- Duplicate data files — `links.json` / `presets.json` existing in **both** repo root and
  `js/`. Only the root copies are live (`sync.js` fetches from repo root). A stale duplicate
  under `js/` is a real confusion hazard.
- Any `.js` file in `js/` that is imported by nothing and imports nothing (orphan).
- Committed secrets: grep for `ghp_`, `github_pat_`, `Authorization:` with a literal token.
  **This is a blocking finding if present.**

---

## 2. Tier 1 — Pure unit tests (no DOM, no browser)

These modules are pure or near-pure and should be tested directly with a Node harness. Write
these to `/tmp` (not into the repo) unless the human asks for a permanent test suite.

### 2.1 `panels.js` — normalization is the backward-compatibility keystone
Every saved preset predating Phase 4A stores plain URL strings. If normalization regresses,
all historical user data breaks.

Assert:
- `normalizePanel('https://x')` → `{type:'url', source:'https://x', options:{}}`
- `normalizePanel({type:'url', source:'https://x'})` → returned unchanged in shape
- `normalizePanel(null)` / `normalizePanel(undefined)` → empty url-panel, does not throw
- `normalizePanel('')` → url-panel with empty source, `isEmptyPanel()` true
- `normalizePanelsArray(['a', {type:'url',source:'b'}, null])` → 3 valid panels (mixed
  legacy/modern array — this exact shape will occur in real data)
- `normalizePanelsArray(undefined)` → `[]`, does not throw
- `createWorkspacePanel(2)` → `{type:'workspace', source:2, options:{layer:2}}`
- `isEmptyPanel({type:'workspace', source:2})` → **false** (a workspace panel with a valid id
  is not empty; only a null/undefined source is)
- `getUrlPanelSource(workspacePanel)` → `''` (degrades gracefully, does not throw)
- Mutation safety: `normalizePanel(obj)` must not return a reference that lets a caller mutate
  the original's `options`.

### 2.2 `undo-stack.js`
Now used by `workspace.js` only — `grid-session.js` moved to the canonical action history
(see 2.4), which is not a plain snapshot stack.
- `push` past `maxSize` drops the *oldest* entry, not the newest (`size` caps, `peek` returns
  most recent)
- `pop` on empty returns `null`, does not throw
- `canPop()` false on empty, true after one push
- `clear()` resets `size` to 0
- Stack holds references as given — confirm callers are responsible for cloning
  (`workspace.js` does). Verify those clones are real: mutating the live editing surface
  after a checkpoint must not corrupt the snapshot.

### 2.2c `panel-navigation.js`
The second history — browsing inside a panel's content. Pure model tests live in
`test/positions-history.test.js`; drive it by calling `notePanelLoad()` directly:
- The generation **anchor** (the URL GS3 assigned) is always known, and a redirected
  assignment re-anchors on where it landed — but a later traversal must never rewrite it,
  and ⟳ Reload must anchor on the URL rather than its `about:blank` hop
- A GS3 assignment opens a generation and its own load is **not** recorded as navigation
  (`entries.length === 1`, `pendingLoads` back to 0) — otherwise one action would undo twice
- Content loads push entries; back/forward move the cursor without re-recording
- A new navigation truncates the forward path (Redo cannot resurrect an abandoned branch)
- An unreadable navigation records `{url: null, opaque: true}` — never a guess, never dropped
- Back from an opaque entry collapses to the nearest entry with a real URL, discards the
  opaque ones (they are unreachable, so they must not linger as Redo targets), and does
  **not** fall through to the action history
- ⟳ Reload collapses to the assigned source and records neither of its two loads
- State is per panel and never leaks across panels

### 2.2b `positions.js`
The only definition of Position geometry in the app. See 4.12 — the pure half of that
section (the per-layout Position→grid-area table, contiguous numbering, and
`resolvePositionOfSlot`/`resolveSlotAtPosition` round-tripping through a scrambled
arrangement) is a Tier 1 test and lives in `test/positions-history.test.js`.

### 2.3 `presets.js`
- `createEmptyPreset(3)` → has `layout: null`, `isEmpty: true`, `savedAt: null`, `panels: []`
- `getPresetPanels()` upconverts a **legacy** preset (`{urls: ['a','b']}`, no `panels` key) →
  2 url-panels. **This is the single most important backward-compat test in the file.**
- `getPresetPanels(null)` → `[]`
- `getPresetPanels({panels: [...], urls: [...]})` → prefers `panels`
- `buildPresetFromWorkspace` computes `streamCount` via `isEmptyPanel` (so a workspace-type
  panel counts as a stream; an empty-string url-panel does not)
- `updatePresetInMemory` **preserves an existing `layout`** when `workspaceData.layout` is
  `undefined`, but **honors an explicit `null`**. This guard exists because `index.html`
  auto-saves never pass `layout` and would otherwise wipe a Grid-saved orientation. Test both
  branches.
- `getPresetSummary` on an empty preset → `{isEmpty:true, savedLabel:'Empty'}`
- `formatRelativeTime`: boundaries at <1min ("just now"), <60min, <24h, exactly 1 day
  ("yesterday"), 2–6 days, ≥7 days (falls back to a locale date). Test with fixed timestamps,
  not `Date.now()` deltas, so results are deterministic.

### 2.4 `grid-session.js` (stub `window.location.search` + `localStorage`)
This is the heart of the refactor. Stub minimally:
```js
global.window = { location: { search: '?workspace=2' } };
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
```
Assert:
- `initGridSession('lefttall')` with `?workspace=live` reads from the Store surface;
  with `?workspace=2` reads from `getPresetById(2)`; with **no param at all** falls back to
  `'live'` (protects old bookmarks / direct visits to `index3.html`)
- Returned `layout` precedence: `preset.layout` → `Store('tripleLayout')` → `defaultLayout`
- `setSessionLayout('4grid')` resets `_arrangement` to identity
  (`['screen1','screen2','screen3','screen4']`)
- `setSessionArrangement(['screen2','screen1','screen3','screen4'])` then
  `getSessionArrangement()` returns a **copy** — mutating the returned array must not corrupt
  session state (same for `getSessionFolderMap` and `getSessionUrls`)
- Applied state lives on `slotState[slot]`, not on the action. Assert a single Shuffle
  action can simultaneously hold `{0:'undone', 1:'applied', 2:'invalidated'}`, and that
  `atomic` is `true` for Position actions and `false` for content actions
- **Decoupling:** a bare `updateGridSession(...)` records nothing — history is opened
  explicitly by `beginGridAction()` / `pushGridSessionCheckpoint()` and only becomes an
  action when the mutation that follows commits it. Neither call alone changes
  `canUndoGridSession()`; the pair does. This is the central Phase 4D invariant, restated
  for the action model.
- An opened action whose mutation changed nothing is **never recorded** — no phantom
  history, no button that enables itself for a no-op
- `beginGridAction()` → mutate content → `undoGridSession()` restores content **and**
  arrangement, and reports exactly which slots changed URL, which changed folder, and
  whether the arrangement moved
- `undoGridSession()` with nothing applied → `null`
- `setSessionSource(4)` changes `getSourceWorkspaceInfo()` to `{type:'preset', id:4}` without
  touching panels/folderMap/history
- `initGridSession()` clears the history completely
- `setSessionLayout(...)` invalidates Position actions (Positions are layout-scoped) but
  leaves content actions undoable
- Panel selection: `canUndoPanelHistory(n)` / `canRedoPanelHistory(n)` and their
  `undo`/`redo` counterparts operate on the same one list master Undo reads — see 4.13 for
  the behavioral proofs

### 2.5 `state.js` compatibility view
- `setTargetUrls(['a','b'])` then `getPanels()` → 2 url-panels
- `setPanels([...])` with a workspace-type panel, then `getTargetUrls()` → that index yields
  `''` (documented lossy behavior of the string view — assert it, so a future change that
  silently alters it gets caught)
- `getPanel(i)` / `setPanel(i, panel)` operate on one index without disturbing neighbors

---

## 3. Tier 2 — DOM integration (jsdom or Playwright, no real network)

Mock `fetch` so no GitHub calls occur. Serve locally.

### 3.1 Every page boots without console errors
For each of `index.html`, `index2.html`, `index3.html`, `settings.html`: load, wait for
network idle, assert **zero** `console.error` and zero uncaught exceptions.

> This alone would have caught the `Uncaught SyntaxError: Unexpected identifier 'is'` that
> silently killed every button on `settings.html`. Make this test permanent.

### 3.2 Every interactive control is actually wired
For each page, enumerate every `<button>` and every element with an `id` referenced by JS.
Assert each has at least one listener (`onclick` set, or detectable via
`getEventListeners`-equivalent / a monkey-patched `addEventListener` recorder installed before
module load). Report any control that is present in the DOM but inert.

### 3.3 `settings.html` round-trips
- Toggling each Hotswap Overlay Visibility switch writes the expected key to `localStorage`
- Quick Action slot count 0→3 renders that many pickers; picking an action removes it from the
  tray on the next panel render; the same action can't be selected in two slots
- Ghost Mode opacity slider and number input stay in sync bidirectionally; value clamps to
  0–100; writes `hotswap_ghost_opacity`
- Ghost target toggles write `hotswap_ghost_targets` and the corresponding `html.ghost-*`
  class appears on the relevant page after reload

### 3.4 Workspace Tabs (`index.html`)
- Tabs render: Live Builder + N presets, driven by `presets.js` data (not hardcoded)
- Clicking a preset tab: sets `activeWorkspaceId`, swaps grid content, applies the purple-glow
  active class to exactly one tab
- Switching tabs **clears** undo history (`btn-undo` becomes disabled)
- Edits auto-save locally *immediately* (assert `localStorage` mutation synchronously), while
  the GitHub push is debounced (~1.5s) — assert the mocked push fires **once** after N rapid
  edits, not N times

### 3.4a ★ Builder rehydration (Part 1-6)
`switchWorkspace()` was the only path that copied a Preset's persisted content into the shared
Builder surface, and it only ran when the tab actually changed — so returning to the Builder
with the SAME Preset still active re-rendered whatever `matrixUrls`/`folderMap`/`lockState` the
Store held from before a Runtime launch. Worse: the Builder's own auto-save then mirrored those
stale rows back over the Preset on the very next edit, silently destroying a Runtime save. Full
end-to-end coverage (`boot-smoke.test.js`, against a mocked GitHub backend so persistence
actually round-trips across real page navigations):
- **The reported bug, fixed** — Preset active in the Builder, Launch Grid, edit the Runtime,
  Save Session As back into the SAME Preset, return via a fresh full page load. The Builder must
  show the Runtime's save, not the stale pre-launch rows, and `Store.get('matrixUrls')` must
  match. The very next Builder edit must land on top of that rehydrated content.
- **Flush before navigating** — edit a Builder row and click Launch Grid with no pause for the
  1500ms GitHub-sync debounce. Assert the edit reached the Preset before the Runtime's own boot
  read it (`getSessionUrls()`), not merely before the page unloaded.
- **Isolation preserved** — a Runtime change that is never saved never appears in the Builder;
  saving into a DIFFERENT preset never disturbs the one still active; Live Builder is NEVER
  rehydrated no matter what a Preset does, since its data has no second authority; resuming twice
  with nothing changed returns `false` the second time and does not clear Builder undo history
  for free.

### 3.5 Undo on `index.html`
Each of these must produce exactly one undo step, and undo must fully restore prior state:
Add Stream Row, Remove Row (both curated and manual variants), Reset/Clear, Shuffle,
Shuffle All, drag-reorder, lock toggle, folder assignment.
Assert `btn-undo` `disabled` state is correct after *every* one of these, and after a
workspace switch.

---

## 4. Tier 3 — Behavioral proofs (Playwright, headless, high value)

These are the tests that prove the refactor's core architectural claims. **None of them
require a human.**

### 4.1 ★ Position swap must not reload or rebuild panels
The single most important invariant in the codebase. Prove it three ways at once:

```js
// Before the swap:
await page.evaluate(() => {
  window.__probe = { loads: {}, nodes: {} };
  document.querySelectorAll('.stream-panel').forEach((p, i) => {
    const f = p.querySelector('iframe');
    window.__probe.loads[i] = 0;
    f.addEventListener('load', () => { window.__probe.loads[i]++; });
    f.dataset.probeId = 'probe-' + i;          // survives only if node is not recreated
    window.__probe.nodes[i] = f;                // identity reference
  });
});

// ... perform a 🖥 position swap through the real UI ...

const result = await page.evaluate(() => ({
  loads: window.__probe.loads,
  sameNodes: Object.entries(window.__probe.nodes)
    .every(([i, f]) => document.querySelector(`[data-probe-id="probe-${i}"]`) === f),
  parentsChanged: /* compare each iframe's closest('.stream-slot').id to before */ null,
}));
```
**Assert:** every `loads[i] === 0` (no reload), `sameNodes === true` (no rebuild), and the
iframe's *parent slot element is unchanged* (no reparenting) — while the visible grid position
**did** change. The only thing that may differ is the slot container's `style.gridArea`.

This has regressed twice historically: once via `iframe.src` reassignment, once via
`appendChild` reparenting. Both passed casual inspection. Only this test catches them.

### 4.2 ★ Live content continuity (canary fixture)
Stronger than 4.1, and still fully automated. Create a same-origin fixture at
`/tmp/canary.html`:
```html
<script>
  window.__t0 = window.__t0 || Date.now();
  setInterval(() => { document.title = String(Date.now() - window.__t0); }, 100);
</script>
```
Load it into a panel, wait ~2s, perform a swap, then read the fixture's elapsed counter via
`frame.evaluate()`. **Assert the counter did not reset** — proving the document's JS context
survived, which is exactly what "the video keeps playing" means mechanically.

### 4.3 ★ Grid session isolation (Phase 4B's whole point)
```
1. On index.html, select Preset 2. Snapshot localStorage['loop_matrix_urls'] and preset 2's
   stored panels.
2. Click Launch Grid (URL must become index3.html?workspace=2).
3. In the Grid: Shuffle, Shuffle All, reassign a folder, swap two positions, kill a panel.
4. Assert localStorage['loop_matrix_urls'] is BYTE-IDENTICAL to the snapshot.
5. Assert presets.json in-memory state for preset 2 is unchanged (no push attempted).
6. Navigate back to index.html; assert Preset 2 still shows its original content.
```
Any difference is a regression of the exact leak Phase 4B fixed.

### 4.4 ★ Save Session As is the *only* write path
Repeat 4.3, then click 💾 → a **different** preset (say 4). Assert:
- Preset 4 now contains the session's content, folderMap, and current `layout`
- Preset 2 is **still** untouched
- The dropup's "current" badge moves to Preset 4 afterward (`setSessionSource`)
- Exactly **one** push was attempted (mock and count it)

### 4.5 Grid Undo restores content *and* arrangement
Swap positions → Shuffle → Undo → Undo. Assert both the content and the slot `gridArea`
assignments return to their pre-action values, and that no iframe reloaded during the undos
(re-run the 4.1 probe). The arrangement half is easy to omit in implementation and invisible
without an explicit assertion.

### 4.6 Launch context handoff
- `?workspace=3` loads preset 3's content — **not** random picks. (Regression guard: this
  broke when `index3.html` didn't `await loadPresetsSilently()` before `initGridSession()`;
  it silently fell back to an empty default and filled slots randomly.)
- `?workspace=live` loads Live Builder content
- **No param** falls back to `live` without throwing
- `?workspace=999` (nonexistent) degrades gracefully, no uncaught error

### 4.7 All 8 orientations
For each of `top2, bottom2, 3col, lefttall, righttall, vsplit, hsplit, 4grid`:
- Correct number of slots visible (2, 3, or 4); unused slots `display:none`
- Resizer handles present and draggable; dragging changes track sizes and respects the
  ~80px minimum (panel cannot collapse to zero)
- Switching orientation resets arrangement to identity
- 📍 Move to Position offers exactly this layout's visible Positions, numbered clockwise
  from top-left, with the panel's own current Position shown disabled rather than as a
  meaningless swap with itself
- `#master-status` stays pinned right while the button group stays centered

### 4.8 `launch.js` dual-context behavior
The same module runs on both pages and must behave differently:
- On `index3.html` (ctx capabilities present): a panel URL edit updates the **session** and
  does **not** touch `localStorage['loop_matrix_urls']`
- On `index.html` (no ctx capabilities): the same edit **does** write to
  `localStorage['loop_matrix_urls']` — this is the correct and only persistence path there
- 📍 Move to Position, 📋 Copy to Position and ↩/↪ Panel Undo/Redo are all **hidden** on
  `index.html` (it supplies none of those ctx hooks) and **visible** on `index3.html`, and
  they are never offered as Quick Actions on a page that cannot perform them

### 4.9 Layer 2 nesting
Load `index3.html`, use 🚀 in a panel to load `index.html` inside it. Assert on the nested
document: `html.is-nested` and `html.layer-2` both present; `.hotswap-trigger` computed
`left` is set and `right` is `auto`; border color is the yellow sentinel (`#f0c020`);
nested `#controls` is right-anchored rather than centered. Then assert the **outer** page's
`#floating-btns` and the nested one do not overlap (compare bounding boxes — they must not
intersect).

### 4.10 Ghost Mode
With `ghost-trigger` enabled and opacity 12: assert `.hotswap-trigger` computed opacity is
`0.12` at rest and `1` on hover (`page.hover()`), and that the enlarged `::before` hit area
extends beyond the visible button box (hover slightly outside the button's own rect and assert
it still reveals).

### 4.11 Responsive controls
At viewport widths 1400 / 760 / 420: assert `#controls` fits within the viewport (its
`scrollWidth <= clientWidth + tolerance`), every child button is within the visible bounds and
clickable, and the `.sep` is hidden at the narrowest breakpoint.

### 4.12 ★ Fixed Position semantics
`js/positions.js` owns the only definition of a layout's Position geometry, and
`test/positions-history.test.js` pins it: each layout's Position→grid-area table, that
Position numbering is contiguous and covers only visible Positions, and that
`resolvePositionOfSlot` / `resolveSlotAtPosition` round-trip through an arbitrary
scrambled arrangement.

The behavioral half matters more. Perform repeated moves — `A/B/C` → move A to Position 2
→ move A to Position 3 → move B to Position 2 — and after **every** step assert:
- Position N still maps to the expected physical location
- the user-visible Position numbering (the `.slot-label` badges) is unchanged
- internal slot identity never leaks into the UX: `getSessionUrls()` is still `[A, B, C]`,
  because a Position move is presentation only

The failure this guards against is subtle and was the reason for the rename: an
implementation that says "Position" in the UI while still targeting the panel that
*originally* started at that number passes a naive one-swap test and fails the second swap.

### 4.13 ★ Panel-scoped history
Panel Undo means "undo the most recent undoable action that affected THIS panel", not
"undo the most recent thing that happened anywhere". Assert:
- **Interleaved histories** — change A, change B, Panel Undo A ⇒ A restored, B still
  changed. Panel Redo A ⇒ A's change back, B untouched throughout.
- **Multi-panel content actions are per-panel undoable** — Master Shuffle `A1/B1/C1` →
  `A2/B2/C2`, then Panel B Undo ⇒ `A2/B1/C2` (only B), Panel B Redo ⇒ `A2/B2/C2` (only B),
  then Panel A Undo ⇒ `A1/B2/C2`. Panels A and C must not reload during B's Undo. This is
  the behavior the first implementation got wrong: it selected the parent action and applied
  it wholesale, undoing the entire Shuffle from one panel's button.
- **Master Undo still reverses the whole thing** — after a panel has reversed its own
  portion, Master Undo reverses the *remaining* applied portions and reports only those as
  changed, so the already-restored panel is neither restored twice nor reloaded. It must
  also never trample a newer independent change: once a panel moves on, that panel's undone
  portion is invalidated and cannot come back over it.
- **Linked Position actions are the exception** — a swap is ONE *atomic* action naming both
  occupants and cannot be half-undone. Undo it from either panel; both sides move, it must
  then be undoable from neither, and from master Undo neither. Invalidating either side
  invalidates the whole swap, since a half-redo would leave the arrangement incoherent.
- **Master/local interoperability** — an action undone through Panel Undo must not be
  undoable again through master Undo, and vice versa. This is the double-apply bug that two
  independent stacks would produce.
- **Redo invalidation** — action → Undo → conflicting new action on the same panel ⇒ the
  stale Redo is dropped, cannot resurrect itself over the newer value, and its button is
  not left clickable. Invalidation is scoped: an unrelated panel's Redo survives.
- **Button state** — no history ⇒ both disabled; after an action ⇒ undo enabled, redo
  disabled; after Undo ⇒ redo enabled. Quick Action mirrors of ↩/↪ track the same
  availability, since a Quick Action that silently does nothing is worse than no button.

### 4.14 ★ Copy to Position
`A/B/C` live. Copy A's URL to Position 3. Assert A unchanged, B unchanged, C's URL becomes
A's, **only C loads**, and A/B canary contexts survive. Then Undo C (C returns to its own
previous URL, A/B untouched) and Redo C (the copied URL returns, A/B untouched).

Copy means URL only — assert the destination keeps its own folder assignment. Cloning a
whole panel's metadata when the user asked to duplicate what is playing is a surprise, not
a feature.

### 4.15 ★ Smart Panel Undo/Redo across both histories
The human-reported regression: GS3 loads Site B's selection page, the user clicks through to
a video *inside* Site B, and Panel Undo jumped straight back to Site A. Panel Undo must walk
the in-content navigation first and only then reach the GS3 action history.

Drive navigations from **inside** the frame (`frame.evaluate(() => location.href = ...)`),
never by assigning `src` from the parent — otherwise the test proves nothing about what GS3
actually observes. Assert:
- browse → category → video, then Undo ⇒ category, Undo ⇒ browse, Undo ⇒ the GS3 assignment
  is reversed. Unrelated panels: zero loads, same nodes/parents/documents, counters advancing
- Redo retraces the same path forward before touching action Redo
- A new in-content navigation invalidates the stale forward path
- Two panels keep independent navigation histories
- A panel keeps its navigation history when it moves Position, and Undo steps browsing back
  *before* reversing the Position move — which is itself reversed before the older URL
  assignment, since the action history is LIFO in its own right
- Master Undo reverses the Runtime action straight past the browsing, and never consumes it

**Test-harness trap:** `page.waitForFunction` does not await a promise returned by its
predicate, so an **async** predicate is always truthy and the wait silently passes on its
first poll. Publish what the predicate needs on `window` and keep the predicate synchronous.
Waiting on `location.href` alone is also not enough — it flips at navigation commit, before
the `load` event settles the panel's pending-load count.

### 4.16 ★ Opaque cross-origin navigation
Run a **second** static server on another port (same host, so it always resolves — `localhost`
can resolve to `::1` while the harness binds IPv4 only). A different port is a different
origin, so reads across it really do throw SecurityError. No third-party network access.

Assert the navigation is **detected** (a second entry appears), recorded as
`{url: null, opaque: true}`, that no fabricated URL reached Runtime Session, that no
SecurityError escaped to the page, and above all that Panel Undo returns the panel to the
content GS3 loaded rather than falling through to the older GS3 URL. After that collapse,
Redo is unavailable (the opaque entry has no address) and the *next* Undo reaches the action
history.

### 4.17 ★ Opaque navigation must block action-history fallthrough
The human-reported bug: a cross-origin panel is Position-swapped, the user browses inside it,
and Panel Undo reverses the *Position swap* instead of the browsing. Regression test drives
the exact sequence against a real cross-origin panel:

1. GS3 assigns a cross-origin URL → that URL is the generation **anchor**
2. Position swap involving that panel
3. Two opaque in-content navigations
4. Panel Undo ⇒ returns to the anchor; the Position swap **remains applied**
5. Panel Undo again ⇒ *now* the Position swap reverses, with **zero** iframe loads on every
   panel including the one that moved, same nodes/parents/documents

Also assert no fabricated URL, no `SecurityError` escaping, no impossible Redo advertised, and
that Master Undo still reverses the Runtime action rather than consuming browsing history.

`canNavigateBack` must **not** be computed from whether the current entry has a readable URL —
an opaque marker plus a known anchor is enough. That is the specific mistake that produces the
reported symptom.

**Observability boundary** (measured — do not assume): a full frame navigation is observed at
any origin; a hash change, an SPA `pushState`, and a nested-iframe load are **not** observed at
all. A cross-origin SPA is therefore invisible in both directions, and Undo correctly falls
through for it.

### 4.18 ★ Hotswap Chrome
The retractable toolbar, the right runway, and layer scope. Assert:
- **Inset, not overlay** — retracted, `toolbarHeight === 0` and the iframe gets the full panel;
  revealed, `iframeTop === toolbarHeight`; retracted again, full panel restored. Through the
  whole cycle: zero loads, same nodes/parents/documents, `src` untouched. Revealing Chrome is
  a layout change on the iframe's existing parent, so it must never touch the document.
- **Separate hit targets** — `elementFromPoint` at the border resolves to the resizer, inside
  the panel to the activation strip, and in the content to the iframe. The activation strip
  starts clear of the resizer's ±4px grab zone, so no pixel is ambiguous.
- **Safe zone** — the runway's top offset is authored as `calc(toolbar * 1.75)` and resolves to
  it; `elementFromPoint` at the panel's top-right returns the **iframe**, not a GS3 hitbox; the
  iframe's width is unchanged (the runway overlays — insetting sideways is what reflows sites).
- **Runway length** — the interactive area matches the configured count; OFF renders no runway
  element at all, and the count survives being switched off.
- **Layer selector** — absent (panel and master) with only L1; appears when a panel loads one
  of our own runtime pages; L2 lit by default; switching retargets with no reload; disappears
  when the nested runtime is replaced. The scope is a *preference* and is not overwritten while
  Layer 2 is absent — otherwise the default silently sticks at L1.
- **Position labels** — after a swap, Position 1 is still Position 1 and the panel under it
  changed; each toolbar states the physical place it is actually in. Zero loads.
- **Settings** — 1-8 in a 4-column grid; ON/OFF independent of count; both lists drag-enabled;
  exactly two opacity range inputs, both persisted, 0 and 100 usable.
- **Ordering** — the runway and tray each render in their own configured order, and an action
  in the runway is still present in the tray (they are independent presentation collections).
- **Small panels** — 8 shortcuts stay configured and stay inside the panel box; the tray remains
  the complete fallback. Configuration is never silently deleted to fit.

Unit coverage (`positions-history.test.js`) pins the preference model: order reconciliation
against the registry, on/off vs count independence, the 1-8 clamp, uniqueness by construction,
legacy `quickActionSlots` migration (without deleting the legacy key), the two opacity values,
and that `isLayerTwoUrl` matches only our own same-origin runtime pages.

**Harness note:** the styled `.switch` hides its real checkbox, so Playwright's `check()` times
out on it — set `.checked` and dispatch `change` instead. And a CSS custom property holds the
literal `calc(...)` text, not a resolved number, so assert on measured geometry.

### 4.19 ★ Chrome lifecycle and the three surfaces
- **Autonomous retraction** — reveal, then leave the whole interaction family: Chrome must
  retract *by itself* within the configured delay (850ms), with **no other panel touched**.
  Returning before it expires cancels it. Moving between family members (toolbar → tray) is
  not leaving. Focus inside the family holds it open. An open tray must **not** hold the
  website's height hostage once the user has genuinely walked away.
- **Deep Cuts dismissal** — inside clicks keep it open; an observable outside click, Escape,
  or X all close it. Escape unwinds one level at a time (submenu → tray → retract) and never
  triggers a Runtime action. Correctness must not depend on cross-origin iframe clicks
  bubbling, because they never do — the countdown is the primary mechanism.
- **Position button** — clicking it opens a menu and moves *nothing*; the menu offers exactly
  Swap Position and Copy To Position; picking one goes through the canonical atomic pathway
  (`history.at(-1)` is a `position` action with `atomic: true`); zero reloads throughout. A
  completed Swap or Copy closes the menu; Escape and an observable outside pointerdown close
  it; it holds the toolbar open while up, then retracts with it.
  **Assert the menu is actually on screen** — parented outside the rail, below it, and
  returned by `elementFromPoint`. A test that only checked its text content passed for an
  entire pass while the menu was being clipped away by the rail's `overflow: hidden`.
- **Deep Cuts retirement** — `position` and `copyPosition` no longer render in the tray or
  appear in its Settings list, every other action still does, and both remain reachable
  through the Position button. Read only *visible* tray buttons: hidden ones keep their markup
  position and are not part of the presented order.
- **Shuffle All icon** — `white-space: nowrap`, no wrapping, the button is wider than it is
  tall (side-by-side, not stacked), it fits the rail, and the rail is still 30px. Behavior is
  proven by counting clicks on the canonical `.btn-hotswap-shuffle-all`, not by driving a real
  shuffle: `loadReplacement` closes over the database captured at panel-build time.
- **Top Shortcuts** — render in configured order; drop from the **end** on a narrow rail while
  Position / Undo / Redo / "···" always survive; the stored count is never rewritten to fit;
  widening restores them; clicking one reuses the canonical action.
- **Opacity scope** — with Resting 0%, the toolbar computes `opacity: 1` and the runway `0`.
  A fully transparent runway still leaves the site's top-right and lower-right to the iframe.
- **Compact rail** — every control is the same height and sits fully inside the rail. This
  guards the specific regression: `.hotswap-trigger` kept `position:absolute; top:16px` from
  the corner era, which inside a flex rail pushed it 16px below the toolbar.

**Waiting on a restore:** `data-last-src` is set SYNCHRONOUSLY by
`updateRenderedPanel`, so waiting on it alone returns before the iframe's `load` event has
fired. Any assertion about load COUNTS must additionally wait for that panel's pending GS3
load to land (`__navState(slot).pendingLoads === 0`). This was a real intermittent failure in
the Master-Shuffle partial-undo test — `loads.C2` read 0 instead of 1 roughly one run in eight.

**Harness notes:** a narrow *viewport* is not a narrow *panel* — index3.html stacks its layout
below a breakpoint, which makes each panel wider; drive the panel narrow instead. And an action
configured as a Top Shortcut also matches `.hotswap-mirror-btn[data-action-key=…]`, so scope
survival checks to `.hotswap-toolbar-actions`.

### 4.20 ★ One canonical action registry
Surface eligibility is DERIVED from the registry, never hand-listed per surface. Assert the
counts encode the ownership rules exactly: Deep Cuts and the Runway share an eligible set;
Toolbar Shortcuts additionally exclude Undo/Redo (already fixed on that same rail); all three
exclude the Position-owned pair. **Guard the specific drift this replaced** — `toggle`
(Edit URL) and `folder` (Assign Folder) must appear on every configurable surface; they were
absent from two of them because one `shortcutable` boolean conflated "opens a picker" with
"may not be a shortcut". A picker action invoked from a shortcut opens the tray first, so its
row is visible rather than opening where nobody can see it.

### 4.21 ★ The ··· gateway and compositor-drawn artifacts
A human reported a crossed-out artifact near `···` that **did not appear in screenshots**.
The gateway was innocent: `disabled: false`, `cursor: pointer`. Undo/Redo sit immediately to
its left, are disabled on any fresh panel, and carried `cursor: not-allowed` across a ~50px
band of the approach path.

**Assert no rail control uses `not-allowed` or `no-drop`**, sweeping the actual approach path
with `elementFromPoint`, and that `user-select` is `none` across the rail (a native text drag
produces an equally invisible no-drop cursor). Also assert: two panels hold independent Deep
Cuts state, moving between `···` and its tray causes **zero** class flips (no open/close
oscillation), `···` survives a narrow panel, and open/close reloads nothing.

**Diagnostic principle worth keeping:** visible to the eye but absent from a capture is a
strong signal for a CSS cursor or another compositor-drawn surface — screenshots contain the
page bitmap, never the cursor. Do not go looking for a DOM bug first.

### 4.22 ★ Settings hierarchy and switch alignment
Two top-level surfaces (`Top Toolbar`, `Quick Action Shortcut Runway`); `Toolbar Shortcuts`
and `··· Deep Cuts` are subsections of the first, verified by `closest('.hotswap-surface')`.
The Top Toolbar copy must name Position/Undo/Redo/`···` as fixed. Toolbar count is 1–10 in a
5-column grid; responsive pressure changes what renders but must leave `hotswap_top_shortcut_count`
and `_order` byte-identical, and structural controls always fit.

**Alignment:** every Hotswap `.switch` right edge lands on one axis (±1px). This caught a real
110px misalignment — the switches carried an inline `style="margin:0"` that outranked the
stylesheet's `margin-left: auto`, so they sat wherever the heading text ended.

**Part 1-6 update:** Toolbar Shortcuts no longer carries its own ON/OFF switch —
`#top-shortcuts-enabled` must not exist in the DOM. Assert count/order still render and persist
identically, and that a legacy `hotswap_top_shortcuts_enabled=false` left over from before this
pass is silently ignored rather than suppressing the toolbar. Quick Action Shortcut Runway keeps
its own ON/OFF switch unchanged — this removal applies to Toolbar Shortcuts only.

### 4.23 ★ Utility dismissal consistency (Part 1-6B)
Edit URL and Assign Folder are presented as sibling utilities and must dismiss identically:
completion, Escape, or a click outside — never only by completing the action.
- **Narrow click-away boundary** — the dismissal boundary for an OPEN utility is the utility
  itself plus the control that invoked it, never `inChromeFamily` (that predicate answers a
  different question: whether the 850ms retract timer should run). Clicking ANY other GS3
  control — the Top Toolbar rail, the Position button, Deep Cuts, the Runway — closes the open
  utility, and that control's own click still fires in the same gesture (e.g. Edit URL open,
  click Reload: Edit URL closes AND Reload still spins). The same-control toggle still closes in
  exactly one click, not close-then-reopen, because the invoking control counts as "inside" while
  its own utility is open.
- **No swallowed clicks** — the dismissal `pointerdown` handler never calls `preventDefault`.
- **Assign Folder owns focus** — on open it takes focus on its own container (`tabIndex=-1`,
  `focus({preventScroll:true})`), matching Edit URL's explicit `input.focus()`. This is what
  makes Escape reach the panel's keydown handler deterministically — before the fix, a plain
  `<div>` folder row focused nothing, `document.activeElement` fell to `BODY`, and Escape only
  worked when a click happened to land on a focusable child by accident. Taking focus must not
  auto-select a folder, scroll the page, or reveal the Top Toolbar.
- **Cross-origin residual case, documented not faked** — the honest boundary is iframe `focus`,
  which fires on the transition into the frame and reliably closes an open utility. If the
  iframe already holds focus when a utility opens, a subsequent click inside that website
  produces no parent-visible event at all, and the utility remains open until Escape, an outside
  click, or an action. This is a real browser limitation — no transparent overlay is introduced
  to paper over it, since that would intercept the customer's own first click into their site.

---

## 5. Tier 4 — Data & sync (mock first, real only if credentials are supplied)

### 5.1 Mocked sync
- `fetchPresetsSilently` on **404** must be treated as "file doesn't exist yet," not an error
  (fresh repos have no `presets.json`)
- `pushPresetsToRemote` sends the current in-memory `presetsStructure` and updates the stored
  SHA from the response
- Base64 encode/decode round-trips content containing non-ASCII characters and emoji without
  corruption
- A push rejection surfaces to the caller as `false` (and the UI reports it) rather than
  throwing

### 5.2 Known open issue — "Push rejected" on Save Session As
There is a **deferred, unresolved** bug: `Preset Sync failed: Push rejected` when saving a
session that contained a nested Layer 2 workspace. If asked to investigate, trace in this
order and report findings before changing anything:
1. What exactly does Save Session As serialize? (Log the payload. A workspace-type panel or a
   nested-Launchpad URL may be producing unexpected content.)
2. Payload size — GitHub's Contents API rejects inline content **>1MB**. `links.json` has hit
   this ceiling before in this project. Check `presets.json`'s encoded size.
3. SHA staleness — is `presetsSha` current? A push with a stale SHA is rejected as a conflict.
   Does anything else write `presets.json` between fetch and push (e.g. `index.html`'s
   debounced auto-save racing the Grid's save)?
4. Branch/credential scope — is the PAT's `repo` scope intact, and is the default branch what
   `sync.js` assumes?
5. Reproduce with **and without** a nested Layer 2 panel to confirm whether nesting is
   causally related or incidental.

### 5.3 Data integrity
- `presets.json` conforms to the schema in `presets.js` (id, name, panels, folderMap,
  lockState, layout, rowCount, streamCount, isEmpty, savedAt)
- `rowCount`/`streamCount` actually match `panels` contents (stale denormalized counts are a
  real hazard since they're stored, not computed)
- No preset contains a `urls` key *and* a `panels` key with conflicting content
- `links.json` total encoded size vs. the 1MB API ceiling — **warn at >800KB**

---

## 6. Genuinely human-only (keep this list short)

Only escalate to the human for these, and only after exhausting the automated equivalents.

1. **Real GitHub push with live credentials.** You have no PAT and must not ask for one
   casually. *Automatable if* the human provisions a throwaway repo + scoped token via
   environment variable — propose that before asking for manual testing.
2. **Subjective visual judgment** — "does the new design look right / feel premium." Layout
   *correctness* (overlap, overflow, clipping, contrast ratios) is automatable via bounding
   boxes and computed styles; only taste is not.
3. **Real third-party site behavior in panels** — sites that set `X-Frame-Options`/CSP
   `frame-ancestors` will refuse to embed, and browser autoplay policies vary by engagement
   state. The *mechanism* is provable with local fixtures (§4.2); real-world site compatibility
   is environment-dependent and not a code defect.
4. **Cross-device / cross-browser sync confirmation** — that a preset saved on machine A
   appears on machine B. Single-machine round-trip through the API is automatable and covers
   the logic; multi-device is infrastructure confirmation.

Everything else in this document is your job, not theirs.

---

## 7. Architectural invariants — DO NOT "fix" these

These look like defects and are not. Confirm they hold; report it as a **regression** if any
of them has been violated.

1. **Position moves are pure CSS.** `_moveSlotToPosition` reassigns `style.gridArea` on slot
   *containers* only. It must never set `iframe.src`, move DOM nodes, or rebuild panels. This
   is the reason live media survives a move. Non-negotiable — and it applies equally to
   undoing and redoing one.
2. **Moves do not move content.** A move changes *presentation* (arrangement) only —
   `urls`/`folderMap` stay bound to slot index. The old code swapped folderMap too and had a
   comment defending it; that was deliberately reversed.
3. **Session updates and undo checkpoints are decoupled.** `updateGridSession()` deliberately
   does not push undo. Callers decide via `pushGridSessionCheckpoint()`. Not every mutation
   deserves a checkpoint (e.g. typing a URL); every mutation *does* need to keep session state
   accurate.
4. **`grid-session.js` never writes `Store` or `presets.json`.** In-memory only. The sole exit
   path to persistence is Save Session As. Grep to confirm: no `Store.set` / no push calls in
   that module.
5. **`launch.js`'s ctx capabilities are optional by design.** `index.html` intentionally
   provides none and falls back to direct `Store` writes — that fallback *is* the correct
   persistence path for that page, not dead code.
6. **`state.js`'s `getTargetUrls`/`setTargetUrls` are a lossy compatibility view** over
   `panels[]`. Intentional. They keep pre-Phase-4A call sites working untouched. A
   workspace-type panel reading as `''` through that view is documented behavior.
7. **Plain strings are valid panel input everywhere.** All historical saved data is strings.
   `normalizePanel` handles it. Do not "clean up" by requiring objects.
8. **`Store.set('tripleLayout')` coexisting with `setSessionLayout()` is intentional** — the
   former is a global default for future sessions, the latter is this session's truth. Both
   should be written on an orientation change.
9. **Border-drag sizes and arrangement reset on orientation change.** By design — geometry
   from one layout doesn't map onto another.
10. **Ghost Mode uses native CSS `:hover`, never JS mouse tracking.** An earlier JS
    zone-tracking implementation caused flicker and was deliberately replaced. Do not
    reintroduce mouse-position math.
11. **Undo stacks are per-surface and independent.** `index.html`'s (`workspace.js`) and the
    Grid's (`grid-session.js`) must never share history.
12. **`workspace.js` is the single source of truth for the active workspace.** No other module
    should independently decide what's active.

---

## 8. Regression checklist (previously-fixed bugs — verify each stays fixed)

| # | Bug | Test |
|---|---|---|
| 1 | Grid renders wrote `Store.set('matrixUrls')`, silently overwriting `index.html`'s active workspace | §4.3 |
| 2 | Position swap reloaded iframes (via `src` reassignment) | §4.1, §4.2 |
| 3 | Position swap reloaded iframes (via `appendChild` reparenting) | §4.1 |
| 4 | Grid Undo button stayed greyed out after Shuffle (state only refreshed at boot) | §4.5 |
| 5 | `index3.html` didn't `await loadPresetsSilently()` → `?workspace=N` loaded random URLs | §4.6 |
| 6 | Reset/Clear bypassed the save funnel → never synced to the active preset | §3.5 |
| 7 | Add Stream Row / Remove Row mutated state but never persisted → lost on refresh | §3.5 |
| 8 | Drag-reorder bypassed workspace sync | §3.5 |
| 9 | Quick Action shortcuts overlapped the "···" overlay | §4.10, §3.3 |
| 10 | Nested Layer 2 UI collided with the outer session's controls | §4.9 |
| 11 | Stream controls overflowed and became unclickable in narrow panels | §4.11 |
| 12 | `links.json` exceeded GitHub's 1MB inline limit | §5.3 |
| 13 | `index.html` auto-save wiped a Grid-saved `layout` | §2.3 |
| 14 | Launch Grid reverted to a plain `<a href>`, dropping `?workspace=` | §4.6 |
| 15 | `#master-status`'s `margin-left:auto` broke master-bar centering | §4.7 |

---

## 9. Reporting format

Produce a single report, prioritized. **Do not modify code on the first pass.**

```
BLOCKING     — app is broken right now (syntax errors, unresolvable imports,
               dead controls, committed secrets)
HIGH         — architectural invariant violated (§7) or regression detected (§8)
MEDIUM       — real defect, non-blocking (edge case, missing guard, silent failure path)
LOW          — hygiene (debris, duplicate data files, orphan modules, stale comments)
INFO         — observations, coverage gaps, notes for the human
```

For each finding include: file + line, what you observed, what you expected, the test that
caught it, and your confidence. If you could not run a tier, say which and why — never let a
skipped check read as a pass.

Finish with: tiers executed, count of automated assertions run, and an explicit list of
anything you were unable to verify programmatically (with the reason it needed a human, per
§6's standard).
