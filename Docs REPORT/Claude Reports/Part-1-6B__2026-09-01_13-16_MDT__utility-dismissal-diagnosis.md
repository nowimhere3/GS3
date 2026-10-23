# GS3 Claude Architecture Report

**Part:** Part 1-6B (add-on to Part 1-6)
**Date:** September 1, 2026
**Time:** 1:16 PM MDT
**Timezone:** Calgary, Alberta — America/Edmonton
**Agent:** Claude / Opus
**Role:** Architecture / Diagnosis
**Repository:** /home/dmcalorum/GS3

---

## Breadcrumb

**WAS** — Outside-click dismissal used the whole Hotswap Chrome family as its boundary, so a
click on the Top Toolbar, the Position button or the `···` trigger left an open utility open.
Assign Folder focused nothing on open, so Escape only worked when focus happened to land inside
the panel by accident.

**IS** — An open utility owns the narrowest boundary: itself, plus the control that opened it.
Any click outside that closes it, without swallowing the click. Assign Folder takes focus on its
own container, making Escape deterministic. Both utilities share one `closePicker()`.

**WHY** — Two utilities presented as siblings behaved differently, and the difference was
invisible to the user. Dismissal must be predictable, and never require completing an action.

---

## 0. Measured behavior (before)

```
CLICK-AWAY MATRIX                      open -> after
  toggle  + Top Toolbar rail            true -> true    WRONG
  toggle  + Position button             true -> true    WRONG
  toggle  + ··· Deep Cuts trigger       true -> true    WRONG
  toggle  + Runway button               true -> false   ok
  toggle  + inside the utility          true -> true    ok
  folder  + Top Toolbar rail            true -> true    WRONG
  folder  + Position button             true -> true    WRONG
  folder  + ··· Deep Cuts trigger       true -> true    WRONG
  folder  + Runway button               true -> false   ok
  folder  + inside the utility          true -> true    ok

ESCAPE / FOCUS OWNERSHIP
  Edit URL after open  : activeElement = .hotswap-input   inPanel = true
  Assign Folder open   : activeElement = BODY             inPanel = FALSE

ALREADY CORRECT
  pointerdown handler preventDefault : false      (click is not swallowed)
  iframe focus dismissal             : closes the utility
  >850ms retract                     : does NOT dismiss
```

The human's summary was accurate but understated the shape: click-away is not "unreliable",
it is **deterministically broken for exactly three targets** and correct for the fourth. The
inconsistency is what made it feel random.

---

## 1. Root cause — click-away failure

`js/launch.js:681`

```js
document.addEventListener('pointerdown', (e) => {
    if (!overlay.classList.contains('open') && positionMenuEl.hidden && !hasOpenPicker()) return;
    if (inChromeFamily(e.target)) return;          // <-- the responsible guard
    closePicker();
    closeDeepCuts();
    closePositionMenu();
});
```

with (`js/launch.js:447`)

```js
const inChromeFamily = (node) => node instanceof Node
    && (toolbar.contains(node) || overlay.contains(node)
        || activationEl.contains(node) || positionMenuEl.contains(node)
        || pickerRows.some((row) => row.contains(node)));
```

One boundary is being used for two different jobs. `inChromeFamily` exists to answer *"is the
pointer still in Chrome, so the 850ms retract should not run?"* — where a broad boundary is
correct. It is then reused to answer *"should this open utility close?"* — where a broad
boundary is wrong.

The Runway happens to close correctly **only because `runwayEl` was never added to
`inChromeFamily`**. That is an accident, not a design, and it is the entire reason the
behavior looks inconsistent rather than uniformly broken.

---

## 2. Root cause — Escape asymmetry

The Escape listener is bound to the **panel** (`js/launch.js:673`), so it only receives key
events that bubble *through* the panel — i.e. only when `document.activeElement` is inside it.

| Utility | Focus on open | Escape |
|---|---|---|
| Edit URL | `inputField.focus()` — explicit, deterministic | reaches the panel handler, always |
| Assign Folder | nothing focused | `activeElement === BODY`, event never reaches the panel |

