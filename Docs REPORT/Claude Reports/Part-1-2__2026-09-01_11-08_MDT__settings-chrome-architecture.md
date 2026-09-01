# GS3 Claude Architecture Report

**Part:** Part 1-2
**Date:** September 1, 2026
**Time:** 11:08 AM MDT
**Timezone:** Calgary, Alberta — America/Edmonton
**Agent:** Claude / Opus
**Role:** Architecture / Diagnosis
**Repository:** /home/dmcalorum/GS3

---

## Breadcrumb

**WAS** — Part 1-1 unified Top/Deep into one ordered projection, moved pickers to panel-level
popovers anchored by invocation surface, and set the Runway safe zone to 1.75x toolbar height
measured from the PANEL top. Chrome retract is a single unconditional 850ms timer. Ingest and
Domain Blacklist live on index.html. Settings sections are always expanded.

**IS** — The Runway tracks the WEBSITE top rather than the panel top, so revealing the toolbar
moves it down by exactly one toolbar height. Runway invocations never reveal the rail. An open
picker owns its interaction and suppresses autonomous retraction until commit/Escape/outside
click. Edit URL opens wider, focused, caret at end, scrolled to end. Major Settings sections
collapse with remembered state, and Ingest and Domain Blacklist move into Settings.

**WHY** — Part 1-1 made the geometry correct but not yet STABLE. Controls must not move under
the pointer while in use, and a picker must not evaporate mid-interaction. Settings must expose
complexity on request and remember how it was left.

---

## 1. Current-State Diagnosis

| Concern | File | Symbol / line |
|---|---|---|
| Reveal / retract | `js/launch.js` | `setToolbarRevealed`, `revealToolbar`, `scheduleRetract`, `cancelRetract` |
| Retract delay | `js/hotswap-chrome.js` | `CHROME_RETRACT_DELAY_MS = 850` |
| Interaction family | `js/launch.js` | `inChromeFamily` (toolbar, overlay, activation, positionMenu, pickerRows) |
| Focus reveal | `js/launch.js:493` | `panel.addEventListener('focusin', … revealToolbar())` |
| Website inset | `index3.html` / `index.html` | `.stream-panel` flex column; `.hotswap-toolbar` height 0 -> `--hotswap-toolbar-height` |
| Runway position | `index3.html:512-524` | `.hotswap-runway { top: var(--shortcut-runway-top-offset) }`, `calc(H * 1.75)` |
| Runway invocation | `js/launch.js:1076-1085` | `mirror.onclick` sets `actionInvocation = { anchor, placement }` |
| Edit URL handler | `js/launch.js` | `toggleBtn.onclick` -> `placePicker(urlRow, toggleBtn)` + `inputField.focus()` |
| Assign Folder handler | `js/launch.js` | `folderBtn.onclick` -> `placePicker(folderRow, folderBtn)` |
| Picker placement | `js/launch.js:560-592` | `placePicker` |
| Picker rows | `js/launch.js:1193` | `panel.appendChild(row)` — panel-level |
| Edit URL input | `index3.html:328` | `.hotswap-input { min-width: 140px }` |
| Settings cards | `settings.html` | `.config-card` x5 (git, manager, frame-height, hotswap, ghost) |
| Ingest markup | `index.html:2234-2261` | `.config-card.ingest-panel` |
| Ingest handlers | `js/app.js:60-61`, `js/parser.js:67-68,135`, `js/folders.js:49` | `initDropzone`, `#ingest-folder-select` |
| Blacklist markup | `index.html:2263-2274` | `.config-card.blacklist-panel` |
| Blacklist handlers | `js/blacklist.js:35,150,118` | `initBlacklist`, `initBlacklistUI`, `renderBlacklistDisplay` |
| Settings boot | `js/settings.js` | `bootSettings()` |
| Settings persistence | `js/storage.js` | `Store` KEYS/DEFAULTS/TYPES |

### Measured behavior (Chromium, panel 635px, toolbar 30px)

