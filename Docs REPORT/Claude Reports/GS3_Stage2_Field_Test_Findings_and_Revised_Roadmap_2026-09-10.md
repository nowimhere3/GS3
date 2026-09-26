# GS3 Stage 2 — Field-Test Findings, Architectural Questions, and Revised Roadmap
**Date:** 2026-09-10  
**Status:** Planning / product-definition document only. No implementation is authorized by this document.


---

## 0. Purpose

This document preserves the extended hands-on field-testing session that followed Stage 2.5. It records the successful behavior, regressions, UX friction, new capability ideas, architectural questions, and the revised order of work.

The goal is not a short summary. The goal is to preserve enough detail that another AI, a new coding environment, or a future chat can understand not only **what** needs work, but **why**, what has already been validated, what should be implemented soon, what should go to the Council first, and what should remain deferred.

The broader signal from this testing session is important: GS3 is now mature enough that the biggest discoveries are increasingly about **interaction architecture, hierarchy, orchestration, and cross-site capability**, rather than basic broken buttons.

---

# 1. Three-part breadcrumb

## WHAT WAS

Stage 1 and Stage 2.5 established the core Runtime architecture:

- Runtime Session owns canonical Panel / Position state.
- Positions remain presentation addresses: P1, P2, P3, P4.
- Panel identity survives movement.
- Layer 2 identity became truthful rather than URL-guess-based.
- Nested Grid Runtime launch works.
- Nested Grid internal resizers work even when the iframe is narrow.
- The Bottom Runtime Shell became the global conductor.
- Stage C routed nested Runtime capabilities to the parent conductor.
- Nested Grid duplicate Master Bar / Orchestration Dock was suppressed only after routing parity was established.
- Layer targeting became explicit with `L2-P#`.
- Nested local Position labels became `L2 · P#`.
- Left Tall ↔ Right Tall was proven to preserve visual-role continuity.
- Grid layout shortcuts were made visually understandable in Settings.
- GS3-owned scrollbars received the dark restrained treatment.
- A Tampermonkey/Jellyfin UI contamination incident was correctly diagnosed as external and not a GS3 regression.

The durable product metaphor remains:

> **Panels are the talent. The bottom Runtime shell is the conductor.**

And the shell rule remains:

> **One global Runtime shell is owned by whoever owns the viewport.**

## WHAT IS

Real field testing has now surfaced a new cluster:

1. `L2-P#` works, but is cognitively heavier than expected.
2. Nested right-side shortcut surfaces can collide in narrow/top-right positions.
3. Two stacked top toolbars are technically legitimate but may expose too much plumbing.
4. L2 Shuffle appears to work while L2 Undo/Redo may not.
5. The selected preset/folder label can remain stuck on `Cleaned Bookmarks`.
6. Routine successful-save popups interrupt flow and should generally disappear.
7. Top2 ↔ Bottom2 does not preserve visual roles.
8. The Fill Panel Tampermonkey prototype is unexpectedly effective across many HTML5 sites and should become a first-class GS3 capability.
9. Popups/pop-unders/new-tab escapes from iframe content are a recurring workflow interruption and deserve a deliberate suppression capability.
10. Solo/index2 is now comparatively low priority.
11. Ghost opacity controls belong primarily to the future launched Stream Runtime, not Solo.
12. Serious Launcher/Automation work remains intentionally deferred until the `index.html` / `index1.html` executor split exists.

## WHAT WILL BE

The near-term focus should remain on **Runtime toolbar clarity and cross-site capability**, not Automations.

Revised direction:

1. Stabilize and clarify current Layer / toolbar behavior.
2. Decide unresolved nested-toolbar UX architecture with the Council.
3. Fix the confirmed small regressions and mirrored-layout behavior.
4. Turn Fill Panel into a semantic GS3 capability with a proper shortcut.
5. Add a deliberate popup/new-tab guard.
6. Implement Browser Gallery Hearts V1 in the L1 conductor toolbar.
7. Only after the toolbar/capability surface is mature, split `index.html` from a new `index1.html`.
8. Then return to serious Launcher / Automation architecture.

---

# 2. What Stage 2.5 got right