Measured above: `activeInPanel: true` for Edit URL, `false` for Assign Folder.

The hypothesis in the brief is confirmed, with one refinement worth stating: Assign Folder is
not *always* broken. Clicking a real `<button>` incidentally focuses it, and that focus is
inside the panel, so Escape works — until focus is lost. Clicking a `.hotswap-folder-item`
(a plain `<div>`, not focusable) moves focus to `body`, and any later click on non-focusable
chrome does the same. **That is precisely why the human observed "not reliably":** the folder
picker has no *owned* focus, so Escape reliability is left to chance.

---

## 3. Correct click-away boundary

The dismissal boundary for an open utility is **the utility itself, plus the control that
opened it** — not the Chrome family.

```
inside  = the open picker row
        + the anchor element that invoked it   (so the same-control toggle still works)
outside = literally everything else, including all other GS3 Chrome
```

The anchor exception is not cosmetic. Without it, `pointerdown` closes the picker and the
subsequent `click` on that same button re-opens it, breaking the existing toggle. The invoking
element is already captured — `actionInvocation = { anchor, placement }` in `buildMirror` — so
this needs no new concept, only retention of the anchor while the utility is open.

The 850ms retract keeps using `inChromeFamily` unchanged. Two questions, two predicates.

---

## 4. Focus strategy for Assign Folder

**Recommendation: focus the picker container itself.**

```js
folderRow.tabIndex = -1;                       // programmatically focusable, not tab-reachable
folderRow.focus({ preventScroll: true });      // after the row is opened and placed
```

Checked against every constraint in the brief:

| Requirement | Result |
|---|---|
| Escape deterministic | yes — focus is inside the panel, so keydown bubbles to the handler |
| Does not auto-select a folder | yes — the container takes focus, no option is chosen |
| Does not move scroll | yes — `preventScroll: true` |
| Does not open the Top Toolbar | yes — Part 1-2 split `focusin` so only `inRailFamily` reveals; picker rows are deliberately excluded, so this only calls `cancelRetract()` |
| Does not interfere with placement | yes — focus after `placePicker()`, in the same rAF |
| No new lifecycle controller | yes — reuses the existing focus/keydown plumbing |

**Converting `.hotswap-folder-item` divs to real `<button>`s is NOT required for this fix.**
It would make the options tab/arrow reachable, which is a genuine accessibility improvement,
but keyboard operability of the option list is a different problem from Escape determinism and
is not what the human reported. Recommend it as a separate, optional follow-up — not in this
pass.

---

## 5. Cross-origin website behavior — the honest boundary

| Signal | Observable from the parent? | Already used? |
|---|---|---|
| `pointerdown` on the parent document | yes | yes |
| iframe `focus` event | yes, cross-origin | yes (`js/launch.js:521`) — **verified closing the utility** |
| iframe `pointerenter` | yes | yes (schedules retract) |
| A click *inside* a cross-origin iframe | **no** — never reaches the parent | n/a |

The existing `iframe.addEventListener('focus', …)` is the right instrument and already works.
Its honest limit: `focus` fires on the *transition* into the frame. If the iframe already holds
focus when the utility opens, a subsequent click inside the website produces **no parent-visible
event at all**, and the utility will stay open until Escape, an outside click, or an action.

That residual case is a real browser boundary, not a defect. **Do not** paper over it with a
transparent overlay: that would intercept the customer's first website click, which is
explicitly forbidden and worse than the symptom.

---

## 6. Worker-ready implementation

### Change 1 — narrow the dismissal boundary (`js/launch.js`, the `document` pointerdown handler)

