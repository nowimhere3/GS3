# GS3 Part 1-6C — Website Click-Away Dismissal Polish

## WAS / IS / WHY

WAS: Utility dismissal correctly handled Escape and observable parent-document click-away, but website-area dismissal relied on an iframe element `focus` listener. Real Chromium clicks into an iframe browsing context do not dispatch that event, so Edit URL and Assign Folder could remain open.

IS: While a utility is open, GS3 observes parent `window.blur`, then checks on the next animation frame whether `document.activeElement` is that panel's iframe. If so, it calls the one canonical `closePicker()`. The iframe `focus` listener remains as a fallback for paths that directly focus the element.

WHY: Website click-away should follow the normal user mental model wherever Chromium exposes an honest parent-side transition, without covering the iframe, stealing the customer's click, or claiming access to cross-origin DOM events.

## Exact browser event diagnosis

A targeted Playwright/Chromium probe clicked a button inside both a same-origin `srcdoc` frame and an opaque cross-origin `data:` frame. In both cases:

- Parent `window.blur` fired.
- At `window.blur`, `document.activeElement` was already `IFRAME`.
- The iframe element's `focus` listener did not fire.
- Parent-document `focusin` and `focusout` did not fire.
- Same-origin and cross-origin results were identical for these parent-observable signals.

The prior listener was therefore valid only as a direct-element/programmatic fallback, not as a reliable signal for a real website click in Chromium.

## Files changed

- `js/launch.js`
- `test/boot-smoke.test.js`
- `Docs ANCHOR/011-HOTSWAP-CHROME.md`
- `Docs REPORT/Tests/TESTING.md`
- This report

## Implementation

Added one narrow parent-window blur listener per panel. It does no work unless a picker is open. On the next animation frame it closes only when that panel's iframe is `document.activeElement`. Both Edit URL and Assign Folder therefore use identical dismissal through the existing `hasOpenPicker()` and canonical `closePicker()` lifecycle.

There is no overlay, `preventDefault`, `stopPropagation`, iframe DOM access, iframe reload, rebuild, reparent, or `src` change. The change creates no Runtime Session mutation and no Undo checkpoint. It does not call toolbar reveal/retract code; the independent 850ms retract behavior remains unchanged.

## Observable cross-origin boundary

The parent can honestly observe the transition from utility focus in the parent document into an iframe browsing context via `window.blur` and `document.activeElement === iframe`, regardless of iframe origin. It cannot observe arbitrary pointer events inside the cross-origin document.

Residual limitation: if the same iframe already owns focus when a utility is opened without focus returning to the parent, a later click inside that already-focused iframe produces no new parent `blur` or focus transition. GS3 cannot dismiss on that click without an iframe cooperation channel or an interception overlay; neither was introduced.

## Automated tests

New targeted Playwright coverage uses a genuinely cross-origin fixture (same host, different port), opens each utility from Runway, performs an actual coordinate click inside the iframe, and proves:

- Assign Folder closes on the observable iframe transition.
- Edit URL closes on the same transition.
- The iframe receives the same `pointerdown` for both clicks.
- The website-side events have `defaultPrevented === false`.
- Runway invocation does not reveal Top Toolbar.

Existing coverage continues to prove Escape closes both utilities, another GS3 control closes the utility and executes its own action, the dismissal handler does not prevent default, and the 850ms retract timer does not independently dismiss an open utility.

Targeted result: 1/1 passed.

Full suite result: 119/119 passed (`npm test`; compact full-suite rerun also exited successfully).

`git diff --check`: PASS, no output.

## Human smoke test

1. Open Assign Folder from Runway.
2. Click directly into the real website.
   EXPECT:
   picker closes and website click still works.

3. Open Edit URL.
4. Click directly into the real website.
   EXPECT:
   picker closes and website click still works.

5. Re-open each and press Escape.
   EXPECT:
   both still close.

## Known residual limitation reproduction

An already-focused cross-origin case remains inherently unobservable: arrange for the website iframe to retain focus, open a utility through a mechanism that does not move focus back into the parent document, then click again inside the same iframe. Because the browsing context was already focused, Chromium exposes no new parent `window.blur`, iframe `focus`, `focusin`, or `focusout`; the utility remains until Escape, an observable outside click, or completion. Normal Runway/Edit URL/Assign Folder opening moves focus into the utility, so the ordinary human path creates the observable transition fixed here.

## `git status --short`

Part 1-6C-owned code changes:

```text
 M js/launch.js
 M test/boot-smoke.test.js
?? Docs REPORT/Codex Reports/Part-1-6C__2026-09-01_14-40_MDT__website-click-away.md
```

The requested current docs are inside pre-existing untracked directory-migration state (`Docs ANCHOR/...` and `Docs REPORT/...`). The worktree also retains the user-owned deletions under legacy lowercase `docs/...` and `Docs ANCHOR/test.txt`; they were present before this pass and were not modified or restored.

No commit or push was performed.
