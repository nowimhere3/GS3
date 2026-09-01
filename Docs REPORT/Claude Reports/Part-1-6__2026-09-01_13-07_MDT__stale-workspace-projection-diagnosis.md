# GS3 Claude Architecture Report

**Part:** Part 1-6
**Date:** September 1, 2026
**Time:** 1:07 PM MDT
**Timezone:** Calgary, Alberta — America/Edmonton
**Agent:** Claude / Opus
**Role:** Architecture / Diagnosis
**Repository:** /home/dmcalorum/GS3

---

## Breadcrumb

**WAS** — `switchWorkspace()` is the only code path that copies a Preset's persisted content
into the shared Builder surface (`matrixUrls` / `folderMap` / `lockState`). It runs only when
the user CHANGES workspace tabs. Returning to the Builder with the same Preset already active
re-renders whatever those Store keys still hold from before the launch.

**IS** — The Builder rehydrates its working surface from the active Preset on resume, when the
persisted Preset and the surface actually differ, and flushes any pending preset mirror before
navigating away so that a difference can only ever mean "something else changed this Preset".

**WHY** — The stale projection is not cosmetic. The Builder's pre-launch working copy is still
wired to `notifyWorkspaceEdited()`, so the next keystroke in the Builder mirrors the STALE rows
back over the Preset and silently destroys the Runtime save.

---

## 0. Severity correction — this is data loss, not a display bug

Reproduced end-to-end in Chromium against a mocked GitHub, using the human's exact scenario:

```
1. Builder shows Preset 5    : [gallery, gallery,    chaturbate, elitebabes]
2. Runtime session (changed) : [gallery, chaturbate, chaturbate, elitebabes]
3. Preset 5 PERSISTED        : [gallery, chaturbate, chaturbate, elitebabes]   CORRECT
4. Builder rows on return    : [gallery, gallery,    chaturbate, elitebabes]   STALE
5. Clicking the ACTIVE tab   : no-op (guard) — no manual recovery path
6. Preset 5 after ONE Builder edit:
                               [EDITED,  gallery,    chaturbate, elitebabes]
   >>> the Runtime save was DESTROYED
```

Step 6 is the part that matters. The human's report stops at "the Builder is visually lying".
The system does not stop there: the lie is load-bearing, and the next edit writes it back.

---

## 1. Root cause

`js/workspace.js :: switchWorkspace()` is the **only** function that reads Preset persistence
into the shared Builder surface:

```js
const panels = getPresetPanels(preset);
Store.set('matrixUrls', panels.map(getUrlPanelSource));
Store.set('folderMap',  preset?.folderMap || {});
Store.set('lockState',  preset?.lockState || {});
```

It is called from exactly one place — `js/app.js :: _handleWorkspaceSwitch()` — which is
guarded:

```js
if (String(workspaceId) === String(getActiveWorkspaceId())) return; // already active
```

On Builder boot, `js/app.js` restores rows straight from the Store keys:

```js
const cachedUrls = Store.get('matrixUrls');
setTargetUrls(...cachedUrls...);
```

`_initWorkspaceTabs()` runs afterward, but only does `loadPresetsSilently()` +
`_renderWorkspaceTabs()`. It refreshes the **tab labels** from the freshly fetched presets and
never touches the **rows**. That is why the tab metadata can be right while the rows are wrong.

So: Runtime reads Preset persistence directly and is correct; the Builder reads a Store copy
that was last written before the launch, and nothing ever refreshes it.

---

## 2. Authorities involved

| Authority | Role | State after the Runtime save |
|---|---|---|
| **Preset persistence** (`presets.json` + GitHub) | Canonical saved Preset content | **Correct** — updated by `saveWorkspaceToPreset` |
| **Preset in-memory cache** (`state.js` presetsStructure) | Working copy of the above | **Correct** — `updatePresetInMemory` runs first, and `loadPresetsSilently()` refetches on Builder resume |
| **Builder shared surface** (`matrixUrls`/`folderMap`/`lockState`) | The Builder's live editing working copy for whichever workspace is active | **STALE** — nothing writes it |
| **Runtime Session** (`grid-session.js`) | Authoritative for live execution; isolated working copy | Correct, and correctly discarded on navigation |
| **`activeWorkspaceId`** | Which workspace the Builder is editing | Correct (`'5'`) — and its correctness is precisely what triggers the guard that blocks recovery |
| **DOM rows** | Projection of `state.js` targetUrls, seeded from the Store keys | Stale, faithfully |

