# AUDIT-PROGRESS.md — status & handoff

**Run date:** 2026-08-31 · **Commit:** `faa620b` (main, clean tree)
**Full report:** [`docs/Claude Reports/2026-08-31-audit-tier0-tier3.md`](../Claude%20Reports/2026-08-31-audit-tier0-tier3.md)
**Code modified:** none. All harnesses written to `/tmp`.

> **Status: the requested scope is finished.** Tiers 0–3 complete, plus Tier 4 §5.1 and §5.3.
> The only thing outstanding is §5.2, which you excluded by instruction.
>
> A follow-up completion pass closed two spots where the first pass had asserted less than the
> spec asks: **§3.5** (drag-reorder, lock toggle, folder assignment and the curated Remove Row
> variant were untested) and **§4.7** (resizer handles were checked for presence but not
> dragged). That pass added 30 assertions and found **three further defects, one of them a
> confirmed §8 regression** — H-4, H-5, and the curated half of M-1. §4.7 came back clean.

---

## 1. Section status

| Tier | Section | Status |
|---|---|---|
| 0 | §1.1 Syntax validation | ✅ **DONE** |
| 0 | §1.2 JSON validation | ✅ **DONE** |
| 0 | §1.3 Import/export + arity contract audit | ✅ **DONE** (AST-based, all 5 contract-table seams) |
| 0 | §1.4 HTML integrity + ID reachability | ✅ **DONE** |
| 0 | §1.5 CSS class reachability | ✅ **DONE** |
| 0 | §1.6 Repo hygiene / secrets | ✅ **DONE** (incl. full git-history secret scan) |
| 1 | §2.1 `panels.js` | ✅ **DONE** — 24/24 |
| 1 | §2.2 `undo-stack.js` | ✅ **DONE** — 12/12 |
| 1 | §2.3 `presets.js` | ✅ **DONE** — 30/30 |
| 1 | §2.4 `grid-session.js` | ✅ **DONE** — 34/34 |
| 1 | §2.5 `state.js` | ✅ **DONE** — 10/10 |
| 2 | §3.1 Pages boot without console errors | ✅ **DONE** |
| 2 | §3.2 Every control wired | ✅ **DONE** — 142 controls enumerated |
| 2 | §3.3 `settings.html` round-trips | ✅ **DONE** |
| 2 | §3.4 Workspace Tabs | ✅ **DONE** |
| 2 | §3.5 Undo on `index.html` | ✅ **DONE** — all 8 listed actions incl. drag-reorder, lock toggle, folder assignment, both Remove Row variants |
| 3 | §4.1 ★ Swap must not reload/rebuild | ✅ **DONE** — invariant holds |
| 3 | §4.2 ★ Live content continuity (canary) | ✅ **DONE** — invariant holds |
| 3 | §4.3 ★ Grid session isolation | ✅ **DONE** — invariant holds |
| 3 | §4.4 ★ Save Session As is the only write path | ✅ **DONE** — 1 defect (H-1) |
| 3 | §4.5 ★ Grid Undo restores content + arrangement | ✅ **DONE** — 1 defect (H-2) |
| 3 | §4.6 Launch context handoff | ✅ **DONE** |
| 3 | §4.7 All 8 orientations | ✅ **DONE** — incl. resizer drag + 80px floor on col & row axes |
| 3 | §4.8 `launch.js` dual-context | ✅ **DONE** |
| 3 | §4.9 Layer 2 nesting | ✅ **DONE** |
| 3 | §4.10 Ghost Mode | ✅ **DONE** |
| 3 | §4.11 Responsive controls | ✅ **DONE** |
| 4 | §5.1 Mocked sync | ✅ **DONE** |
| 4 | §5.2 Deferred "Push rejected" bug | ⏸️ **NOT STARTED — excluded by instruction** |
| 4 | §5.3 Data integrity | ✅ **DONE** |
| — | §7 Invariants (all 12) | ✅ **DONE** — all 12 verified holding |
| — | §8 Regression checklist (all 15) | ✅ **DONE** — 13 hold, 2 flagged (#4, #12) |

**Assertions run: 1,316** — Tier 0: 742 · Tier 1: 110 · Tier 2: 240 · Tier 3: 179 · Tier 4: 41 · blocking repro: 4.

---

## 2. Findings (§9 format)

### BLOCKING

**B-1 — `js/launch.js:1-2` — `Uncaught SyntaxError: Unexpected identifier 'is'`**
*Observed:* two pasted junk lines above the file header — `Content is user-generated and unverified.` / `Learn about artifacts`. Line 1 parses as `Content` `is` → the exact reported error. `settings.js` statically imports `HOTSWAP_ACTIONS` from `launch.js`, so the parse failure aborts the whole module graph and leaves every button unwired; the browser attributes it to the entry document (`settings.html:1`) rather than to `launch.js`.
*Expected:* file begins at `/**`.
*Test:* forced ES-module parse of every `.js` blob in the full object DB — exactly one failed: blob `9c44e80`, `js/launch.js`, introduced in `801fe67`. Reproduced bidirectionally in Chromium: bad build → 0/8 buttons wired + the error; HEAD → 8/8 wired, clean.
*Confidence:* Certain.
*⚠️ Status:* **already fixed in-tree** by `3ef7932` (`js/launch.js | 2 --`). HEAD verified clean four independent ways. If still seen live, it is a stale deploy/cache, not source. Note §3.1 says "make this test permanent" — **it was never made permanent; no test file exists in the repo.**

### HIGH

**H-1 — `js/triple-mode.js:600-610` — Save Session As never persists `layout`**
*Observed:* `saveWorkspaceToPreset(presetId, { panels, folderMap, lockState })` omits `layout`; saved preset gets `layout: null`. `getSessionLayout()` (`grid-session.js:165`) is exported but imported by **no** module.
*Expected (§4.4):* preset contains content, folderMap **and current layout**.
*Test:* §4.4 Playwright proof. *Confidence:* Certain.

**H-2 — `js/triple-mode.js:366-382` + `:443` — Undo button stays disabled after a position swap**
*Observed:* `_swapSlotContents` pushes a checkpoint but never refreshes the button; `_updateGridUndoButtonState()` is only called from `_renderPanels()` (`:519`) and boot (`:797`), and a swap deliberately does not re-render.
*Expected (§4.5 / regression #4):* undo enabled after any checkpoint-worthy action.
*Test:* isolated probe — swap-only leaves the button disabled; force-enabling it restores the arrangement correctly, proving session state is right and only the UI is stale. *Confidence:* Certain.

**H-3 — `links.json` — 972.8 KB raw = 97.3% of GitHub's 1 MB ceiling**
*Observed:* 996,185 bytes raw / 1.267 MB base64. §5.3 warns at >800 KB — exceeded by 21%; ~27 KB headroom left.
*Expected:* comfortably under the limit (regression #12).
*Test:* §5.3 size check. *Confidence:* Certain.

**H-4 — `js/grid.js:167-171` — drag-reorder bypasses the save funnel (regression #8 REGRESSED)**
*Observed:* the `drop` handler calls `Store.set('matrixUrls'/'lockState'/'folderMap')` directly instead of `_persistAndNotify()`, skipping both `pushUndoSnapshot()` and `notifyWorkspaceEdited()`. The stated reason for bypassing (`saveInputsToState()` re-reads the stale DOM) does not apply to `_persistAndNotify()`, which reads nothing. `js/grid.js:57-59` still documents the old, correct behaviour.
*Expected (§3.5 / regression #8):* exactly one undo step, and the reorder syncs to the active preset.
*Test:* reorder inside a preset workspace → 0 undo steps, 0 pushes; control edit in the same workspace does push. *Confidence:* Certain.

**H-5 — `js/grid.js:213-220` — lock toggle never persisted, lost on reload**
*Observed:* `_makeLockBtn`'s onclick calls only `setRowLockState()` (in-memory) and `applyState()` (DOM classes). No `Store.set`, no undo snapshot, no workspace notify.
*Expected (§3.5 lists "lock toggle"; regression #7 class):* persisted + exactly one undo step.
*Test:* toggle → `matrix_lock_state` unchanged, btn-undo still disabled, 0 pushes, and the lock reverts to 🔓 after reload. Since a URL lock exists to make shuffles skip a row, losing it means the next Shuffle overwrites a deliberately protected row. *Confidence:* Certain.

### MEDIUM

**M-1 — `js/grid.js:433+438`, `:265+276`, `:340+348` — Add/Remove Row push TWO undo checkpoints.** Both handlers call `saveInputsToState()` twice; it calls `pushUndoSnapshot()` unconditionally (`:61`). Measured: 2 undo clicks to drain the stack after one action, for Add Stream Row and **both** Remove Row variants (manual and curated). §3.5 requires exactly one. Shuffle / Shuffle All / Reset-Clear / folder assignment are correct. *Certain.*

**M-2 — `js/app.js:235` + `js/grid.js` — typed URL edits never auto-save, and Launch Grid drops them.** No `input`/`change`/`blur` listener on `.url-grid-field` (measured: localStorage unchanged at 0/100/300/600/1000/1600/2500/4000 ms), and `btn-launch-grid` navigates without calling `saveInputsToState()`. Proven: type a URL → Launch Grid → the Grid loads the previous content. Contradicts §3.4; same class as fixed regressions #6/#7/#8. *Certain.*

**M-3 — `js/grid-session.js:80,87` — `initGridSession(defaultLayout)`'s 3rd precedence tier is unreachable.** `Store.get('tripleLayout')` has a non-empty default (`storage.js:108` → `'lefttall'`), so it is never falsy. Proven: `initGridSession('righttall')` with an empty store returns `'lefttall'`. Harmless only because `DEFAULT_LAYOUT` happens to match. *Certain.*

**M-4 — `presets.json` — all 5 presets missing the `layout` key** (§5.3 schema). Benign at runtime; it is the on-disk footprint of H-1. All other integrity checks passed (rowCount/streamCount/isEmpty match actual panels; no `urls`+`panels` conflict). *Certain.*

**M-5 — `js/single-mode.js:56-59` — with no database, `index2.html` leaves all 7 solo controls inert.** Early `return` precedes all wiring. With a database present all 7 wire correctly. Buttons stay visible/clickable-looking; a status message is a partial mitigation. *Certain.*

**M-6 — `js/blacklist.js:128` — HTML/JS injection into a generated `onclick`.** `onclick="removeFromBlacklist('${domain}')"` interpolates user-controlled input raw. This is the **only** runtime code-generation site in the repo (no `eval`, `new Function`, `document.write`, string `setTimeout`, `javascript:`, or `setAttribute('on…')` anywhere). Self-inflicted only. *Certain.*

**M-7 — `js/app.js:172` — `console.error` on every fresh boot.** "Not connected yet" is normal first-run state. Measured: 1 console.error with no credentials, 0 with credentials. Blocks §3.1 (zero-console.error) from being made permanent. *Certain.*

### LOW

**L-1** — Legacy extension debris at root: `content.js` + `manifest.json` (§1.6 flags `content.js`). Not deleted, per §1.6. `1.html` / `extension/` / `test*.js` / `js/*.json` duplicates already gone.
**L-2** — Four dead `getElementById` targets present on no page: `#speed-label` (`scroll.js:151`), `#btn-solo-mode` (`grid.js:472`), `#btn-toggle-fm-drawer` / `#fm-drawer-content` (`folders.js:264-265`). All guarded, so they fail silently — but `initFolderManagerDrawer()` and the Solo Mode entry point are unreachable. The other 27 unresolved lookups are correct cross-page guards.

### INFO

- **No committed secrets** in the tree or in any of the 28 commits' blobs.
- Ghost-mode class coverage (`ghost-master`/`ghost-stream`/`ghost-solo` each on one page) is **by design**, verified end-to-end — not a gap.
- A `presets.json` 404 produces one browser-level `Failed to load resource` console error; app handling is correct. A permanent §3.1 test must filter network-level messages.
- `<style> 2/1` raw-count mismatch on index2/index3 is a false positive (literal `<style>` in a JS comment, line 11). Authoritative parse5+jsdom: 0 parse errors, perfect balance on all 4 pages.
- No orphan modules — `app.js` & co. are reached via the documented dynamic `import()` in `index.js`.

---

## 3. §7 invariants — all 12 verified HOLDING

1 ✅ pure-CSS swaps (AST + live probe: 0 reloads, node identity kept, no reparent, gridArea changed) · 2 ✅ content bound to slot index · 3 ✅ update/checkpoint decoupled · 4 ✅ zero Store writes (static + instrumented runtime) · 5 ✅ dual-context fallback · 6 ✅ lossy string view · 7 ✅ plain strings valid · 8 ✅ both layout writes, all 8 orientations · 9 ✅ arrangement resets · 10 ✅ pure CSS `:hover` (0.12→1; `::before` reveals at 5px/8px out, not 14px — matches the declared 10px) · 11 ✅ separate stacks · 12 ✅ `workspace.js` sole owner.

## 4. §8 regressions — 11 of 15 hold

Flagged: **#8 fully REGRESSED** (→ H-4); **#4** fixed for Shuffle, regressed for position swap (→ H-2); **#7** fixed for add/remove but the lock toggle in the same §3.5 set is unpersisted (→ H-5); **#12** `links.json` at 97.3% of the ceiling (→ H-3). The other 11 verified still fixed.

---

## 5. Not verifiable programmatically (§6 standard)

1. **Real GitHub push with live credentials** — no PAT, not requested. Everything downstream covered against a mocked API: 404-as-not-yet-created, full `presetsStructure` payload, SHA rotation, rejection → UI message not throw, and base64 round-trip of `Präset — 日本語 🎬🔥 «quoted» ünïcode` intact both directions. *Automatable* with a throwaway repo + scoped token in an env var.
2. **Subjective visual taste.** Layout *correctness* was automated (overflow at 3 breakpoints, nested/outer box intersection, master-bar centering geometry, computed opacity).
3. **Real third-party site embedding / autoplay** — environment-dependent, not a code defect. The mechanism is proven with same-origin canaries (§4.2).
4. **Cross-device sync** — infrastructure, not logic.

---

## 6. If resuming

The requested scope is finished; there is nothing to pick back up except:

- **§5.2** — the deferred "Push rejected" investigation, if you want it. *(One free data point already: `presets.json` encodes to 8.8 KB, nowhere near the 1 MB ceiling — so step 2 of that trace can be ruled out. `links.json` is the at-risk file, and it is not what Save Session As pushes.)*
- **Fixing what was found.** Suggested order: **H-4 + H-5** (silent data loss; H-4 is a confirmed §8 regression) → **H-2 + H-1** (small, user-visible) → **M-2** (Launch Grid drops typed input) → **H-3** (`links.json` headroom).
- **Making the tests permanent.** Nothing was written into the repo. If you want a committed suite, the harnesses that produced these 1,286 assertions can be moved in — start with §3.1, which is the test that would have caught B-1 (fix M-7 first or it fails on a fresh profile).

**Environment note for the next run:** `npx playwright install-deps chromium` is required in this container (missing `libatk-1.0.so.0`). Serve over HTTP — `file://` will not load the modules. Throwaway deps were removed after this run.
