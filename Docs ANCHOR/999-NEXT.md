# Next

This document tracks upcoming work.

Items are grouped by architectural phase rather than priority.

## Runtime Memory RM-1 binding

Tier 2 current-truth snapshots are implemented as an on-demand browser reader.
The committed front door is `Diagnostics/README.md`; generated evidence belongs
only under gitignored `Diagnostics/local/`. The implementation deliberately
stops at Tier 2: Tier 1 Journal, Incidents, Last-Known-Good, background
instrumentation, and diagnostic repair/actions remain absent until separately
approved.

---

# Phase 1 — Runtime Foundation (Current)

## Runtime Session

- [ ] Finish Runtime Session ownership
- [ ] Finish Session Serialization
- [ ] Verify every runtime action updates Runtime Session
- [ ] Confirm Runtime as the single source of truth
- [ ] Investigate GitHub sync failure (after Runtime Session is complete)

---

# Phase 2 — Runtime Polish

## User Experience

- [ ] Duplicate/Copy control on the pre-launch Builder, beside Lock/X.
      Deliberately deferred: the Builder's control layout is expected to be
      reorganized, and the runtime "Copy to Position" behavior should be
      settled first so the Builder can reuse it rather than grow a second
      implementation.
- [ ] Quick Favourite
- [ ] Favourite Panel collection
- [ ] Runtime zoom in/out
- [ ] Adjustable (stream) runtime panel borders

---

# Phase 3 — Runtime Intelligence

## Runtime Systems

- [ ] Capability detection
- [ ] Runtime Events
- [ ] Timer engine
- [ ] Automation engine

---

# Phase 4 — Library Improvements

## Collections

- [x] Move Blacklist into Settings
- [x] Move "Ingest Extracted Directories" into Settings

## Part 1-2 Settings breadcrumb

WAS: all major Settings sections were always expanded, while Ingest Extracted Directories and Domain Blacklist occupied primary-page UI.

IS: each top-level Settings card collapses independently and remembers collapsed state in Store; children have no separate collapse state. Ingest is the second Settings card and Domain Blacklist is the final card, with their canonical behavior moved rather than copied.

WHY: Settings exposes complexity on demand and remembers how the customer left it; administrative functions no longer consume primary workflow real estate.
- [ ] Paste-from-clipboard ingest mode
- [ ] Skip selected collections during Shuffle
- [ ] Less-played shuffle mode
- [ ] Shuffle weighting algorithms
- [ ] Favourite collections

---

# Phase 5 — Architecture

## Runtime Separation

- [ ] Extract Stream Runtime from index.html
- [ ] Separate Design-Time from Runtime
- [ ] Make all Runtime executors siblings

Prerequisites:

- Runtime Session complete
- Timer engine complete
- Automation engine underway

---

# Phase 6 — Long-Term

- [ ] Agent framework
- [ ] Media capability scanner
- [ ] NEAR integration

---

# Deferred

Ideas intentionally postponed until the architecture is ready.

- Advanced Runtime Events
- Cloud synchronization
- Autosave
- Crash recovery
- Version history
- Collaborative Runtime

These features should be built on top of Runtime Session rather than before it.
# Pre-launch Shuffle Scope + Runtime ROOT repair breadcrumb

WAS: the Builder dropdown simultaneously acted as user intent, generation
read-out, and launch provenance fallback; Runtime normal Shuffle stayed active
for content with no assigned folder, and Copy duplicated only the URL.

IS: Builder Shuffle Scope is one persisted preference changed only by explicit
dropdown selection. Row folder / Runtime ROOT remains independent and truthful.
Unknown content stays unassigned, normal Runtime Shuffle derives availability
from ROOT, and URL + ROOT travel together through Copy and Position swaps.

WHY: "where should the next Builder Shuffle draw from?" and "which ROOT is this
content assigned to?" are different facts and GS3 must not fabricate either.

---

## Durable Layer identity (Tier 1 + Tier 2)