Runtime isolation is intact and should stay that way: `grep Store.set js/triple-mode.js
js/grid-session.js` shows the Runtime writes only `tripleLayout`. It never touches the Builder
surface or `activeWorkspaceId`. The bug is the **absence of a rehydration path**, not a
violation of isolation.

---

## 3. Exact stale path

```
A. Builder, Preset 5 active
   switchWorkspace(5)  ->  Preset -> Store keys        [surface == preset]

B. Launch Grid
   saveInputsToState({checkpoint:false})
     -> Store.set(matrixUrls/folderMap/lockState)
     -> notifyWorkspaceEdited()  -> starts a 1500ms debounce
   window.location.href = 'index3.html?workspace=5'    <-- page unloads,
                                                            debounce timer dies

C. Runtime boot
   initGridSession() -> getPresetById(5) -> Preset persistence   (NOT the Store keys)
   => Runtime is correct

D. Runtime edit + Save Session As -> Preset 5
   saveWorkspaceToPreset(5, ...)
     -> updatePresetInMemory(5)       preset cache updated
     -> savePresetsToRemote()          GitHub updated
   Store keys: UNTOUCHED               [surface != preset]

E. Return to Builder  (<a href="index.html"> — a full load; also true via BFCache)
   boot(): setTargetUrls(Store.get('matrixUrls'))   <-- reads the pre-launch copy
   _initLaunchpad() -> renderInputRows()            <-- renders it
   _initWorkspaceTabs() -> loadPresetsSilently()    <-- refreshes tab LABELS only
   => rows stale, tab metadata fresh

F. Any Builder edit
   saveInputsToState() -> notifyWorkspaceEdited()
     -> saveWorkspaceToPreset(5, { panels: STALE ROWS })
   => the Runtime save is overwritten
```

---

## 4. Correct rehydration point

**`js/app.js :: _initWorkspaceTabs()`.**

It is the only function already invoked on **both** resume paths:

- normal full load — called at the end of `boot()`
- BFCache restore — called from the `pageshow` handler (`if (!event.persisted) return`)

and it already `await`s `loadPresetsSilently()`, so the fresh Preset is in memory at exactly
that moment. Rehydrating there needs no new fetch, no new lifecycle hook, and no new event.

Rehydration must happen **after** `loadPresetsSilently()` and **before**/with a re-render.

---

## 5. Dirty-working-copy protection

The decisive architectural fact, and the reason this fix is small:

> For a **Preset** workspace, the Preset *is* the save target of Builder edits.

`notifyWorkspaceEdited()` mirrors every Builder edit into that Preset (debounced 1500ms).
There is therefore no legitimate long-lived "unsaved Builder edit" state for a Preset to
protect — the Builder surface is *supposed* to converge to the Preset. (Live Builder is
different: its data lives directly in the Store keys with no second authority, so it must be
excluded from rehydration entirely.)

Two safeguards make this airtight:

**(a) Content comparison, not a version key.** Rehydrate only when the persisted Preset
actually differs from the current surface. No new persisted state, no fingerprint, and — since
`switchWorkspace()` calls `clearUndoHistory()` — this avoids needlessly destroying Builder undo
history on a BFCache restore where nothing changed.

**(b) Flush the pending mirror before leaving.** `notifyWorkspaceEdited()`'s 1500ms timer is
started and then immediately abandoned by `window.location.href = 'index3.html?...'`. The
Builder's last pre-launch edit can therefore never reach the Preset. This is a **real
pre-existing bug in its own right**, and it also matters here: without the flush, a difference
on resume is ambiguous ("Runtime changed it" vs "my own edit never landed"). With the flush, a
difference can only mean an external change, so rehydrating is unambiguously correct.