```
GOAL 1  retracted: websiteTop=0   runwayTop=53   runway-minus-website=53
        revealed : websiteTop=30  runwayTop=53   runway-minus-website=23   <-- drifts
GOAL 2  runway folder  -> toolbar revealed: false   picker open: true
        runway toggle  -> toolbar revealed: TRUE    picker open: true      <-- bug
GOAL 3  picker after >850ms: revealed=false, folderPickerOpen=false        <-- killed
GOAL 5  input width=165 (panel 635), focused=true, selectionStart=0, scrollLeft=0
```

53 = round(30 x 1.75). The 1.75x value is correct; its REFERENCE POINT is wrong.

---

## 2. Edit URL vs Assign Folder — Root Cause

Both handlers are structurally identical: toggle `.open`, call `placePicker(row, btn)`.
The **only** difference is that Edit URL additionally calls `inputField.focus()`.

Exact call path:

```
runway mirror.onclick
  -> actionInvocation = { anchor: mirror, placement: 'left' }
  -> trayBtn.click()                       (canonical Edit URL handler)
       -> urlRow.classList.add('open')
       -> placePicker(urlRow, toggleBtn)   correct, anchored to the runway button
       -> inputField.focus()               <-- THE CAUSE
            -> panel 'focusin' fires
            -> inChromeFamily(inputField) === true
               (pickerRows.some(row => row.contains(node)))
            -> revealToolbar()
            -> setToolbarRevealed(true)    Top Toolbar opens
```

Assign Folder focuses nothing, so no `focusin`, so no reveal. That is the entire asymmetry.

`revealToolbar()` currently fuses two separate effects:

1. `cancelRetract()` — keep Chrome alive
2. `setToolbarRevealed(true)` — reveal the rail

Focus landing anywhere in the family should do (1). Only focus landing in **rail-anchored**
surfaces should do (2). Panel-level popovers (pickers) are family members but are NOT rail
surfaces — a picker invoked from the Runway has no business opening the rail.

### Surgical correction (for Codex)

```js
// Rail-anchored family members: focus here means "I am using the rail".
const inRailFamily = (node) => node instanceof Node
    && (toolbar.contains(node) || activationEl.contains(node)
        || overlay.contains(node) || positionMenuEl.contains(node));

panel.addEventListener('focusin', (e) => {
    if (!inChromeFamily(e.target)) return;
    cancelRetract();                       // ALL family members keep Chrome alive
    if (inRailFamily(e.target)) revealToolbar();   // only rail surfaces reveal it
});
```

Do **not** fix this by removing `inputField.focus()` — autofocus is required by Goal 5.
Do **not** fix it by removing picker rows from `inChromeFamily` — that would let the retract
timer kill an open picker.

---

## 3. Runway Geometry Model

**Invariant:** `Runway top = website current top + 1.75 x toolbarHeight`.

The website's current top IS the toolbar's rendered height, because `.hotswap-toolbar` is a
flex sibling before the iframe (0 when retracted, `--hotswap-toolbar-height` when revealed).
So the whole model is expressible in CSS with no JS and no second magic number:

```css
.stream-panel {
    --hotswap-website-inset: 0px;                          /* website top, panel-relative */
    --shortcut-runway-top-offset:
        calc(var(--hotswap-website-inset)
             + var(--hotswap-toolbar-height) * 1.75);
}
.stream-panel.chrome-revealed {
    --hotswap-website-inset: var(--hotswap-toolbar-height);
}
```

`.hotswap-runway { top: var(--shortcut-runway-top-offset) }` is then already correct, and its
existing `max-height: calc(100% - var(--shortcut-runway-top-offset) - 10px)` stays correct
automatically.

**Expected measurements after the change (toolbar 30px):**

```
retracted: websiteTop 0   runwayTop 53   (0  + 52.5)
revealed : websiteTop 30  runwayTop 83   (30 + 52.5)
delta = exactly one toolbar height
```

The single derived token `--hotswap-website-inset` is the canonical "how far down the website
starts" value. **Nothing else may hardcode the inset.** Presentation-only: one class toggle,
no JS geometry, no Runtime mutation, no iframe touch.

