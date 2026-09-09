# Layer 2 Identity repair — implementation

**Calgary time:** 2026-09-07 09:46 MDT  
**Branch:** `main` @ `2bf92d7`  
**Git:** no commit, no push

## Existing partial work found

The working tree already contained the Tier 1/2 implementation, durable anchor
updates, and most regression coverage. This pass preserved that work, completed
the browser coverage and validation, and made the pre-existing canary liveness
assertion wait for an actual timer tick rather than racing its 25 ms interval.

## Implementation

- Replaced URL-as-identity detection with an assignment-time executor registry.
  It returns an entry or `null`, requires explicit intent for relative paths,
  does not fabricate `index.html`, and distinguishes Design-Time `index.html`
  from Runtime entries. `index1.html` is registry-only and was not created.
- Added Panel-owned nested Runtime declaration helpers and a typed rendering
  path for Workspace Panels.
- Added `getSessionPanels()` safe typed copies. `getSessionUrls()` remains the
  intentionally lossy compatibility projection and is documented as unsuitable
  for identity decisions.
- Closed compatibility writes: unchanged URL projections retain typed Panel
  identity/options; actual URL replacement creates a newly assigned Panel and
  clears or derives Runtime metadata.
- Moved Grid selector visibility, panel selector visibility, availability and
  Layer-2 dispatch to Runtime Session Panel identity. Master targets use the
  same visible-slot authority, so hidden slots cannot advertise Layer 2.
- Preserved full Panel identity through Copy to Position, history, Save Session
  As, restore, and Position arrangement changes.

## Files changed

- `js/hotswap-chrome.js`, `js/panels.js`, `js/grid-session.js`
- `js/triple-mode.js`, `js/launch.js`
- `test/positions-history.test.js`, `test/boot-smoke.test.js`
- `Docs ANCHOR/000-INVARIANTS.md`, `004-RUNTIME-SESSION.md`,
  `006-TERMINOLOGY.md`, `007-PANEL-IDENTITY.md`, `011-HOTSWAP-CHROME.md`,
  `999-NEXT.md`, and `Docs REPORT/Tests/TESTING.md`

## Tests

- Targeted unit/session suite: **49 passed, 0 failed**.
- Targeted Layer browser suite: **7 passed, 0 failed**.
- Full suite: **130 passed, 1 failed** out of 131. The sole failure is the
  unrelated existing `Part 1-2 Runway tracks website top and active Runway
  pickers own stable geometry` assertion. It reproduces unchanged against a
  clean `HEAD` archive with the same measured values
  (`websiteTopOffset: 0`, `rightInset: 445`, `inside: false`), so it does not
  block or originate from this Layer identity change.
- `git diff --check` passed.

## Breadcrumbs and housekeeping

The required Layer identity truth was absorbed into the anchors and mechanical
test guide. Older reports were reviewed for the lossy-projection caveat and
separate unresolved sync/size work; none were pruned because their durable
truth was not fully superseded or they remain relevant evidence.

## Remaining follow-up

Tier 3 cooperative Runtime confirmation remains deliberately deferred. The
existing Runway geometry test failure remains unrelated and untouched.

Out-of-scope areas were left alone: no `index1.html`, no launch retargeting, no
confirmation handshake, no toolbar/Ghost/Position redesign, no new Layer store
or map, and no `LAYER_SCOPED_ACTIONS` expansion.
