Calgary Timestamp: 2026-09-01 15:37 MDT
Timezone: America/Edmonton
Agent: Claude / Opus
Role: Architecture + Root-Cause Diagnosis
Repository: /home/dmcalorum/GS3
Scope: index.html — Pre-Launch / Builder Shuffle scope. NOT Runtime Grid, NOT Hotswap, NOT index3.html.
Status: DIAGNOSIS ONLY — no code modified, nothing committed, nothing pushed.

---

# GS3 — Pre-Launch Shuffle Scope Bug
## Architecture + Root-Cause Diagnosis

---

## WAS / IS / WHY

**WAS** — GS3 has no concept called "the folder the user wants to shuffle from". The only place that
value has ever lived is the `value` property of the `#directory-dropdown` `<select>` element. Because
no module owns it, four separate code paths write it freely: normal Shuffle overwrites it with a
*randomly chosen folder* on every press, Shuffle All overwrites it with the string `'manual'` (an
option that does not exist once a database is connected, leaving the control blank), and
`updateDirectoryDropdown()` destroys it entirely on every database refresh, boot, and bfcache resume
by rebuilding the option list. Per-row provenance (`folderMap`) and user-selected scope are treated
as the same idea, when they are not.

**IS** — Shuffle Scope becomes a named, singly-owned piece of state: one Store preference read
through one accessor, with the `<select>` demoted to a *view* of it plus the single user-facing
writer of it. Normal Shuffle reads the scope and never writes it. Shuffle All reads all eligible
folders for one generation, writes per-row provenance only, and never touches the scope. Rebuilding
the dropdown restores the scope instead of erasing it. Shuffle All's MAX-2 rule becomes a hard,
tested invariant with an explicit, non-silent behavior when the slot count mathematically exceeds
`eligibleFolders × 2`.

**WHY** — "Which folder this row came from" and "which folder the user wants to shuffle from" are two
different facts with two different lifetimes. Conflating them means every generation event silently
rewrites the user's intent, which is exactly the reported symptom: press Shuffle enough times and
GS3 wanders across the library. It also violates two standing invariants — *Single Source of Truth*
("No state should have multiple competing owners") and *"The DOM is never treated as state."*

---

## 1. EXACT ROOT CAUSE

### 1.1 Primary cause — Shuffle Scope is unowned state living in the DOM

There is no `shuffleScope`, no `selectedFolder`, no Store key, no `state.js` field. Grep confirms it:
the only storage of the user's folder choice anywhere in the repository is the live `value` of one
`<select>` element (`index.html:2211`). `js/storage.js` `KEYS` has `matrixUrls`, `folderMap`,
`lockState`, `activeWorkspaceId`, `singleModeFolder` — but nothing for the Builder's shuffle folder.

Because nothing owns it, everything writes it.

### 1.2 Every writer of the main dropdown value (complete list, verified)

| # | Location | Writes | Trigger | Verdict |
|---|---|---|---|---|
| W1 | `js/grid.js:505-506` | `dirDropdown.value = randomFolder` where `randomFolder = folders[Math.floor(Math.random()*folders.length)]` | every press of **Shuffle** (`#dice-shuffle-btn`) | **BUG — primary.** Confirmed exactly as suspected. |
| W2 | `js/grid.js:569` | `dirDropdown.value = 'manual'` | every press of **Shuffle All** (`#dice-shuffle-all-btn`) | **BUG.** Worse than expected — see 1.3. |
| W3 | `js/folders.js:44-69` `updateDirectoryDropdown()` | `dirDropdownEl.innerHTML = ''` then re-appends every folder option | boot after DB fetch, bookmark save (`_refreshDropdowns`), folder delete, folder reorder, `pageshow` bfcache resume | **BUG — silent third writer.** Rebuilding the option list collapses `select.value` to the **first folder in `db`**, regardless of what the user had chosen. |
| W4 | `js/parser.js:119` | `ctx.dirDropdown.value = folderName` after ingest | ingest on settings.html | **Inert here.** `js/settings.js:85` passes `dirDropdown: null`. Ingest no longer exists on index.html. No change needed, but it is a latent fourth writer. |
| W5 | `js/app.js:156-157` | `innerHTML = MANUAL_DIRECTORY_OPTION; value = 'manual'` | `_showDisconnectedGitState()` — no token/repo, or fetch failure | **Legitimate.** Disconnected has no folders; `'manual'` is correct there. |