---

## 6. BFCache / pageshow

`js/app.js:230` is the only `pageshow` handler in the codebase:

```js
window.addEventListener('pageshow', async (event) => {
    if (!event.persisted) return;
    await _restoreGitSyncState(true);
    await _initWorkspaceTabs();
});
```

The return control is `<a href="index.html">` (index3.html:585 and :631), which is a normal
forward navigation and therefore a **full load** — BFCache is not involved in the primary path.
BFCache applies only if the user presses browser Back.

**Both paths are stale for the same reason**, and both already funnel through
`_initWorkspaceTabs()`. Putting the rehydrate there covers BFCache for free. No new `pageshow`
work, and no `visibilitychange` handler, is required.

---

## 7. Already-active tab behavior

**Recommendation: keep the guard, and let it become genuinely irrelevant.**

The `if (workspaceId === getActiveWorkspaceId()) return;` guard is correct in its own terms —
switching to the workspace you are already on should not clear undo history and re-render for
nothing. Removing it to create a manual "refresh" gesture would be fixing the symptom with a
gesture the user should never need to discover, and would make undo history randomly clearable
by a stray click.

Once resume-rehydration exists the stale state cannot persist to the point where a manual
refresh is needed. Leave the guard alone. This is explicitly secondary to the automatic path.

---

## 8. RECOMMENDED FIX (minimal worker implementation)

**Model A — rehydrate on Builder resume, comparison-gated, plus a debounce flush.**

Rejected alternatives, briefly:
- **Model B** (Runtime writes the Builder surface) — directly violates the non-negotiable
  isolation invariant, and still fails when the Builder is resumed in another tab.
- **Model C** (version/fingerprint) — needs a new persisted key and a new invariant to answer a
  question a direct content comparison already answers for free. Over-engineered here.
- **Model D** (explicit resume contract via URL/Store flag) — only covers return-from-Runtime;
  breaks for a second tab, a typed URL, or any other resume, and couples Runtime to Builder.

### Change 1 — `js/workspace.js`: expose a flush, and a comparison-gated rehydrate

```js
/** Force any pending debounced preset mirror to run now. Called before the
 *  page navigates away, so a Builder edit is never lost to a dying timer. */
export function flushPendingWorkspaceSync() {
    if (!_debounceTimer) return;
    clearTimeout(_debounceTimer);
    _debounceTimer = null;
    // re-run the mirror synchronously with the current surface
    const presetId = getActivePresetId();
    if (presetId === null) return;
    saveWorkspaceToPreset(presetId, {
        panels: normalizePanelsArray(Store.get('matrixUrls') || []),
        folderMap: Store.get('folderMap') || {},
        lockState: Store.get('lockState') || {},
    });
}

/**
 * Re-read the active PRESET into the shared Builder surface when they have
 * diverged — i.e. something else (a Runtime "Save Session As") changed it
 * while the Builder was not looking. A no-op for Live Builder, whose data has
 * no second authority, and a no-op when nothing changed, so Builder undo
 * history is not cleared for free.
 * @returns {boolean} whether the surface was refreshed
 */
export function rehydrateActiveWorkspaceIfStale() {
    if (isLiveBuilder()) return false;
    const preset = getPresetById(getActivePresetId());
    if (!preset) return false;
    const presetUrls = getPresetPanels(preset).map(getUrlPanelSource);
    const same = JSON.stringify({
        u: presetUrls,
        f: preset.folderMap || {},
        l: preset.lockState || {},
    }) === JSON.stringify({
        u: Store.get('matrixUrls') || [],
        f: Store.get('folderMap') || {},
        l: Store.get('lockState') || {},
    });
    if (same) return false;
    switchWorkspace(getActiveWorkspaceId()); // the existing, tested rehydration path
    return true;
}
```

`switchWorkspace()` is reused deliberately — it is the one function that owns
Preset → surface copying, and reusing it keeps that single authority.

### Change 2 — `js/app.js`: rehydrate on resume

