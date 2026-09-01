# GS3 Claude Implementation Report

**Part:** Part 1-6 (combined: 1-6 + 1-6B)
**Date:** September 1, 2026
**Time:** 2:09 PM MDT
**Timezone:** Calgary, Alberta — America/Edmonton
**Agent:** Claude / Sonnet 5
**Role:** Implementation
**Repository:** /home/dmcalorum/GS3

---

## Breadcrumb

**WAS** — `switchWorkspace()` was the only path that copied a Preset's persisted content into
the shared Builder surface, and it only ran on an actual tab change, so returning to the Builder
with the same Preset still active re-rendered stale `matrixUrls`/`folderMap`/`lockState`, and the
next Builder edit mirrored those stale rows back over the Preset, destroying a Runtime save.
Separately, outside-click dismissal used the whole Hotswap Chrome family as its boundary, so a
click on the Top Toolbar, Position, or `···` left an open utility open, and Assign Folder focused
nothing so Escape only worked by accident. Toolbar Shortcuts also carried its own ON/OFF switch
in Settings, alongside a count and an order.

**IS** — The Builder compares the active Preset's persisted content against its own surface on
resume and rehydrates only when they differ, while Live Builder is never touched; any pending
debounced Preset mirror is flushed before Launch Grid navigates away. An open utility's dismissal
boundary is itself plus its invoking control, never the whole Chrome family; any other GS3
control closes it without swallowing that control's own click; Assign Folder now owns focus on
its own container so Escape is deterministic. Toolbar Shortcuts are structurally available
whenever the Top Toolbar is revealed, configured only through count and order — the separate
enable switch is gone, and the Runway's own ON/OFF is untouched.

**WHY** — The Builder must never present, and then itself persist, a stale Workspace projection.
Two sibling utilities behaving differently was invisible to the user until they clicked in the
"wrong" place, and dismissal must never require completing an action. The Toolbar Shortcuts
enable switch duplicated a decision the Top/Deep Cuts cutoff already expressed.

---

## 1. Files changed

```
js/workspace.js                  — flushPendingWorkspaceSync(), rehydrateActiveWorkspaceIfStale()
js/app.js                        — wired both into _initWorkspaceTabs() and Launch Grid
js/launch.js                     — inActiveUtility(), activePickerAnchor, Assign Folder focus,
                                    removed isTopShortcutsEnabled() gating
js/hotswap-chrome.js             — removed isTopShortcutsEnabled/setTopShortcutsEnabled
js/settings.js                   — Top Shortcuts collection wired without an enable switch
settings.html                    — removed the Toolbar Shortcuts ON/OFF switch markup
docs/000-INVARIANTS.md           — new "Builder Projection Freshness" invariant
docs/011-HOTSWAP-CHROME.md       — Part 1-6 breadcrumb (dismissal + toggle removal)
docs/Tests/TESTING.md            — 3.4a, 4.23, and a Settings-hierarchy update
test/boot-smoke.test.js          — 4 new tests (rehydration x2, click-away, Assign Folder focus),
                                    1 test updated (Toolbar Shortcuts switch removal)
test/positions-history.test.js   — 1 test updated (no separate enable switch)
```

`index.html`, `index3.html`, and the two other `test/boot-smoke.test.js` /
`docs/011-HOTSWAP-CHROME.md` / `docs/Tests/TESTING.md` diff hunks that predate this session
(Part 1-5 Runway dice-cuddle polish) were left untouched, as instructed.

---

## 2. Part A — Builder rehydration / data-loss fix

### Root fix (`js/workspace.js`)

- **`flushPendingWorkspaceSync()`** — if a debounced Preset mirror is pending, clears the timer
  and immediately calls `saveWorkspaceToPreset()` with the CURRENT `matrixUrls`/`folderMap`/
  `lockState`. No-op for Live Builder (nothing to mirror) and no-op with nothing pending.
- **`rehydrateActiveWorkspaceIfStale()`** — no-op for Live Builder. Otherwise reads the active
  Preset's persisted panels/folderMap/lockState and compares them against the current Builder
  surface. URLs are compared via `JSON.stringify` (array order matters and is stable); folderMap
  and lockState are compared via a small order-insensitive normalized-entries comparison
  (`_sameNormalizedMap`) rather than a raw `JSON.stringify`, per the diagnosis report's own risk
  note about key-order fragility. Only on an actual difference does it call the existing,
  tested `switchWorkspace(activeWorkspaceId)` — no second Preset→surface copy path was created.

