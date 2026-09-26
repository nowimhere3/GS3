# Stage 2.5 — Layer Clarity + Bottom Runtime Shell Stage C — implementation

**Calgary time:** 2026-09-09 14:30 MDT
**Branch:** `main` @ `d1b0568` + uncommitted working tree
**Git:** no commit, no push (per restriction)

---

## 1. Starting state

`git status`/`git diff`/`git log -3` at the start showed the tree already contained,
uncommitted and preserved throughout this task: the Stage 2 UI-polish pass (GS3-owned
dark scrollbars on index.html/index2.html/index3.html/settings.html, a Settings section
reorder, and a Settings layout-row icon "button shell" visual refinement). None of it was
reset, discarded, or reintroduced independently — this task's edits are additive on top.

Read before any edit: all of `Docs ANCHOR` (000/001/004/006/007/008/010/011/999), and the
newest relevant reports (`Bottom-Runtime-Shell` architecture, `Bottom-Shell-B1-Polish...`,
`Post-B1-Runtime-UX-Geometry-Refinement`). Confirmed Bottom Runtime Shell Stages A and B
(shell geometry, Dock reserve, z-scale, Master Redo, Grid layout shortcuts, layout/general
overflow gateways) were already committed at `d1b0568` — this task is Stage C only.

---

## 2. Capability inventory / matrix (pre-existing vs. added this pass)

| Master control | Layer-scoped before this pass | After this pass |
|---|---|---|
| 🎲 Shuffle | ✅ `LAYER_SCOPED_ACTIONS` | ✅ unchanged, now single-target (see §4) |
| 🎲🎲 Shuffle All | ✅ | ✅ unchanged, single-target |
| ↩ Undo | ✅ | ✅ unchanged, single-target |
| ↪ Redo | ✅ (nested receiver already implemented — the `triple-mode.js:1170` empty stub the architecture report worried about is **not present** in this codebase; Stage B already closed it) | ✅ unchanged, single-target |
| ⟳ Reload (panel-level) | ✅ | ✅ unchanged |
| 🌐 Folder (Master) | ❌ not forwardable | ✅ new — `MASTER_LAYER_ACTIONS`, payload `{folder}` |
| ▦ Layout | ❌ not forwardable | ✅ new — payload `{layout}` |
| 💾 Save Session As | ❌ not forwardable | ✅ new — payload `{presetId}` |
| Nested status | ❌ none | ✅ new — `nestedStatus` report, shown only for the targeted nested Runtime |
| 🎬 Close / ⚙ Launchpad (bar) | shell/container — no layer | unchanged, correctly not routed |

Category D (no meaningful nested equivalent): none newly discovered; the four above were
already the complete, honest "must route or leave visible" list from the prior architecture
report, and all four now route.

**Solo (index2.html) is category D by construction, not oversight**: it has no
`_installLayerScopeReceiver`, no per-Panel/Position system to route through, and — since it
is a single iframe with no Panel system — it can never itself *host* a nested Runtime
either. Suppressing its own nested-shell-when-nested would strip Shuffle/Folder/etc. with
no replacement route, so per the acceptance rule its `html.is-nested #orchestration-dock`
relocation workaround is **left in place**, and this is recorded as a deferred blocker in
`999-NEXT.md`, not silently skipped.

---

## 3. Exact `[L2-P#]` model implemented

- `_sessionLayerTwoSlots()` (unchanged) enumerates genuinely nested, visibly-positioned
  Panels.
- `_effectiveMasterLayerTarget()` (new) resolves the selector's live meaning: an explicit
  `L1` pick is sticky; an explicit slot pick is sticky as long as that Runtime is still
  truthfully nested at a visible Position; otherwise the first remaining nested Runtime is
  followed automatically (never silently targeting nothing) — generalizing the existing
  "absence never rewrites the preference" rule from a boolean to a set.
- `_refreshMasterLayerSelector()` rebuilds `#master-layer-selector`'s buttons from scratch
  on every refresh: one `L2-P{position}` button per truthfully-nested slot (label from
  `resolvePositionOfSlot()`, `dataset.slot` carrying the stable slot index), plus one `L1`
  button (`data-layer="L1"`, preserved for existing test compatibility).