The new Layer-2 conductor targeting is real and useful. Targets such as `L2-P1`, `L2-P2`, etc. can represent nested Runtimes by their host Positions, and actions such as Shuffle can operate on a selected nested Runtime rather than indiscriminately affecting everything.

Nested Grid launch continues to work. The parent conductor remains available while nested Grid duplicate bottom shells are removed. The system can support multiple nested Runtimes and expose their host Positions as routing targets.

Nested Grid resizers remain available, preserving the critical distinction between outer geometry and inner geometry. Outer geometry decides how much space the nested Runtime receives. Inner geometry decides how that Runtime divides its own Panels.

The Stage C architecture is therefore not being rejected. The new feedback is primarily about how that architecture is **expressed to a person**.

---

# 3. Detailed field-test findings

## 3.1 Preset / folder display label regression

### Observed behavior

The selector display can remain stuck on:

`Cleaned Bookmarks`

even after selecting Preset 1, Preset 2, Preset 3, Preset 4, Preset 5, etc.

The underlying preset action may still work, but the visible label does not reliably reflect the active selection.

### Why this matters

This is a state-projection problem. Even when the plumbing works, the user cannot confidently tell what is selected.

A selector that changes state while continuing to display stale text is dangerous because it creates uncertainty without producing an obvious hard failure.

### Diagnostic caveat

The behavior was observed during local VS Code/browser-preview testing. Local preview can sometimes differ from other served environments, but that possibility must be tested rather than assumed.

### Required future invariant

> **The visible preset/folder label is a truthful projection of the active canonical selection.**

Mechanically compare canonical selected preset, displayed label, persistence state, reload behavior, and preview-vs-normal serving if needed.

---

## 3.2 Routine success popups should be silent

### Observed behavior

Saving a folder/session/playlist can produce an interruption whose essential message is:

> Successfully saved.

The user does not want that interruption.

### Product principle

Routine success should generally not interrupt.

A successful action can be acknowledged through:

- subtle inline status;
- temporary non-blocking status text;
- visible state change;
- or nothing at all.

Failures, warnings, conflicts, destructive confirmations, or action-required states do deserve attention.

### Durable rule

> **Success is generally silent. Failure is visible. Action-required states may interrupt.**

This should become a GS3 interaction principle rather than only a one-off popup deletion.

---

## 3.3 L2 Undo / Redo appears inconsistent

### Observed behavior

During testing, L2 Shuffle behaved correctly against a selected nested Runtime.

Undo and Redo appeared not to work for the same L2 target.

### Why this matters

This is a meaningful Stage C acceptance issue.

If:

`L2-P1 + Shuffle`

works, but:

`L2-P1 + Undo`

does not,

then the conductor is only partially coherent.

### Required next step

Mechanically reproduce:

1. select L2-P1;
2. create a known nested history mutation;
3. Undo;
4. confirm nested restoration;
5. Redo;
6. confirm nested reapplication;
7. prove L1 and sibling L2 Runtimes remain unchanged.

If routing arrives but history does not change, inspect history ownership. If routing never arrives, inspect Layer dispatch.

This should be a focused bug fix, not an architecture rewrite.

---

## 3.4 Top2 ↔ Bottom2 visual-role continuity is now confirmed

Left Tall ↔ Right Tall already preserves visual roles naturally.

Top2 ↔ Bottom2 does not.

### Expected composition

If the current layout is:

```text
TOP2

┌──────────┬──────────┐
│    A     │    B     │
├─────────────────────┤
│          C          │
└─────────────────────┘
```

then switching to the mirrored counterpart should produce:

```text
BOTTOM2

┌─────────────────────┐
│          C          │
├──────────┬──────────┤
│    A     │    B     │
└──────────┴──────────┘
```

The wide/focal content remains wide/focal.

A remains the corresponding left-short role.

B remains the corresponding right-short role.

The composition flips vertically.

### Durable rule

> **Mirrored layout counterparts preserve visual roles. Position assignments may permute internally to preserve the composition.**

For Top2 ↔ Bottom2 specifically:

- wide stays wide;
- left-short stays left-short;
- right-short stays right-short;
- geometry mirrors vertically.

Panel identity must remain intact. No iframe reload, no media restart, no ROOT/folder loss, no metadata recreation.

Do not invent a universal transition engine unless the current architecture naturally supports one.