Codex must also add a CSS transition on the runway's `top` matching the toolbar's 0.16s so it
travels with the website rather than jumping.

---

## 4. Active Picker Ownership Rule

**Rule:** *An open picker owns its invocation geometry until commit or dismissal.*

Two concrete consequences:

**(a) Retraction yields.** `scheduleRetract`'s callback becomes conditional on picker state:

```js
const hasOpenPicker = () => pickerRows.some((row) => row.classList.contains('open'));

retractTimer = setTimeout(() => {
    retractTimer = null;
    if (hasOpenPicker()) return;      // the picker owns the interaction; do not retract
    setToolbarRevealed(false);
}, CHROME_RETRACT_DELAY_MS);
```

This is a **yield**, not a new timer and not a new ownership system. The existing family and
the existing single timer remain authoritative. Note this deliberately relaxes the Part 1-1
comment "deliberately unconditional" — that reasoning was about an open *tray* holding website
height hostage. An active picker is a live interaction, which is different, and it terminates
on the dismissal conditions below.

**(b) Rail state freezes for the picker's lifetime.** While a picker is open, autonomous
transitions must not change `chrome-revealed`. Only explicit user interaction with the rail
itself may. This prevents the Goal-1 geometry from yanking the anchor mid-edit.

**Dismissal — the complete and only list:**

| Condition | Already implemented? |
|---|---|
| Successful commit / selection | yes (folder item click; URL submit) |
| Escape | yes (`closeDeepestChild`) |
| Deliberate outside `pointerdown` | yes (document listener) |
| Explicit toggle of the same control | yes (`classList.toggle('open')`) |

**Never dismiss on:** pointer leaving the anchor, 850ms elapsing, pointer moving anchor -> picker,
focus entering the input, typing, or any other autonomous timer.

Picker rows stay in `inChromeFamily` (so pointer traversal anchor -> picker cancels retraction).

---

## 5. Edit URL UX Plan

Current: `min-width: 140px`, rendered 165px in a 635px panel; focused but `selectionStart = 0`
and `scrollLeft = 0` — the customer sees the *start* of a URL whose meaningful part is the tail.

**Width policy** (responsive, not character-count):

```css
.hotswap-picker.hotswap-url-row { width: clamp(280px, 60%, 560px); }
.hotswap-url-row .hotswap-input { flex: 1 1 auto; min-width: 0; }
```

`60%` of the panel is roughly twice today's useful width at typical sizes; `clamp` keeps it
usable on a narrow panel and stops it sprawling on a wide one. `placePicker`'s existing clamp
already keeps it inside the panel, so no new boundary logic is needed.

**Focus / caret / scroll**, in the canonical handler after the row is opened and placed:

```js
const url = iframe.getAttribute('data-last-src') || iframe.src;
inputField.value = url;
requestAnimationFrame(() => {          // after layout, so scrollWidth is real
    inputField.focus({ preventScroll: true });
    inputField.setSelectionRange(url.length, url.length);   // caret at END
    inputField.scrollLeft = inputField.scrollWidth;         // show the tail
});
```

`preventScroll: true` stops the browser scrolling the panel to the field. The rAF matters:
`scrollWidth` is meaningless before the picker has been laid out.

---

## 6. Settings Collapse Architecture

**Major sections only.** A major section is exactly one `.config-card`. Children
(`.hotswap-surface`, `.hotswap-subsection`) never get independent state — no accordion inception.

**Mechanism — recommend a controlled class/state system, not `<details>`.** Rationale from the
current code: cards already carry meaningful classes and per-card left-border accents; the
Hotswap card contains drag-and-drop rows and measured layout (the switch-alignment axis), and
`<details>` introduces its own box and default marker that would fight both. A class toggle
also keeps children in the DOM, which satisfies "no content reconstruction, no data loss, no
form reset" for free.

```html
<div class="config-card hotswap-panel" data-section="hotswap">
  <button class="section-toggle" aria-expanded="true" aria-controls="sec-hotswap">
    <span class="section-caret" aria-hidden="true">▼</span>
    <h2>🎛 Hotswap Overlay Controls</h2>
  </button>
  <div class="section-body" id="sec-hotswap"> … unchanged children … </div>
</div>
```