The user's report — *"the dropdown itself may also move/change unexpectedly"* — is explained twice
over: W1 moves it to a random folder on Shuffle, and W3 snaps it back to the first folder on every
database refresh and on every bfcache return from `index3.html`.

### 1.3 A second-order defect inside W2

`updateDirectoryDropdown()` (W3) builds options for **folders only**. It never re-adds the
`<option value="manual">`. That option exists only in the static markup at `index.html:2211-2213`
and in `MANUAL_DIRECTORY_OPTION` (`js/app.js:29`), and both are wiped the moment a database
connects.

Therefore, on a connected database, `dirDropdown.value = 'manual'` assigns a value that has **no
matching option**. Per HTML spec the select's `value` becomes `''` and `selectedIndex` becomes `-1` —
the control renders **blank**. Then the next `updateDirectoryDropdown()` silently re-seats it on the
first folder. So Shuffle All does not merely "reset" the scope; it puts the control into an
unrepresentable state and defers the visible corruption to an unrelated later event. That timing gap
is why this has been hard to pin down for so long.

### 1.4 Why the code was written this way (the architectural cause)

Read W1 and W2 in the language of *provenance* rather than *scope* and they are internally coherent:

- W1: "this generation came from one folder — show which one." The dropdown is being used as a
  **read-out of what just happened**.
- W2: "this generation came from many folders — no single folder describes it, so show `'manual'`."
  Again a read-out, not a control.
- The button tooltips in `index.html` state this outright and are themselves now wrong under the
  product contract: `#dice-shuffle-btn` reads *"Randomize One Folder & Fill Grid"* and
  `#dice-shuffle-all-btn` reads *"Shuffle All Folders — picks a random folder per URL slot."*

The same element is *also* the input control (`dirDropdown.addEventListener('change', ...)`,
`js/grid.js:475`) and *also* consulted as launch-time provenance
(`js/launch.js:264` — `ctx.dirDropdownEl?.value !== 'manual' ? ctx.dirDropdownEl?.value : null`).

One DOM node is simultaneously: the user's input, a generation read-out, and a provenance fallback.
That is the root cause. The two `value =` lines are the symptom.

---

## 2. CURRENT STATE-FLOW DIAGRAM (WAS)

```
                          ┌───────────────────────────────────────────┐
                          │   #directory-dropdown  (a DOM <select>)    │
                          │   — the ONLY store of "shuffle scope"      │
                          │   — also a generation read-out             │
                          │   — also a launch provenance fallback      │
                          └───────────────────────────────────────────┘
                             ▲          ▲            ▲            ▲
             user 'change'   │          │            │            │
             (grid.js:475)   │          │            │            │
                             │          │  W1        │  W2        │  W3
                             │   random folder   'manual'   innerHTML=''
                             │   grid.js:506     grid.js:569  folders.js:48
                             │          │            │            │
   ┌─────────────────────────┴──┐  ┌────┴──────┐  ┌──┴────────┐  ┌┴────────────────────┐
   │ dropdown change handler    │  │  Shuffle  │  │Shuffle All│  │updateDirectory-     │
   │ fills slots from `selected`│  │           │  │           │  │Dropdown()           │
   └─────────────┬──────────────┘  └─────┬─────┘  └─────┬─────┘  │ boot / bookmark /   │
                 │                       │              │        │ delete / pageshow   │
                 │                       │              │        └─────────────────────┘
                 └───────────┬───────────┴──────────────┘
                             ▼
                 _applyShuffleToInputs(inputs, getPoolForSlot)   grid.js:376
                   lock 0 → getPoolForSlot(i)
                   lock 1 → skip
                   lock 2 → urlFolderMap[i] pool
                             │
                             ▼
                 setTargetUrls / setUrlFolderMap        (state.js)
                             │
                             ▼
                 saveInputsToState()                    grid.js:76
                             │
                             ▼
                 _persistAndNotify()                    grid.js:60
                   pushUndoSnapshot()  → workspace.js
                   Store.set matrixUrls / folderMap / lockState
                   notifyWorkspaceEdited() → preset mirror (debounced)
```

Observed failure sequence, exactly as the user describes it:

```
user selects Folder A        dropdown = A     scope = A            (only because A is displayed)
press Shuffle                dropdown = D     scope = D            W1 — silently reassigned
press Shuffle                dropdown = B     scope = B            W1
press Shuffle  ×50           dropdown = ???   scope = random walk  W1
press Shuffle All            dropdown = ''    scope = unrepresentable  W2
bookmark a link / reload     dropdown = first folder in db         W3
```