---

# 4. Layer-target UX: truthful but cognitively expensive

## 4.1 Problem with repeated `L2-P#`

The current conductor can show:

```text
L2-P2   L2-P1   L1
```

This is mechanically accurate, but real use revealed repeated mental decoding:

- Which Layer am I targeting?
- Which P belongs to what?
- Is P1 the host Position or the nested local Position?
- Which target am I touching?

If the designer has to pause and parse it, a new user will fare worse.

The issue is not false labels. It is that hierarchy is encoded almost entirely through repeated text.

## 4.2 Proposed hierarchical selector direction

The user sketched a more spatial model in which Layer identity is shown once and Positions appear underneath or within the Layer group.

Conceptually:

```text
L1          L2
            P1
            P2
            P3
```

or:

```text
L1 | L2
     ├ P1
     ├ P2
     └ P3
```

The core idea:

> **Layer is the group/context; Position is the selectable child.**

The existing `L2-P#` routing model can remain intact underneath.

### Status

Council-worthy UX architecture decision. Do not implement yet.

---

# 5. Nested right-side shortcut collision

## Observed problem

When Grid Runtimes are nested into narrower or top-right positions, the local shortcut/icon surface can collide with neighboring controls or the Panel boundary.

This is particularly likely in vertical splits, top-right cells, nested grids inside smaller parent cells, and any case where independent shortcut stacks occupy the same limited horizontal region.

The structural problem is:

> **Duplicating full shortcut surfaces per Layer does not scale spatially.**

## Proposed local L1/L2 scope toggle

Instead of duplicating both Layer sets of quick shortcuts, show one shortcut surface with a compact scope control when nesting exists:

```text
L1 | L2
```

Default to:

`L2`

because nested context will usually mean the nested target is desired.

Conceptually:

```text
Quick shortcut surface
      ↓
 [ L1 | L2 ]
      ↓
same icons
different semantic target
```

This suggests a broader rule:

> **Prefer one control surface with explicit scope over duplicated control surfaces that collide.**

This local selector does not necessarily have to be the same UI as the global conductor selector. It may share plumbing while remaining a separate local targeting surface.

### Status

Strong product direction, but include in Council discussion before implementation.

---

# 6. Two stacked top toolbars may expose too much plumbing

Nested hierarchy can legitimately produce:

```text
L1 top Chrome
L2 top Chrome
```

stacked vertically.

That is technically defensible because each Runtime has local controls, but it consumes viewport space and forces the user to repeatedly reason about hierarchy.

An alternative is:

```text
ONE top control surface
[ L1 | L2 ]
Position
Folder
Favorite
Fill Panel
etc.
```

where controls retarget according to scope.

The danger is that not every top-Chrome control has the same ownership. Some are Panel-local, some Runtime-local, some conductor/global, and some app capabilities.

Before merging top toolbars, classify each action by ownership:

- Panel-local;
- Runtime-local;
- conductor/global;
- app capability;
- ambiguous/context-dependent.

### Status

Major architecture/UX decision. Take to Council before implementation.

---

# 7. Fill Panel — a major capability seed

## 7.1 What the prototype does

The `Video - Fast Panel Fill` Tampermonkey prototype:

- searches the current document for an HTML5 `<video>`;
- finds a likely player container;
- toggles a `panel-fill-active` class;
- fixes that container to the viewport;
- expands it to `100vw × 100vh`;
- forces contained video to `width: 100%`, `height: 100%`;
- uses `object-fit: contain`;
- exposes a floating Fill Panel / exit button;
- supports `Shift + F`.

The key conceptual insight is that inside an iframe:

> the iframe viewport **is the GS3 Panel**.

So a child-page command to "fill the viewport" becomes:

> **Fill this GS3 Panel.**

## 7.2 Product problem it solves

Different sites render media with different player sizes, padding, wrappers, responsive rules, overlays, and max-width constraints.

GS3 cannot realistically hand-author player CSS for hundreds of sites.

Fill Panel offers a generic:

> "make the primary HTML5 player own the Panel"

capability.

Partial compatibility is already valuable.

## 7.3 Current compatibility evidence

Confirmed/strong successes from the field test:

- Peak Videos;
- Eporner;
- PornTrex.

Promising or partially responsive:

- WXX.WTF;
- CamLady.

Known failure:

- SpankBang.

The crude prototype appears to catch around half or more of the random HTML5 sites tested so far. That is already a meaningful product win.

## 7.4 Fill Panel becomes GS3 language

The feature should be a named product concept:

**Fill Panel**

Potential icon direction:

- expand-corners glyph with a tiny `P`;
- `FP`;
- custom panel-expand icon.

It should feel related to fullscreen without pretending to be fullscreen.

> **Fullscreen owns the display. Fill Panel owns the GS3 Panel.**

## 7.5 Semantic capability model

Do not make the final feature "click the Tampermonkey button."

The semantic action should be something like:

```text
FILL_PANEL
```

with invocation surfaces including:

```text
toolbar shortcut
keyboard shortcut
future automation
future recipe
```

All should converge on the same capability.

Potential future automation:

```text
Launch Workspace
→ Stream executor
→ choose media
→ Play
→ FILL_PANEL
```

## 7.6 Integration question

Because GS3 often embeds cross-origin sites, the host cannot directly manipulate their DOM.

The final Fill Panel implementation likely requires a browser-side capability bridge such as:

- a companion extension content script;
- expansion of an existing iframe/header extension;
- a userscript during prototype stages;
- or a future non-iframe embedding model.

The current Tampermonkey script is prototype evidence, not necessarily final plumbing.

---

# 8. Popup / pop-under / new-tab escape problem

## 8.1 User problem

While browsing media inside GS3 Panels, clicks frequently open:

- a new browser tab;
- a pop-under;
- an advertising tab;
- another page outside StreamLoop.

That breaks the workspace loop.

The user must leave GS3, locate the unwanted tab, close it, return, and re-establish context. In longer sessions this can happen repeatedly.

Even partial suppression would be a major improvement.

## 8.2 Candidate A — iframe sandbox

A native iframe can use `sandbox`.

By intentionally omitting:

- `allow-popups`;
- `allow-popups-to-escape-sandbox`;

the browser can block popup creation.

Advantages:

- native browser primitive;
- little/no injected code;
- strong containment.

Risks:

- some sites may break;
- auth/media/navigation behavior may change;
- some sites may require capabilities blocked by sandbox;
- needs evidence-based site testing.

Do not apply globally without compatibility analysis.

## 8.3 Candidate B — userscript/content injection

A child-frame script can intercept:

```text
window.open()
```

and capture links such as:

```html
<a target="_blank">
```

Possible handling:

- neutralize;
- remove `_blank`;
- keep navigation in-frame;
- allowlist legitimate cases.

Advantages:

- selective;
- can evolve heuristics;
- can share a bridge with Fill Panel.

Risks:

- timing matters;
- page-context vs isolated-world behavior matters;
- broad match rules can contaminate unrelated pages, as the recent Jellyfin/Tampermonkey incident demonstrated.

## 8.4 Candidate C — companion Chrome extension

The existing browser-extension ecosystem around GS3 suggests a durable browser capability layer may be appropriate.

Possible extension mechanisms:

- `chrome.scripting.registerContentScripts` with `allFrames: true`;
- content scripts at `document_start`;
- controlled host permissions;
- `chrome.tabs.onCreated` safety-net logic;
- declarative network/header policies where justified.

A service worker could potentially close clearly unwanted tabs spawned by GS3 child frames, but rules must be careful enough not to kill deliberate user navigation.

## 8.5 Candidate D — pointer overlay for view-only Panels

For Panels intended only to display/loop content, a transparent interaction layer can block all clicks from reaching the iframe.

This is effective for view-only mode, not a general popup solution.

Treat it as a possible interaction-lock mode.

## 8.6 Proposed product concept

Working names:

**Popup Guard**

or:

**Stay in Panel**

The exact label can wait.

The invariant:

> **Embedded sites should not casually escape the workspace into new tabs.**

Legitimate user navigation must still be possible when intentionally requested.

## 8.7 Relationship to Fill Panel

Fill Panel and Popup Guard are separate product capabilities but may belong to the same technical seam.

Both require legitimate control inside or around cross-origin framed documents.

Possible architecture:

```text
GS3 Runtime
      ↕ semantic capability messages
GS3 browser companion / content bridge
      ↕
cross-origin framed site
```

