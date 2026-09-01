# Verification Audit — Stream Loop Launchpad

**Date:** 2026-08-31  **Commit audited:** `faa620b` (main, clean tree)
**Scope:** TESTING.md Tiers 0–3 in full, plus Tier 4 §5.1 / §5.3
**Mode:** Report only — **no application code was modified.**
**Deferred by instruction:** §5.2 (the open "Push rejected" bug) was *not* investigated.

---

## 0. Environment

| Item | Status |
|---|---|
| HTTP origin (ES modules) | ✅ `python3 -m http.server` on `:8080` (repo) and `:8082` (isolated copy + canary fixtures) |
| `playwright` + chromium | ✅ installed as throwaway dev deps; needed `npx playwright install-deps chromium` (missing `libatk-1.0.so.0`) |
| `jsdom` | ✅ installed |
| `acorn` / `acorn-walk` | ✅ added — needed for real AST-based import/export + arity analysis rather than regex |
| Node | v24.14.0 |

All GitHub traffic was intercepted at `https://api.github.com/**`; **zero real network calls were made.** Throwaway deps (`node_modules/`, `package.json`, `package-lock.json`) were removed after the run — the tree is back to a clean `faa620b`.

---

## 1. Findings

### 🔴 BLOCKING

---

#### B-1 — `Uncaught SyntaxError: Unexpected identifier 'is'` → **`js/launch.js` lines 1–2**

**Root cause located.** Two lines of UI chrome were accidentally pasted above the file header when `launch.js` was uploaded:

```
js/launch.js:1   Content is user-generated and unverified.
js/launch.js:2   Learn about artifacts
js/launch.js:3   /**
js/launch.js:4    * launch.js — Stream Loop Launchpad
```

Line 1 parses as `Content` (identifier) followed by `is` (identifier) → **`SyntaxError: Unexpected identifier 'is'`** — the exact reported string, character for character.

**Why the browser blames `settings.html:1`, not `launch.js`:** `settings.html` loads exactly one script, `js/settings.js`, which statically imports `HOTSWAP_ACTIONS` from `./launch.js`. A parse failure anywhere in a module graph aborts instantiation of the *whole* graph, so `settings.js` never evaluates and **every** control on the page is left unwired — the misattribution and the "all buttons dead" symptom are the same event.

**Located by:** scanning every `.js` blob in the full object database (`git rev-list --objects --all`) with a forced ES-module parse. Exactly one blob failed:

```
BAD BLOB 9c44e80c5af789c5cbb158608f78ee708f527aad   path=js/launch.js
  SyntaxError: Unexpected identifier 'is'
introduced in: 801fe67 "Update file"  (Fri Aug 14 07:24:16 2026)
```

**Reproduced bidirectionally in headless Chromium** — same repo, only `js/launch.js` swapped:

| Build | `settings.html` buttons | Console |
|---|---|---|
| `launch.js` @ `801fe67` (with the 2 junk lines) | **0 of 8 wired — all inert** | `Unexpected identifier 'is'` |
| `launch.js` @ `faa620b` (HEAD) | **8 of 8 wired** | clean |

> **⚠️ Status correction — this is already fixed in the tree.**
> Commit **`3ef7932` "Update file"** (Aug 14 07:39:04, ~15 min after `801fe67`) deleted exactly those two lines — `js/launch.js | 2 --`, a one-file two-deletion commit. I verified independently that HEAD is clean four ways: `node --check` on all 28 `.js` files; a forced ES-module re-parse of all 28; a real-Chromium `import()` of every module in `js/`; and a live boot of `settings.html` (0 console errors, 0 uncaught exceptions, 25/27 controls wired). A repo-wide grep for the marker strings `Content is user-generated` / `Learn about artifacts` returns nothing.
>
> **Therefore:** if this error is still appearing in your browser, it is being served from a stale deployment or an HTTP/service-worker cache, **not** from `faa620b`. Hard-reload, and confirm the deployed `js/launch.js` starts with `/**` on line 1.

**Confidence:** Certain (exact string reproduced, exact commit pair identified).
**Gap this leaves:** TESTING.md §3.1 says *"Make this test permanent."* **It was never made permanent** — there is no test file anywhere in the repo. This class of bug is currently undefended.

---

### 🟠 HIGH — architectural invariant / regression

---

#### H-1 — "Save Session As" never persists the session's `layout`
**File:** `js/triple-mode.js:600–610` (`_handleSaveSessionAs`)

