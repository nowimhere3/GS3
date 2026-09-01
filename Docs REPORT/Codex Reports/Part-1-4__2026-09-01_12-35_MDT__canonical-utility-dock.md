# GS3 Codex Implementation Report

**Part:** Part 1-4
**Date:** September 1, 2026
**Time:** 12:35 PM MDT
**Timezone:** Calgary, Alberta — America/Edmonton
**Agent:** Codex
**Role:** Implementation / UX Polish
**Repository:** /home/dmcalorum/GS3

## Work requested

Replace Edit URL / Assign Folder surface-specific picker placement with one website-relative top-right utility dock; make click-away reliable without intercepting website clicks; preserve Runway/Top independence and the Part 1 lifecycle; and stack the canonical Shuffle All dice only in the vertical Runway presentation.

## Breadcrumb

WAS

Edit URL and Assign Folder opened below Top controls or left of Runway/Deep controls. Same-document click-away existed, but iframe return was not an explicit dismissal signal. Shuffle All used horizontal dice on both Top and Runway.

IS

All six action/surface combinations use one utility dock measured 8px from the current website top and 12px from the bordered panel's visual right edge. Completion, Escape, outside GS3 pointerdown, same-control toggle, and observable iframe focus use the canonical picker-close path. Runway Shuffle All stacks two dice inside the same 30x30 mirror; Top remains horizontal.

WHY

One predictable editor location is visually cleaner, opening an editor must not force completion, website pixels must remain directly interactive, and glyph orientation should match its surface without forking action semantics.

## Files changed by Part 1-4

- `js/launch.js`
- `index.html`
- `index3.html`
- `test/boot-smoke.test.js`
- `docs/011-HOTSWAP-CHROME.md`
- `docs/Tests/TESTING.md`
- This report

The final status also contains intentional uncommitted Part 1-1 through Part 1-3 files listed below.

## Implementation completed

### Canonical utility location

`placePicker()` no longer accepts or reads an invoking anchor, placement, or surface alignment. It schedules layout once, reads `--hotswap-website-inset`, and places either canonical picker at the shared top-right dock. Surface mirrors still forward clicks to the single registry-owned tray button and canonical action handler.

Measured normalized geometry on `index3.html`:

- Top -> Edit URL: top 8px, right 12px
- Runway -> Edit URL: top 8px, right 12px
- Deep Cuts -> Edit URL: top 8px, right 12px
- Top -> Assign Folder: top 8px, right 12px
- Runway -> Assign Folder: top 8px, right 12px
- Deep Cuts -> Assign Folder: top 8px, right 12px

The top measurement is relative to the current website top. With Top closed, website inset is 0; with Top already open, the utility follows the toolbar-height website inset. Invoking from Runway leaves Top closed and does not move the Runway.

### Edit URL and Assign Folder

Edit URL retains the wide responsive field, `preventScroll` autofocus, caret at the end, and horizontal tail scroll. Assign Folder retains the canonical folder data/list and applies Runtime changes only after selection. No action handler was duplicated.

### Click-away and lifecycle

The existing document-level outside `pointerdown` remains the normal GS3 click-away route and calls the one `closePicker()` pathway. A focus listener on the existing iframe closes an active picker when the browser exposes focus transfer into website content. It does not prevent the event, add an overlay, or consume the website's first click.

Exact supported dismissal paths are successful URL commit, successful folder selection, Escape, observable outside pointerdown, iframe focus, same-control toggle, and genuine panel teardown. The 850ms autonomous retract still yields while a picker is open; focus and typing do not dismiss or reveal Top from Runway. Toolbar retract was not made a picker-close command.

Cross-origin documents do not expose their internal pointer events to the parent. The implementation uses the clean browser-observable iframe focus signal and deliberately does not fabricate universal pointer visibility with an intercepting layer.

### Shuffle All presentation

The registry still has one `shuffleAll` key, emoji, handler, preference entry, and canonical tray button. Only Runway mirror rendering creates two stacked glyph spans. Top, Deep Cuts, Settings, and other representations retain horizontal `🎲🎲`. The Runway button remains 30x30 and both Top and Runway mirrors forwarded exactly once to the same canonical handler.

## Documentation breadcrumbs

`docs/011-HOTSWAP-CHROME.md` records the chronological Part 1-4 WAS / IS / WHY evolution. `docs/Tests/TESTING.md` records that Part 1-4 supersedes only Part 1-3 picker location, plus the new geometry, click-away, continuity, and orientation proof.

## Tests

Targeted command:

`node --test --test-name-pattern='Part 1-2|Part 1-3|Part 1-4|Shuffle All' test/boot-smoke.test.js`

Result: 5 passed, 0 failed.

Focused proof includes website-relative geometry across Top/Runway/Deep Cuts, Runway Top isolation, URL focus/caret/tail behavior, timer survival, outside pointerdown, iframe focus dismissal, same-node continuity, unchanged 30x30 Runway footprint, and canonical Shuffle All forwarding.

Full suite command: `npm test`

Result: 114 passed, 0 failed, 0 skipped, duration approximately 90.2 seconds.

`git diff --check`: clean; no output.

## Continuity / invariant verification

Presentation-only utility operations retained the exact iframe node and parent, unchanged `src`, and zero load events. No iframe reload, rebuild, reparent, or re-src occurred. No Runtime Undo checkpoint is created by utility open, close, placement, click-away, or glyph rendering. Top/Deep projection, visibility-before-cutoff, responsive overflow, independent Runway preferences, website-relative 1.75H Runway geometry, Position-left/actions-right structure, and canonical action singularity remain intact.

## Known limitations

The parent document cannot observe arbitrary pointer events occurring inside a cross-origin iframe. Dismissal on website return therefore relies on browser-observable iframe focus. No transparent overlay or sacrificial click was introduced to pretend otherwise.

## Unrelated observations deliberately not pursued

None discovered during this pass. Out-of-scope product areas were not investigated.

## Final `git status --short`

```text
 M docs/000-INVARIANTS.md
 M docs/011-HOTSWAP-CHROME.md
 M docs/999-NEXT.md
 M docs/Tests/TESTING.md
 M index.html
 M index3.html
 M js/app.js
 M js/folders.js
 M js/hotswap-chrome.js
 M js/launch.js
 M js/settings.js
 M js/storage.js
 M settings.html
 M test/boot-smoke.test.js
 M test/positions-history.test.js
?? "docs/Claude Reports/Part-1-2__2026-09-01_11-08_MDT__settings-chrome-architecture.md"
?? "docs/Codex Reports/"
```

Nothing committed.

Nothing pushed.
