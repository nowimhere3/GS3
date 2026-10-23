# Bottom Runtime Shell Stage B — implementation

2026-09-08 18:40 MDT (Calgary)

## Working tree

Preserved the existing uncommitted Layer 2 Identity, Nested Runtime Launch
Handoff, and Stage A changes. No reset, commit, push, or unrelated report
pruning was performed.

## Implemented

- Added Grid Master Redo to the existing single canonical Runtime history.
  Master and panel Undo/Redo continue to select portions of the same action
  list; the existing nested `redo` receiver now invokes that path.
- Added the shared `js/grid-layouts.js` canonical eight-layout registry.
- Added Store-backed `gridLayoutSlotCount` (1–3, default 2) and reconciled
  `gridLayoutSlotOrder` preferences.
- Added Settings configuration using the existing collection/order grammar.
- Replaced Grid's permanent layout pile with stable visible shortcuts, a
  dedicated layout gateway, and a separate general `⋯` gateway.
- Demoted Grid Folder, Save Session As, Close, and Launchpad into general
  overflow. Solo retains its prominent Folder controls and has no Grid layout
  vocabulary.
- Preserved Stage A transform hiding, Dock reserve measurement, status flow,
  dropup anchoring, z-scale, and nested relocation behavior.

## Files changed

`js/grid-layouts.js`, `js/grid-session.js`, `js/hotswap-chrome.js`,
`js/settings.js`, `js/storage.js`, `js/triple-mode.js`, `index3.html`,
`settings.html`, `test/boot-smoke.test.js`, plus the durable anchors and test
specification.

## Validation

- Focused Stage B, Stage A, Layer, nested handoff, Settings, and Solo/Grid
  regressions: passed.
- Focused Stage B tests: 3 passed.
- Stage A geometry plus Stage B tests: 6 passed.
- Full `node --test`: 136 tests, 135 passed, 1 failed. The sole failure is the
  existing Hotswap Runway geometry assertion (`websiteTopOffset: 0,
  rightInset: 445, inside: false`); it was already reproduced against clean
  `HEAD` during Stage A validation and is unrelated to this implementation.
- `git diff --check`: passed.

## Durable breadcrumbs

Updated invariants for structural Grid actions and separate overflow gateways;
added P# terminology and Panel/Position ownership wording; recorded the future
dynamic Browser Gallery Dock contract (`♡P#`/`♥P#`), semantic favorite state,
dynamic live-instance population, and independence from Layer scope.

## Remaining boundaries

Stage C remains outstanding: capability routing for Folder, layouts, parameterized
Save Session As, nested status, `[L2-P#]`, and nested global shell suppression.
Browser Gallery Hearts, handshake, `FAVORITE_CURRENT`, Portrait mode, and
`index1.html` remain unimplemented.