Potential capabilities:

```text
FILL_PANEL
EXIT_FILL_PANEL
POPUP_GUARD
PLAY
PAUSE
future site/player actions
```

This is a strong Council topic.

---

# 9. Browser-preview differences are evidence, not an explanation

The user has observed that StreamLoop, Browser Gallery, and related tools can occasionally behave differently in local VS Code preview versus other environments.

Future diagnosis should distinguish:

```text
application state bug
vs.
browser-preview/server-origin difference
vs.
extension/userscript contamination
vs.
cached/localStorage state
```

The recent Jellyfin Tampermonkey incident demonstrates why environment provenance matters.

But "probably preview" is not a sufficient diagnosis. Compare mechanically when relevant.

---

# 10. Product principles emerging from this test

## Hide plumbing without lying about hierarchy

The user should understand what they are targeting without learning internal Runtime Session mechanics.

Truthful does not automatically mean usable.

## Recognition beats decoding

Visual hierarchy should replace repeated encoded labels where possible.

The Grid Layout icon improvement already proved this principle.

## One semantic action, many invocation surfaces

Shuffle, Favorite, Fill Panel, Play, and future capabilities should converge on semantic actions across mouse, keyboard, and Automation.

## Success should not interrupt

Routine success should be silent or minimally acknowledged. Failures deserve attention.

## Preserve visual roles across mirrored layouts

The user's eyes care about composition, not arbitrary slot identity.

## Narrow/nested does not mean mobile

A narrow Panel can exist on a desktop because it is nested. Do not remove capability solely from width.

## Local scope beats duplicated control stacks

Prefer:

```text
[L1 | L2] + one shortcut set
```

over two colliding copies.

## Cross-origin capability needs an explicit bridge

Do not pretend the GS3 parent can manipulate arbitrary iframe DOM. Put child-page control in architecture that legitimately runs there.

---

# 11. Council questions

## A. Layer selector UX

Should the conductor replace repeated:

```text
L2-P1 L2-P2 L2-P3 L1
```

with grouped visual hierarchy while preserving the same routing model underneath?

## B. One top toolbar or nested top toolbars?

Should nested Runtime top Chrome remain physically separate, or become one scope-aware top control surface?

Classify ownership before choosing.

## C. Local quick-shortcut Layer scope

Should the right-side/quick shortcut surface show a compact `L1 | L2` selector only when nesting exists, defaulting to L2?

## D. Browser capability bridge

Should Fill Panel and Popup Guard use:

- a dedicated GS3 companion extension;
- the existing iframe/header extension;
- userscripts during prototype stages;
- another mechanism?

What should the semantic message contract look like so Automations can eventually call the same capabilities?

## E. iframe sandbox strategy

Can sandboxing safely form the first popup-defense layer?

If yes, should it be global, per-site, per-Panel, or capability-driven?

---

# 12. Revised roadmap

## Checkpoint — finish current Stage 2.5 validation

Before adding another substantive feature:

- finish human validation;
- verify L2 Undo/Redo;
- decide whether any Stage 2.5 defect blocks commit;
- commit/push accepted Stage 2.1–2.5 work.

Do not pile experimental capability work onto an unresolved tree.

---

## Stage 2.6 — Runtime Stabilization

**Priority: high**

Bounded scope:

### A. Preset display truth

Fix stale `Cleaned Bookmarks` projection if reproduced.

### B. L2 Undo / Redo

Reproduce and fix inconsistency.

### C. Top2 ↔ Bottom2 mirrored continuity

Implement visual-role-preserving mapping.

### D. Silent success

Remove/demote the specific routine successful-save interruption observed during testing.

Do not turn this into a repo-wide notification redesign unless separately authorized.

This is mostly Codex-capable once behavior is specified.

---

## Stage 2.7 — Layer / Top-Chrome UX Architecture

**Priority: high, architecture-gated**

Take to Council first.

Questions:

- grouped visual Layer selector;
- local `L1 | L2` shortcut scope;
- duplicated vs unified top toolbar;
- ownership classification for top-Chrome controls.

After the Council decision, implement the chosen UX without rewriting successful Stage C routing.

---

## Stage 2.8 — Fill Panel V1

