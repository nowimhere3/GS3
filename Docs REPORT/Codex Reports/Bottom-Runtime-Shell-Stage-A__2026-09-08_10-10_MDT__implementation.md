# Bottom Runtime Shell Stage A — implementation

2026-09-08 10:10 MDT (Calgary)

## Preserved working tree

Preserved the uncommitted Layer 2 Identity repair and Nested Runtime Launch
Handoff work, including its reports, anchors, tests, and the pre-existing report
pruning deletions.

## Completed

- Replaced Grid's fixed negative-offset Master hide with `translateY(100%)`.
- Renamed the fixed Grid and Solo `#floating-btns` surface to
  `#orchestration-dock`; preserved the existing nested relocation behavior.
- Added a Dock-only `ResizeObserver` writer for `--gs3-dock-reserve`; Master and
  Solo bars consume that reserve with safe initial fallbacks.
- Added Grid's structural/status/contextual shell regions. Status is normal-flow,
  truncating content and no longer claims the viewport edge.
- Re-anchored Master Folder and Save dropups above the full Master Bar, independent
  of wrapped-row height.
- Applied the finite Runtime shell z-scale to `index.html` controls and retained
  the existing 29000/30000/30001/40000 host ordering.

## Files changed for Stage A

`index.html`, `index2.html`, `index3.html`, `js/single-mode.js`,
`js/triple-mode.js`, `test/boot-smoke.test.js`, `Docs REPORT/Tests/TESTING.md`,
`Docs ANCHOR/000-INVARIANTS.md`, `Docs ANCHOR/011-HOTSWAP-CHROME.md`, and
`Docs ANCHOR/999-NEXT.md`.

## Tests

Added browser coverage for all requested widths (1920, 1440, 1280, 1080, 880,
700, 560, 420): closed Master geometry, open Master/Dock non-overlap, dynamic
Dock reserve expansion/contraction, long status truncation, Folder and Save
dropups at multi-row widths, and shared z-scale.

- Focused Stage A browser regression: passed.
- Focused Stage A plus relevant Layer/handoff boot regressions: 4 passed.
- `node --check js/triple-mode.js; node --check js/single-mode.js`: passed.
- Full `npm test`: two existing non-Stage-A failures occurred. Copy-to-Position
  iframe tick assertion passed immediately when rerun in isolation. The Hotswap
  Runway utility-dock geometry assertion failed again against a temporary clean
  `HEAD` worktree with the identical `{ websiteTopOffset: 0, rightInset: 445,
  inside: false }` result; it predates this change. The temporary worktree was
  removed.
- `git diff --check`: passed.

## Durable breadcrumbs

Added the bottom shell geometry invariant, the Dock reserve/dropup/z-scale
contract, and the Stage B/Stage C boundary. Updated the superseded test-spec
assertion that previously required an absolute right-pinned Master status.

## Scope boundaries and housekeeping

No Stage B or Stage C behavior was added: no Redo, overflow/layout configuration,
capability routing, or nested-shell suppression. No reports were pruned by this
task; pre-existing report deletions were left untouched. No commit or push was
performed.