```css
.config-card[data-collapsed="true"] .section-body { display: none; }
.config-card[data-collapsed="true"] .section-caret { transform: rotate(-90deg); }
```

- Whole heading is the click target (a real `<button>`: keyboard and screen-reader correct for free).
- `aria-expanded` on the button, `aria-controls` -> body id.
- `display: none` (not height animation) — avoids animating a card containing measured layout.

**Persisted schema — one object, not N booleans:**

```
key:     settings_section_state        (Store KEYS.settingsSectionState)
type:    json
default: {}                            // absent === open
value:   { "<sectionId>": true }       // true === COLLAPSED
```

Storing only the collapsed set means a newly added section defaults to open without a
migration, and the object stays small. First-time users get every section open, which matches
today's behavior exactly.

**Event flow:** `bootSettings()` reads the map once and applies `data-collapsed` **before**
first paint work; toggling writes the whole map back on each click. This is a **user preference**
— `Store` owns it. Not Runtime Session. Not Workspace.

**One ordering caveat for Codex:** the switch-alignment axis and any width measurement must be
taken while a section is OPEN. If the Hotswap card boots collapsed, deferred measurement must
run on first expand, or measurements will read 0.

---

## 7. Settings Relocation Plan

Both are pure markup relocations — every handler already binds by `getElementById`, so DOM
ancestry is irrelevant. The work is **moving the markup and calling the existing init functions
from `bootSettings()`**. No handler is copied, no behavior changes.

### Ingest Extracted Directories
- **Move:** `index.html:2234-2261` (`.config-card.ingest-panel`) -> `settings.html` as section 2.
- **Also move** the `.ingest-panel`, `.dropzone-container`, `.or-divider` CSS it depends on.
- **Wire in `bootSettings()`:** `initDropzone(document.getElementById('file-dropzone'), document.getElementById('manual-file-pick'), ctx)` — the same call `js/app.js` makes today. Confirm the `ctx` shape `parser.js` expects and supply the equivalent.
- **Populate the select:** `#ingest-folder-select` is filled by `js/folders.js:49` inside `updateDirectoryDropdown`. Settings currently calls `renderFolderManager` only. Codex must ensure the ingest select is populated on the Settings page (call the same folders.js path after database fetch).
- **Remove from `index.html`** and drop the now-dead refs in `js/app.js:60-61` (guard or delete — they are already null-safe via `getElementById`).
- **Risk:** parser writes to the database and pushes to GitHub; Settings already fetches the database in `bootSettings`, so ordering is compatible, but ingest must not run before the fetch resolves.

### Domain Blacklist
- **Move:** `index.html:2263-2274` (`.config-card.blacklist-panel`) -> `settings.html` as the FINAL section.
- **Also move** `.blacklist-display`, `.blacklist-tag`, `.blacklist-manual-row`, `.bl-empty` CSS.
- **Wire in `bootSettings()`:** `initBlacklist(); initBlacklistUI(); renderBlacklistDisplay();` — identical to `js/app.js:78-80`.
- **Leave `initBlacklist()` calls elsewhere alone** — `js/triple-mode.js` calls it to load storage at Runtime boot; that is state loading, not UI, and must keep working.
- **Do not change blacklist semantics.** `js/blacklist.js` is untouched.

---

## 8. Final Settings Order

```
1. GitHub Cloud Sync Pipeline
2. Ingest Extracted Directories            (moved from index.html)
3. 🎛 Hotswap Overlay Controls
       Top Toolbar
           Toolbar Shortcuts
           ··· Deep Cuts
       Quick Action Shortcut Runway
4. 📂 Folder Manager
5. 📐 Frame Height Settings
6. 👻 Ghost Mode
7. Domain Blacklist                        (moved from index.html, final)
```

---

## 9. Worker File Plan

