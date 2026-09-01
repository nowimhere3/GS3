# TESTING.md — Verification Guide for Stream Loop Launchpad

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
| `triple-mode.js` | `grid-session.js` | `initGridSession(defaultLayout)` returns `{urls, folderMap, layout}`; `undoGridSession()` returns `{urls, folderMap, arrangement}`; `getSessionArrangement`/`setSessionArrangement`/`setSessionLayout`/`pushGridSessionCheckpoint`/`updateGridSession`/`setGridSessionSilently` all exist |
| `launch.js` | `triple-mode.js`'s `ctx` object | `ctx.onPanelContentChanged(index, url, folder)`, `ctx.onPanelRemoved(index)`, `ctx.pushUndoCheckpoint()`, `ctx.getPositionOrder()`, `ctx.swapWithSlot(a, b)` |
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
- `push` past `maxSize` drops the *oldest* entry, not the newest (`size` caps, `peek` returns
  most recent)
- `pop` on empty returns `null`, does not throw
- `canPop()` false on empty, true after one push
- `clear()` resets `size` to 0
- Stack holds references as given — confirm callers are responsible for cloning (they are;
  `grid-session.js` and `workspace.js` both clone before pushing). Verify those clones are
  real: mutating the live session after a checkpoint must not corrupt the snapshot.

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
- **Decoupling:** `updateGridSession(...)` does **not** change `canUndoGridSession()`.
  Only `pushGridSessionCheckpoint()` does. This is the central Phase 4D invariant.
- `pushGridSessionCheckpoint()` → mutate content → `undoGridSession()` restores content
  **and** arrangement
- `undoGridSession()` on an empty stack → `null`
- `setSessionSource(4)` changes `getSourceWorkspaceInfo()` to `{type:'preset', id:4}` without
  touching panels/folderMap/undo stack

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
- 🖥 dropdown offers exactly the other visible slots, numbered clockwise from top-left
- `#master-status` stays pinned right while the button group stays centered

### 4.8 `launch.js` dual-context behavior
The same module runs on both pages and must behave differently:
- On `index3.html` (ctx capabilities present): a panel URL edit updates the **session** and
  does **not** touch `localStorage['loop_matrix_urls']`
- On `index.html` (no ctx capabilities): the same edit **does** write to
  `localStorage['loop_matrix_urls']` — this is the correct and only persistence path there
- 🖥 Position button is **hidden** on `index.html` (no `getPositionOrder`) and **visible** on
  `index3.html`

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

1. **Position swaps are pure CSS.** `_swapSlotContents` reassigns `style.gridArea` on slot
   *containers* only. It must never set `iframe.src`, move DOM nodes, or rebuild panels. This
   is the reason live media survives a swap. Non-negotiable.
2. **Swaps do not move content.** A swap changes *presentation* (arrangement) only —
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