```js
async function _initWorkspaceTabs() {
    const tabsEl = document.getElementById('workspace-tabs');
    if (!tabsEl) return;
    await loadPresetsSilently();               // fresh preset data
    if (rehydrateActiveWorkspaceIfStale()) renderInputRows();
    _renderWorkspaceTabs(tabsEl);
}
```

### Change 3 — `js/app.js`: flush before leaving for the Runtime

```js
document.getElementById('btn-launch-grid')?.addEventListener('click', () => {
    saveInputsToState({ checkpoint: false });
    flushPendingWorkspaceSync();               // do not abandon the mirror
    const workspaceId = getActiveWorkspaceId();
    window.location.href = `index3.html?workspace=${encodeURIComponent(workspaceId)}`;
});
```

Optionally also `window.addEventListener('pagehide', flushPendingWorkspaceSync)` to cover
leaving by any other route. The worker should confirm `savePresetsToRemote` tolerates being
started during unload (the in-memory update lands regardless; the network push may not, which
is acceptable and no worse than today).

**Three small changes. No new storage key. No new invariant. No Workspace refactor.**

---

## 9. Tests

**Save case (the reported bug)**
1. Preset A = X. Select it in the Builder; assert rows = X.
2. Launch Grid; change the Runtime to Y; Save Session As → Preset A.
3. Return to the Builder. **Assert rows = Y**, and `Store.get('matrixUrls') === Y`.

**No-save case (isolation must survive)**
4. Preset A = X. Launch Grid; change the Runtime to Y; **do not save**; return.
5. **Assert rows = X**, and that Preset A's persisted panels are still X.

**Different-preset save**
6. Launch from Preset A; Save Session As → Preset **B**; return with A still active.
7. **Assert A is unchanged** and the Builder shows A, not B.

**Live Builder is never rehydrated**
8. Live Builder active with surface Z; a Preset changes externally; resume.
9. **Assert the Live Builder rows are still Z.**

**Builder edits are not clobbered**
10. Resume (rehydrate runs), then type a new URL into row 0 and wait past the debounce.
11. **Assert the Preset now contains the edit** — i.e. rehydration ran before the edit and did
    not re-run over it. A second resume must then show the edited value.

**No unnecessary rehydration**
12. Resume twice with nothing changed. Assert `rehydrateActiveWorkspaceIfStale()` returns
    `false` the second time and Builder undo history survives.

**Flush**
13. Type into a row and immediately click Launch Grid. **Assert the Preset received that edit**
    (today it is lost to the dying debounce).

**BFCache**
14. Simulate `pageshow` with `persisted: true` after an external Preset change; assert the rows
    refresh.

**Regression guard**
15. Assert the Runtime still writes only `tripleLayout` to Store — isolation unchanged.

---

## 10. Risks

- **`switchWorkspace()` clears undo history.** The comparison gate keeps this from firing when
  nothing changed; when something did change, clearing is arguably correct because the base
  moved. Worth confirming with the human.
- **Flush during unload** may not complete its network push. The in-memory preset update still
  happens, and the next `loadPresetsSilently()` would re-fetch the older remote copy — so a
  fully offline flush can still lose the last edit. This is strictly better than today (where
  it is always lost) but is not a guarantee.
- **JSON.stringify comparison is key-order sensitive** for `folderMap`/`lockState`. Both are
  produced by the same code paths so ordering is stable in practice; a worker who wants
  certainty should compare normalized entries rather than raw stringify.

---

## Related finding — recorded, NOT investigated

**Pending debounce is abandoned on navigation.** `notifyWorkspaceEdited()` starts a 1500ms
timer that `window.location.href` immediately kills, so the last Builder edit before Launch
Grid never reaches the Preset. This is a pre-existing bug independent of the stale projection,
and Change 3 above addresses it because the recommended fix depends on it. Flagged so it is a
conscious decision rather than a side effect.

## Out of scope — untouched

Fill Panel, Hotswap UX, dice presentation, Automations, Runtime Events, Capability Detection,
Builder Duplicate UI, Phase 5, unrelated Preset/serialization work.