```js
// Retained while a utility is open so the control that opened it counts as
// "inside" — otherwise pointerdown closes and the following click re-opens.
let activePickerAnchor = null;

/** The dismissal boundary for an OPEN utility: itself + its invoking control.
 *  Deliberately NOT inChromeFamily — that predicate answers a different
 *  question (should the retract timer run) and is far too broad for this one. */
const inActiveUtility = (node) => node instanceof Node
    && (pickerRows.some((row) => row.classList.contains('open') && row.contains(node))
        || (activePickerAnchor && activePickerAnchor.contains(node)));

document.addEventListener('pointerdown', (e) => {
    // An open utility is dismissed by ANY click outside itself, including other
    // GS3 Chrome. Runs first and independently, and never returns early, so the
    // tray/position-menu rules below still apply. No preventDefault: the click
    // must still reach whatever the customer aimed at.
    if (hasOpenPicker() && !inActiveUtility(e.target)) closePicker();

    if (!overlay.classList.contains('open') && positionMenuEl.hidden) return;
    if (inChromeFamily(e.target)) return;   // unchanged: tray + position menu
    closeDeepCuts();
    closePositionMenu();
});
```

Set `activePickerAnchor` where the picker opens (the invocation context already carries it) and
clear it in `closePicker()`.

### Change 2 — give Assign Folder owned focus (`folderBtn.onclick`, after `placePicker`)

```js
folderRow.tabIndex = -1;
requestAnimationFrame(() => {
    if (folderRow.classList.contains('open')) folderRow.focus({ preventScroll: true });
});
```

### Change 3 — confirm the single canonical path

`closePicker()` (`js/launch.js:387`) already exists and is already the only close path for both
utilities — used by Escape (`closeDeepestChild`), the outside handler, iframe focus, both
commit paths, and both toggles. **Keep it singular.** Do not add `closeUrlPicker()` /
`closeFolderPicker()`. It must also clear `activePickerAnchor`.

**Three small changes. No new lifecycle, no new timer, no overlay.**

---

## 7. Tests

**Edit URL** — Escape closes · outside Top Toolbar click closes **and Reload still fires** ·
outside Runway click closes **and that shortcut still fires** · ordinary parent-document click
closes · commit closes.

**Assign Folder** — the identical five, with folder selection as the commit case.

**Both, shared**
- 850ms retract does **not** close an open utility (regression guard on Part 1-2).
- A click inside the utility does not close it.
- A click on the utility's own invoking control **toggles it closed once** (not close-then-reopen).
- Invoking from the Runway does not reveal the Top Toolbar (regression guard on Part 1-2).
- No transparent overlay element exists over the iframe at any point.
- `pointerdown` handler never sets `defaultPrevented` (assert on a cancelable event).
- Focus: after opening Assign Folder, `panel.contains(document.activeElement) === true`.
- Escape dispatched from `document.body` closes the utility **after** the focus fix (today it
  does not — this is the direct regression test for §2).

**Cross-origin**
- Dispatching `focus` on the panel iframe closes an open utility.
- Document the untestable case explicitly in `docs/`: a click inside an **already-focused**
  cross-origin iframe emits no parent-visible event, so the utility remains open until Escape,
  an outside click, or an action. Assert nothing here — record the limitation.

---

## SONNET IMPLEMENTATION CONTRACT

```
1  An open utility's dismissal boundary is ITSELF plus its invoking control.
   Never inChromeFamily — that predicate answers a different question.
2  Clicking any other GS3 Chrome (Top Toolbar, Position, ···, Runway) closes
   the open utility.
3  NEVER swallow the click. No preventDefault, no stopPropagation, no overlay.
   The clicked control must still perform its own action in the same gesture.
4  Assign Folder focuses its own container on open (tabIndex -1,
   preventScroll). It must not auto-select a folder, scroll, or reveal the rail.
5  ONE canonical closePicker(). No per-utility close functions.
6  Autonomous behavior unchanged: the 850ms retract, typing, focus, pointer
   movement and toolbar retract must never dismiss an open utility.
7  Runway invocation must still not reveal the Top Toolbar.
8  Keep the iframe `focus` dismissal. Do not attempt to observe clicks inside a
   cross-origin iframe; document the residual case instead of faking it.
9  Do not convert folder options to <button> in this pass. Record it as an
   optional accessibility follow-up.
10 Presentation only: no Runtime mutation, no Undo checkpoint, no iframe
   reload/rebuild/reparent/re-src.
```

---

## Out of scope — untouched

Stale Workspace projection (its own Part 1-6 report), dice presentation, Fill Panel,
Automations, Runtime Events, Phase 5, all other Hotswap behavior.