- `_dispatchMasterToLayerTwo(actionKey, payload)` (rewritten) now targets the ONE effective
  slot — never fans out to every nested Runtime — for both key-only (`LAYER_SCOPED_ACTIONS`)
  and payload-carrying (`MASTER_LAYER_ACTIONS`) actions.

Mechanically proven (new tests, §10): a second nested Runtime adds a second button; moving
the hosting Panel relabels the SAME target (`L2-P1` → `L2-P2`) with zero reload; targeting
one of two simultaneous nested Runtimes reaches only that one (postMessage spy on both).

---

## 4. Nested local label implementation

`_positionLabelFor()`/`_positionLongLabelFor()` (triple-mode.js) key off a new module-level
`IS_NESTED` constant (`document.documentElement.classList.contains('is-nested')`, read once
— a browser fact, never Runtime Session state, per `000-INVARIANTS.md`). When nested, local
Position labels/tooltips read `L2 · P#` / `Layer 2 · Position #` instead of `Position #`;
the outer (un-nested) Runtime is unaffected. This is deliberately a different grammar from
the Master's `L2-P#` addressing — see `006-TERMINOLOGY.md` § L2-P# addressing.

---

## 5. Visual Layer treatment

`html.is-nested .hotswap-toolbar` (index3.html) now carries a subtle graphite/smoky
background/border tint distinct from the near-black L1 treatment, reusing the existing
`.is-nested` state hook. Mechanically proven (not screenshot-only): a computed-style
comparison between nested and outer `.hotswap-toolbar` background colors.

---

## 6. Routing added/reused

