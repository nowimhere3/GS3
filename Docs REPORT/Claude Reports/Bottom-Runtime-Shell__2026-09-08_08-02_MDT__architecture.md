# Bottom Runtime Shell / Master Toolbar — Architecture

**Calgary time:** 2026-09-08 08:02 MDT
**Branch:** `main` @ `2bf92d7` + **uncommitted working tree** (Layer 2 Identity repair, Nested Runtime Launch Handoff — both preserved, nothing reset)
**Scope:** architecture / UX design only. No production code modified, no tests modified, no commit, no push.
**Evidence:** live Playwright measurement of `index3.html` at nine viewport widths and two nested-panel placements (read-only; harness in scratchpad, not in repo).

---

## 1. Executive recommendation

**One Runtime Shell, owned by whoever owns the viewport.**

Today every executor page independently renders a global bottom shell and then tries to *dodge* the other one when nested. That is the wrong primitive. Dodging requires the nested page to know where the outer page's controls are — and a nested page cannot know that, because it only sees its own iframe. I measured this: the same nested Grid puts its `🎬 ⚙` cluster at true-viewport **(19, 839)** when it lands in the left panel and at **(822, 386)** — the middle of the monitor — when it lands in the top-right panel. The workaround's promise is accidental, not structural.

The replacement is an ownership rule, not a placement rule:

> The **global bottom shell** — Master Bar plus Orchestration Dock — belongs to the Runtime that owns the browser viewport. A Runtime executing inside a Panel does not own the viewport, therefore it renders no global shell. Its capabilities remain reachable, but through the parent's shell and through the Panel that hosts it — never through a second copy of the same surface.

Four structural changes carry that rule:

1. **Height-independent closed geometry.** `bottom: -120px` is replaced by `transform: translateY(100%)`. CLOSED then means "exactly one bar-height below the viewport" at any rendered height. I measured the current failure: at a 700px-wide viewport the closed bar protrudes **41px** into the page, and at 420px it protrudes **136px**. At the common 880–1280px range it clears by only **6px** — one more control tips it over.
2. **A measured reserve, not a guessed one.** The dock publishes its own rendered width as a CSS custom property; the Master Bar reserves exactly that much of its own content box. Overlap stops being something to avoid and becomes something that cannot be expressed. I measured the current overlap: `#master-status` sits underneath the dock at **every** ordinary desktop width tested (1920, 1440, 1280, 1080, 880), and `⚙ Launchpad` joins it at 1440, 880 and 560.
3. **Three regions instead of one centred pile.** `[structural] [status] [layout · layer · overflow]`, with the layout cluster hard against the reserve so it sits under the user's hand where they opened the bar. Nothing is centred, so nothing can be knocked off-centre — which retires regression #15 structurally instead of by the absolute-positioning patch that currently papers over it.
4. **Reuse the eligibility model that already exists.** `SURFACES` / `isEligibleFor()` / `getEligibleActions()` / `_reconcileOrder()` in `hotswap-chrome.js` is already a declarative capability registry with three surfaces over one canonical action list. The Master Bar becomes a **fourth surface** with a per-executor relevance field. Configurable layout slots become a **third instance** of `settings.js`'s existing `_wireCollection({ getCount, setCount, getOrder, setOrder })`. No new subsystem is required for either.

And one honest constraint that shapes the staging: **nested suppression cannot ship before Layer routing covers what it removes.** Suppressing the nested shell today would silently strip the nested Runtime's Folder, Layout and Save Session As, because `LAYER_SCOPED_ACTIONS` forwards only `undo, redo, shuffle, shuffleAll, reload`. So Stage A and B fix the top-level shell and leave the nested workaround untouched; Stage C retires the workaround **together with** the routing that replaces it. That ordering is not caution for its own sake — it is the brief's own rule, *"do not remove nested controls until reachability is preserved."*

---

## 2. Current-state diagnosis

### 2.1 Three pages, three copies of the same bug

| | closed offset | dock | nested workaround | z-index |
|---|---|---|---|---|
| `index.html` (Design-Time) | `#controls` `bottom:24px` (always visible) | — | `right: 140px` (guesses parent dock width) | **2147483647** |
| `index2.html` (Solo Runtime) | `#control-bar` `bottom:-80px` | `#floating-btns` `bottom:18px right:18px` | `right:auto; left:18px` | 29000 / 30000 |
| `index3.html` (Grid Runtime) | `#master-bar` `bottom:-120px` | `#floating-btns` `bottom:18px right:18px` | `right:auto; left:18px` | 29000 / 30000 |

Every executor hand-rolls the same shell with its own magic numbers. `index.html`'s `z-index: 2147483647` is the sharpest edge: a nested Design-Time page paints **above** the parent's dock unconditionally, so its `right:140px` dodge is the only thing standing between it and the parent's controls — and 140px is a guess at a cluster I measured at **108px** today and which will grow the moment Hearts arrive.

### 2.2 Measured: the closed Master Bar protrudes

`#master-bar` is `flex-wrap: wrap`, so its height is a function of viewport width. `bottom: -120px` hides it only while height ≤ 120px.

| viewport width | rendered bar height | visible while CLOSED |
|---|---|---|
| 1920 / 1600 / 1500 / 1440 | 67px | 0 |
| 1280 / 1152 / 1080 / 950 / 880 | 114px | 0 — **6px of margin** |
| 700 | 161px | **41px** |
| 560 | 162px | **42px** |
| 420 | 256px | **136px** |

Measured directly (`getBoundingClientRect()` on the closed bar against `innerHeight`). Two things follow. The bug is already live below ~750px. And the 6px margin at every common desktop width means the *next* control added to this bar — a Redo button, a `[L2-P1]` selector, one Heart — pushes mainstream widths over the edge. This is not a latent risk; it is a tripwire.

Portrait makes it worse rather than better: narrower viewport → more wrapping → taller bar. The `translateY(100%)` fix is load-bearing for the Portrait phase, not merely tidy.

### 2.3 Measured: the dock already occludes the bar

`#floating-btns` is `z-index: 30000`; `#master-bar` is `29000`. The dock therefore *wins* every overlap, silently clipping whatever is beneath it.

| viewport width | `#master-status` under dock | `⚙ Launchpad` under dock |
|---|---|---|
| 1920 | **yes** | no |
| 1440 | **yes** | **yes** |
| 1280 | **yes** | no |
| 1080 | **yes** | no |
| 880 | **yes** | **yes** |
| 560 | no | **yes** |

`#master-status` is `position: absolute; right: 20px; top: 50%` inside the fixed bar — it is out of flow and permanently claims the bar's right edge, which is exactly the dock's footprint. It collides at every ordinary desktop width.

That absolute positioning is not an accident: `TESTING.md` §4.7 pins *"`#master-status` stays pinned right while the button group stays centered"*, and §8 regression #15 records that a previous `margin-left: auto` broke the bar's centering. The current code solved a centering regression by taking status out of flow, and in doing so moved it under the dock. **Both problems are symptoms of one cause: a single centred flex row cannot host a right-anchored claimant.** The three-region layout in §4 dissolves both.

### 2.4 Measured: nested duplication is placement-dependent

Nested a real Grid Runtime inside a real Grid panel over HTTP (same harness shape the suite uses):

```
nested in screen-1-slot (left tall):    html = "is-nested layer-2"
  nested dock  → true viewport (19, 839)–(131, 881)     bottom-left corner
  outer  dock  → true viewport (1474, 842)–(1582, 882)  bottom-right corner
  → two 🎬⚙ clusters on the same bottom edge

nested in screen-2-slot (top right):
  nested dock  → true viewport (822, 386)–(934, 428)    MIDDLE OF THE SCREEN
```