`Math.random()` over folders means the dropdown *sometimes* lands back on Folder A, which is why the
behavior reads as intermittent rather than obviously broken.

---

## 3. INTENDED STATE-FLOW DIAGRAM (IS)

```
   USER INTENT LANE (long-lived)                    GENERATION LANE (per press)
   ─────────────────────────────                    ───────────────────────────

   ┌──────────────────────────────┐
   │ Shuffle Scope                │                 ┌───────────────────────────┐
   │ Store: builderShuffleFolder  │◀── the ONLY ────│ #directory-dropdown       │
   │ owner: js/shuffle-scope.js   │    writer:      │ 'change' (user action)    │
   │ getShuffleScopeFolder()      │    user select  └───────────────────────────┘
   │ setShuffleScopeFolder(f)     │                              │
   └──────────────┬───────────────┘                              │ also fills slots
                  │ read-only                                    │ from that folder
      ┌───────────┼───────────────┐                              ▼
      │           │               │                  ┌────────────────────────┐
      ▼           ▼               ▼                  │ _applyShuffleToInputs  │
 ┌─────────┐ ┌──────────────┐ ┌────────────────┐     │  lock 0 → provided pool│
 │ Shuffle │ │updateDirectory│ │ (future: any   │     │  lock 1 → skip         │
 │  reads  │ │Dropdown()     │ │  scope reader) │     │  lock 2 → own folder   │
 │  never  │ │ RESTORES the  │ │                │     └───────────┬────────────┘
 │  writes │ │ selection     │ │                │                 │
 └────┬────┘ └───────────────┘ └────────────────┘                 ▼
      │                                                 setTargetUrls / setUrlFolderMap
      │                                                           │
      ▼                                                           ▼
 pool = db[scope].filter(!blacklisted)                   saveInputsToState()
                                                                  │
 ┌────────────┐   plans folders for THIS generation only          ▼
 │ Shuffle All│──▶ planShuffleAllFolders(...)  MAX 2 each  _persistAndNotify()
 │  reads all │    writes ONLY urlFolderMap (provenance)     pushUndoSnapshot()
 │  eligible  │    NEVER writes Shuffle Scope                Store.set(...)
 └────────────┘                                             notifyWorkspaceEdited()
```

Invariant, stated for the workers:

> **The Shuffle Scope changes if and only if the user changes the dropdown.**
> Shuffle reads it. Shuffle All ignores it. Dropdown rebuild restores it. Nothing else touches it.

---

## 4. WHICH CONCEPTS ARE CURRENTLY CONFLATED

| # | Concept | Should mean | Lives in (intended) | Currently |
|---|---|---|---|---|
| 1 | **Shuffle Scope** | "When I press Shuffle, use *this* folder." One value. Changes only on user selection. | Store preference, read via one accessor; dropdown is its view | Exists **only** as `select.value`; overwritten by W1, W2, W3 |
| 2 | **Row provenance** | "Slot *i*'s current URL came from folder *X*." One value **per row**. Changes whenever that row is repopulated. | `urlFolderMap` in `state.js` + `folderMap` in Store — already correct | Correct, but its *summary* is being written back into the scope control |
| 3 | **Folder lock (lock 2)** | "This row is a permanent exception — always shuffle it from its own folder, regardless of scope." | `rowLockState[i] === 2` + `urlFolderMap[i]` — already correct | Correct and already handled properly in `_applyShuffleToInputs` |
| 4 | **Launch provenance fallback** | "This row has no recorded folder — attribute it to…?" | explicit decision | `js/launch.js:264` reads the dropdown, inheriting whatever corruption W1/W2 left behind |

The answer to the critical architecture question posed in the brief is **yes**: GS3 is treating
*"folder this URL came from"* as *"folder the user wants normal Shuffle to use."* Concepts 1 and 2 are
stored in the same place, and concept 2 wins every time because it is written more often.

Note the asymmetry that makes the conflation obvious: `folderMap` is a **map keyed by row**, and the
dropdown is a **single value**. There is no lossless way for one to represent the other. W2's
`'manual'` is precisely that lossy collapse — "many folders don't fit in one slot, so write nothing."

---