### Call sites (`js/app.js`)

- `_initWorkspaceTabs()` now calls `rehydrateActiveWorkspaceIfStale()` right after
  `loadPresetsSilently()` and re-renders only if it returned `true`. This function already runs
  on both the normal boot path and the `pageshow`/BFCache path, so both are covered for free —
  no new lifecycle listener was added.
- The Launch Grid click handler now calls `flushPendingWorkspaceSync()` between
  `saveInputsToState()` and the `window.location.href` navigation, so the last Builder edit
  cannot be lost to the dying 1500ms debounce timer.
- The active-tab guard in `_handleWorkspaceSwitch()` was left untouched, as instructed — clicking
  an already-active tab remains a no-op, and correctness now comes from the automatic resume
  path rather than a manual refresh gesture.

---

## 3. Part B — Utility dismissal consistency

### Narrow click-away boundary (`js/launch.js`)

- Added `activePickerAnchor`, retained while a utility is open and cleared inside the single
  canonical `closePicker()`.
- Added `inActiveUtility(node)` — true only for a node inside the open picker row itself, or
  inside the control that invoked it. Deliberately separate from `inChromeFamily`, which still
  answers its own, different question (should the 850ms retract timer run) and is unchanged.
- The `document` `pointerdown` handler now runs `if (hasOpenPicker() && !inActiveUtility(e.target))
  closePicker();` unconditionally first, then falls through to the pre-existing (unchanged)
  Deep Cuts / Position menu dismissal logic. No `preventDefault`/`stopPropagation` was added —
  the clicked control's own handler still fires in the same gesture.
- `folderBtn.onclick` and `toggleBtn.onclick` each set `activePickerAnchor` to themselves when
  opening, so the same-control toggle still closes in one click rather than closing and then
  reopening on the same gesture.

### Assign Folder focus (`js/launch.js`)

- `folderRow.tabIndex = -1` plus a `requestAnimationFrame`-scheduled
  `folderRow.focus({ preventScroll: true })`, guarded by re-checking `.open` in case the picker
  closed before the frame fires. This makes Escape reach the panel's existing `keydown` handler
  deterministically, the same way Edit URL's explicit `input.focus()` already did. It does not
  auto-select a folder, does not scroll, and does not reveal the Top Toolbar (the existing
  `focusin` handler already excludes picker rows from `inRailFamily`, so this was untouched).

### Preserved as-is

- `closePicker()` remains the single canonical close path for both utilities — no
  `closeUrlPicker()`/`closeFolderPicker()` were introduced.
- The iframe `focus` listener's cross-origin dismissal is unchanged and still works; its honest
  residual limitation (a click inside an *already-focused* cross-origin iframe emits no
  parent-visible event) is documented in `docs/Tests/TESTING.md` §4.23, not papered over with an
  overlay.
- `.hotswap-folder-item` divs were not converted to `<button>`s — explicitly out of scope per the
  diagnosis report, left as a future accessibility follow-up.

---

## 4. Part C — Toolbar Shortcuts ON/OFF removal

- `isTopShortcutsEnabled()` / `setTopShortcutsEnabled()` removed from `js/hotswap-chrome.js`;
  `getActiveTopShortcuts()` no longer gates on it.
- `js/launch.js`'s `configuredTopKeys` computation no longer checks the flag.
- `js/settings.js`'s shared `_wireCollection()` helper now accepts an *optional* enable switch
  (`enabledId`/`isEnabled`/`setEnabled`) — the Runway call site still passes all three; the Top
  Shortcuts call site passes none, so it renders only count + order.
- `settings.html` no longer has the `#top-shortcuts-enabled` checkbox; the now-unreachable
  `#top-shortcuts-config.disabled` CSS rule was trimmed to the Runway's config element only.
- The Store key `hotswap_top_shortcuts_enabled` (and its `true`/`false` value) is left in place
  as inert compatibility debris — nothing writes it anymore, and nothing reads it, so a customer
  who previously had it `false` now gets normal, always-available Toolbar Shortcuts. No
  destructive migration was performed.
