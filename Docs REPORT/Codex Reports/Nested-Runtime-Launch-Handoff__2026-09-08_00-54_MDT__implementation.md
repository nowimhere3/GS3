# Nested Runtime Launch Handoff — implementation

**Calgary time:** 2026-09-08 00:54 MDT  
**Branch:** `main`  
**Git:** no commit, no push

## Existing work preserved

The completed uncommitted Layer 2 identity repair was present in the working
tree. It was preserved intact. This implementation extends its existing
Runtime Session Panel-assignment seam; it does not reintroduce URL inference.

## Confirmed pre-fix flow

🚀 assigned `index.html` through Grid's `onPanelContentChanged` callback.
Nested `app.js` then made a local `window.location` change to
`index3.html?workspace=<id>`. The parent Session therefore correctly retained
the stale Design-Time Panel source and could not declare Layer 2.

## Implementation

- Added the same-origin `gs3-runtime-launch` semantic message contract.
- Top-level Design-Time retains its existing direct Grid navigation.
- Nested Design-Time sends `{ action: 'launchRuntime', kind: 'grid', workspace }`
  to its parent using the explicit origin.
- Grid validates origin, message shape, Grid kind, canonical Workspace identity,
  child window-to-host-iframe membership, and that the host Panel was assigned
  Design-Time content.
- The parent constructs `index3.html?workspace=<id>` and assigns it through the
  existing checkpoint + `onPanelContentChanged` + rendered-panel path. This
  updates Runtime Session, source display, runtime metadata, selectors, and
  navigation generation without touching Position or sibling Panels.

## Files changed

- `js/app.js`, `js/launch.js`, `js/triple-mode.js`
- `test/boot-smoke.test.js`
- `Docs ANCHOR/004-RUNTIME-SESSION.md`, `007-PANEL-IDENTITY.md`,
  `010-PANEL-NAVIGATION.md`, `999-NEXT.md`

## Tests

- Existing top-level Launch Grid test passes.
- New nested handoff test proves selected Workspaces 2 and 7 become exact parent
  sources, receive `{ layer: 2, kind: 'grid' }`, show aligned panel/Master
  selectors, update the URL editor, preserve sibling documents, and keep identity
  through a Position move.
- Security negatives prove unsupported kind, invalid Workspace, unrelated
  same-origin iframe, and untrusted-origin messages do nothing.
- Full `node --test` suite passed.
- `git diff --check` passed.

## Follow-up status

Grid is complete. Solo remains untouched: the same request seam can support it
later if requested. Stream remains deliberately unchanged because `index.html`
is still Design-Time; a truthful Stream handoff waits for `index1.html`.

## Breadcrumbs

Anchors now record that explicit nested Runtime launch is a parent-owned
host-level assignment, distinct from ordinary in-content navigation, and that
the resulting identity stays with the Panel rather than Position.