## 5. EXACT FILES / SYMBOLS REQUIRING CHANGE

### 5.1 New file

**`js/shuffle-scope.js`** — the owner of Shuffle Scope, plus the pure Shuffle All planner.

Why a new module rather than exporting from `grid.js`: `grid.js` already imports `folders.js`
(`buildFolderOptions`), and `folders.js` needs the scope accessor to restore the selection. Exporting
it from `grid.js` would create an import cycle. `shuffle-scope.js` imports only `storage.js` and
`state.js`, so both `grid.js` and `folders.js` can depend on it cleanly. Being free of DOM
dependencies also makes the planner directly unit-testable under `node --test` with no browser.

```
export function getShuffleScopeFolder()          // resolved against current db; '' if unresolvable
export function setShuffleScopeFolder(folder)    // the single writer
export function resolveShuffleScope(db)          // stored → valid? keep : first folder key : ''
export function planShuffleAllFolders({ unlockedIdxs, availableFolders, maxPerFolder = 2, rng })
                                                 // → { slotFolders: {idx: folder}, unfilled: idx[] }
```

### 5.2 `js/storage.js`

- `KEYS`: add `builderShuffleFolder: 'builder_shuffle_folder'`
- `DEFAULTS`: `[KEYS.builderShuffleFolder]: ''`
- `TYPES`: `[KEYS.builderShuffleFolder]: 'string'`

### 5.3 `js/grid.js`

| Symbol / line | Change |
|---|---|
| imports | add `shuffle-scope.js` imports |
| `dirDropdown` `'change'` handler, **:475-494** | first statement becomes `setShuffleScopeFolder(selected)`. Then fill via the shared folder-fill helper. Also add the `isBlacklisted` filter this path currently lacks (see 7.R6). |
| `#dice-shuffle-btn` handler, **:498-531** | **delete** `const folders = Object.keys(db)`, `const randomFolder = ...` and `dirDropdown.value = randomFolder` (**:504-506**). Replace with `const folder = getShuffleScopeFolder();` and an early return + guidance alert when it is `''`. Everything downstream reads `folder` instead of `randomFolder`. **No write to `dirDropdown` at all.** |
| `#dice-shuffle-all-btn` handler, **:533-575** | **delete** `dirDropdown.value = 'manual'` (**:569**). Replace the inline `folderUsage` loop (**:551-558**) with `planShuffleAllFolders(...)`. Rows in `unfilled` are skipped (`getPoolForSlot` returns `null` → `_applyShuffleToInputs` leaves them untouched). Surface the capacity shortfall once via `alert()` (see 6, Step 5). |
| `_applyShuffleToInputs`, **:376** | **no change.** Its lock semantics are already correct. |
| `saveInputsToState` / `_persistAndNotify`, **:60-88** | **no change.** Both shuffle paths already funnel through them; keep it that way. |
| new small helper `_fillSlotsFromFolder(folder)` | shared by the dropdown-change path and the Shuffle path so one folder-scoped fill implementation exists instead of two near-copies |

### 5.4 `js/folders.js`

`updateDirectoryDropdown()` (**:44-70**): after the option-append loop and **before** the
`onAfterUpdate` callback, restore the selection:

```
if (dirDropdownEl) {
    const scope = resolveShuffleScope(db);      // stored value, or first folder if it vanished
    if (scope) {
        dirDropdownEl.value = scope;            // assignment ONLY
        setShuffleScopeFolder(scope);           // keep control and store in agreement
    }
}
```

**Hard requirement:** assign `.value` directly. Do **not** `dispatchEvent(new Event('change'))` — the
change handler repopulates every unlocked slot, so firing it here would wipe the user's grid on every
boot, bookmark save and bfcache resume. This is the single most dangerous line in the whole repair.

### 5.5 `index.html`

Tooltip copy only — the current text documents the bug as if it were the feature:

- `:2207` `#dice-shuffle-btn` → `title="Shuffle — fresh links from the selected folder"`
- `:2206` `#dice-shuffle-all-btn` → `title="Shuffle All — one mixed generation across folders; your selected folder is unchanged"`

### 5.6 Explicitly NOT changed

`js/launch.js` (see 7.R1), `js/state.js`, `js/workspace.js`, `js/presets.js`, `js/parser.js`,
`js/app.js`, `index2.html`, `index3.html`, `js/grid-session.js`, `js/hotswap-chrome.js`,
`js/single-*.js`, `js/triple-mode.js`.