**`js/launch.js`** — *why:* focus asymmetry, picker ownership.
*Changes:* split `focusin` into `cancelRetract` (all family) + `revealToolbar` (rail family only);
add `hasOpenPicker()` guard to the retract callback; freeze `chrome-revealed` while a picker is
open; add caret-end + scroll-end + `preventScroll` to the Edit URL handler.
*Must not change:* `HOTSWAP_ACTIONS`, mirrors forwarding to canonical buttons, `placePicker`
anchoring/flip/clamp, dismissal conditions, Position menu, Top/Deep projection.

**`index3.html` / `index.html`** — *why:* Runway tracks website; Edit URL width.
*Changes:* add `--hotswap-website-inset`; redefine `--shortcut-runway-top-offset` as
`inset + H*1.75`; set the inset under `.chrome-revealed`; transition runway `top`; widen
`.hotswap-url-row`.
*Must not change:* 1.75 factor, rail height 30px, control heights 22px, overlay-only runway,
ghost scoping, `user-select: none`, disabled `cursor: default`, resize/activation split.

**`settings.html`** — *why:* collapse, relocation, order.
*Changes:* wrap each `.config-card` in toggle + `.section-body` with `data-section`; add ingest
and blacklist sections in final order; import their CSS.
*Must not change:* Hotswap card internals, switch-alignment grammar, Top/Deep single list,
Runway card, opacity pair location.

**`js/settings.js`** — *why:* collapse state, new section wiring.
*Changes:* read/apply/persist `settingsSectionState`; wire toggles; call `initDropzone` and
blacklist inits; ensure ingest select population; defer measurement for collapsed cards.
*Must not change:* `_initHotswapControls`, `_makeReorderable`, `_wireCollection`, Ghost card.

**`js/storage.js`** — *why:* one new key.
*Changes:* add `settingsSectionState` (json, default `{}`).
*Must not change:* any existing key name, default, or type.

**`js/app.js`** — *why:* index.html no longer owns the moved panels.
*Changes:* remove/guard the ingest dropzone refs and the blacklist UI init.
*Must not change:* `initBlacklist()` state loading if index.html still needs the list at runtime.

**Docs:** `docs/011-HOTSWAP-CHROME.md` (runway reference point, picker ownership),
`docs/000-INVARIANTS.md` (Runway tracks website top; picker owns interaction),
`docs/Tests/TESTING.md`, `docs/999-NEXT.md` (tick off the relocations).

---

## 10. Test Plan

**Runway geometry**
1. Retracted: `runwayTop === round(H * 1.75)`.
2. Revealed: `runwayTop === round(H + H * 1.75)`; delta === H exactly.
3. Retract restores the original value.
4. Runway remains overlay-only: iframe width unchanged in both states.

**Runway invocation isolation**
5. Runway Edit URL: picker opens, `chrome-revealed` stays **false**.
6. Runway Assign Folder: same (regression guard).
7. Runway anchor `getBoundingClientRect().top` identical before and after invoking its own picker.

**Picker ownership**
8. Open picker, dispatch panel `pointerleave`, wait > `CHROME_RETRACT_DELAY_MS + 300`: picker still open.
9. Pointer anchor -> picker does not dismiss.
10. Focus into the URL input does not dismiss and does not reveal the rail.
11. Commit dismisses. 12. Escape dismisses. 13. Outside `pointerdown` dismisses.
14. After dismissal the normal retract resumes and completes.

**Edit URL**
15. Width > 2x the pre-change width and <= panel width minus padding.
16. `document.activeElement` is the input.
17. `selectionStart === selectionEnd === value.length`.
18. `scrollLeft > 0` for a URL wider than the field (assert with a deliberately long URL).

**Settings**
19. Each major section collapses/expands; children hidden/restored together.
20. No child has independent state (no nested toggles present).
21. Collapse survives navigate-away-and-return (reload settings.html).
22. Default first-run state: all open.
23. Form values and drag order survive a collapse/expand cycle.
24. `aria-expanded` tracks state; toggle reachable and operable by keyboard.
25. Section order matches Goal 8 exactly.
26. Ingest works after relocation: dropzone accepts a file, folder select populates.
27. Blacklist works after relocation: add, render, clear.
28. Exactly one blacklist and one ingest implementation (no duplicate ids anywhere).