**Priority: very high**

Promote the prototype into a proper capability.

V1 goals:

- define semantic `FILL_PANEL`;
- define exit/desired-state behavior;
- retain simple HTML5-player heuristic;
- provide a GS3-visible shortcut;
- keep keyboard invocation;
- establish supported/unsupported behavior;
- create a site compatibility matrix.

Universal support is not required.

Known evidence:

**Working/strong**
- Peak Videos
- Eporner
- PornTrex

**Not working**
- SpankBang

**Promising / needs confirmation**
- WXX.WTF
- CamLady

---

## Stage 2.9 — Popup Guard V1

**Priority: high**

Goal: dramatically reduce unwanted new-tab/pop-under escapes.

Prototype/evaluate:

1. iframe sandbox restrictions;
2. child-frame content-script interception;
3. extension-level tab safety net;
4. view-only pointer lock where appropriate.

Measure:

- sites protected;
- sites broken;
- false positives;
- legitimate navigation impact.

Likely durable home: the same browser-side capability layer used by Fill Panel.

---

## Stage 2.10 — Browser Gallery Hearts V1

**Priority: high**

Once the toolbar/Layer interaction model is stable:

```text
[Layouts] [gateway] | [♡1] [♥3] [♡4] [🎬] [⚙]
```

Core:

- discover recognized live BG instances;
- map BG host Panel to current outer Position;
- render one compact Heart per BG;
- update Position label when Panel moves;
- show current favorite state;
- use idempotent semantic `FAVORITE_CURRENT`;
- already favorite = no-op, never accidental unfavorite;
- mouse and future keyboard shortcuts use the same semantic action.

Keep V1 primarily outer/L1.

L2 Hearts come later after real usage informs addressing.

---

## Stage 2.11 — Capability shortcuts

After Hearts and Fill Panel exist semantically:

- configurable Heart shortcuts;
- Fill Panel shortcut integration;
- possible shared capability-shortcut framework;
- no DOM-click simulation.

This may also inform the local quick-action toolbar architecture.

---

## Stage 2.12 — Stream executor split

**Required before serious Automations.**

Approved future architecture:

```text
index.html
→ Workspace / Design-Time ONLY

index1.html
→ Stream Runtime / launched Stream executor

index2.html
→ Solo Runtime

index3.html
→ Grid Runtime
```

Do not build serious Automation / Launcher orchestration on the current mixed `index.html`.

The split should establish:

- authoritative Stream Runtime entry point;
- clean launch contract;
- Workspace/Design-Time isolation;
- migration/compatibility path;
- preservation of saved Workspaces.

---

# 13. Solo toolbar priority correction

The prior roadmap put `index2.html` Solo toolbar polish too high.

That is no longer correct.

The user barely uses Solo.

GS3 is increasingly centered on:

- `index3.html` Grid Runtime;
- `index.html` Workspace/Design-Time today;
- future `index1.html` Stream Runtime;
- cross-app and cross-site orchestration.

Therefore:

> **Solo/index2 toolbar polish is deprioritized.**

Keep it functional, but do not spend near-term design budget there.

---

# 14. Ghost opacity moves to future Stream Runtime

The user still wants:

- resting toolbar opacity;
- hover toolbar opacity;
- inline live adjustment from a compact Ghost control.

But this is desired primarily for **Launch Stream**, not Solo.

Today Launch Stream still emerges from mixed `index.html`.

In the future architecture it belongs to `index1.html`.

Therefore preserve the requirement but do not implement it against the wrong long-term surface.

Future concept:

```text
[controls ...] [👻]
                 ↓
          Rest Opacity
          Hover Opacity
```

Prefer existing Ghost preference semantics and avoid duplicate persistence.

---

# 15. Stage 2.13 — Launcher / Automation architecture

Only begin serious work after `index1.html` exists.

Durable principle:

> **Manual Layer selection is an interaction scope, not an Automation execution gate.**

An Automation should address the intended Panel/Runtime semantically.

Potential recipe:

```text
Target outer Position
→ launch Workspace
→ choose executor: Grid / Stream
→ optional folder/scope
→ optional Shuffle / Shuffle All
→ optional Auto Play
→ optional FILL_PANEL
→ future external/app capability actions
```