---

## 6. WORKER-READY IMPLEMENTATION PLAN

**Step 1 — Store key.** Add `builderShuffleFolder` to `KEYS` / `DEFAULTS` / `TYPES` in
`js/storage.js`. Three lines, no migration (absent key → `''` → resolves to first folder).

**Step 2 — `js/shuffle-scope.js`.** Create the module described in 5.1.

`resolveShuffleScope(db)`:
1. `if (!db) return '';`
2. `const saved = Store.get('builderShuffleFolder') || '';`
3. `if (saved && db[saved]) return saved;`
4. `return Object.keys(db)[0] || '';`

`getShuffleScopeFolder()` = `resolveShuffleScope(getDatabaseStructure())`.
`setShuffleScopeFolder(f)` = `Store.set('builderShuffleFolder', f || '')`.

`planShuffleAllFolders({ unlockedIdxs, availableFolders, maxPerFolder = 2, rng = Math.random })`:
1. `const usage = {}; const slotFolders = {}; const unfilled = [];`
2. for each `i` of `unlockedIdxs` in order:
   - `const eligible = availableFolders.filter(f => (usage[f] || 0) < maxPerFolder);`
   - `if (eligible.length === 0) { unfilled.push(i); continue; }`  ← **the old `= availableFolders`
     fallback is deleted; this is the hard-rule enforcement**
   - `const chosen = eligible[Math.floor(rng() * eligible.length)];`
   - `usage[chosen] = (usage[chosen] || 0) + 1; slotFolders[i] = chosen;`
3. `return { slotFolders, unfilled };`

Pure, injectable `rng`, no DOM, no Store — directly unit-testable.

**Step 3 — Shuffle Scope becomes user-writable exactly once.** In `grid.js`'s dropdown `'change'`
handler, call `setShuffleScopeFolder(selected)` first, then fill.

**Step 4 — Normal Shuffle reads, never writes.** Rewrite the `#dice-shuffle-btn` handler:

```
const db = getDatabaseStructure();
if (!db) { alert('Please connect your GitHub database pool before using the shuffle engine.'); return; }
const folder = getShuffleScopeFolder();
if (!folder || !db[folder]) { alert('Select a folder to shuffle from first.'); return; }
let sourcePool = db[folder].filter(u => !isBlacklisted(u));
if (sourcePool.length === 0) { alert('All URLs in the selected folder are blacklisted.'); return; }
// ...existing _applyShuffleToInputs call, with `folder` in place of `randomFolder`...
// NO dirDropdown write anywhere in this handler.
```

Keep the existing pool-refill-on-exhaustion (`sourcePool = db[folder].filter(...)` when empty) so a
folder smaller than the slot count still fills every row.

**Step 5 — Shuffle All stops touching scope, enforces MAX-2.**

```
const { slotFolders, unfilled } = planShuffleAllFolders({ unlockedIdxs, availableFolders });
// _applyShuffleToInputs's getPoolForSlot returns null for any i not in slotFolders
// → that row keeps its current URL, provenance and lock state, untouched.
if (unfilled.length) {
    alert(`Shuffle All can fill at most ${availableFolders.length * 2} rows from `
        + `${availableFolders.length} folder(s) (2 each). ${unfilled.length} row(s) were left unchanged.`);
}
// NO dirDropdown write.
```

**Recommended answer to the exhaustion question** (asked explicitly in the brief): when
`unlockedSlots > eligibleFolders × 2`, **fill the first `eligibleFolders × 2` unlocked rows in row
order and leave the remainder unchanged, with one explicit alert.** Rationale:

- It keeps MAX-2 a *hard* rule rather than a preference that evaporates under load — the brief's
  stated requirement.
- "Leave excess slots unchanged" is a semantic GS3 already has and already renders correctly:
  `_applyShuffleToInputs` returning `null` is the same path used for a folder-locked row with no
  usable pool, so no new state or rendering concept is invented.
- The `alert()` channel is the one these two handlers already use for every other refusal
  ("All URLs in the selected folder are blacklisted", "No folders with available URLs found"), so
  nothing is silent and no new UX surface is introduced.
- Row order (not random selection) makes the outcome deterministic and therefore testable.

The alternative — raising the cap to `ceil(slots / folders)` to spread evenly — is a legitimate
product choice but *does* weaken the stated rule, so it should not be adopted without the owner
saying so. Flag it in the PR description and let the owner decide.