- `js/launch.js`: new `MASTER_LAYER_ACTIONS = new Set(['folder', 'layout', 'saveSessionAs'])`
  — kept separate from `LAYER_SCOPED_ACTIONS` because these are Master-Bar-only concepts
  with no per-panel Hotswap Chrome counterpart (a panel's own 🌐 Folder assigns *that
  container's* folder — a different action that must never be forwarded by this key).
- `js/triple-mode.js`: one `_doMaster*` function per routed action
  (`_doMasterShuffle/_doMasterShuffleAll/_doMasterUndo/_doMasterRedo/_doMasterFolder/
  _doMasterLayout/_doMasterSaveSessionAs`), each checking `_dispatchMasterToLayerTwo()`
  first and falling through to the existing local implementation otherwise. Both the
  (possibly nested-suppressed) button/menu click handlers AND `_installLayerScopeReceiver`'s
  forwarded-action handlers call these same functions — so a doubly-nested Runtime forwards
  or acts correctly with no special-casing.
- `_installLayerScopeReceiver` extended to accept `MASTER_LAYER_ACTIONS` (payload-bearing)
  alongside the existing key-only set, plus a new `nestedStatus` message kind handled
  separately (not an action to run, but a status string to display).
- Payload validation on receipt, matching the existing launch-handoff discipline: `layout`
  is checked against `LAYOUT_IDS`; `saveSessionAs`'s `presetId` is checked against
  `getPresets()` before being acted on.

All existing key-only routing (Shuffle/Shuffle All/Undo/Redo/Reload) is **unchanged in
behavior** except for the single-target rewrite described in §3 — no reworking of already-
correct implementations.

---

## 7. Nested status reporting

`_installNestedStatusReporter(statusEl)` (nested side): a `MutationObserver` on the local
`#master-status` element mirrors its text outward via
`postMessage({source: LAYER_MESSAGE_SOURCE, action: 'nestedStatus', text})` — chosen over
touching every call site that sets `statusEl.textContent` (there are several: boot, DB
connect, render, undo/redo). Parent side: `_slotForSource()` (new, reused pattern from the
existing launch-handoff `contentWindow === event.source` lookup) resolves the reporting
frame to a slot; `_nestedStatusBySlot` stores the latest text; `_refreshMasterNestedStatus()`
shows it in a new `#master-nested-status` sibling span, only while the selector's effective
target is that specific nested Runtime. No second status system — one pathway, one new
display element.

---

## 8. Nested shell suppression

`IS_NESTED` now gates **construction**, not merely visibility. At boot, when nested,
`#master-bar` and `#orchestration-dock` are `.remove()`d from the DOM before any handler is
wired to them, and the Master-bar-only wiring block (toggle, layout/general overflow menus,
folder dropdown, Shuffle/Shuffle All/Undo/Redo/Save Session As button handlers,
`_installDockReserve`) is skipped entirely (`if (!IS_NESTED) { ... }`). `_installLayerScopeReceiver`
still installs unconditionally — a nested Runtime must still be able to *receive* forwarded
commands even though it renders no shell of its own to send them from.

Sequencing followed the required order: routing (§6) landed **before** suppression, and the
acceptance gate (§10) proves every control the nested shell used to expose is reachable
before suppression is exercised in tests.

---

## 9. Obsolete workaround removed

`html.is-nested #orchestration-dock { right: auto; left: 18px; }` deleted from
`index3.html` — with the Dock never constructed while nested, there is no second Dock left
to relocate. The surrounding comment was rewritten to explain the retirement rather than
left describing a mechanism that no longer exists. `index2.html`'s equivalent relocation
rule is **deliberately left in place** (§2) — Solo has no routing to replace it yet.

---

## 10. Tests added (all in `test/boot-smoke.test.js`, section "Stage 2.5")

1. `[L2-P#] truthfully addresses each nested Runtime by its HOST Position, and tracks a
   move` — no L2-P2/P3 when nothing hosts one there; a second nested Runtime adds a second
   button; moving the hosting Panel relabels the same target with zero reload.
2. `the selector targets exactly ONE nested Runtime, never broadcasting` — postMessage spy
   on two simultaneous nested Runtimes proves single-target dispatch both ways.
3. `Folder, Layout and Save Session As route to the targeted nested Runtime only` — exact
   payload shape asserted for all three; the other nested Runtime and the outer Grid's own
   layout are proven untouched.
4. `Layout forwarding actually changes the targeted nested Grid, real effect not just the
   message` — the nested Grid's own `#triple-layout` class changes; the outer Grid's does
   not.
5. `nested local Position labels read "L2 · P#", distinct from the host conductor's
   "L2-P#" addressing` — both vocabularies asserted side by side for the same Runtime.
6. `nested Chrome carries a subtle, distinct visual hook` — computed-style comparison, not
   a screenshot.
7. `a nested Grid Runtime constructs no global Master Bar or Orchestration Dock, but keeps
   local Chrome and resizers; a standalone Grid still renders both` — `=== null` (not
   merely hidden) for the nested case; both elements present, exactly once, at top level and
   for a standalone (never-nested) Grid.

One existing test was **updated, not rewritten**: `Layer identity: typed Workspace survives
boot, Copy, Save As, relaunch and removal` now explicitly targets `L1` before invoking Save
Session As. This is a required consequence of §6 (Save Session As is now Layer-scoped and,
like Shuffle/Undo before it, defaults to the nested target the moment one exists) — the
test's own intent (proving the OUTER session's Save) needed an explicit L1 click to keep
testing that, exactly as a human saving the Runtime they are looking at would click.

---

## 11. Targeted / full suite results

- New Stage 2.5 tests: **7/7 pass** in isolation.
- Full `node --test test/positions-history.test.js`: **51/51 pass**.
- Full `node --test test/boot-smoke.test.js`, run twice:
  - Run 1: **96/98 pass** — the two failures were `Part 1-2 Runway tracks website top…`
    (reproduces with the same measured values documented as pre-existing/unrelated in
    every prior Stage A/B/B.1/B.2 report) and `Copy to Position copies URL and ROOT…`
    (a canary-tick timing assertion that passed in isolation immediately after — the same
    resource-contention-under-full-suite flake class the Post-B.1 report already documented
    for a different test).
  - Run 2: **96/96 pass** — both of the above passed clean.
- `git diff --check`: clean (exit 0, no output).
- `node --check` on every JS file touched (`triple-mode.js`, `launch.js`, `boot-smoke.test.js`): clean.

No test failure is attributable to this task's changes; both flakes reproduce the
established, previously-documented pattern (isolated rerun passes).

---

## 12. Known unrelated failures