```js
const { updated, synced } = await saveWorkspaceToPreset(presetId, {
    panels: urls,
    folderMap,
    lockState: {},
});           // ← `layout` is never passed
```

**Observed:** after setting an orientation, mutating the session and saving to Preset 4, the stored preset has `layout: null`.
**Expected (§4.4):** *"Preset 4 now contains the session's content, folderMap, and current `layout`."*

Because `layout` is `undefined`, `updatePresetInMemory` takes its **preserve** branch (`presets.js:170`) and keeps the *target* preset's old value — the guard that correctly fixes regression #13 is exactly what makes this failure silent. Confirming evidence: **`getSessionLayout()` (`grid-session.js:165`) is exported but imported by no module in the repo** — `grep -rn "getSessionLayout" js/` returns only its own definition and its own doc comment.

This also contradicts `grid-session.js`'s header contract, which states the save path *"reads `getSessionUrls()`/`getSessionFolderMap()`/**`getSessionLayout()`***".

**Caught by:** §4.4 Playwright proof. **Confidence:** Certain.

---

#### H-2 — Grid Undo button stays greyed out after a position swap (recurrence of regression checklist item #4)
**Files:** `js/triple-mode.js:366–382` (`_swapSlotContents`), `js/triple-mode.js:443` (`_updateGridUndoButtonState`)