**Step 6 — Dropdown rebuild restores instead of erasing.** Apply 5.4 to `folders.js`. Re-read the
"do not dispatch change" warning before writing the line.

**Step 7 — Tooltip copy.** Apply 5.5.

**Step 8 — Tests.** Add `test/shuffle-scope.test.js` (unit) and
`test/prelaunch-shuffle-scope.test.js` (Playwright). See section 8.

**Step 9 — Documentation breadcrumb.** Add a `Shuffle Scope` entry to
`Docs ANCHOR/006-TERMINOLOGY.md` (defined against `Folder` and `Collection`, which already exist
there), and a WAS/IS/WHY breadcrumb to `Docs ANCHOR/999-NEXT.md` in the established house style.
This matters because `999-NEXT.md` already lists three future shuffle features — *Skip selected
collections during Shuffle*, *Less-played shuffle mode*, *Shuffle weighting algorithms* — and every
one of them will need to read a scope. Naming it now is what stops the next feature from inventing a
second one.

---

## 7. REGRESSION RISKS

**R1 — `js/launch.js:264` launch provenance fallback. (Highest-value item to read before merging.)**

```
const launchFolder = urlFolderMap[index]
    || (ctx.dirDropdownEl?.value !== 'manual' ? ctx.dirDropdownEl?.value : null)
    || null;
```

Today, immediately after a Shuffle All the dropdown reads `'manual'`/`''`, so a row with **no**
`folderMap` entry (a hand-typed URL) launches with `data-source-folder=""`. After the repair the
dropdown holds a real folder, so that same row inherits the selected folder as its provenance. This
is a genuine, unavoidable behavior delta that follows directly from fixing the scope. Recommendation:
**leave `launch.js` unchanged** — "row has no recorded folder → attribute it to the current scope" is
the more defensible reading, and every shuffled row has an explicit `folderMap` entry anyway, so only
hand-typed rows are affected. Call it out in the PR body; add the assertion in Test F.

**R2 — Preset schema must not grow.** `test/stabilization.test.js` asserts the exact key set of every
preset object (`id, name, panels, folderMap, lockState, layout, rowCount, streamCount, isEmpty,
savedAt`). Shuffle Scope is a Store *preference*, not workspace design data — it must **not** be
added to preset objects, `saveWorkspaceToPreset()`, or `switchWorkspace()`. Adding it there breaks
that test and, worse, would make scope a second per-workspace authority.

**R3 — Never dispatch `change` from `updateDirectoryDropdown()`.** See 5.4. A dispatched change event
would fire the slot-fill handler on boot, on bookmark save, on folder delete and on every bfcache
resume — silently overwriting the user's Builder grid. Assignment only.

**R4 — Undo / checkpoint behavior must stay exactly as-is.** Both shuffle paths must continue to end
in a single `saveInputsToState()` → `_persistAndNotify()` → `pushUndoSnapshot()` per press. Do not add
`Store.set('matrixUrls', …)` anywhere new, and do **not** route the scope write through
`_persistAndNotify()` — changing the shuffle folder is a preference change, not a workspace edit, and
must not consume an undo slot or trigger a preset/GitHub mirror.

**R5 — Curated mode.** Both handlers end with `if (getIsCuratedMode()) renderInputRows();`. Keep it —
curated rows show provenance through per-row `<select>`s built by `buildFolderOptions(assignedFolder)`
and must still re-render after Shuffle All. Curated rows are unaffected by scope by design.

**R6 — Dropdown-change path currently skips the blacklist.** `js/grid.js:480` uses
`[...db[selected]]` with **no** `isBlacklisted` filter, while both dice paths filter. Unifying the two
paths behind `_fillSlotsFromFolder()` will add the filter to the dropdown path. This is a small,
deliberate correctness improvement, not scope creep — but it *is* a behavior change and belongs in the
PR body.

**R7 — Deleted / renamed folder.** `resolveShuffleScope()` falls back to the first folder key and
`updateDirectoryDropdown()` writes that back, so the control and the Store can never disagree.
Deleting the folder currently in scope must not leave the dropdown blank or the scope dangling —
cover it in Test B's tail.

**R8 — Disconnected state.** `_showDisconnectedGitState()` (`app.js:155-162`) still owns
`'manual'`. `resolveShuffleScope(null)` returns `''`, so normal Shuffle's guard alert fires instead of
throwing. Verify the disconnected boot path still produces zero console errors (`boot-smoke` already
covers this).