- Quick Action Shortcut Runway's own ON/OFF switch (`isQuickActionRunwayEnabled` /
  `setQuickActionRunwayEnabled`) is completely untouched.

---

## 5. Targeted test results

All run individually before the full-suite pass, all green:

```
✔ Builder rehydrates a stale Workspace projection instead of clobbering a Runtime save
✔ Builder rehydration respects isolation: no-save, Live Builder, and a different-preset save
✔ an open utility is dismissed by ANY other GS3 control, without swallowing that control's own click
✔ Assign Folder owns its own focus, so Escape closes it deterministically
✔ Part 1-4 picker actions share one website-top-right dock and canonical click-away   (regression)
✔ Top Shortcuts are their own collection, independent of the runway                    (updated)
```

The first test drives a real Builder → Launch Grid → Runtime edit → Save Session As → fresh
Builder reload round trip against a mocked GitHub `presets.json` backend (so persistence
genuinely survives real page navigations, not just an in-page function call), and additionally
proves the flush fix by editing a row and clicking Launch Grid with no pause for the debounce,
then reading the Runtime's own `getSessionUrls()` at boot to confirm the edit was already in the
Preset before the Runtime ever read it.

The second test exercises `switchWorkspace`/`notifyWorkspaceEdited`/`flushPendingWorkspaceSync`/
`rehydrateActiveWorkspaceIfStale` directly (still inside a real browser module context) to prove
no-save isolation, cross-preset isolation, Live Builder exclusion, and that a no-op rehydrate
neither re-fires nor clears undo history.

---

## 6. Full suite result

```
node --test   (all three files: boot-smoke, positions-history, stabilization)
tests 118
pass 118
fail 0
cancelled 0
skipped 0
duration_ms ~112,000
```

No regressions in any pre-existing test, including the full Hotswap Chrome §4.18–4.22 suite, all
Position/Undo/Redo/navigation-history suites, and the unrelated Part 1-5 Runway dice-cuddle test
already pending in the working tree.

---

## 7. `git diff --check`

Clean — exit code 0, no whitespace errors.

---

## 8. Known limitations

- **Offline flush is not a guarantee.** `flushPendingWorkspaceSync()`'s in-memory preset update
  always happens; if the network push itself fails (e.g. offline at the exact moment of
  navigation), the next `loadPresetsSilently()` re-fetch could still see an older remote copy.
  This is strictly better than before (where the edit was always lost to the dying timer) but is
  not airtight — flagged in the original diagnosis report as an accepted risk, not fixed here.
- **Cross-origin iframe click limitation is real, not fixed.** If a cross-origin iframe already
  holds focus when a utility opens, a subsequent click inside that site produces no
  parent-visible event, and the utility stays open until Escape, an outside click, or an action.
  Documented, not papered over with an overlay (which would intercept the customer's own first
  click into their site — explicitly forbidden).
- **`.hotswap-folder-item` remains a non-interactive `<div>`**, not a `<button>` — tab/arrow
  navigation of the folder list itself is a separate, explicitly out-of-scope accessibility
  follow-up.

---

## 9. Final `git status --short`

```
 M docs/000-INVARIANTS.md
 M docs/011-HOTSWAP-CHROME.md
 M docs/Tests/TESTING.md
 M index.html
 M index3.html
 M js/app.js
 M js/hotswap-chrome.js
 M js/launch.js
 M js/settings.js
 M js/workspace.js
 M settings.html
 M test/boot-smoke.test.js
 M test/positions-history.test.js
?? "docs/Claude Reports/Part-1-6B__2026-09-01_13-16_MDT__utility-dismissal-diagnosis.md"
?? "docs/Claude Reports/Part-1-6__2026-09-01_13-07_MDT__stale-workspace-projection-diagnosis.md"
?? "docs/Codex Reports/Part-1-5__2026-09-01_12-56_MDT__dice-cuddle-polish.md"
```

(`index.html`, `index3.html`, and the untracked Codex report predate this session — Part 1-5
Runway dice-cuddle polish, untouched here.)

---

## Explicit confirmation

```
Nothing committed.
Nothing pushed.
```