`_swapSlotContents` correctly calls `pushGridSessionCheckpoint()`, but `_updateGridUndoButtonState()` is only ever called from **two** places — inside `_renderPanels()` (line 519) and at boot (line 797). A swap deliberately does **not** re-render (that's §7.1, and it is correct), so the button's `disabled` state is never refreshed.

**Proven in isolation:**
```
undo button disabled at boot                                          ✓ true
the swap DID happen (arrangement no longer identity)                  ✓
undo button still DISABLED after a swap-only action                   ✓ (the defect)
PROOF: force-enabling the button and clicking it restores arrangement ✓
=> session state is correct; only the BUTTON state is stale
```
**User impact:** perform a 🖥 swap as the first action of a session and Undo is unreachable. Any subsequent render-triggering action (Shuffle, etc.) unsticks it — which is why casual testing misses it.

This is regression checklist #4 (*"Grid Undo button stayed greyed out after Shuffle (state only refreshed at boot)"*) resurfacing in the swap path. **Confidence:** Certain.

---

#### H-3 — `links.json` is at 97.3% of GitHub's 1 MB Contents API ceiling (regression #12 returning)
**File:** `links.json`

```
raw          = 996,185 bytes  (972.8 KB)   → 97.3% of the 1 MB limit, 27 KB headroom
base64 body  = 1,328,248 bytes (1.267 MB)
```
TESTING.md §5.3 sets the warn threshold at **>800 KB — exceeded by 21%.** Regression #12 is *"`links.json` exceeded GitHub's 1MB inline limit."* At 24 folders / ~2,600 URLs, roughly 70 more URLs will push it over and every database push will start failing.

**Caught by:** §5.3 size check. **Confidence:** Certain (arithmetic).

---

#### H-4 — Drag-reorder bypasses the save funnel entirely (**regression #8 has REGRESSED**)
**File:** `js/grid.js:167–171` (the `drop` handler)

```js
// Save directly — do NOT call saveInputsToState() here because
// it re-reads the DOM (still in old order) and overwrites the reordered array
Store.set('matrixUrls', urls);
Store.set('lockState', newLockState);
Store.set('folderMap', newFolderMap);
```

The handler writes `Store` directly instead of going through `_persistAndNotify()`. It therefore skips **both** things that funnel does: `pushUndoSnapshot()` and `notifyWorkspaceEdited()`.

The stated reason for bypassing is sound — `saveInputsToState()` re-reads the DOM in its stale order — but the fix reached past `_persistAndNotify()` as well, which does *not* read the DOM and would have been safe to call.

**`js/grid.js:57–59` now documents behaviour the code no longer has:**
> *"used by `saveInputsToState()` **and by the drag-reorder handler below**, so neither one can silently bypass workspace-aware sync (drag-reorder used to, before this refactor)."*

**Measured** inside an active preset workspace:
```
drag-reorder actually reordered the rows                          ✓
DEFECT: drag-reorder pushes NO undo step (btn-undo still disabled) ✓
DEFECT: drag-reorder triggers NO preset sync push (0 pushes)       ✓
control: a normal edit in the same workspace DOES push             ✓
```
The control rules out a mock or debounce artefact. **Consequences:** a reorder cannot be undone (§3.5 requires exactly one undo step), and it never reaches the active preset or GitHub — it lives only in `localStorage` until some later action happens to push. This is regression checklist **#8, "Drag-reorder bypassed workspace sync"**, verbatim. **Confidence:** Certain.

---

#### H-5 — Lock toggle is never persisted and is lost on reload
**File:** `js/grid.js:213–220` (`_makeLockBtn`'s `onclick`)

```js
btn.onclick = (e) => {
    e.stopPropagation();
    const current = getRowLockState();
    const next    = ((current[idx] || 0) + 1) % 3;
    current[idx]  = next;
    setRowLockState(current);   // in-memory only (state.js)
    applyState(next);           // DOM classes only
};                              // no Store.set, no saveInputsToState, no _persistAndNotify
```

`setRowLockState()` is a plain in-memory setter. Nothing writes `matrix_lock_state`, pushes an undo snapshot, or notifies the workspace.

**Measured:**
```
lock toggle changed the button state (🔓 → 🔒)                ✓
DEFECT: pushes NO undo step (btn-undo still disabled)         ✓
DEFECT: NOT persisted to localStorage (matrix_lock_state)     ✓
DEFECT: triggers NO preset sync push                          ✓
DEFECT: the lock is LOST on reload (back to 🔓)               ✓
```

Lock state survives only if some *other* action later calls `saveInputsToState()`, which reads `getRowLockState()` incidentally. Since a URL lock's whole purpose is to make shuffles skip a row, silently losing it on refresh means the next Shuffle overwrites a row the user deliberately protected.

§3.5 names **"lock toggle"** as one of the actions that must produce exactly one undo step — so this falls inside the test that guards regression **#7** (*"mutated state but never persisted → lost on refresh"*), in a control the original fix did not cover. **Confidence:** Certain.

---

### 🟡 MEDIUM

---

#### M-1 — "Add Stream Row" and "Remove Row" each push **two** undo checkpoints
**Files:** `js/grid.js:433 + 438` (add), `js/grid.js:265 + 276` and `js/grid.js:340 + 348` (remove, curated + manual variants)

Both handlers call `saveInputsToState()` twice — once to "commit anything already typed", once to "persist the change itself". `saveInputsToState()` → `_persistAndNotify()` → **`pushUndoSnapshot()` unconditionally** (`grid.js:61`). One user action therefore produces two stack entries.

**Measured** (drain-the-stack probe):
```
Add Stream Row      : ONE undo restores prior state ✓  but stack NOT empty → needed 2 clicks  ✗
Remove Row (manual) : ONE undo restores the row     ✓  but stack NOT empty → needed 2 clicks  ✗
Remove Row (curated): ONE undo restores the row     ✓  but stack NOT empty → needed 2 clicks  ✗
Shuffle             : exactly one undo step ✓
Shuffle All         : exactly one undo step ✓
Reset/Clear         : exactly one undo step ✓
Folder assignment   : exactly one undo step ✓
```
Both Remove Row variants (curated and manual) are affected — they share the double-call shape.
**Expected (§3.5):** *"Each of these must produce exactly one undo step."* The first undo does restore correctly, so the visible symptom is a phantom second undo that appears to do nothing. **Confidence:** Certain.

---

#### M-2 — Typed URL edits are never auto-saved, and **Launch Grid drops them**
**Files:** `js/grid.js` (no `input`/`change`/`blur` listener on `.url-grid-field`), `js/app.js:235`

`saveInputsToState()` is only invoked from discrete actions (add/remove row, shuffle, launch, dropdown change…). Typing into a URL row persists nothing:

```
t=   0ms after input event   localStorage changed: false
t=   0ms after change event  localStorage changed: false
t=   0ms after blur          localStorage changed: false
t=4000ms                     localStorage changed: false
```

Critically, `btn-launch-grid` navigates without committing first:
```js
document.getElementById('btn-launch-grid')?.addEventListener('click', () => {
    const workspaceId = getActiveWorkspaceId();
    window.location.href = `index3.html?workspace=${encodeURIComponent(workspaceId)}`;
});   // ← no saveInputsToState()
```
**Proven:** type a URL into row 1 → click 🧩 Launch Grid → the Grid loads the *previous* content; the typed URL is gone.

This is the same "bypassed the save funnel" class as fixed regressions #6, #7 and #8 — the funnel exists and is correct, this entry point just doesn't use it. Note `add-field-btn` explicitly guards against this (`saveInputsToState(); // commit anything already typed`); Launch Grid does not.

**Contradicts §3.4:** *"Edits auto-save locally immediately."* **Confidence:** Certain.

---

#### M-3 — `initGridSession(defaultLayout)`'s third precedence tier is unreachable
**File:** `js/grid-session.js:80` and `:87`

```js
_layout = preset?.layout || Store.get('tripleLayout') || defaultLayout;
```
`Store.get('tripleLayout')` has a **non-empty default** (`storage.js:108` → `'lefttall'`), so it can never be falsy and `defaultLayout` can never be reached.

**Proven** with an empty store and an invalidated cache:
```
Store.get('tripleLayout') with nothing stored  ->  "lefttall"
initGridSession('righttall') returned layout   ->  "lefttall"
=> defaultLayout param is DEAD CODE
```
Harmless today only because `triple-mode.js:25` sets `DEFAULT_LAYOUT = 'lefttall'` — the same value. Changing that constant would silently have no effect. §2.4's documented 3-tier precedence is really 2 tiers. **Confidence:** Certain.

---

#### M-4 — `presets.json` is missing the `layout` key on every preset
**File:** `presets.json`

All 5 presets lack `layout`, which §5.3's schema requires (`id, name, panels, folderMap, lockState, layout, rowCount, streamCount, isEmpty, savedAt`).

```
id=1  panels=7 streams=6  types=['url']  MISSING KEYS ['layout']
id=2  panels=4 streams=4  types=['url']  MISSING KEYS ['layout']
id=3  panels=3 streams=3  types=['url']  MISSING KEYS ['layout']
id=4  panels=4 streams=4  types=['url']  MISSING KEYS ['layout']
id=5  panels=4 streams=4  types=['url']  MISSING KEYS ['layout']
```
Benign at runtime (`preset?.layout` handles `undefined`), and it is the on-disk footprint of **H-1** — nothing has ever written a layout. All other integrity checks passed: `rowCount`/`streamCount`/`isEmpty` match actual panel contents on all 5, and no preset carries both `urls` and `panels`. **Confidence:** Certain.

---

#### M-5 — `index2.html`: with no database, every control is left inert
**File:** `js/single-mode.js:56–59`

```js
if (!db || Object.keys(db).length === 0) {
    statusEl.textContent = 'No database loaded. Connect GitHub to get started.';
    return;                       // ← returns BEFORE any control is wired
}
```
**Measured:** on a fresh profile, 7 of 7 solo controls (`btn-folder`, `btn-favorite`, `btn-purge`, `btn-delete-replace`, `btn-shuffle`, `btn-shuffle-all`, `btn-toggle-master`) have no handler yet remain fully visible and clickable-looking. With a database present, **all 7 wire correctly** — so this is degraded-state handling, not a broken page. The status message is a partial mitigation; the dead buttons are not disabled or hidden. **Confidence:** Certain.

---

#### M-6 — HTML/JS injection into a generated `onclick` attribute
**File:** `js/blacklist.js:128`

```js
`<button class="bl-remove-btn" onclick="removeFromBlacklist('${domain}')" title="Unblock">✕</button>`
```
`domain` is user-controlled (typed into `#blacklist-manual-input`, or derived from a URL by 🗑️ Purge) and is interpolated raw into both an HTML attribute and a JS string. A value containing `'` or `"` breaks out. This is the **only** place in the entire codebase that compiles JS from data — a repo-wide search for `eval(`, `new Function`, `document.write`, `setTimeout("…")`, `javascript:` and `setAttribute('on…')` found nothing else. Self-inflicted only (no cross-user path), so severity is limited, but it is the one remaining runtime-code-generation surface. **Confidence:** Certain.

---

#### M-7 — `index.html` logs a `console.error` on every fresh boot
**File:** `js/app.js:172`

```js
console.error('[app] _restoreGitSyncState: showing disconnected state — Store.get returned
               empty token/repo despite localStorage check. token:', token, 'repo:', repo);
```
"Not connected yet" is the normal first-run state, not an error. Measured:

| Profile | `console.error` count |
|---|---|
| fresh, no credentials | **1** |
| with credentials | 0 |

This makes §3.1 (*"assert **zero** `console.error`"*) fail on first run and would block that test from ever being made permanent. The wording ("despite localStorage check") suggests leftover debug instrumentation. **Confidence:** Certain.

---

### 🔵 LOW

- **L-1 — Legacy extension debris at repo root.** `content.js` (9 KB) plus `manifest.json` (MV3, `<all_urls>` content script). §1.6 explicitly flags `content.js`. `1.html`, `extension/` and `test*.js` are already gone; `js/links.json` and `js/presets.json` duplicates were correctly removed in `faa620b`. Not deleted — flagged for approval per §1.6.
- **L-2 — Four dead `getElementById` targets** — present in JS, present on no page: `#speed-label` (`scroll.js:151`), `#btn-solo-mode` (`grid.js:472`), `#btn-toggle-fm-drawer` / `#fm-drawer-content` (`folders.js:264–265`). All are optional-chained or `if (!x) return`-guarded, so they fail silently rather than throwing — but `initFolderManagerDrawer()` and the Solo Mode entry point are unreachable dead code. The other 27 unresolved lookups are correct cross-page guards (e.g. `settings.js` reading `#bm-folder-select`, which only exists on the index pages).

### ⚪ INFO

- **No committed secrets** — in the working tree *or* anywhere in the 28-commit object database. The only `ghp_` match is a `placeholder=` attribute on `settings.html:402`.
- **Ghost-mode class coverage is surface-specific by design, not a gap.** `html.ghost-master` lives only in `index3.html`, `html.ghost-stream` only in `index.html`, `html.ghost-solo` only in `index2.html` — each page's inline bootstrap adds all four classes and each page implements only the ones whose surface it owns. Verified end-to-end: toggling all four in settings and reloading applies `ghost-trigger + ghost-stream` on index, `ghost-trigger + ghost-master` on index3, `ghost-solo` on index2, with `--ghost-opacity` correct on all three.
- **A `presets.json` 404 produces one browser-level `Failed to load resource` console error.** This is Chrome's own network log, not application code; the app handles the 404 correctly (bootstraps defaults, no uncaught error). Any permanent §3.1 test must filter network-level messages.
- **`<style> 2/1` "mismatch"** reported by raw tag counting in `index2.html` / `index3.html` is a false positive — the second match is the literal text `<style>` inside a JS comment on line 11 of each. Authoritative DOM parse (parse5 + jsdom) shows **0 parse errors and perfect tag balance on all four pages.**
- **§4.7 resizer drag verified end-to-end (no defect).** For `vsplit` (col axis), `hsplit` (row axis) and `4grid`, dragging the handle changes `gridTemplateColumns`/`gridTemplateRows`, and dragging hard past the viewport edge clamps every content track at exactly **80.0px** — `MIN_TRACK_SIZE` (`triple-mode.js:60`) holds and no panel collapses to zero area.
- **`js/grid.js:57–59` carries a stale doc comment** claiming the drag-reorder handler routes through `_persistAndNotify()`. It does not (→ H-4). Worth correcting alongside the fix so the next reader isn't misled the way this comment nearly misled this audit.
- **No orphan modules.** `app.js`, `grid.js`, `parser.js`, `scroll.js`, `workspace.js` appear unreachable to a static-import walk only because `index.js` reaches them via `import('./app.js')` — a deliberate dynamic import documented at `app.js:39`. All 20 modules in `js/` are reachable.

---

## 2. §7 Architectural invariants — all 12 verified HOLDING

Nothing in §7 was reported as a defect; each was independently confirmed.

| # | Invariant | How proven | Result |
|---|---|---|---|
| 1 | Position swaps are pure CSS | AST scan of `_swapSlotContents` (no `.src`/`appendChild`/`insertBefore`/`replaceChild`/`removeChild`/`innerHTML`/`createElement`) **+** live probe: `loads[i]===0` for every panel, iframe node identity preserved, `closest('[id^=screen-]')` unchanged, `gridArea` changed | ✅ |
| 2 | Swaps do not move content | after a swap, iframe `src` per **slot id** is byte-identical | ✅ |
| 3 | Updates and checkpoints decoupled | `updateGridSession()`, `setSessionArrangement()`, `setGridSessionSilently()` all leave `canUndoGridSession()` false; only `pushGridSessionCheckpoint()` flips it | ✅ |
| 4 | `grid-session.js` never writes Store/presets | static grep **+** runtime: instrumented `localStorage.setItem` recorded **zero** writes across init/update/checkpoint/undo/layout/arrangement/setSource | ✅ |
| 5 | `launch.js` ctx capabilities optional | index3 edit → session only, `loop_matrix_urls` untouched; index.html edit → **does** write `loop_matrix_urls` and survives reload | ✅ |
| 6 | `state.js` string view is lossy by design | workspace panel reads as `''` through `getTargetUrls()`, url neighbour intact | ✅ |
| 7 | Plain strings valid everywhere | mixed `['a', {type:'url'...}, null]` → 3 valid panels | ✅ |
| 8 | `Store.set('tripleLayout')` coexists with `setSessionLayout()` | both written on orientation change — verified for **all 8** layouts | ✅ |
| 9 | Arrangement resets on orientation change | swap → change orientation → arrangement back to identity | ✅ |
| 10 | Ghost Mode is pure CSS `:hover` | computed opacity `0.12` at rest → `1` on hover; `::before` reveals from 5px and 8px outside the button rect but **not** from 14px (matches the declared 10px extension); no mouse-tracking handler. The `mousemove` listeners in `triple-mode.js:289–325` / `grid.js:119` are border-drag resize and drag-reorder, unrelated to ghost | ✅ |
| 11 | Undo stacks per-surface | separate `createUndoStack(50)` instances in `workspace.js:48` and `grid-session.js:52`; switching workspace clears index.html's without touching the Grid's | ✅ |
| 12 | `workspace.js` owns the active workspace | only `workspace.js` reads/writes `activeWorkspaceId`; `app.js` goes through its accessors | ✅ |

## 3. §8 Regression checklist

| # | Bug | Result |
|---|---|---|
| 1 | Grid renders overwrote `Store.set('matrixUrls')` | ✅ **Still fixed** — `loop_matrix_urls` byte-identical after Shuffle + Shuffle All + URL edit + folder reassign + swap + kill |
| 2 | Swap reloaded iframes via `src` | ✅ Still fixed |
| 3 | Swap reloaded iframes via `appendChild` | ✅ Still fixed |
| 4 | Grid Undo greyed out after Shuffle | ⚠️ **Fixed for Shuffle, REGRESSED for position swap** → **H-2** |
| 5 | `?workspace=N` loaded random URLs | ✅ Still fixed — `?workspace=3` loads exactly `[canary1, canary4, canary2]` |
| 6 | Reset/Clear bypassed the save funnel | ✅ Still fixed |
| 7 | Add/Remove Row never persisted | ⚠️ Fixed for add/remove (each now costs **two** undo steps → **M-1**), but the **lock toggle** in the same §3.5 set is still unpersisted → **H-5** |
| 8 | Drag-reorder bypassed workspace sync | 🔴 **REGRESSED** — writes `Store` directly, skipping both `pushUndoSnapshot()` and `notifyWorkspaceEdited()` → **H-4** |
| 9 | Quick Action shortcuts overlapped "···" | ✅ `.hotswap-shortcut-row`/`-btn` present in both pages; duplicate-slot guard works |
| 10 | Nested Layer 2 UI collided with outer controls | ✅ Bounding boxes do not intersect |
| 11 | Stream controls overflowed in narrow panels | ✅ No overflow at 1400 / 760 / 420px; `.sep` hidden at 420 |
| 12 | `links.json` exceeded 1MB | ⚠️ **At 97.3% of the ceiling** → **H-3** |
| 13 | index.html auto-save wiped a Grid-saved layout | ✅ Guard works (both branches tested) — but see **H-1**: nothing ever writes a layout to wipe |
| 14 | Launch Grid dropped `?workspace=` | ✅ Still fixed — navigates to `index3.html?workspace=2` |
| 15 | `#master-status` broke master-bar centering | ✅ Status pinned right, button group centred |

---

## 4. Execution summary

### Tiers executed

| Tier | Section | Status |
|---|---|---|
| 0 | §1.1–1.6 static analysis | ✅ complete |
| 1 | §2.1–2.5 pure unit tests | ✅ complete — **110/110 pass** |
| 2 | §3.1–3.5 DOM integration | ✅ complete |
| 3 | §4.1–4.11 behavioural proofs | ✅ complete |
| 4 | §5.1 mocked sync, §5.3 data integrity | ✅ complete |
| 4 | §5.2 deferred sync bug | ⏸️ **not investigated — excluded by instruction** |

### Automated assertions run: **1,316**

| Tier | Assertions | Detail |
|---|---|---|
| Tier 0 | **742** | 59 syntax (28 files × CJS + forced-ESM, + 3 inline HTML scripts) · 6 JSON · **457** import/export contract (164 binding + 293 arity) · 16 HTML integrity · 144 ID reachability · 50 CSS class/hook reachability · 10 hygiene |
| Tier 1 | **110** | panels 24 · undo-stack 12 · presets 30 · state 10 · grid-session 34 |
| Tier 2 | **240** | 12 boot · 142 control-wiring (35+10+70+27 controls) · 21 settings round-trip · 14 workspace tabs · **51** undo (incl. drag-reorder, lock toggle, folder assignment, curated Remove Row) |
| Tier 3 | **179** | across 6 runs (main suite + 4 targeted re-verifications + resizer drag/80px-floor completion) |
| Tier 4 | **41** | 9 mocked sync · 32 data integrity |
| Blocking repro | **4** | bidirectional `launch.js` swap |

**8 initial failures were traced to harness artifacts, corrected, and re-run to green** — they are *not* reported as defects: stale `.hotswap-position-row` contents leaking between orientation iterations (2); a `page.addInitScript` seed re-firing inside same-origin panel iframes and clobbering the write under test (2); a ghost-hover probe aimed 14px out, beyond the declared 10px `::before` (1); `getComputedStyle` returning resolved used-values instead of the literal `auto` for `right`/`left` (2); and a `#3.4` assertion watching `loop_matrix_urls` while the active workspace was a preset (1).

---

## 5. Could not verify programmatically

Per §6's standard, this list is deliberately short. Everything else in TESTING.md was proven mechanically.

1. **Real GitHub push with live credentials.** No PAT available, and I did not ask for one. Everything logically downstream *was* covered against a mocked API: 404-as-"not created yet", full `presetsStructure` in the payload, SHA rotation (push N+1 uses the SHA returned by push N), rejection surfacing as a UI message rather than a throw, and base64 round-tripping of `Präset — 日本語 🎬🔥 «quoted» ünïcode` intact in both directions. *If you want the real-network half automated, provision a throwaway repo + scoped token in an env var and it becomes testable — no manual step needed.*
2. **Subjective visual judgment** — whether the UI "looks right". Layout *correctness* was automated (overflow at 3 breakpoints, nested/outer bounding-box intersection, master-bar centering geometry, computed opacity).
3. **Real third-party site behaviour in panels** — `X-Frame-Options` / CSP `frame-ancestors` refusals and per-engagement autoplay policy. The *mechanism* is fully proven with same-origin canary fixtures (§4.2: JS context identity `__t0` preserved and the elapsed counter strictly increasing across a swap); real-site compatibility is environment-dependent and not a code defect.
4. **Cross-device sync confirmation.** Single-machine round-trip through the mocked API is covered; multi-device is infrastructure, not logic.

### Deliberately not done
- **§5.2** — the deferred "Push rejected on Save Session As" bug. Excluded by instruction. *(Unprompted observation only, since it bears on step 2 of that trace: `presets.json` encodes to 8.8 KB — nowhere near the 1 MB ceiling. `links.json` is the file at risk, and it is not what Save Session As pushes.)*
- **No code was modified.** All test harnesses were written to `/tmp`, never into the repo.

---

## 6. Suggested order of work

1. **Verify the deployed `js/launch.js`** starts with `/**` (B-1) — if the error is live, it is a stale artefact, not source.
2. **H-4** (drag-reorder → call `_persistAndNotify(urls, newFolderMap, newLockState)` instead of the three bare `Store.set` calls; it does not read the DOM, so the stated reason for bypassing does not apply) and **H-5** (lock toggle → persist + checkpoint). Both are silent data loss, and H-4 is a confirmed §8 regression.
3. **H-2** (one line: refresh the undo button state in `_swapSlotContents`) and **H-1** (pass `layout: getSessionLayout()` in `_handleSaveSessionAs`) — both small, both user-visible.
4. **M-2** — add `saveInputsToState()` to the `btn-launch-grid` handler; silent data loss again.
5. **H-3** — decide on a `links.json` strategy before it crosses 1 MB.
6. **Make §3.1 permanent** — it is the test that would have caught B-1, and it still does not exist. It needs **M-7** fixed first (the fresh-boot `console.error` in `app.js:172`) or it will fail on first run.