**R9 — Out of scope, must remain untouched.** Runtime Grid shuffle and Hotswap panel shuffle live in
`js/launch.js` (`shuffleBtn.onclick` / `shuffleAllBtn.onclick`, ~`:935-960`) and operate per-panel off
`urlFolderMap`; they never read `#directory-dropdown` except through R1. Solo (`index2.html`,
`single-launch.js`) has its own `singleModeFolder` Store key. Neither is touched. Position/history,
Layer 2, drag reorder, cassette/GitHub persistence, blacklist and Builder/Preset isolation are all
outside every file changed here.

---

## 8. AUTOMATED TEST PLAN

Two files, matching the two harnesses already in the repo (`npm test` = `node --test`).

### 8.1 `test/shuffle-scope.test.js` — pure unit, no browser

Follows `test/stabilization.test.js` (fake `localStorage`, dynamic `import()`).

- `planShuffleAllFolders` — 3 folders × 6 slots: every folder used **exactly** twice, `unfilled` empty.
- `planShuffleAllFolders` — 5 folders × 6 slots: no folder used more than twice, `unfilled` empty.
- **TEST D exhaustion**: 2 folders × 6 slots → `Object.keys(slotFolders).length === 4`, no folder
  above 2, `unfilled` is exactly the last two unlocked indices in row order.
- 0 folders → every index in `unfilled`, `slotFolders` empty, no throw.
- Determinism: with a seeded `rng`, two runs produce identical `slotFolders`.
- `resolveShuffleScope`: stored-and-present → kept; stored-but-deleted → first key; unstored → first
  key; `null` db → `''`.

### 8.2 `test/prelaunch-shuffle-scope.test.js` — Playwright, index.html only

Reuse `boot-smoke.test.js`'s harness verbatim: `python3 -m http.server` on 127.0.0.1, `chromium`,
`page.addInitScript` seeding `git_sync_token` / `git_sync_repo`, and `page.route('https://api.github.com/**')`
returning a base64 fixture for `contents/links.json` (404 for `links-index.json`, empty presets for
`presets.json`). Also `page.route` the catch-all to `204` so no real network is touched.

Fixture database (URLs are only ever placed into text inputs; nothing loads them):

```
Folder_A: 20 × https://example.test/A/1..20
Folder_B: 20 × https://example.test/B/1..20
Folder_C: 20 × https://example.test/C/1..20
Folder_D: 20 × https://example.test/D/1..20
```

Folder membership is readable straight from the URL path, so every assertion is exact.

**TEST A — Sticky normal scope.** Select `Folder_A`. Click `#dice-shuffle-btn` **50 times**. After
*every* click assert (a) `#directory-dropdown` value is still `Folder_A`, and (b) every
`.url-grid-field` value matches `/example\.test\/A\//`. 50 iterations makes a false pass under the old
random-folder implementation ~`(1/4)^50`.

**TEST B — Explicit scope change.** Select `Folder_B`; shuffle 20×; assert every value matches `/\/B\//`
and none matches `/\/A\//`; dropdown stays `Folder_B`. Then reload the page and assert the dropdown
still reads `Folder_B` — this is the assertion that proves W3 is fixed. Tail: delete `Folder_B` from
the routed fixture, reload, assert the dropdown shows a valid folder and `localStorage
.builder_shuffle_folder` matches it (R7).

**TEST C — Shuffle All does not destroy scope.** Select `Folder_A`. Click `#dice-shuffle-all-btn`.
Assert: dropdown still `Folder_A`; the set of folders across the 6 rows has ≥2 distinct members;
`localStorage.matrix_folder_map` has an entry per unlocked row. Then click `#dice-shuffle-btn` once and
assert **all** ordinary unlocked rows are back in `Folder_A` and the dropdown is unchanged.

**TEST D — MAX TWO, in the real UI.** Add rows to 8 slots with 4 folders available: run Shuffle All 20
times, and on each run assert no folder appears more than twice across the rows. Then the exhaustion
case: route a 2-folder fixture with 6 slots; capture all 6 input values before the press; after the
press assert exactly 4 rows changed, no folder used more than twice, and the last 2 rows hold their
**exact** pre-press values.

