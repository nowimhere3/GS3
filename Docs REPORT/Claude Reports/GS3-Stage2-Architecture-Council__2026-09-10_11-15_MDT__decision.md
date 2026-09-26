# GS3 Stage 2 Architecture Council — Field-Test Review, Priority Decision, and Capability Architecture

**Calgary time:** 2026-09-10 11:15 MDT
**Branch:** `main` @ Stage 2.5 tree (uncommitted, per the Stage 2.5 report)
**Scope:** architecture + prioritization only. No code was read to be changed, none was edited,
no commit, no push. Where the field-test document raised a suspected bug (L2 Undo/Redo), the
current implementation was inspected read-only to keep this report's risk assessment honest —
see §10.

**Primary input:** `Docs REPORT/Claude Reports/GS3_Stage2_Field_Test_Findings_and_Revised_Roadmap_2026-09-10.md`
(treated as the authoritative field-test record; not restated here except where a specific claim
needed evaluating or narrowing).

**Anchors reviewed:** `000-INVARIANTS.md`, `001-PHILOSOPHY.md`, `004-RUNTIME-SESSION.md`,
`006-TERMINOLOGY.md`, `007-PANEL-IDENTITY.md`, `010-PANEL-NAVIGATION.md`, `011-HOTSWAP-CHROME.md`,
`999-NEXT.md`. Latest report: `Stage-2.5-Layer-Clarity-Bottom-Shell-StageC` (this session's own
prior implementation, which the field test evaluated).

---

## 1. Executive verdict

**Do next:** Stage 2.6 (Runtime Stabilization) immediately, in parallel with locking the two
Layer/top-Chrome decisions this report makes in §4 — those decisions do not require writing code
today, only being settled so Stage 2.7's implementer doesn't re-litigate them. Then Fill Panel V1
and Browser Gallery Hearts V1 **run in parallel** (they touch disjoint surfaces and neither
depends on the other), immediately after Stage 2.6/2.7 land. Popup Guard V1 follows Fill Panel by
one prototype cycle, reusing the same capability bridge contract.

**What should wait:** the Stream executor split (`index1.html`) and all serious Launcher/
Automation architecture. Nothing in this report's approved work requires the split, and doing the
split before the toolbar/capability surface settles would fork every subsequent Arc A/B change
across two executor files.

**Highest-leverage architectural move available right now:** not a feature — it's the decision in
§4 that a Panel's own local Chrome (top toolbar *and* right-side Runway) should **yield by default**
to the Chrome of a nested Runtime it hosts, rather than stacking beside it. This single rule
dissolves both the "two top toolbars" complaint (§6 of the field-test doc) and the "shortcut
collision" complaint (§5) with one mechanism, without touching the Stage C routing that already
works. It costs a presentation-only change (Chrome Is Presentation already permits this) and pays
down two separate UX complaints at once — the kind of leverage the philosophy anchor asks for
("the best UI is often a consequence of good architecture").

**What must not happen:** literally unifying every top-Chrome control (Position, Folder, Fill
Panel, etc.) behind one scope-toggled button set, as the field test's mockup sketches. §4 shows
why: several of those controls have no L2 meaning at all, and forcing them through a shared scope
toggle would either silently break ("Copy to Position 3" inside a nested grid is not the same
request — already a documented invariant) or require inventing meanings that don't exist. The
field test's *goal* (less stacked plumbing) is right; its literal mockup is not the mechanism.

---

## 2. Dependency graph

```text
Stage 2.5 tree (uncommitted)
└─ Stage 2.6 — Runtime Stabilization  (blocks everything: do not build on an unresolved tree)
   ├─ A. Preset display truth
   ├─ B. L2 Undo/Redo verification            ← likely test gap, not defect (§10)
   ├─ C. Top2 ↔ Bottom2 visual-role mapping
   ├─ D. Silent success (this ONE popup only)
   └─ COMMIT/PUSH the accepted Stage 2.1–2.6 tree
      │
      ├─ Stage 2.7 — Layer/top-Chrome UX (DECIDED in §4 of this report; implementation only)
      │  ├─ 2.7a Master selector: grouped disclosure over unchanged L2-P# routing
      │  └─ 2.7b Panel Chrome yields to hosted Runtime (top toolbar + Runway)
      │     │
      │     ├─ Stage 2.8 — Fill Panel V1 ──────────────┐
      │     │  (Panel-local capability; needs 2.7b      │
      │     │   settled so its toolbar slot is stable,   │  both write to the
      │     │   but not gated on 2.7b SHIPPING — see §6) │  SAME capability
      │     │                                            │  bridge contract
      │     ├─ Stage 2.9 — Popup Guard V1 ───────────────┤  (defined once,
      │     │  (reuses 2.8's bridge contract;             │  §5 — not two
      │     │   independent implementation)                │  divergent ones)
      │     │                                            │
      │     └─ Stage 2.10 — BG Hearts V1 ────────────────┘
      │        (Dock-only; depends on 2.6's clean tree
      │         and the EXISTING --gs3-dock-reserve
      │         contract, already growth-safe; does NOT
      │         depend on 2.8/2.9 — can run concurrently)
      │
      └─ Stage 2.11 — Capability shortcuts
         (configurable Fill Panel / Hearts shortcuts;
          needs 2.8 AND 2.10 to have a semantic action
          to bind — the only true convergence point)
         │
         └─ Stage 2.12 — index1.html executor split
            (needs Arc A + core Arc B stable so the
             split forks nothing still moving)
            │
            └─ Stage 2.13 — Launcher / Automation architecture
               (the split's entire reason to exist first)
```