- `Part 1-2 Runway tracks website top and active Runway pickers own stable geometry` —
  pre-existing, documented in the Stage A/B/B.1/B.2/Post-B.1 reports with the same measured
  values (`websiteTopOffset: 0, rightInset: 445, inside: false`). Not touched by this task.
- Occasional canary-tick-timing flakes under full-suite resource contention (this run:
  `Copy to Position copies URL and ROOT to the destination, undoably`) — same class as the
  `Move to Position…` flake the Post-B.1 report documented; passes reliably in isolation and
  on repeat full-suite runs.

---

## 13. Anchors updated

- `Docs ANCHOR/000-INVARIANTS.md` — new § *Runtime Shell Ownership* (the shell-ownership
  rule plus the L2-P# single-target invariant).
- `Docs ANCHOR/006-TERMINOLOGY.md` — new § *L2-P# addressing*, distinguishing the Master
  conductor's HOST-Position addressing from a nested Runtime's own local `L2 · P#` labels.
- `Docs ANCHOR/011-HOTSWAP-CHROME.md` — four new breadcrumb sections: explicit `[L2-P#]`
  addressing superseding broadcast; nested local labels; subtle nested visual treatment;
  nested global-shell suppression after routing parity (including the Solo deferral).
- `Docs ANCHOR/999-NEXT.md` — Stage 2.5 summary, explicit Solo-suppression deferral with
  its reason, and the future executor-split breadcrumb (index1.html / Stream Runtime /
  Design-Time separation) with the explicit statement that manual Layer selection is an
  interaction scope, not an Automation execution gate.
- `Docs REPORT/Tests/TESTING.md` — new §4.24 summarizing the Stage 2.5 mechanical coverage.
- `001-PHILOSOPHY.md` — verified unchanged: § *The Conductor* (Panels are the talent, the
  bottom Runtime shell is the conductor; one global shell per viewport) was already present
  from the prior B.1 pass and needed no further edit.

---

## 14. Explicit confirmation — NOT implemented this pass

- `index1.html` was not created; `index.html` was not split.
- Launcher redesign, Automation recipes, Auto Play: not implemented.
- Browser Gallery Hearts, `♡P# / ♥P#`, `FAVORITE_CURRENT`, BG capability handshake, Heart
  shortcuts: not implemented — only the pre-existing breadcrumb in `999-NEXT.md` remains.
- Solo Ghost toolbar refresh, Rest/Hover opacity controls: not implemented.
- Portrait/Auto orientation, new Grid layout transition semantics, Top2 ↔ Bottom2 mirroring:
  not implemented.
- No new dependencies. No unrelated UI cleanup beyond what Stage C itself required
  (the two comment rewrites in index3.html explaining retired/changed mechanisms).
- Stage 2.1 scrollbar/layout polish (the pre-existing uncommitted diff) was not touched
  except where verification required confirming it still passed (§11 — Stage 2.1 tests
  all still pass unchanged).

---

## 15. Current git status

```
Changes not staged for commit:
  modified:   Docs ANCHOR/000-INVARIANTS.md
  modified:   Docs ANCHOR/006-TERMINOLOGY.md
  modified:   Docs ANCHOR/011-HOTSWAP-CHROME.md
  modified:   Docs ANCHOR/999-NEXT.md
  modified:   Docs REPORT/Tests/TESTING.md
  modified:   index.html
  modified:   index2.html
  modified:   index3.html
  modified:   js/launch.js
  modified:   js/settings.js
  modified:   js/triple-mode.js
  modified:   settings.html
  modified:   test/boot-smoke.test.js

Untracked files:
  Docs REPORT/AntiGravity/
  Docs REPORT/Claude Reports/Stage-2.5-Layer-Clarity-Bottom-Shell-StageC__2026-09-09_14-30_MDT__implementation.md
```

`index.html`, `index2.html`, `js/settings.js`, `settings.html` carry only the pre-existing
Stage 2 UI-polish diff (scrollbars, Settings reorder/icon-shell) — untouched by this task
except that `index2.html`'s nested-shell relocation workaround was deliberately left as-is
(§2, §9). `index3.html`, `js/launch.js`, `js/triple-mode.js` carry this task's Stage C work.
No commit, no push, per instruction.