**TEST E — Locks.** 4 rows: row0 URL-locked (state 1) with a sentinel URL, row1 folder-locked (state
2) to `Folder_C`, rows 2-3 unlocked. Scope = `Folder_A`. Shuffle 20×: row0 is byte-identical every
time; row1 always matches `/\/C\//`; rows 2-3 always match `/\/A\//`. Repeat under Shuffle All: row0
still frozen, row1 still `Folder_C`, rows 2-3 spread across folders under MAX-2.

**TEST F — Persistence funnel.** After one Shuffle: `localStorage.loop_matrix_urls` deep-equals the
visible `.url-grid-field` values; `#btn-undo` becomes enabled; one Undo click restores the exact
pre-shuffle values. Assert `pushUndoSnapshot` fires **once** per shuffle press (undo twice → back two
generations, not one). Switch to Preset 1, shuffle, wait past the 1500 ms debounce and assert exactly
one `PUT contents/presets.json` was observed by the route handler — proving no direct Store bypass.
Finally assert `localStorage.builder_shuffle_folder` is **absent from** `loop_matrix_urls`/preset
payloads (R2) and that shuffling does **not** change it (R4). Add one launch assertion for R1: with
`Folder_A` in scope, click `#btn-launch-grid` and assert the first panel's
`iframe[data-source-folder]` equals the row's `folderMap` folder.

Registration: `npm test` picks both files up automatically (`node --test`); no config change needed.

---

## 9. HUMAN TESTS (exactly two)

**H1 — Scope stickiness.** Connect the real database on `index.html`. Pick a folder. Press **Shuffle**
about ten times, watching the dropdown: it must never move, and every link must stay inside that
folder. Reload the page: the dropdown must still show the same folder.

**H2 — Shuffle All is a generation, not a scope change.** With that folder still selected, press
**Shuffle All** once: the rows should visibly mix across folders while the dropdown does not move.
Press **Shuffle** once: every ordinary unlocked row must snap back into the selected folder.

Everything else in section 8 is deterministic and needs no human.

---

## 10. RECOMMENDED WORKER

**Codex.**

The diagnosis is complete and the change surface is small, bounded and mechanical: one new ~60-line
pure module, three lines in `storage.js`, three localized handler rewrites in `grid.js`, one insertion
in `folders.js`, two tooltip strings, and two test files whose harnesses already exist in the repo and
can be copied. Acceptance is fully expressible as assertions. There is no open design question left
except the MAX-2 exhaustion policy, which Section 6 Step 5 settles with a stated default and a named
alternative.

The two places that need care rather than volume — never dispatching `change` from
`updateDirectoryDropdown()` (R3), and not letting the scope write enter the undo/preset funnel (R4) —
are both single-line rules stated explicitly above.

Sonnet would also be fine. Reserve Opus for the follow-on question of whether Shuffle Scope should
eventually become per-workspace, which is a design decision and deliberately **not** part of this repair.

---

## 11. PASS / FAIL ASSESSMENT

**PASS — safely implementable as a narrow repair.**

Supporting evidence:

- **Bounded blast radius.** Four production files (`storage.js`, `grid.js`, `folders.js`,
  `index.html`) plus one new module. No shared code path with Runtime Grid, Hotswap, Solo, Triple,
  positions/history, Layer 2 or the cassette/GitHub layer.
- **No new state authority.** One Store preference key, one accessor module, and the DOM demoted from
  authority to view — a net *reduction* in competing owners, moving toward the *Single Source of
  Truth* and *"The DOM is never treated as state"* invariants rather than away from them.
- **The persistence funnel is untouched.** Both shuffle paths already end in `saveInputsToState()` →
  `_persistAndNotify()`; the repair changes only which folder pool feeds them.
- **Lock semantics are untouched.** `_applyShuffleToInputs`'s 0/1/2 handling is already correct and
  needs no edit; the main dropdown governs ordinary unlocked rows only, folder-locked rows remain a
  per-row exception scoped to their own folder — confirmed in code, not assumed.
- **Deterministic acceptance.** Every clause of the product contract maps to an assertion, and the
  50-iteration Test A makes regression to the old behavior statistically impossible to miss.

Two items require a decision rather than an implementation, and both are surfaced above rather than
resolved unilaterally: the MAX-2 exhaustion policy (Section 6, Step 5) and the `launch.js:264`
provenance delta (R1). Neither blocks the repair; both belong in the PR body for the owner's sign-off.

---

*End of report. No code was modified. Nothing was committed or pushed.*