The canonical executor registry now distinguishes Workspace / Design-Time from Runtime execution and anticipates index1.html. This prepares later Runtime separation as an additive registry/navigation change. No index1.html or launch retargeting was implemented. Runtime confirmation handshake remains deferred; current Layer UI uses Panel declarations.

## Nested Runtime launch handoff

Grid handoff is now a parent-owned semantic assignment. Stream receives the
same truthful handoff only after `index1.html` exists as its distinct Runtime
executor; `index.html` must not be claimed as Stream Runtime in the meantime.

B.2 breadcrumb — the launch handoff is independent of the [L2][L1] command
selector by construction: `_handleRuntimeLaunchRequest` resolves its Panel
target from `event.source` alone and never reads Runtime scope. A dedicated
mechanical trace (real and synthetic clicks, every canonical layout/slot,
Master Bar open and closed, saved Workspace ids, Live Builder, and the
selector explicitly set to L1) found the handoff, the activation boundary,
and this independence already correct and reproducibly working; see
011-HOTSWAP-CHROME.md § The selector has no jurisdiction over launch. The
click handler now also tolerates a failing local autosave/sync without
losing the launch itself — a silent failure there must never look to the
user like "Launch Grid does nothing."

## Bottom Runtime Shell follow-up

Stage A establishes height-independent shell geometry and Dock measurement only.
Stage B owns action/layout composition; Stage C may suppress nested shells only
once capability routing preserves every nested control's reachability.

Stage B now provides canonical Grid layout shortcut order/count preferences,
separate layout/general gateways, Grid Folder demotion, Solo-specific Folder
prominence, and Master Redo over the existing single Runtime history.

## Future Browser Gallery Dock contract

Browser Gallery Hearts remain unimplemented. Future semantic capability state
will populate a dynamic Dock list such as `♡P1`, `♥P3`; the label follows the
host Panel's current Position when that Panel moves. Favorite state must come
from a Browser Gallery handshake, never DOM scraping or URL resemblance. Heart
routing is independent of L1/L2 scope and will use the live Browser Gallery
instance → host Panel → current Position mapping.

The permanent physical Dock order, approved ahead of implementation:

    [visible Grid layout shortcuts] [layout gateway] | [dynamic Hearts] [🎬] [⚙]

Hearts sit inside the dynamic Dock, before 🎬 and ⚙. Only recognized live
instances get a control — no reserved/invisible Heart slots. Stage A's
measured Dock reserve already grows and shrinks the Master Bar's legal width
to match, so Hearts need no new shell geometry, only population.

Each Heart is invokable both by mouse and by its own configurable keyboard
shortcut, and both invocations dispatch the SAME semantic action —
`FAVORITE_CURRENT` targeting the live Browser Gallery instance whose host
Panel is currently at that Heart's Position — never two separate
implementations. See 001-PHILOSOPHY.md § The Conductor. Default shortcut
bindings are not yet decided.

## Post-B.1 refinement follow-up

Settings' Grid Layout Order rows now render the canonical mini-floorplan icon
and a human-readable title, reusing `js/grid-layouts.js` — no second layout
vocabulary. The [L2][L1] Layer target moved into its own central Master shell
region (a dedicated flex spacer balances the status region so it sits toward
the bar's middle); the future `[L2-P1] [L2-P3] [L1]` selector will occupy the
same region. index3.html's small-viewport `@media (max-width: 900px)`
fallback is now scoped to `html:not(.is-nested)`, so a nested Grid's own
internal resizers and configured layout survive being hosted in a Panel
narrower than 900px — a genuinely narrow top-level viewport is unaffected.

Left Tall <-> Right Tall already preserves each Panel's visual role (tall /
top-short / bottom-short) with no permutation code of any kind: both layouts
bind the same grid-area names to the same visual roles in index3.html's CSS,
and a layout switch already resets the session arrangement to identity. This
was verified mechanically, not assumed — see the Claude Report for this pass.

Deferred, not guessed at:

- **Top2 <-> Bottom2** is NOT an automatically-compatible pair the way Left
  Tall/Right Tall is — `top2` binds `screen1`→top-left-half/`screen2`→
  top-right-half/`screen3`→bottom-wide, while `bottom2` binds
  `screen1`→top-wide/`screen2`→bottom-left-half/`screen3`→bottom-right-half.
  A content role WOULD jump on switching (e.g. a top-left-half Panel would
  land in the top-WIDE cell). If mirrored continuity is ever wanted for this
  pair, it needs its own deliberate area-remapping design, not an assumption
  that the Left Tall/Right Tall mechanism generalizes.
- **Vsplit <-> Hsplit** have no tall/short role distinction to violate (two
  equal panels either way), so there is nothing to design here.
- A universal layout-transition/permutation engine was deliberately NOT built.
  Only Left Tall <-> Right Tall was verified; extending "mirrored continuity"
  to any other pair is a future product decision, not an inferred consequence
  of this pass.
- Full Portrait/Auto orientation architecture remains its own future pass;
  this task only narrowed one existing rule's exclusion (nested + narrow),
  it did not build the orientation model itself.
- Future `[L2-P#]` addressing still needs its own design pass; only its
  physical shell position (central, alongside the future Layer target) is
  now settled.

## Stage 2.5 — Layer Clarity + Bottom Runtime Shell Stage C

`[L2-P#]` addressing is implemented (see 006-TERMINOLOGY.md, 011-HOTSWAP-
CHROME.md, 000-INVARIANTS.md § Runtime Shell Ownership): the Master conductor
targets exactly one nested Grid Runtime, by its outer HOST Position, never
broadcasting. Nested local Position labels read `L2 · P#`; nested top Chrome
carries a subtle graphite/smoky `.is-nested` treatment. `Folder`, `Layout` and
`Save Session As` joined the routed action set (`MASTER_LAYER_ACTIONS` in
launch.js) alongside the already-routed Shuffle/Shuffle All/Undo/Redo/Reload,
and a nested Grid now reports its own status outward to the parent's shell.
Only once that parity was proven did a nested Grid Runtime stop constructing
its own global Master Bar/Orchestration Dock — one shell per viewport.

**Solo (index2.html) nested-shell suppression is explicitly deferred.** Solo
has no Layer-scoped routing of its own today — no `_installLayerScopeReceiver`,
no per-Panel system to route Folder/Shuffle/Undo through — so suppressing its
nested global shell now would be a real, unreplaced capability loss. Per the
acceptance rule (parity before suppression), Solo's `html.is-nested
#orchestration-dock { right:auto; left:18px }` relocation workaround stays in
place until a future pass gives Solo the same routing Grid now has. Note also
that Solo cannot itself HOST a nested Runtime (a single iframe, no Panel/
Position system) — only Grid (and future Stream) hosts nested Runtimes, so
Grid-in-Grid is the only case Stage C's suppression needed to prove.

## Future executor split (breadcrumbed, not implemented)

Canonical Runtime executor family, approved but not yet built:

```text
index.html  → Workspace / Design-Time only
index1.html → Stream Runtime
index2.html → Solo Runtime
index3.html → Grid Runtime
```

`index.html` today still carries historical mixed responsibilities; untangling
that, creating `index1.html`, and splitting Design-Time from Runtime execution
is Phase 5 work (see § Runtime Separation above) and was deliberately NOT
touched by Stage 2.5.

Manual Layer selection (`[L2-P#]`/`[L1]`) is an interaction SCOPE, not an
Automation execution gate. Future Automations will address Panels/Runtimes
semantically after the executor split is established — serious Launcher/
Automation work should not proceed until that split and its plumbing receive
their own dedicated pass. Stage 2.5 did not implement Automations, Launcher
redesign, Browser Gallery Hearts, or Solo toolbar refresh — all remain future
work in the order already recorded above (Solo toolbar refresh, then BG
Hearts V1, then Heart shortcuts/L2 Hearts, then Launcher/Automation
architecture after the executor split).