The nested bar is 114px tall and opens at the *panel's* bottom edge — in the left-tall case that is 1px above the true viewport bottom, i.e. a second full-width-of-panel bar stacked directly on the outer one.

This is the proof that the relocation model is unfixable in kind. `left: 18px` means "18px from the left of whatever box I happen to be in." A nested Runtime has no access to the true viewport, so it cannot avoid a collision it cannot see. Adding more CSS to the workaround only relocates the collision, exactly as `011-HOTSWAP-CHROME.md` already concluded for the top-Chrome corner model: *"Moving controls to dodge a collision only relocated the collision onto the website."* The bottom shell never received that lesson.

### 2.5 Secondary geometry claimants with the same defect

`#master-folder-dropup` (`bottom: 80px; left: 20px`) and `#master-save-dropup` (`bottom: 80px; right: 20px`) are `position: fixed` with a hardcoded 80px clearance sized for a one-row bar. At 114px the bar covers them; at 161px it buries them. The save dropup's `right: 20px` also puts it directly under the dock. `index.html` already has the correct pattern at line 243 — `bottom: calc(100% + 8px)` inside a positioned wrapper — so the fix is a known-good local precedent, not an invention.

---

## 3. Bottom shell ownership model

### 3.1 The rule

> **Viewport ownership determines shell ownership.**
> A Runtime renders the global bottom shell **iff** it owns the browser viewport.
> Nesting is a browser fact the page may read about itself (`window.top`), not Runtime Session state — this is the one legitimate DOM-derived input, and it must stay that way.

Three modes, one executor:

| mode | detection | Master Bar | Orchestration Dock | Panel Chrome | Status |
|---|---|---|---|---|---|
| **Top-level** | `window === window.top` | renders | renders | renders | own bar |
| **Nested (Layer 2)** | `window !== window.top` | **suppressed** | **suppressed** | renders (its own panels' Chrome) | reported outward |
| **Standalone** | same as top-level | renders | renders | renders | own bar |

"Standalone" and "top-level" are the same mode — that is the point. A Grid opened directly in a tab and a Grid opened as somebody's Layer 2 differ in exactly one input (`window.top`) and one behaviour (does the global shell render). Everything else — session, panels, positions, history, Layer identity — is identical. That is what makes the same executor correct in both contexts without a fork.

### 3.2 What "suppressed" must mean

Suppressed means **not rendered**, not "moved" and not "hidden but present":

* not moved — relocation is the failed model (§2.4);
* not merely `display:none` on a built surface — a built-but-hidden bar still owns keyboard handlers, still runs `_refreshMasterLayerSelector`, and still invites a future regression that reveals it.

The nested page should skip constructing the global shell at all, the same way `launch.js` already skips Grid-only `ctx` capabilities on `index.html`.

### 3.3 What stays local when nested

| stays | why |
|---|---|
| **Panel Hotswap Chrome** (every panel of the nested Grid) | These are Panel-scoped controls over the nested Runtime's *own* panels. They are not duplicates of anything the parent renders — the parent's Panel Chrome addresses the nested Runtime *as one Panel*; the nested Panel Chrome addresses content *inside* it. Both meanings are real. See §13 of the brief and §10.5 below. |
| **The nested Layer-2 sentinel** (yellow border, `html.layer-2`) | Cheap, honest, tells the user which Runtime they are looking at. Keep. |
| **Resizers, layout rendering, Positions** | Presentation of the nested Runtime's own geometry. Never duplicated. |
| **The nested Runtime Session itself** | Unchanged. Ownership of state is not what is being moved — only ownership of a *rendering surface*. |

### 3.4 What suppression costs, and what must replace it

This is the load-bearing honesty of the whole design. `LAYER_SCOPED_ACTIONS` currently forwards five keys: `undo, redo, shuffle, shuffleAll, reload`. Everything else on the Master Bar becomes unreachable the instant the nested bar stops rendering.

| nested control | after suppression | verdict |
|---|---|---|
| 🎲 Shuffle | forwarded (`shuffle`) | ✅ covered |
| 🎲🎲 Shuffle All | forwarded (`shuffleAll`) | ✅ covered |
| ↩ Undo | forwarded (`undo`) | ✅ covered |
| ↪ Redo | forwarded (`redo`) — **but the nested Grid's handler is an empty stub** (`triple-mode.js:1170`) | ⚠️ hole, see §9 |
| 🎬 Close | closes a bar that no longer exists | ✅ no loss — the control's referent is gone |
| ⚙ Launchpad | "replace this Panel with Design-Time" — the **outer Panel's own 🚀 already does exactly this**, with better semantics (parent-owned assignment, per the nested-handoff work) | ✅ no loss, strictly better |
| 🌐 Folder | not forwardable today | ❌ **real loss** |
| Layout (8) | not forwardable today | ❌ **real loss** |
| 💾 Save Session As | not forwardable today, and needs a payload (which preset), not just an action key | ❌ **real loss, hardest** |

Therefore: **nested suppression is Stage C work, gated on extending Layer routing to cover Folder, Layout and Save Session As.** Stages A and B leave `html.is-nested #floating-btns { right:auto; left:18px }` exactly where it is. The workaround is obsolete in principle and must not be extended, but removing it early would trade a cosmetic defect for a capability regression.

The one nested fix that *is* safe now, because it costs nothing: cap `index.html`'s `#controls { z-index: 2147483647 }` into the shared z-scale (§5.6). That removes a guaranteed stacking violation without removing a control.

---

## 4. Proposed shell anatomy

```
TOP-LEVEL RUNTIME (owns the viewport)
┌────────────────────────────────────────────────────────────────────────────────┐
│                                                                                │
│                          PANELS  /  Fixed Positions                            │
│                                                                                │
├────────────────────────────────────────────────────────────────────────────────┤
│ #master-bar          closed: translateY(100%)   ·   open: translateY(0)         │
│                                                                                │
│ ┌─ structural ─────┐ ┌─ status ────────┐ ┌─ contextual ───────────────┐┊reserve┊│
│ │ 🎲  🎲🎲  ↩  ↪  │ │ 12 streams · … │ │ ▦ ▦ │ ▤ │ [L2][L1] │ ⋯    │┊       ┊│
│ └──────────────────┘ └─────────────────┘ └────────────────────────────┘┊       ┊│
│   always the same       flows, never          layout slots + layout      ┊     ┊│
│   place, never wraps    absolutely            overflow, layer target,    ┊     ┊│
│   away                  positioned            general overflow           ┊     ┊│
└─────────────────────────────────────────────────────────────────────────┴───────┘
                                                                          ▲
                                        #orchestration-dock (fixed, above the bar)
                                        ♡1  ♥3  ♡4  🎬  ⚙
                                        width measured → --gs3-dock-reserve
```

Reading the groups left to right:

* **Structural** — `🎲 Shuffle`, `🎲🎲 Shuffle All`, `↩ Undo`, `↪ Redo`. High-frequency, always present, never configurable, never in overflow. Left-anchored so they are in the same place at every width.
* **Status** — an ordinary flex item in a `flex: 1 1 auto; min-width: 0` centre region. It truncates with `text-overflow: ellipsis` rather than pushing anything. It never claims an edge, so it can never collide with the dock and can never break centering — the two failure modes §2.3 documented.
* **Contextual** — the layout cluster (N configurable slots + a layout-specific overflow gateway), the Layer target, and the general overflow `⋯`. Right-anchored, immediately before the reserve.
* **Reserve** — not an element. `padding-right: var(--gs3-dock-reserve)` on the bar's content box. Content physically cannot flow into it.
* **Dock** — `#orchestration-dock` (renamed from `#floating-btns`, which describes placement rather than role). Fixed bottom-right, always visible, above the bar in z-order because `🎬` is the bar's own toggle and must be reachable while the bar is closed.

### 4.1 Why the layout cluster goes right

The user opens the shell from the bottom-right `🎬`. On a 1920px or wider monitor, a centred layout cluster means a ~700px pointer journey to change layout and a ~700px journey back. Right-anchoring puts the most-used contextual control under the hand that just opened the bar. The structural quartet stays left precisely because it is *not* where the hand is — those four are muscle-memory targets that benefit from a fixed absolute position more than from proximity.

This ordering also happens to be the one that degrades best: when the bar wraps, the right group wraps as a unit and stays adjacent to the reserve, so the layout cluster and the dock never separate.

---

## 5. Geometry contract

Five clauses. Each makes one class of collision inexpressible rather than merely unlikely.

### 5.1 Closed state is height-independent

```css
#master-bar {
    position: fixed;
    bottom: 0; left: 0; right: 0;
    transform: translateY(100%);          /* CLOSED — exactly one bar-height down */
    transition: transform 0.25s ease, opacity 0.15s ease;
}
#master-bar.open { transform: translateY(0); }
```

CLOSED is now defined in terms of the bar's own height, so it is correct at 67px, 114px, 256px, and at whatever height a future dock, a Redo button, a `[L2-P3]` selector or a portrait viewport produces. No number to keep in sync.

> **Trap an implementer must know:** a non-`none` `transform` on an ancestor makes that ancestor the containing block for `position: fixed` descendants. `#master-folder-dropup` and `#master-save-dropup` are `position: fixed` and are DOM children of the bar. After this change they become **bar-relative rather than viewport-relative.** That is what we want (§5.5) but it must be a deliberate step in the same commit, not a discovery afterwards. Do not ship `translateY` without re-anchoring the dropups.

### 5.2 The dock publishes its own width

```
#orchestration-dock  ──ResizeObserver──►  document.documentElement.style
                                          .setProperty('--gs3-dock-reserve',
                                                       `${rect.width + 2 * GAP}px`)
```

`ResizeObserver` is the right mechanism here — not because it is the obvious one, but because it is the only one whose trigger set matches the actual causes of change: Hearts appearing and disappearing at runtime, font-size changes, and zoom. A `resize` listener misses all three; a constant misses all three plus the whole point.

Contract: **one observer, one property, one writer.** The dock is the only thing that may write `--gs3-dock-reserve`; everything that needs to avoid the dock reads it. A fallback (`var(--gs3-dock-reserve, 140px)`) covers the frames before the first observation, so there is never an unreserved paint.

### 5.3 The Master Bar consumes the reserve

```css
#master-bar { padding-right: var(--gs3-dock-reserve, 140px); }
```

Because this shrinks the **content box**, flex wrapping is computed against the reduced width. No child can be laid out into the reserve — not the last button, not a wrapped row, not status, not a future Heart-adjacent control. Overlap is not avoided; it is unrepresentable.

*Trade-off, stated:* the reserve applies to every wrapped row, not only the bottom one, so upper rows lose ~130px they could theoretically have used. That is the price of a total guarantee, and it is the right price — a per-row reserve would need to know which row is last, which is exactly the kind of measurement-dependent reasoning this contract exists to eliminate.

### 5.4 Status owns no edge

`#master-status` loses `position: absolute` and becomes an ordinary flex child of the centre region with `flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis`. It cannot collide with the dock (it is inside the reserved content box) and it cannot break centering (nothing is centred). This **supersedes** `TESTING.md` §4.7's "pinned right while the button group stays centered" assertion and closes §8 regression #15 by construction — see §13.1.

### 5.5 Dropups anchor to the bar, not to a number

```css
.master-dropup-anchor { position: relative; }
.master-dropup { position: absolute; bottom: calc(100% + 8px); }
```

Same pattern `index.html:243` already uses. Height-independent, and it inherits the reserve automatically because the anchor lives inside the bar's content box. The Save dropup stops being able to open under the dock.

### 5.6 One z-scale, declared once

| layer | z-index |
|---|---|
| panel content / resizers | ≤ 50 |
| resizer drag overlay | 40000 |
| Master Bar | 29000 |
| Orchestration Dock | 30000 |
| dropups | 30001 |

`index.html`'s `#controls { z-index: 2147483647 }` is capped into this scale. A nested page must not be able to paint above its host's controls by fiat.

### 5.7 Responsive and portrait behaviour

The shell's responsiveness comes from **configuration**, not from breakpoints that guess device class:

* the layout cluster shrinks because the user chose 1 or 2 visible slots (§7), not because a media query decided the screen is "small";
* the general overflow `⋯` absorbs low-frequency controls at every width, so narrow is the same design as wide with fewer things out;
* structural controls are never sacrificed to width — consistent with `000-INVARIANTS` §*Chrome Is Presentation*: *"Structural controls … are fixed. They are never removable, reorderable, or sacrificed to responsive pressure."*

**Portrait dependency (must be honoured by the later Portrait phase):** do not add shell rules inside `@media (max-width: 900px)`. That query currently also does `.resizer { display: none !important }` and collapses `#triple-layout` to a single column — which is precisely the portrait-desktop trap. The shell must key off the future orientation model, never raw width. Everything in §5.1–5.6 is orientation-agnostic by construction, so the Portrait phase inherits a correct shell rather than having to repair one.

---

## 6. Control classification matrix

**Semantics legend.** *Runtime-global* = acts on the whole Runtime Session. *Container* = acts on the Panel that hosts a nested Runtime, from outside it. *Panel* = acts on one panel's content. *Position* = acts on physical placement. *Shell* = acts on the control surface itself.

| Control | Semantics | Structural / contextual / overflow | L1 / L2 targetable | Grid | Solo | future Stream | Notes |
|---|---|---|---|---|---|---|---|
| 🎲 **Shuffle** | Runtime-global | **structural** | **L2-targetable** (in `LAYER_SCOPED_ACTIONS`) | ✅ | ✅ | ✅ | Highest-frequency action in every executor. |
| 🎲🎲 **Shuffle All** | Runtime-global | **structural** | **L2-targetable** | ✅ | ✅ | ✅ | — |
| ↩ **Undo** | Runtime-global | **structural** | **L2-targetable** | ✅ | ✅ | ✅ | Exists today; see §9. |
| ↪ **Redo** | Runtime-global | **structural** | **L2-targetable** | ✅ | ✅ | ✅ | **Does not exist on the Master Bar today.** Data model supports it; see §9. |
| ▦ **Layout ×8** | Runtime-global (presentation) | **contextual** — N visible slots + layout overflow | *should be* L2-targetable; **not today** | ✅ | ❌ (no layouts) | ⚠️ likely | Grid-only. Blocks nested suppression until routed (§3.4). |
| ▤ **Layout overflow** | Shell | **contextual** (gateway) | n/a | ✅ | ❌ | ⚠️ | Layout-specific icon, **not** `⋯` — see §7.5. |
| 🌐 **Folder** | Runtime-global (content source) | **overflow** in Grid; **structural** in Solo | *should be* L2-targetable; **not today** | overflow | **structural** | overflow | The canonical proof that one vocabulary must not be forced on every executor. |
| 💾 **Save Session As** | Runtime-global (serialization) | **overflow** | needs a **payload** (which preset), not an action key | ✅ | ⚠️ | ✅ | Hardest nested-routing case (§3.4). |
| 🎬 **Close** | **Shell** | **overflow** (the dock's 🎬 is the real control) | **never** — a shell has no layer | ✅ | ✅ | ✅ | Meaningless once nested renders no bar. |
| ⚙ **Launchpad** (bar) | **Container** | **overflow** | **never** — outer 🚀 owns this meaning | ✅ | ✅ | ✅ | Duplicate of the dock's ⚙; keep one. |
| **[L2][L1] selector** | **Shell** (routing) | **structural**, contextual *visibility* | **is** the target selector | ✅ | ⚠️ | ✅ | Hidden when no nested Runtime — unchanged, already truthful. |
| 🎬 (dock) | **Shell** | **dock — fixed** | never | ✅ | ✅ | ✅ | Opens the bar. Must stay reachable while closed. |
| ⚙ (dock) | **Container / navigation** | **dock — fixed** | never | ✅ | ✅ | ✅ | Leaves the Runtime. |
| **status** | Runtime-global (report) | **contextual**, non-interactive | reports L1; L2 status arrives by message | ✅ | ✅ | ✅ | Must join flex flow (§5.4). |
| ♡ **BG Hearts** (future) | **Position-semantic** (`♡1` = the Gallery at Position 1) | **dock — dynamic** | per-instance, not per-layer | ✅ | ⚠️ | ⚠️ | Only reason the reserve must be dynamic. |
| 📍 Move to Position | Position | Panel Chrome, not Master | never | ✅ | ❌ | ⚠️ | Listed for completeness — Position-owned, per `011`. |
| 📋 Copy to Position | Position | Panel Chrome, not Master | never | ✅ | ❌ | ⚠️ | Ditto. |
| ⟳ Reload | Panel | Panel Chrome | **L2-targetable** | ✅ | ✅ | ✅ | Already routed. |

### 6.1 The two conclusions this matrix forces

**(a) Layer scope is not a property of the toolbar.** Of fifteen Master-surface controls, five are or should be L2-targetable, four are structurally incapable of it (`Close`, `Launchpad`, dock `🎬`, dock `⚙` — a shell and a container have no layer), and the rest are Runtime-global controls that *could* route but do not yet. So the `[L2][L1]` selector must never be presented as if it re-aims the whole bar. **Recommendation:** the selector governs a declared subset, and controls in that subset carry a subtle affordance when L2 is active (e.g. the same yellow Layer-2 sentinel already used on nested borders). Controls outside the subset show no such mark and keep acting locally. This is the same honesty `011-HOTSWAP-CHROME.md` already reached for the panel toolbar: *"Being honest about which actions are scopable beats pretending every button changes meaning."* The Master Bar has not yet inherited it.

**(b) Executors need different vocabularies, and the existing model already expresses that.** Folder is overflow in Grid and structural in Solo. Layout does not exist in Solo. This is the §7-of-the-brief question, and the answer is **not** a new capability subsystem — see §11.2.

---

## 7. Layout shortcut architecture

### 7.1 Canonical registry ownership

The eight layouts already have a single owner: `LAYOUT_IDS` in `triple-mode.js` (`top2, bottom2, 3col, lefttall, righttall, vsplit, hsplit, 4grid`), with geometry in `positions.js`. **All eight stay.** Nothing is deleted to save toolbar space — presentation changes, the registry does not.

Promote `LAYOUT_IDS` to an exported canonical list (id, title, icon class) so `settings.js` can render it without duplicating the vocabulary. One list, two readers — the same discipline `HOTSWAP_ACTIONS` already follows.

### 7.2 Visible slot count

Range **1–3**, default **2**. Reasons: two shortcuts plus a gateway is three targets, which fits comfortably beside the reserve at every width I measured, including 880px; three is available for wide monitors; one suits portrait. This is deliberately a *narrower* range than the runway's 1–8 — the layout cluster competes with the reserve on the same row, and 8 layout buttons is the current design that wraps at 1280px.

### 7.3 Persistence and reuse — this is almost free

`hotswap-chrome.js` and `settings.js` already contain, generically:

* `_reconcileOrder(stored, universe)` — drops unknown keys, appends missing ones in registry order, so a stored order can never desynchronize from the registry;
* `_wireCollection({ configId, countRowId, listId, echoId, getCount, setCount, getOrder, setOrder, withToggle })` — count buttons + drag-ordered list + live echo, already instantiated **twice** (Toolbar Shortcuts, Quick Action Runway);
* `_renderList(listEl, order, withToggle, onChange)` — the drag/drop implementation itself.

Layout slots are a **third instantiation**:

```js
// hotswap-chrome.js — mirrors getTopShortcutOrder/Count exactly
export const MAX_LAYOUT_SLOTS = 3;
export function getLayoutSlotOrder()  { return _reconcileOrder(Store.get('layoutSlotOrder'), LAYOUT_IDS); }
export function setLayoutSlotOrder(o) { Store.set('layoutSlotOrder', _reconcileOrder(o, LAYOUT_IDS)); }
export function getLayoutSlotCount()  { /* clamp 1..MAX_LAYOUT_SLOTS, default 2 */ }
export function setLayoutSlotCount(n) { /* same clamp */ }
```

```js
// settings.js — one more call, no new machinery
_wireCollection({
    configId: 'layout-slots-config', countRowId: 'layout-count-row',
    listId: 'layout-order-list', echoId: 'layout-count-echo',
    getCount: getLayoutSlotCount, setCount: setLayoutSlotCount,
    getOrder: getLayoutSlotOrder, setOrder: setLayoutSlotOrder,
});
```

Store keys: `layoutSlotOrder` (array of layout ids), `layoutSlotCount` (1–3). Both go through `Store`, both are user preferences — correct per `000-INVARIANTS` §*Single Source of Truth*: *"Store owns user preferences."* Neither is Runtime Session state; neither is serialized into a preset. Note the deliberate separation from `tripleLayout` (the *current* orientation, already a Store preference) and `preset.layout` (a saved session's orientation, Runtime Session state) — three different facts, three different owners, none conflated.

### 7.4 Stable slots, and the active-layout question

**Slots never reshuffle.** If the user orders `[lefttall, 3col, …]` with count 2, slot 1 is always `lefttall` and slot 2 is always `3col` — regardless of which layout is active. Muscle memory is the entire value of a shortcut; a self-reordering shortcut is a slower menu.

**Active state, when the active layout is visible:** the slot lights, exactly as today (`.layout-btn.active`).

**Active state, when the active layout is in overflow:** this needs care, because two of the brief's own principles pull against each other — "don't reshuffle" and "show which is active." Recommendation:

> The layout **gateway** carries the active-layout indication. When the active layout is not in a visible slot, the gateway renders that layout's own mini-icon (the `.layout-icon` markup already exists per layout) plus an active treatment. When the active layout *is* visible, the gateway renders a neutral stack glyph.

This tells the truth without moving anything: the visible slots stay where the user put them, and the state of the system is always legible in a fixed location. It also means the gateway is never a dead-looking control — it always says something.

### 7.5 The gateway icon

Do **not** use `⋯`. In this codebase `⋯` already means Deep Cuts — the panel Chrome's general overflow — and `011-HOTSWAP-CHROME.md` calls it *"the fallback gateway to every action on a narrow panel."* Reusing the glyph for a layout-specific list would collide two different overflow vocabularies in one product.

Use a **layout-stack metaphor** consistent with the existing `.layout-icon` grammar: the mini grid glyph with a stacked/offset second plate, or a 3×3 grid dot matrix (`▦` / `⊞`). It should read as "more arrangements", never as "more actions". The general overflow `⋯` keeps its existing meaning in the Master Bar's right group for non-layout controls.

### 7.6 Executor relevance

Grid: all eight. Solo: layouts do not exist — the cluster and gateway are not rendered, and the Settings section is not shown. Future Stream: likely a smaller set; expressed as registry relevance (§11.2), not as a Stream-specific code path.

---

## 8. Nested Runtime behaviour

### 8.1 What disappears (Stage C)

| element | nested | mechanism |
|---|---|---|
| `#master-bar` | **not constructed** | boot guard: `window === window.top` |
| `#orchestration-dock` | **not constructed** | same guard |
| `#master-folder-dropup` / `#master-save-dropup` | not constructed (children of the bar) | — |
| `#master-status` | not rendered locally; **reported outward** | §8.3 |
| `html.is-nested #floating-btns { left: 18px }` | **deleted** | the workaround it implements no longer has a subject |

### 8.2 What remains

Panel Hotswap Chrome for every panel of the nested Runtime; resizers; layout rendering; Position labels; the `html.layer-2` sentinel; the whole nested Runtime Session.

### 8.3 How reachability is preserved

Three routes, two of which already exist:

1. **Layer-scoped action forwarding** (exists). `_dispatchMasterToLayerTwo()` → `postMessage({source: LAYER_MESSAGE_SOURCE, action})` → the nested `_installLayerScopeReceiver`. Already covers `shuffle, shuffleAll, undo, reload`. Stage C extends `LAYER_SCOPED_ACTIONS` with `folder`, `layout` and `saveSessionAs`, and fills the `redo` stub.
2. **Container actions through the outer Panel** (exists). The parent's Panel Chrome already owns "what is in this Panel" — 🌐 URL, 🚀 Launchpad, ☠ Kill, 📍 Position. A nested Runtime is *content*, so replacing or removing it is already correctly a container operation. Nothing new needed.
3. **Nested → parent status reporting** (new, but on an existing seam). The nested Runtime posts a status payload to its parent; the parent renders it in its own status region, attributed to the Position that hosts it.

Route 3 must reuse the seam the Nested Runtime Launch Handoff just built, not invent a second one. That handoff already validates: same origin, message shape, and — critically — **child window → host iframe membership**:

```js
const slotIndex = SLOT_IDS.findIndex((id) =>
    document.getElementById(id)?.querySelector('.stream-panel iframe')?.contentWindow === event.source);
```

That single line is the primitive `[L2-P#]` needs (§10.1). It already resolves "which nested Runtime is speaking" to a slot index, and `resolvePositionOfSlot()` already turns a slot index into a Position number.

### 8.4 Payload-carrying actions

`saveSessionAs` is the one forwarded action that needs data, not just a key. Recommendation: keep `LAYER_SCOPED_ACTIONS` as the set of **key-only** actions and add a small parallel notion of a *parameterised* forwarded action (`{action: 'saveSessionAs', presetId}`), validated on receipt against the canonical preset list exactly as the launch handoff validates `workspace`. Do not widen the key-only set to admit payloads — that would erase the guarantee the current contract earns by carrying *"a fixed action key from the canonical registry — never code, never a URL."*

### 8.5 The same executor in both contexts

The only behavioural fork is `window === window.top`. Everything downstream — session, panels, history, Layer identity, Positions — is identical. A nested Grid opened directly in a new tab becomes top-level and grows a shell, with no state migration, because the shell was never state.

---

## 9. Master Redo assessment

**Verdict: small history addition (~12 lines mirroring code that already exists) + UI wiring. Not UI-only. Not substantial history work.**

Evidence from `grid-session.js`:

* `_redoAction(action, slotIndex = null)` **already exists and already accepts the master case.** `_targetSlots(action, null, 'undone')` returns every slot of the action still in `undone` state — exactly master breadth.
* `slotUndoneSeq` — the per-slot LIFO ordinal a redo needs to pick "the most recently undone thing" — **already exists and is already maintained** by `_undoAction`, incremented from a single monotonic `_undoSeq` shared by master and panel undo.
* `_findPanelRedoable(slotIndex)` is the exact selector shape needed, one scope down.
* Redo invalidation on new actions is already implemented, already slot-scoped, and already respects `atomic`.

What is missing is only the master-scoped selector and its two exports:

```js
function _findMasterRedoable() {
    let best = null, bestSeq = 0;
    _history.forEach((action) => {
        if (!_hasSlotIn(action, 'undone')) return;
        const seq = Math.max(...action.slots.map((s) => action.slotUndoneSeq[s] || 0));
        if (seq > bestSeq) { best = action; bestSeq = seq; }
    });
    return best;
}
export function canRedoGridSession() { return _findMasterRedoable() !== null; }
export function redoGridSession()    { return _redoAction(_findMasterRedoable()); }
```

Because `_undoSeq` is shared, master Redo correctly reverses a master Undo **and** correctly picks up an action a *panel* undid — which is the behaviour `000-INVARIANTS` §*History* demands: *"Panel-scoped Undo and master Undo are two ways of selecting from that one history, never two independent stacks."* Redo inherits that property for free.

UI wiring: one `↪` button in the structural group, `disabled = !canRedoGridSession()` refreshed from the existing `_refreshHistoryButtons()`, and `_applyRestoredHistory(redoGridSession(), ctx)` on click — the identical shape to the existing Undo handler.

**One live hole this exposes.** `triple-mode.js:1170`:

```js
redo: () => { /* the Grid master bar has no Redo of its own */ },
```

A nested Grid that receives a forwarded `redo` from its parent **silently does nothing today**. The `redo` key is already in `LAYER_SCOPED_ACTIONS` and the parent's panel toolbar already enables the button when aimed at L2, so this is a control that can already be pressed and already does nothing. Adding master Redo closes it in the same change — which is a good reason to do it in Stage B rather than later.

---

## 10. Future compatibility

### 10.1 `[L2-P#]` — the addressing primitive already exists

Physically, the Layer target sits in the right group beside the layout cluster, inside the reserve. Its width grows with the number of nested Runtimes, which is exactly why the reserve is measured rather than assumed.

Semantically, `[L2-P1] [L2-P3] [L1]` needs three things, and two of them are already built:

| need | status |
|---|---|
| resolve a nested Runtime → a slot index | ✅ `_handleRuntimeLaunchRequest`'s `contentWindow === event.source` lookup |
| resolve a slot index → a Position number | ✅ `resolvePositionOfSlot(layout, arrangement, slotIndex)` |
| enumerate genuine nested Runtimes | ✅ `_sessionLayerTwoSlots()` (from the Layer 2 identity repair) |

So `[L2-P#]` is presentation over facts the Runtime Session already holds. It requires no new state — which is exactly why the Layer 2 identity repair had to land first, and why this shell design must not reintroduce any URL- or DOM-derived layer inference.

The matrix in §6.1(a) is the semantic constraint: `[L2-P#]` selects a **target for the scopable subset**, never a mode for the whole bar.

### 10.2 Portrait desktop

The shell contributes three properties the Portrait phase needs and adds no new obstacles: closed-state correctness at any height (§5.1 — and portrait *causes* taller bars, so this is a prerequisite, not a nicety); a reserve contract with no orientation assumption; and responsiveness expressed as user configuration rather than a device-class guess.

**The one dependency to record:** the Portrait phase must fix `@media (max-width: 900px)`, which today conflates "narrow" with "mobile" and disables `.resizer`. No shell rule may be added inside that query in Stages A–C, or the Portrait work inherits a second thing to untangle.

### 10.3 `index1.html`

The shell is per-executor by construction: one shared renderer, per-executor relevance declared in the registry (§11.2). `index1.html` arrives as registry rows — one executor entry (already present in `RUNTIME_EXECUTORS` from the Layer 2 work) plus its Master-surface relevance flags. No shell code needs to know it exists.

### 10.4 Browser Gallery Hearts

Hearts appear and disappear at runtime, so the dock's width changes at runtime. That single fact is the reason §5.2 measures instead of assuming. Adding `♡1 ♥3 ♡4` to the dock will, with the contract in place, automatically shrink the Master Bar's legal width with no shell change at all — which is the acceptance test for whether the geometry contract is actually right.

Hearts are **Position-semantic** (`♡1` = the Gallery at Position 1), which is the same addressing vocabulary as `[L2-P#]`. Both should read Positions from `positions.js`; neither may invent its own numbering.

### 10.5 Multiple nested Runtime entrances, and top Chrome

Multiple nested Runtimes are already representable — `_sessionLayerTwoSlots()` returns a list, and `_dispatchMasterToLayerTwo()` already fans out to all of them. The shell change makes this *legible* for the first time: instead of N competing bottom bars, there are N entries in one Layer target.

**Constraint the Bottom Shell imposes on the future top-Chrome pass (recommendation only, no action now):** the ownership rule established here — *outer Panel Chrome addresses the nested Runtime as one Panel; inner Panel Chrome addresses content inside it* — is a **hierarchy statement, not a duplication**. Both meanings are real and neither should be suppressed. The bottom shell rule must not be over-generalised into "nested pages render less Chrome"; it applies specifically to *global* surfaces, which are the only ones that assume viewport ownership. Panel Chrome makes no such assumption and is therefore correct at every depth.

---

## 11. Staged implementation plan

### Stage A — Shell ownership contract + geometry correctness

**Goal:** collisions structurally impossible at top level; CLOSED means fully hidden at any height. No control moves between structural/contextual/overflow yet, so the change is verifiable in isolation.

**Files:** `index3.html` (CSS + bar markup regrouping), `js/triple-mode.js` (dock observer, status into flow), `index2.html` + `index.html` (same closed-state and z-scale fixes), `Docs REPORT/Tests/TESTING.md`.

**Behavioural contract**
1. `#master-bar` closes via `transform: translateY(100%)`; at every width its closed rect is entirely below `innerHeight`.
2. `#orchestration-dock` (renamed) publishes `--gs3-dock-reserve` via `ResizeObserver`; it is the only writer.
3. `#master-bar { padding-right: var(--gs3-dock-reserve, 140px) }`; no `#master-bar` descendant's rect intersects the dock's rect at any width.
4. `#master-status` is a normal flex child, truncating, in a three-region bar; nothing uses `justify-content: center`.
5. Dropups re-anchored to `bottom: calc(100% + 8px)` inside positioned wrappers (**required** by the `translateY` containing-block change).
6. `index.html #controls` z-index capped into the shared scale.
7. `#master-bar` keeps its **id** — existing dismissal tests use it as an outside-click target.

**Dependencies:** none. **Out of scope:** control reclassification, layout slots, Redo, any nested suppression, `[L2-P#]`, Hearts, Portrait, top Chrome. **`html.is-nested #floating-btns` stays exactly as it is.**

### Stage B — Control hierarchy, overflow, configurable layouts, Master Redo

**Goal:** the bar carries the right things in the right groups, and its vocabulary becomes per-executor.

**Files:** `js/hotswap-chrome.js` (Master surface + layout slot preferences), `js/settings.js` (third `_wireCollection`), `settings.html`, `js/triple-mode.js` (render groups from the registry; Redo wiring), `js/grid-session.js` (`canRedoGridSession` / `redoGridSession`), `index3.html`, tests.

**Behavioural contract**
1. Structural group = `Shuffle, Shuffle All, Undo, Redo` — never configurable, never in overflow, never dropped for width.
2. Contextual group = layout slots (1–3, default 2, drag-ordered, `_reconcileOrder`-backed) + layout gateway + Layer target + general overflow.
3. General overflow holds `Folder` (Grid), `Save Session As`, `Close`, `Launchpad`. Layout overflow is a **separate** gateway with a layout metaphor — `⋯` keeps its Deep Cuts meaning.
4. Master surface eligibility is declared per executor (§11.2); Solo renders Folder as structural and renders no layout cluster.
5. `canRedoGridSession()` / `redoGridSession()` added; the nested `redo` stub at `triple-mode.js:1170` is filled.
6. Layout slot preferences persist under `layoutSlotOrder` / `layoutSlotCount`; a stored order naming a removed layout reconciles rather than breaking.

**Dependencies:** Stage A (the right group must have a reserve to sit against).
**Out of scope:** nested suppression, `[L2-P#]`, Hearts, Portrait.

### Stage C — Nested ownership + Layer routing completion

**Goal:** retire the relocation workaround, together with the routing that makes it safe. **These ship in one change; the suppression must not land first.**

**Files:** `js/triple-mode.js`, `js/launch.js` (`LAYER_SCOPED_ACTIONS`, parameterised forwarding), `index2.html`, `index3.html`, `index.html`, tests.

**Behavioural contract**
1. `window !== window.top` → the global shell is **not constructed** (not moved, not hidden).
2. `LAYER_SCOPED_ACTIONS` extended to `folder` and `layout`; `saveSessionAs` added as a validated parameterised forward (§8.4).
3. Nested → parent status reporting on the existing launch-handoff seam, attributed by Position.
4. `html.is-nested #floating-btns { right:auto; left:18px }` deleted from all three pages.
5. **Acceptance gate:** every control the nested shell used to expose is reachable, and a test proves it, *before* the suppression rule merges.
6. Physical room for `[L2-P#]` is verified; the selector itself is still not implemented.

**Dependencies:** Stages A and B. **Out of scope:** `[L2-P#]` implementation, Hearts, Portrait, top Chrome, `index1.html`.

---

## 12. Test plan

Existing harness: `test/boot-smoke.test.js` runs Playwright against a `python -m http.server` on 127.0.0.1 (with a second port for cross-origin), and `test/positions-history.test.js` covers unit-level preferences. Both patterns extend cleanly.

**Geometry (Stage A)**
1. **Full hide at every height.** For widths `[1920, 1440, 1280, 1080, 880, 700, 560, 420]`: with the bar closed, `bar.getBoundingClientRect().top >= window.innerHeight`. *This is the test that fails today at 700/560/420 — write it first and watch it fail.*
2. **No collision, ever.** Same width sweep, bar open: for every `#master-bar` descendant, its rect does not intersect the dock's rect. *Fails today for `#master-status` at 1920/1440/1280/1080/880 and for `⚙ Launchpad` at 1440/880/560.*
3. **Dynamic reserve.** Inject a synthetic 200px-wide child into the dock; assert `--gs3-dock-reserve` grows, the bar's content width shrinks correspondingly, and (2) still holds. Remove it; assert both revert. *This is the Hearts acceptance test, written before Hearts exist.*
4. **Status truncates, never displaces.** Set a 500-character status; assert the structural group's rect is unchanged and (2) still holds.
5. **Dropup anchoring.** With the bar at 1, 2 and 3 rendered rows, each dropup's bottom edge sits above the bar's top edge and does not intersect the dock.
6. **Z-scale.** `#controls` on `index.html` computes below the dock's z-index.

**Layout system (Stage B)**
7. **Order round-trip and reconciliation.** `setLayoutSlotOrder(['3col','lefttall'])` persists; a stored order naming an unknown layout drops it and appends the missing ones in registry order; count clamps to 1–3 and defaults to 2. (Unit, `positions-history.test.js`, mirroring the existing Top Shortcut order tests.)
8. **Visible count.** Count N renders exactly N layout buttons plus one gateway.
9. **Slots are stable.** Activate a layout that is *not* in a visible slot; assert the visible slots' ids and order are byte-identical afterwards.
10. **Gateway carries active state.** With the active layout in overflow, the gateway shows that layout's icon and active treatment; with it visible, the gateway is neutral and the slot is lit.
11. **Overflow vocabularies do not collide.** The layout gateway and the general `⋯` are distinct elements with distinct contents; opening one does not open the other.
12. **All eight remain reachable** through slots + gateway at every count.

**Executor capability (Stage B)**
13. Grid renders Folder in overflow and a layout cluster. Solo renders Folder as structural and **no** layout cluster or layout Settings section. Neither reads a hardcoded per-page list — both derive from the registry.

**History (Stage B)**
14. **Master Redo exists and is LIFO.** Shuffle → Shuffle All → Undo → Undo → Redo → Redo restores the post-Shuffle-All state; `canRedoGridSession()` tracks availability; a new action invalidates redo for the slots it touched and leaves others redoable.
15. **Redo respects the one canonical history.** A panel-scoped Undo followed by master Redo re-applies that panel's portion and nothing else.
16. **The nested `redo` stub is closed.** A forwarded `redo` to a nested Grid produces an observable state change.

**Nested ownership (Stage C)**
17. **Suppression.** Nested `index3.html`: `#master-bar` and `#orchestration-dock` are absent from the DOM (`=== null`, not merely hidden).
18. **Standalone unchanged.** The same page opened top-level renders both, with identical structure to a never-nested session.
19. **No second bottom surface.** With a nested Runtime in `screen-1-slot` and again in `screen-2-slot`, exactly one dock and one Master Bar exist in the whole frame tree. *Written against the placement-dependence measured in §2.4 — the second placement is the one that fails today.*
20. **Reachability, control by control.** For every control the nested shell used to expose, an equivalent parent-initiated route produces the nested state change: shuffle, shuffleAll, undo, redo, reload, folder, layout, saveSessionAs.
21. **Security negatives preserved.** Untrusted origin, wrong message shape, and an unrelated same-origin iframe still do nothing — the existing launch-handoff negatives must keep passing against the extended contract.

**Responsive / narrow (all stages)**
22. At 420px the structural group is present and clickable, no control is clipped by the dock, and the closed bar is fully hidden.
23. No new shell rule appears inside `@media (max-width: 900px)` (source assertion — protects the Portrait phase).

---

## 13. Risks and migration concerns

**13.1 A superseded test will look like a regression.** `TESTING.md` §4.7 asserts *"`#master-status` stays pinned right while the button group stays centered"*, and §8 regression #15 records the `margin-left:auto` centering break. Stage A deliberately makes both statements false: nothing is centred and status is not pinned. **Update the spec in the same change**, with a note explaining that the three-region layout removes the condition #15 described rather than reverting its fix. An implementer who sees this test fail and "restores" the absolute positioning will reintroduce the dock collision.

**13.2 The `transform` containing-block trap.** Adding `transform` to `#master-bar` retargets every `position: fixed` descendant to the bar. The dropups are such descendants. Ship §5.1 and §5.5 together or the dropups will jump.

**13.3 Do not cement `is-nested` as Runtime state.** The `window.top` walk is a *browser* fact about embedding, read before first paint. It is not DOM-as-state and must not be "upgraded" into a message or a session field — that would add a race to something that is currently synchronous and correct. `000-INVARIANTS`' "the DOM is never treated as state" is about *application* state; embedding depth is not application state. Worth stating in the anchor so nobody refactors it.

**13.4 Do not let the shell touch Layer identity.** `_sessionLayerTwoSlots()` and the executor registry are the authority, freshly repaired. The shell **reads** them. No shell code may re-derive layer from a URL, an iframe `src`, `data-last-src`, or `html.layer-2`.

**13.5 Do not suppress before routing.** Restated because it is the single highest-consequence sequencing risk: Stage C's two halves are one change (§3.4, §11 Stage C acceptance gate).

**13.6 Three pages will drift again.** Stages A–C fix the same shell three times by hand. That is acceptable now (extraction is Phase 5 work and premature here), but the constants — `--gs3-dock-reserve`, the z-scale, the dock gap — should be authored once in a shared place from the start, so extraction later is a move rather than a reconciliation.

**13.7 `saveSessionAs` is the routing case that can go wrong.** It carries a payload, and it writes to `presets.json`. Its forward must validate the preset id against the canonical list exactly as the launch handoff validates `workspace`, and it must not widen the key-only contract (§8.4).

**13.8 The 6px margin.** Until Stage A lands, *any* addition to the Master Bar at 880–1280px pushes the closed bar into the viewport. Master Redo (Stage B) is exactly such an addition. Stage A is therefore a hard prerequisite for Stage B, not merely a preferred order.

---

## 14. Codex handoff recommendations

| Stage | Recommendation | Why |
|---|---|---|
| **A — shell ownership + geometry** | **Terra / Medium** | Mechanically small and fully specified, but three genuine traps: the `transform` containing-block change, the superseded §4.7 test, and a three-page repeat. Luna would likely ship `translateY` without re-anchoring the dropups. |
| **B — control hierarchy + layouts + Redo** | **Terra / Medium** | Largest diff, lowest novelty. `_wireCollection`, `_reconcileOrder` and `_findPanelRedoable` are all copy-shaped precedents. Medium because the Master surface eligibility rules and the two-vocabulary overflow split need judgement, not because the code is hard. |
| **C — nested ownership + Layer routing** | **Sol / High** | The only genuinely hard stage: a cross-frame security contract, a payload-carrying forward, and an acceptance gate that must be reasoned about rather than checked off. Getting this wrong silently removes user capability or widens a message contract that is currently tight. |
| *Anchor edits (§15)* | **Luna / Low** | Prose, fully drafted below. |

Suggested split to conserve reasoning: run **A** and **B** as separate Terra passes (A is a prerequisite for B per §13.8, so they cannot be merged anyway), and reserve **Sol** entirely for **C**.

---

## 15. Durable breadcrumbs (anchor edits to make when implementing)

Extend existing owners; do not create a new anchor.

**`000-INVARIANTS.md`** — new section after *Chrome Is Presentation*:

> **Runtime Shell Ownership**
> The global bottom shell — Master Bar and Orchestration Dock — belongs to the Runtime that owns the browser viewport.
> A Runtime executing inside a Panel does not own the viewport and renders no global shell.
> Suppression means not rendered — never relocated, never merely hidden. A nested Runtime cannot see the true viewport, so it cannot avoid a collision by moving; moving only relocates the collision.
> Nested capabilities are reached through the parent's shell and through the Panel that hosts them. A nested control may not be removed until its replacement route exists.
> Embedding depth is a browser fact a page reads about itself. It is not Runtime Session state.

> **Shell Geometry**
> CLOSED means entirely outside the viewport at every rendered height, row count and viewport size. Closed-state geometry is expressed relative to the surface's own height, never as a fixed offset.
> The Orchestration Dock publishes its measured width; the Master Bar reserves it from its own content box. Overlap is unrepresentable, not merely avoided.
> No surface may claim a viewport edge independently of that reservation.

**`006-TERMINOLOGY.md`** — add *Runtime Shell*, *Master Bar*, *Orchestration Dock*, *Layout Slot*, *Layout Gateway*; note that `⋯` (Deep Cuts) and the layout gateway are distinct vocabularies.

**`011-HOTSWAP-CHROME.md`** — the Master Bar becomes a fourth surface over the canonical registry, with per-executor relevance. Record §6.1(a): the Layer selector governs a declared subset; the bar must not imply whole-surface scope. Record that the bottom shell has now inherited the same lesson the top Chrome learned — *relocation is not collision avoidance*.

**`999-NEXT.md`** — Phase 1/2: the three staged slices, with Stage C's suppression-after-routing gate stated explicitly. Phase 5: note the shell is fixed three times by hand and is a candidate for extraction once Runtime separation begins.

**`008-RUNTIME-EVENTS.md` / `009-AUTOMATIONS.md`** — no change needed. Nested status reporting is a shell concern today; if it later becomes a Runtime Event, it should reuse the existing event vocabulary rather than a shell-specific channel.

---

## 16. Report housekeeping

### 16.1 Reviewed

All 7 Claude reports and all 9 Codex reports, plus `Docs REPORT/Tests/AUDIT-PROGRESS.md`.

### 16.2 Findings still unresolved (untouched, deliberately)

* **H-3** — `links.json` at 97.3% of GitHub's 1 MB inline limit (`2026-08-31-audit`).
* **§5.2** — the deferred "Push rejected on Save Session As" bug, never investigated.
* **Runway geometry test failure** — the Codex Layer 2 report records 130/131 passing, with the sole failure (`Part 1-2 Runway tracks website top…`) reproducing identically against a clean `HEAD`. Pre-existing and unrelated; still open.
* **Tier 3 Layer confirmation handshake** — deliberately deferred by the Layer 2 work. This shell design does not require it (§10.1 needs only facts already in the Runtime Session), so it remains correctly deferred.

### 16.3 Stale assumptions this report supersedes

* `TESTING.md` §4.7's `#master-status` pinning assertion and §8 regression #15 — see §13.1. **Not yet edited**; the edit belongs with the Stage A implementation.
* The `html.is-nested` relocation model in all three pages — superseded in principle by §3, but **left in place** until Stage C (§3.4).

### 16.4 Pruned

Retention applied: **4 newest per agent + everything with unresolved findings + anything cited by an anchor.** Only tracked (git-recoverable) files were considered; the three untracked reports were not candidates.

**Pruned — 6 files** (all committed, all with their durable truth already absorbed as named breadcrumb sections in `Docs ANCHOR/011-HOTSWAP-CHROME.md`):

| file | absorbed into |
|---|---|
| `Codex Reports/Part-1-1__2026-09-01_10-57_MDT__hotswap-settings-intelligence.md` | `011` §*Part 1 intelligence and picker geometry breadcrumb* |
| `Codex Reports/Part-1-2__2026-09-01_11-28_MDT__stable-chrome-settings.md` | `011` §*Part 1-2 stable geometry breadcrumb* |
| `Codex Reports/Part-1-3__2026-09-01_11-56_MDT__human-ux-polish.md` | `011` §*Part 1-3 human UX polish breadcrumb* |
| `Codex Reports/Part-1-4__2026-09-01_12-35_MDT__canonical-utility-dock.md` | `011` §*Part 1-4 canonical utility dock breadcrumb* |
| `Codex Reports/Part-1-5__2026-09-01_12-56_MDT__dice-cuddle-polish.md` | `011` §*Part 1-5 Runway dice-cuddle breadcrumb* |
| `Claude Reports/Part-1-2__2026-09-01_11-08_MDT__settings-chrome-architecture.md` | `011` §*Settings hierarchy*, §*Two opacity values*, §*Quick Actions: on/off, then 1-8* |

**Explicitly kept despite age:**

* `Claude Reports/2026-08-31-audit-tier0-tier3.md` — unresolved findings (§16.2).
* `Claude Reports/Part-1-6__2026-09-01_13-07_MDT__stale-workspace-projection-diagnosis.md` — **cited by name from `000-INVARIANTS.md:109`**. Pruning it would break a durable anchor's citation.
* `Codex Reports/Part-1-6C__2026-09-01_14-40_MDT__website-click-away.md` — within the 4-newest window.
* Everything else in both directories.

Nothing under `Docs ANCHOR`, `Docs REPORT/Tests`, or `test/` was touched.

---

## 17. Answers to the numbered questions

**A. Ownership** — (1) Master Bar + Orchestration Dock + status. (2) Whichever Runtime owns the browser viewport. (3) Both global surfaces, not constructed at all. (4) Panel Hotswap Chrome, resizers, Positions, the Layer-2 sentinel, and the whole nested session. (5) They differ in exactly one input (`window.top`) and one behaviour (does the global shell render).

**B. Geometry** — (6) A measured `--gs3-dock-reserve` written only by the dock and consumed as `padding-right` on the bar's content box; status joins normal flow; Hearts inherit the guarantee free. (7) `transform: translateY(100%)`, height-independent — ship it with the dropup re-anchoring. (8) Configuration, not breakpoints; structural controls never sacrificed; no shell rule inside `max-width: 900px`.

**C. Control hierarchy** — (9) Structural: Shuffle, Shuffle All, Undo, Redo. Contextual: layout slots, layout gateway, Layer target, status. Overflow: Folder (Grid), Save Session As, Close, Launchpad. Dock: 🎬, ⚙, future Hearts. (10) Yes in Grid; **no in Solo**, where it stays structural — that difference is the point. (11) Save/Close/Launchpad → overflow; Close and Launchpad are near-duplicates of dock controls and should not also hold prime horizontal space. (12) Not exposed today, but the data model fully supports it — ~12 lines plus wiring (§9).

**D. Layout system** — (13) 1–3 visible slots, default 2, first-N of a drag-ordered canonical list. (14) `layoutSlotOrder` + `layoutSlotCount` in `Store` (preferences), distinct from `tripleLayout` and `preset.layout`. (15) **Yes** — `_wireCollection` and `_reconcileOrder` already exist and are already used twice; this is a third instantiation. (16) The gateway carries the active layout's own icon when the active layout is not visible; slots never reshuffle. (17) A layout-stack metaphor, never `⋯` — that glyph already means Deep Cuts.

**E. Layer interaction** — (18) Shuffle, Shuffle All, Undo, Redo, Reload today; Folder, Layout and Save Session As should join (Save needs a payload). (19) Close, Launchpad, dock 🎬/⚙ — a shell and a container have no layer. (20) Right group, inside the reserve; semantically it targets a declared subset, and both primitives it needs (window→slot, slot→Position) already exist.

**F. Runtime family** — (21) Yes — one renderer, per-executor relevance. (22) Layout geometry, session semantics and executor-specific actions. (23) Extend `SURFACES` / `isEligibleFor()` with a Master surface and a relevance field. That is the whole architecture; anything larger would be the "giant generalized framework" this repo has correctly avoided so far.