Read left-to-right as "must exist before," not "must ship before starting the next." 2.8/2.9/2.10
can be worked in parallel by different agents once 2.6+2.7 land; 2.11 is the only real join point.

---

## 3. Recommended Stage 2 roadmap

### Checkpoint 0 — Close out Stage 2.5

**Objective:** stop accumulating uncommitted work on an unvalidated tree.
**Risk:** none architecturally; purely process.
**Value:** everything after this depends on a known-good baseline.
**Agent:** none (human decision + a commit).
**Must NOT include:** any new feature work riding along in the same commit.

---

### Stage 2.6 — Runtime Stabilization

**Objective:** fix the four confirmed field-test regressions; restore trust in state-projection
truthfulness before adding new surface area.
**Architectural risk:** low. All four are either a rendering-truth bug (A), a coverage gap more
than a defect (B — see §10), a presentation mapping already proven possible for one layout pair
and now extended to a second (C), or a UI-only removal (D).
**User value:** high. These are exactly the kind of "plumbing works, representation of the
plumbing doesn't" bugs the field test's central thesis is about — fixing them is disproportionately
trust-restoring relative to their size.
**Agent:** Codex, once each item is mechanically reproduced. B specifically should start with
reproduction, not a fix attempt (§10).
**Must NOT include:** a general notification-system redesign (only the one save-success popup),
a universal layout-transition engine (only Top2↔Bottom2, following the Left-Tall/Right-Tall
precedent's *method*, not assuming its *code* generalizes — verify the area-name bindings for
this pair exactly as that prior pass did), or any Layer/toolbar UX change (that's Stage 2.7).

---

### Stage 2.7 — Layer / Top-Chrome UX Architecture

**Objective:** implement the two decisions locked in §4 of this report.
**Architectural risk:** medium. 2.7a is presentation-only over already-correct routing (low risk
in isolation). 2.7b changes *default reveal behavior* of existing, unremoved Chrome — the
category of change 011-HOTSWAP-CHROME.md already permits ("Chrome Is Presentation... revealing,
retracting, ghosting or reordering Chrome is presentation only"), but it is new enough behavior
that it needs the same mechanical-proof discipline Stage 2.5 used (an outer Panel hosting a
nested Runtime still reaches every container-only action through the compact affordance; nothing
is deleted, only its default visibility changes).
**User value:** very high — this is the field test's central complaint, resolved once.
**Agent:** Sonnet for the 2.7b default-reveal logic (cross-Chrome-lifecycle reasoning, same class
of work as the original Hotswap Chrome retraction design); Codex-capable for 2.7a once the
disclosure-menu shape is specified (it's a close cousin of the existing Position-button pop-under
pattern already in the codebase).
**Must NOT include:** merging Panel-local container actions (Position, Copy Position, Folder,
Kill, Launchpad, Star, Purge, Delete) into anything Layer-scoped. Must not touch the Master
conductor's routing (`_effectiveMasterLayerTarget`, `_dispatchMasterToLayerTwo`, `_sessionLayerTwoSlots`)
at all — only its rendering.

---

### Stage 2.8 — Fill Panel V1

**Objective:** promote the Tampermonkey prototype into a named GS3 semantic capability with a
real (even if narrow) V1 boundary. See §6 for the full architecture.
**Architectural risk:** medium-high — this is the first capability that legitimately needs code
running *inside* third-party origin content, which is a new trust boundary for GS3 (§10).
**User value:** very high — proven prototype, immediate cross-site win, "recognition beats
decoding" made literal (a player finally looks like it belongs to the Panel).
**Agent:** Sonnet for the capability-bridge contract and the trust-boundary decisions (§5, §10);
Codex for the per-site heuristic, the toolbar/keyboard wiring once the contract is fixed, and the
compatibility matrix maintenance.
**Must NOT include:** a full browser extension (§5); Automation wiring (no executor split yet);
universal site support; any code path where an inbound third-party-origin message can mutate
Runtime Session state (§10).

---

### Stage 2.9 — Popup Guard V1

**Objective:** layered popup/pop-under suppression. See §7 for the full architecture.
**Architectural risk:** medium — the compatibility-breakage risk is real and must be measured,
not assumed.
**User value:** high, and compounds with Fill Panel (both make cross-origin content behave more
like a GS3-owned component).
**Agent:** Sonnet for the sandbox-flag compatibility strategy and the trust boundary reuse from
2.8; Codex for the compatibility-matrix test harness once the layers are specified.
**Must NOT include:** a companion extension built for this alone (§7); global sandbox rollout
before a compatibility pass; anything that silently kills a tab a user deliberately opened.

---

### Stage 2.10 — Browser Gallery Hearts V1

**Objective:** exactly as specified in the field-test doc §12 (Stage 2.10) — no changes
recommended to that scope.
**Architectural risk:** low. `--gs3-dock-reserve` already measures and grows for exactly this
case (built and tested in Stage A/B). `FAVORITE_CURRENT` is a clean new idempotent semantic
action with no dependency on Fill Panel/Popup Guard/the capability bridge.
**User value:** high, and independent — can ship whenever 2.6 is done, does not need to wait for
2.8/2.9.
**Agent:** Codex, once the BG handshake shape is specified (Sonnet should specify the handshake
itself — "how does GS3 know a live BG instance exists and is favorited" — in a short design note
before Codex implements, since that's the one genuinely architectural question in this stage).
**Must NOT include:** L2 Hearts addressing (§8) or any Heart keyboard-shortcut default bindings
beyond what's already breadcrumbed.

---

### Stage 2.11 — Capability shortcuts

**Objective:** configurable shortcuts for Fill Panel and Hearts, converging on the same
"one semantic action, many invocation surfaces" pattern Shuffle/Undo already prove.
**Architectural risk:** low — this is presentation/configuration plumbing over already-existing
`_wireCollection`/`_reconcileOrder` machinery (a fourth instantiation, matching the precedent
Stage B already set for layout slots).
**User value:** medium — real but incremental once 2.8/2.10 exist.
**Agent:** Codex.
**Must NOT include:** DOM-click simulation for any shortcut (already an explicit product
principle); premature Automation binding.

---

### Stage 2.12 — Stream executor split (`index1.html`)

**Objective:** as specified in the field-test doc — authoritative Stream Runtime entry point,
clean launch contract, Design-Time isolation, migration path, saved-Workspace preservation.
**Architectural risk:** high in the sense that it touches launch/navigation plumbing broadly, but
low in novelty — the executor registry (`RUNTIME_EXECUTORS`) already anticipates this file, and
the Layer 2 identity work already distinguishes `role: 'runtime'` from `role: 'design-time'`.
**User value:** indirect (enables Automation) but not user-visible on its own.
**Agent:** Sonnet.
**Must NOT include:** any Automation implementation riding along in the same pass. Ghost opacity
(resting/hover controls) should land here or after, targeting `index1.html` directly — see §10
for why implementing it against `index.html` now would be a trap.

---

### Stage 2.13 — Launcher / Automation architecture

**Objective:** as specified in the field-test doc. Not detailed further here — this report's job
was to get everything *before* it settled, not to re-architect Automations early.
**Architectural risk:** deferred, correctly.
**Agent:** Sonnet to start; this is exactly the "genuine long-lived architecture fork" class of
work the field-test doc reserves Opus for, if Sonnet hits a real wall.

---

## 4. Layer/top-Chrome recommendation

This is a decision, not a restatement. Two separate questions were bundled in the field-test
document; they get two separate answers.

### 4a. Master conductor selector (`L2-P1 L2-P2 L2-P3 L1`)

**Decision: keep `L2-P#` as the routing identifier unchanged; change only its *rendering* to a
grouped disclosure control.**

```text
[ L1 ]   [ L2 ▾ ]
           ├ P1
           └ P3
```

- `L2 ▾` is lit whenever the effective target is any nested Runtime; opening it reveals only the
  Positions that truthfully host one (never a fixed set — same truthfulness rule as today).
- Selecting a Position inside it sets `_masterLayerTarget` to that slot, exactly as a direct
  `L2-P#` button click does today — **zero change to `_effectiveMasterLayerTarget()`,
  `_dispatchMasterToLayerTwo()`, or `_sessionLayerTwoSlots()`**. This is a rendering change over
  already-correct plumbing, which is why it is low risk despite being visible everywhere.
- With exactly one nested Runtime, collapse to a flat `[L1] [L2-P1]` (no pointless one-item
  submenu) — this already matches the "hidden when there is no choice to present" principle
  011-HOTSWAP-CHROME.md established for the selector's existence at all; extend it to the
  disclosure's existence too.
- Reuses an existing pattern: this is structurally the same shape as the Position button's own
  pop-under menu (`.hotswap-position-menu`), already implemented and already proven to survive
  the "rail is `overflow:hidden`" clipping trap. Do not invent a second menu mechanism.

**Why not literally "Layer once, Position as children" with no disclosure interaction** (i.e., a
flat two-row list that also invalidates the whole point of a *compact* conductor bar): because
the Master Bar's structural constraint (§5 of the Bottom-Runtime-Shell report — the reserve, the
right-anchored contextual cluster) means an always-expanded list of nested Runtimes competes for
the same horizontal budget as the layout cluster. A closed-by-default disclosure keeps the
common case (one nested Runtime, or none) exactly as compact as today, and only costs width when
there is genuinely something to disambiguate — which is precisely when the extra width is earned.

### 4b. Top-Chrome ownership classification

| Control | Classification | L2-scopable today | Notes |
|---|---|---|---|
| 📍 Move to Position, 📋 Copy to Position | Position-scoped (container) | **Never** | Already `structural: 'positionButton'`; a swap inside a nested grid is a different request entirely — existing invariant. |
| 📁 Folder (panel-level) | Panel-local (container's content source) | **Never** | Distinct from Master's own 🌐 Folder (Grid-only, already L2-routed as of Stage 2.5) — same word, two different owners, already documented. |
| ⭐ Star/Favorite | Panel-local | **Never** | Bookmarks *this container's* current URL; a nested Runtime has no single "current URL." |
| ❌ Delete, ☠ Kill, 🗑️ Purge, 🚀 Launchpad | Panel-local (container) | **Never** | Kill removes the container itself — deleting the nested Runtime wholesale is not "delete something inside it." |
| ⟳ Reload | **Dual** — Runtime-local | **Already** (`LAYER_SCOPED_ACTIONS`) | Legitimately means two things (reload this container vs. reload the nested Runtime) and both are already correctly wired. |
| 🎲 Shuffle, 🎲🎲 Shuffle All, ↩ Undo, ↪ Redo | Runtime-local | **Already** | Panel-level and Master-level both correctly route (Stage B/B.2/2.5). |
| **Fill Panel** (new) | **Panel-local**, specifically LEAF-content-local | Never at Master level | See §6 — it targets whichever Panel is *actually* showing playable media, which for a nested Grid is one of *its own* leaf Panels, not the container. It belongs on the toolbar of whichever Panel directly hosts the video, at whatever nesting depth that is — never forwarded through `L2-P#`. |
| **Popup Guard** (new) | Panel-local **policy**, possibly promotable to a Folder/session default later | Never | A per-Panel or per-content-source setting, not a one-shot conductor action. |
| Layer target itself | Conductor/global | is the target | Master Bar only. |
| Master 🌐 Folder / ▦ Layout / 💾 Save Session As | Conductor/global, Grid-only | **Already** (Stage 2.5) | Correctly excluded from Solo (no layouts there). |

**Decision: Hybrid (C), not full unification (B).**

Full unification is rejected because roughly half the table has **no L2 meaning at all** — a
scope toggle over Position/Folder/Kill/Launchpad would either silently do nothing when aimed at
L2 (confusing) or require inventing a meaning that contradicts an existing, deliberate invariant
("Copy to Position 3 inside a nested grid is not the same request"). Keeping multiple physically
separate toolbars unchanged (A) is rejected because it does not address the field test's real
complaint (stacked plumbing, visual weight, collision).

The hybrid: **a Panel's own local Chrome (top toolbar *and* right-side Runway) yields by default
whenever that Panel's content is a truthful nested Runtime.** Concretely:

- When `getPanelRuntimeLayer(panel) === 2`, the CONTAINER Panel's own top-toolbar reveal-on-hover
  and Runway no longer auto-populate/auto-reveal their full control set. The nested Runtime's own
  Chrome — rendered natively one layer in, at whatever Position the user is actually looking at —
  already supplies the controls that matter 95% of the time (its own Shuffle, its own Position
  moves, its own Fill Panel on its own leaf Panels).
- The container-only actions that have no nested equivalent (Kill this container, Move/Copy this
  container's Position, replace with Launchpad) remain reachable through one small, always-present
  affordance (a compact badge near the Panel's border, not a revealed toolbar) rather than a full
  duplicate surface. Nothing is removed — only demoted from "revealed by default" to "one extra
  click away," which is exactly the kind of change 011-HOTSWAP-CHROME.md already classifies as
  presentation.
- This is deliberately **not** a new dispatch mechanism and does not touch `LAYER_SCOPED_ACTIONS`,
  `MASTER_LAYER_ACTIONS`, or any routing code from Stage 2.5 — it only changes when Chrome reveals
  itself, which the existing "Chrome retracts itself" lifecycle already owns.
- This same rule resolves the field test's §5 Runway-collision complaint identically: if the
  container's own Runway doesn't populate while hosting a nested Runtime, there is nothing to
  collide with. The container's existing panel-level `[L2][L1]` selector (already implemented,
  already governs `dispatchToLayerTwo` for the Runway's mirrored buttons) becomes the *explicit*
  path back to container actions when the user deliberately wants them, rather than something
  fighting for the same pixels as the nested Runtime's own controls by default.

**Consistency check against existing invariants:** 011-HOTSWAP-CHROME.md's "Nested Runtime
geometry is hierarchy, not duplicated Chrome... both meanings are real, neither should be
suppressed" is about GEOMETRY (resizers) — capability that must never be strippable by nesting or
narrow width. This recommendation does not strip Chrome capability; it changes default reveal
ergonomics of Chrome that remains fully present and fully reachable, which is a different,
narrower claim and does not contradict that invariant.

---

## 5. Browser capability recommendation

**Decision: yes, define the shared capability-bridge message contract now — but build only a
userscript-based prototype against it, not an extension.**

The evidence bar is met: two independent, real product capabilities (Fill Panel, Popup Guard)
plus a foreseeable third (Play/Pause and future player actions) all hit the exact same wall — the
GS3 parent cannot manipulate arbitrary cross-origin child DOM, and any legitimate solution
requires code that runs *inside* that child's own JS realm. That is a single, recurring
architectural fact, not three separate problems. Defining the contract once, before either ships,
is cheap; discovering after both ship independently that they invented two different message
shapes is expensive and exactly the kind of "one canonical registry, not three hand-curated
vocabularies" mistake this codebase has already paid down once (see `011-HOTSWAP-CHROME.md`'s own
retrospective on `shortcutable`).

**Minimum viable architecture:**

```text
GS3 Runtime (parent, trusted)
      │  1. GS3-INITIATED capability invocation
      │     window.postMessage({ source: 'gs3-capability-bridge',
      │                           capability: 'FILL_PANEL' | 'EXIT_FILL_PANEL' | 'POPUP_GUARD' | ... },
      │                         '*')   ← target origin cannot be known in advance; see trust note below
      ▼
Content bridge (today: a userscript; later: an extension content script — same code, different host)
   running INSIDE the child frame's own origin/realm
      │  2. CHILD-INITIATED reports only (advisory, never state-mutating)
      │     window.parent.postMessage({ source: 'gs3-capability-bridge',
      │                                  report: 'CAPABILITY_PRESENT' | 'FILL_PANEL_ACTIVE' | 'POPUP_BLOCKED',
      │                                  capability, ... }, '*')
      ▼
cross-origin framed site (untrusted)
```

**Trust boundary — the one thing this must get right from day one (see also §10):**

- Direction 1 (parent → child) is safe by construction: GS3 already knows what it wants to do; the
  message is an *instruction*, and if no bridge is listening, nothing happens — a truthful,
  fail-closed default consistent with `000-INVARIANTS.md`'s "Honest Capability" section (no
  fabricated capability may be assumed; absence must degrade honestly).
- Direction 2 (child → parent) crosses a genuine trust boundary: the sender is arbitrary
  third-party content, so the existing internal contract's discipline (same-origin check,
  `LAYER_MESSAGE_SOURCE`, validated against a canonical registry) **cannot** be reused as-is,
  because origin equality is meaningless here by design. GS3 must treat every inbound message on
  this channel as **advisory and idempotent only** — it may light up a "Fill Panel available here"
  indicator or log a blocked-popup count; it must **never** be allowed to reach Runtime Session,
  Store, presets, or folders. This is a new rule, not a relaxation of an old one, and belongs in
  `000-INVARIANTS.md` once implemented (§11).
- Capability discovery is honest, not assumed: a Panel shows Fill Panel/Popup Guard affordances
  only after receiving a `CAPABILITY_PRESENT` report from that specific frame, with a timeout that
  defaults to "not supported here" — mirroring the same "resemblance is never evidence, absence
  degrades honestly" discipline the Layer 2 identity work already established for a different kind
  of truthfulness.

**Why userscript-first, not an extension, right now:** the brief's own instruction — do not build
an extension because it sounds elegant — is correct on the evidence available. A userscript can
validate the *contract* (message shapes, capability discovery, the trust boundary) at near-zero
build cost, exactly as the Fill Panel Tampermonkey prototype already has. An extension earns its
cost only once a capability needs something a userscript genuinely cannot provide — the clearest
candidate being Popup Guard's Layer 3 (`chrome.tabs.onCreated` as a last-resort net for native
browser popups sandboxing can't stop). Build the extension when that specific gap is proven, not
before.

---

## 6. Fill Panel architecture

**Semantic contract:**

```text
FILL_PANEL        — parent → child, no payload beyond target frame
EXIT_FILL_PANEL    — parent → child, no payload
CAPABILITY_PRESENT — child → parent, { capability: 'FILL_PANEL' }, advisory only (§5)
FILL_PANEL_ACTIVE  — child → parent, { active: boolean }, advisory only — drives the toolbar's own active/inactive glyph state
```

**Ownership:** Panel-local, specifically leaf-content-local (§4b) — the control appears on the
toolbar of whichever Panel is *actually* rendering the third-party page with the video, at
whatever nesting depth that is. It is never a Master-conductor action and never routed through
`L2-P#`; a nested Grid's own leaf Panels carry their own Fill Panel controls exactly as they carry
their own Shuffle.

**V1 boundary:**

- One generic HTML5-`<video>`-plus-likely-container heuristic, exactly as the prototype already
  implements — no per-site special-casing in V1 beyond what a compatibility matrix records as
  data (site → works/doesn't/untested), never as branching code.
- Invocation surfaces: toolbar button (Panel-local, following §4b placement), `Shift+F` (already
  proven ergonomic by the prototype; make it the default, configurable like every other GS3
  shortcut), and the capability slot reserved for a future Automation step — not implemented now.
- Capability presence must be honestly reported (§5) before the toolbar control renders as usable;
  a Panel whose content never reports back shows no Fill Panel affordance rather than a button
  that silently does nothing (same "no control that silently does nothing" discipline the ···
  gateway/cursor incident already established).
- No persistence of Fill Panel state across a content generation change (a new URL assignment is a
  new generation per `010-PANEL-NAVIGATION.md`; Fill Panel state is presentation over the OLD
  generation's DOM and has no meaning once that generation ends — Exit implicitly on any GS3
  content reassignment, never carried forward).
- Site compatibility matrix ships as a maintained data table (the field test's own evidence is the
  seed: Peak Videos / Eporner / PornTrex working, SpankBang failing, WXX.WTF / CamLady pending),
  not as a growing pile of per-site conditionals in the bridge script.

**Explicitly out of scope for V1:** universal support, player-specific overrides beyond the
generic heuristic, Automation wiring, any capability beyond FILL_PANEL/EXIT_FILL_PANEL on this
pass (PLAY/PAUSE reuse the same bridge later, once the contract has one real precedent proven in
production rather than two speculative ones at once).

---

## 7. Popup Guard architecture

**Recommended layered defense**, gated by evidence at each layer before promoting it to a wider
default — the field test's own framing ("layered defenses, not one catch-all") is correct and is
adopted as-is:

**Layer 1 — iframe `sandbox`, default-on after a compatibility pass.**
Omit `allow-popups` / `allow-popups-to-escape-sandbox` on GS3's own iframe elements. Cheapest,
most native, highest containment. Risk is real (OAuth/auth flows and some legitimate
window-opening functionality can break) — this must not ship globally without first running the
same site matrix Fill Panel already seeded, tracking sites-protected vs. sites-broken. Offer a
per-Panel or per-folder opt-out for sites known to legitimately need popups, mirroring the
existing per-Panel/per-content-source preference pattern GS3 already uses elsewhere (folder
assignment, layer scope).

**Layer 2 — capability-bridge content script, opt-in once Layer 1's matrix is known.**
Reuses the exact contract from §5/§6: the bridge intercepts `window.open()` and neutralizes
`target="_blank"` inside the child's own realm, reporting `POPUP_BLOCKED` events (advisory, §5)
so the user can *see* that something was stopped rather than wondering why nothing happened — this
satisfies "failures/action-required deserve attention" even though a blocked popup is not exactly
a failure; it is a state worth surfacing, not silence.

**Layer 3 — extension `chrome.tabs.onCreated` safety net, deferred until an extension exists for
another proven reason** (§5) — a last-resort net for native popups that bypass both sandbox and
in-frame interception. Do not build the extension solely to get this layer; add it opportunistically
once Fill Panel or Popup Guard's own Layer 1/2 evidence justifies migrating the bridge to an
extension.

**Layer 4 — pointer-lock overlay for explicitly view-only Panels**, opt-in per Panel, not a
general popup solution — exactly as scoped in the field-test document. Treat as an interaction-lock
mode, not part of Popup Guard's own escalation ladder.

**Compatibility-testing plan:** reuse the Fill Panel evidence sites as the initial matrix (same
sites, two different capabilities measured against them is efficient), add a small set of known
popup/pop-under-heavy sites, and track four numbers per candidate layer before promoting its
default: sites protected, sites broken, false positives (legitimate navigation blocked), and
whether the break is recoverable via the per-Panel opt-out. Do not default Layer 1 on globally
until that matrix exists.

---

## 8. Hearts placement

**Placement in the sequence:** parallel with Fill Panel V1 (Stage 2.10 alongside 2.8), not after
it and not gated on the capability bridge. The two are independent by construction — Hearts is a
Dock/conductor-level favorite-state control over a live Browser Gallery instance; Fill Panel is a
Panel-local media control over arbitrary third-party content. They share no code path and no
trust boundary.

**Dependency:** only Stage 2.6 (clean tree) and, loosely, Stage 2.7a (so the conductor's visual
language — where a Position-addressed control sits in the bar — is settled before Hearts adds a
third Position-addressed vocabulary alongside `L2-P#` and Position labels; not a hard blocker,
but sequencing it right after avoids designing Hearts' `♡1`/`♥3` presentation against a selector
UI that's about to change shape).

**What to reserve now, architecturally:** nothing beyond what Stage A/B already built. The
`--gs3-dock-reserve` measured-width contract was explicitly designed and tested to absorb
Hearts appearing/disappearing at runtime with zero new shell geometry — this is the acceptance
test that contract was written against, still valid, nothing further to reserve. Do not invent
L2 Hearts notation now (§16 of the field-test doc is correct to defer this — a Heart on a nested
Runtime's own leaf Panel needs its own addressing question answered by real V1 usage first, not
guessed at).

---

## 9. Executor-split timing

**When:** Stage 2.12, after Arc A (Layer/top-Chrome UX, §4) and the core of Arc B (Fill Panel,
Popup Guard, Hearts) are shipped and stable — not before, not deferred indefinitely.

**What must happen before it:**
- Stage 2.6 stabilization (a clean baseline to fork from).
- Stage 2.7's Layer/top-Chrome decisions implemented (so the split isn't forking a UI that's
  still being redesigned across two files).
- Fill Panel, Popup Guard, and Hearts V1 shipped against the *current* mixed `index.html`
  Launch-Stream path where they must (see trap below) — or better, deferred from that path
  entirely where they can be.

**What must wait until after it:**
- All serious Launcher/Automation architecture (Stage 2.13) — this is the split's entire reason
  to exist, per the field-test document's own framing and the durable principle it states: manual
  Layer selection is an interaction scope, not an Automation execution gate.
- Ghost opacity's Rest/Hover controls (§10 trap below) — implement against `index1.html`
  directly rather than against `index.html`'s current mixed Launch-Stream surface.

**Why not sooner:** the split is Design-Time/Runtime separation, not a feature — starting it
while Arc A/B are still landing means every subsequent toolbar or capability change has to be
decided twice (which file owns it now, which file will own it after the split), which is exactly
the "forking maintenance" cost `001-PHILOSOPHY.md`'s "Single Responsibility" principle warns
against paying twice for one decision.

**Why not indefinitely deferred:** Automation cannot begin honestly without it (per the field-test
document and the existing `009-AUTOMATIONS.md`/`000-INVARIANTS.md` split of Workspace-vs-Runtime
responsibility), and the longer `index.html` accumulates Arc B features that *should* target the
future `index1.html`, the more expensive the eventual migration becomes.

---

## 10. Risks / traps

**Taking the "unified top toolbar" mockup literally.** The field test's own sketch places Fill
Panel next to Position and Folder under one `[L1|L2]` toggle. §4b shows this is wrong: Position/
Folder/Kill have no L2 meaning, and Fill Panel has no *container* meaning at all. The trap is
building exactly the sketched UI because it looks like what was asked for, rather than the
ownership-classified hybrid that actually solves the underlying complaint (stacked, colliding
Chrome) without breaking anything.

**Treating "L2 Undo/Redo may not work" as a confirmed defect.** A read-only inspection of the
current code during this pass (no edits made) shows the panel-level and Master-level Undo/Redo
forwarding paths are both wired identically to Shuffle's already-working path — same
`LAYER_SCOPED_ACTIONS` membership, same dispatch function, same nested receiver. Stage 2.5's own
test suite covered payload/isolation for Shuffle/Layout/Folder/SaveSessionAs forwarding but did
**not** add a dedicated real-effect test proving a forwarded `undo` actually mutates the nested
session's history — a genuine coverage gap, not evidence of a code path difference from Shuffle.
Stage 2.6 item B should start by reproducing the symptom mechanically (does the nested session's
history actually change? does the message even arrive? is the nested Grid's Undo button perhaps
disabled because `aimedAtLayerTwo` is being computed against the wrong panel?) before assuming an
architecture rewrite is needed. This is exactly the discipline the field-test document itself asks
for ("if routing arrives but history does not change, inspect history ownership... this should be
a focused bug fix, not an architecture rewrite").

**Trusting inbound capability-bridge messages as more than advisory.** The single biggest new
security-shaped risk in this entire roadmap. A message arriving on the capability-bridge channel
originates from arbitrary third-party content the moment it exists — even though the *code*
producing it is GS3's own userscript/extension, the *page* it runs inside is not trusted, and a
malicious or compromised site could attempt to forge or flood messages on that channel. The
contract in §5 must stay one-directional-trusted (parent-initiated commands are safe; child
reports are advisory-only, never state-mutating) from the very first prototype, not retrofitted
after something ships that assumed otherwise.

**Sandboxing globally before measuring breakage.** Popup Guard Layer 1 is cheap to write and easy
to over-apply; the compatibility matrix must exist and show real numbers before it becomes a
default, not an assumption that "it's just popups, what could break."

**Scope-creeping the silent-success fix into a notification redesign.** Explicitly warned against
in the field-test document; reaffirmed here because it's the easiest trap in Stage 2.6 to fall
into by accident (one popup removal naturally invites "why not fix all of them while I'm here").

**Implementing Ghost opacity or other Launch-Stream-specific UI against `index.html` now.** The
field-test document already identifies this correctly (§14) — flagging it again here as a trap
specifically because Stage 2.7-2.11's implementers will be touching toolbar code in the same
neighborhood and may be tempted to "just also" wire Ghost opacity while they're there. Don't;
it belongs to the future `index1.html`.

**Building the capability-bridge extension because Fill Panel "needs" it.** It doesn't — a
userscript validates the entire contract. Build the extension only when a specific capability
(Popup Guard Layer 3) proves a userscript genuinely cannot do the job.

**Inventing L2 Hearts notation speculatively.** Already correctly deferred by the field-test
document; reaffirmed as a trap because Stage 2.11's "capability shortcuts" work sits close enough
to Hearts that it's an easy place to accidentally start designing L2 addressing prematurely.

---

## 11. Durable breadcrumbs (for a future implementation pass to write into `Docs ANCHOR`)

Not edited in this pass — listed so the Stage 2.7+ implementer knows what to record once each
decision ships:

- **`006-TERMINOLOGY.md` / `011-HOTSWAP-CHROME.md`** — the Master selector's routing identifier
  (`L2-P#`, unchanged) is now explicitly decoupled from its presentation (a grouped disclosure
  control); record that future presentation changes may target the disclosure UI freely without
  touching `_effectiveMasterLayerTarget`/`_dispatchMasterToLayerTwo`.
- **`011-HOTSWAP-CHROME.md`** — new principle: *"A Panel's own local Chrome yields to the Chrome
  of a Runtime it hosts."* Record the exact mechanism (reveal-on-hover suppression + compact
  container-action affordance, never a deletion of capability) once 2.7b ships, cross-referenced
  against the existing "Nested Runtime geometry is hierarchy, not duplicated Chrome" section so
  the two are read as consistent (presentation vs. geometry) rather than contradictory.
- **`001-PHILOSOPHY.md`** — candidate new principle: *"Success is generally silent. Failure is
  visible. Action-required states may interrupt."* — promote from the field-test document's
  product principle into a durable one once Stage 2.6 item D ships.
- **`000-INVARIANTS.md`** — new "Honest Capability" subsection for the capability bridge once §5/
  §6/§7 ship: parent→child capability invocation is trusted; child→parent reports are advisory-only
  and may never reach Runtime Session/Store/presets/folders directly. This is the same
  "no fabricated capability, absence degrades honestly" discipline already applied to Layer 2
  identity, extended to a genuinely untrusted origin boundary for the first time — worth its own
  clearly-labeled subsection given the stakes.
- **`999-NEXT.md`** — once Stage 2.8/2.9 land, record Fill Panel and Popup Guard as Panel-local
  capabilities (never conductor/Master-level, never L2-routed) so a future contributor doesn't
  "fix" that by adding them to `MASTER_LAYER_ACTIONS`.
- **`999-NEXT.md`** — record the executor-split sequencing rule this report establishes (Arc A +
  core Arc B before Arc C) as the durable justification for *why* `index1.html` waited, so a
  future pass doesn't need to re-derive the reasoning.

---

## Summary table — approved execution order

| # | Stage | Depends on | Priority | Agent |
|---|---|---|---|---|
| 0 | Close out Stage 2.5 | — | blocking | human |
| 2.6 | Runtime Stabilization | 0 | high | Codex |
| 2.7 | Layer/top-Chrome UX (this report's §4 decisions) | 2.6 | high | Sonnet + Codex |
| 2.8 | Fill Panel V1 | 2.6, loosely 2.7 | very high | Sonnet (bridge) + Codex (heuristic/UI) |
| 2.9 | Popup Guard V1 | 2.8's bridge contract | high | Sonnet (strategy) + Codex (harness) |
| 2.10 | BG Hearts V1 | 2.6, loosely 2.7a | high | Sonnet (handshake) + Codex (impl) |
| 2.11 | Capability shortcuts | 2.8 + 2.10 | medium | Codex |
| 2.12 | index1.html executor split | 2.7 + core of 2.8–2.10 | required-before-2.13 | Sonnet |
| 2.13 | Launcher / Automation architecture | 2.12 | deferred, correctly | Sonnet (Opus only on a genuine fork) |