This is where semantic capability work begins paying compound interest.

Fill Panel should eventually be callable here.

BG actions should eventually be callable here.

Popup Guard may be a Runtime/Panel policy rather than a one-shot action, but the same capability framework can expose it.

---

# 16. Deliberately deferred

## L2 Browser Gallery Hearts

After V1 Hearts are used, decide nested addressing.

Example ambiguity:

```text
outer P1
→ nested L2 Runtime
→ inner P3
→ Browser Gallery
```

A simple `♥3` is insufficient.

Do not invent notation yet.

## Full Portrait / Auto orientation

Still needed:

```text
Auto
Landscape
Portrait
```

with portrait desktop retaining full Grid capability.

Not part of this scope.

## Solo/index2 aesthetic refresh

Low priority.

## Universal Fill Panel support

Not required.

Expand compatibility incrementally.

---

# 17. Agent strategy

## Antigravity

Use for tightly fenced CSS/UI polish, small visual relocation, straightforward tests, and bounded DOM adjustments.

Every prompt should include:

> **Inside the fence: be autonomous. At the fence: stop.**

## Codex

Primary implementation worker for:

- mechanically defined bug fixes;
- state projection;
- mirrored-layout mapping;
- semantic command plumbing after architecture is settled;
- tests;
- Fill Panel implementation slices;
- Hearts implementation slices.

Use the cheapest model genuinely capable; escalate only on evidence.

## Sonnet

Reserve for:

- cross-frame architecture;
- Layer/Chrome ownership;
- browser capability bridge design;
- executor split;
- tricky multi-system diagnosis.

## Opus

Do not proactively use.

Use only for a genuine long-lived architecture fork that Sonnet cannot resolve cleanly.

---

# 18. Human-test policy

Continue:

> **Automate everything mechanically provable. Ask for at most two human tests per pass unless automation cannot establish the behavior.**

Human testing is most valuable for:

- whether hierarchy makes sense;
- whether mirrored composition feels correct;
- whether something interrupts flow;
- real cross-site compatibility;
- real workflow continuity.

Do not turn the user into a manual regression harness.

---

# 19. Immediate next scope

Before Fill Panel, Hearts, or Popup Guard, the immediate engineering target should be **Runtime Stabilization**:

1. verify/fix L2 Undo and Redo;
2. verify/fix stale preset display label;
3. implement Top2 ↔ Bottom2 visual-role continuity;
4. remove/demote the specific successful-save interruption.

In parallel, prepare the Council package for:

- Layer selector hierarchy;
- local L1/L2 shortcut scope;
- duplicated vs unified top toolbar;
- Fill Panel / Popup Guard browser capability bridge.

Then proceed into the capability arc.

---

# 20. The emerging Stage 2 product arcs

## Arc A — Runtime clarity

Make nested Runtime behavior understandable without exposing plumbing:

- Layer targeting;
- Position hierarchy;
- toolbar scope;
- mirrored layouts;
- silent status;
- truthful selectors.

## Arc B — Panel capabilities

Make heterogeneous websites behave more like components inside GS3:

- Fill Panel;
- Popup Guard;
- future Play/Pause/player capabilities;
- Browser Gallery Favorites/Hearts.

## Arc C — Orchestration

Once Runtime surfaces and capability contracts stabilize:

- split Workspace from Stream executor;
- Launcher becomes a clean semantic entry point;
- Automations compose the same actions;
- Grid/Stream/BG/external capabilities can be orchestrated without UI-click simulation.

Sequence matters.

> **Do not build Arc C deeply while Arc A and the core of Arc B are still moving.**

The toolbar and capability language should settle first.

---

# 21. Final direction

GS3 is increasingly becoming less about "four iframes on a page" and more about:

> **A Runtime that turns heterogeneous web/media sources into controllable Panels, then orchestrates them through one coherent conductor.**

The latest field test reinforces that direction.

The next wins are not gigantic rewrites. They are:

- make targeting obvious;
- preserve the composition the user's eyes already understand;
- stop needless interruption;
- make common hostile/awkward website behavior disappear;
- turn proven hacks such as Fill Panel into named semantic capabilities;
- then expose those capabilities through toolbar, keyboard, and eventually Automation.

That is the revised Stage 2 scope.