**Continuity** — 29. Every operation above: zero iframe loads, same nodes/parents/documents,
unchanged `src`, no Undo checkpoint.

---

## 11. Human Smoke Test

1. Hover the panel top — toolbar opens, website drops, **runway drops with it**.
2. Move away — both return together.
3. Click Edit URL on the **Runway** — picker opens, **toolbar stays shut**, nothing moves.
4. Confirm the field is wide, focused, and showing the END of the URL.
5. Type slowly for several seconds, pause > 1s — picker must not vanish.
6. Press Escape — closes. Reopen, click the website — closes.
7. Click Assign Folder on the Runway — same stability.
8. Settings: collapse everything except Hotswap; leave; run a session; return — arrangement restored.
9. Confirm Ingest and Domain Blacklist are in Settings and functional; confirm they are gone from index.html.
10. Confirm video/SPA keeps playing throughout.

---

## 12. Risks

- **Retract yield could strand Chrome open** if a picker's `.open` class is ever left set on a
  hidden row. Codex must ensure `closeDeepCuts`/`setToolbarRevealed(false)` always clears picker
  rows, so `hasOpenPicker()` cannot report a phantom.
- **Freezing `chrome-revealed` while a picker is open** must not survive dismissal — clear the
  freeze on every dismissal path, including commit, or the rail will never retract again.
- **Measuring inside a collapsed card returns 0.** The switch-alignment test and any width
  measurement must expand first or defer to first expand.
- **Ingest ordering:** parsing before the database fetch resolves could write against an empty
  structure. Gate on the same fetch `bootSettings` already awaits.
- **Duplicate element IDs** if a panel is copied rather than moved — would silently break
  `getElementById` for one of them. Verify the source markup is deleted.
- **`initBlacklist()` has two callers** (app.js, triple-mode.js). Only the *UI* init moves.

---

## 13. CODEX / SONNET IMPLEMENTATION CONTRACT

```
1  Runway top = website top + 1.75 x toolbar height. Change the REFERENCE POINT,
   never the 1.75 factor. Derive from one canonical inset token; no second magic number.
2  A Runway invocation must NEVER reveal the Top Toolbar. Fix the focusin path,
   not by removing autofocus and not by removing pickers from the interaction family.
3  Split revealToolbar's two effects: cancelRetract for ALL family members,
   setToolbarRevealed only for rail-anchored ones.
4  An open picker owns its interaction: the 850ms timer YIELDS. One timer only;
   no second lifecycle, no competing ownership system.
5  Dismiss only on commit, Escape, deliberate outside pointerdown, or explicit toggle.
   Never on pointer-leave, elapsed time, focus, or typing.
6  While a picker is open, autonomous Chrome transitions must not move its anchor.
7  Edit URL: responsive clamp width, autofocus, caret at END, scrolled to END.
   No character-count math.
8  Only MAJOR sections (.config-card) collapse. No nested child collapse state.
9  Collapse memory is a USER PREFERENCE in Store, one object keyed by section id.
   Not Runtime Session. Not Workspace.
10 Ingest and Domain Blacklist are MOVED, not duplicated. One implementation each.
   Handlers bind by id and survive relocation; call the existing init functions.
11 Do not undo Part 1-1: one ordered Top/Deep list, visibility-before-cutoff,
   independent Runway, structural Position/Undo/Redo/···, picker anchoring by
   invocation surface, canonical action singularity.
12 No iframe reload, rebuild, reparent, or re-src. No Undo checkpoint for any
   Chrome, picker, or Settings operation.
```

---

## Out of Scope — recorded, not investigated

- `#btn-master-undo` still uses `cursor: not-allowed` when disabled (different surface).
- Ghost Mode toggles sit on a different card with a narrower content box, so they are on a
  different global axis than the Hotswap switches. Not requested; flagging only.
- Fill Panel, Preset 7, L2 receiver, touch DnD — untouched.
