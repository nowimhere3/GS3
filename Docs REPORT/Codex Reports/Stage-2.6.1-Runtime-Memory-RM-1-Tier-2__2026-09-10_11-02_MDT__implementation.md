# Stage 2.6.1 — Runtime Memory RM-1 Tier 2 Diagnostic Snapshot Foundation

**Calgary timestamp:** 2026-09-10 11:02 MDT  
**Branch:** `main`  
**Starting HEAD:** `d1b0568193ff48305fc2bd32fb1188464b5880f7`

## Starting git state

The pass began on `main...origin/main` with intentional uncommitted Stage
2.1–2.6 work. The following paths were already modified:

```text
Docs ANCHOR/000-INVARIANTS.md
Docs ANCHOR/006-TERMINOLOGY.md
Docs ANCHOR/007-PANEL-IDENTITY.md
Docs ANCHOR/011-HOTSWAP-CHROME.md
Docs ANCHOR/999-NEXT.md
Docs REPORT/Tests/TESTING.md
index.html
index2.html
index3.html
js/grid-session.js
js/launch.js
js/positions.js
js/settings.js
js/sync.js
js/triple-mode.js
settings.html
test/boot-smoke.test.js
test/positions-history.test.js
test/stabilization.test.js
```

The tree also contained untracked AntiGravity and Claude report material and
the Stage 2.6 Codex implementation report. All existing work was preserved.
No reset, revert, stash, clean, or unrelated overwrite was performed.

## Files changed by Stage 2.6.1

New:

- `Diagnostics/.gitignore`
- `Diagnostics/README.md`
- `Diagnostics/CONTRACT.md`
- `js/diagnostics.js`
- `test/diagnostics.test.js`
- `Docs REPORT/Codex Reports/Stage-2.6.1-Runtime-Memory-RM-1-Tier-2__2026-09-10_11-02_MDT__implementation.md`

Modified in addition to their pre-existing dirty content:

- `Docs ANCHOR/000-INVARIANTS.md`
- `Docs ANCHOR/999-NEXT.md`
- `Docs REPORT/Tests/TESTING.md`
- `js/settings.js`
- `settings.html`
- `test/boot-smoke.test.js`

No reports were pruned. Recent unresolved Preset Sync evidence remains useful
and was retained.

## Exact GS3 RM-1 binding

GS3 now has one on-demand Tier 2 producer in `js/diagnostics.js`. It constructs
an allowlisted structured object and renders that object into one Markdown
artifact. Copy and Download transport that artifact; they do not maintain
independent snapshot implementations. The artifact is ephemeral and generated
only on request.

The committed reader front door is `Diagnostics/README.md`. The GS3-specific
contract is `Diagnostics/CONTRACT.md`. `Diagnostics/.gitignore` ignores
`local/` without exceptions, so a human may manually place current evidence at
`Diagnostics/local/CURRENT.md` while the browser remains unaware of repository
paths.

Snapshot freshness is ten minutes. The artifact includes an ISO 8601 generated
timestamp with an explicit numeric offset, rendered age, and `FRESH` or
`STALE`. Output naturally stays below 16 KB in the authored worst-case fixture;
40 KB is the hard cap, with an explicit truncation section if ever reached.

Diagnostics read current state and never repair or act. No Runtime Session,
Panel, history, Workspace, preset, credential, Layer selection, iframe,
localStorage, or remote state is changed during generation. No diagnostic
database, identity, journal, timer, background capture, retry, or domain-state
write was added.

## Snapshot fields implemented

The fixed V1 sections are:

- **HEADER:** protocol, schema, project, generation time, freshness/age,
  origin, pathname, build, and redaction mode.
- **VERDICT:** only deterministic Workspace projection and preset SHA mismatch
  warnings, otherwise the contract’s bounded no-anomaly statement.
- **RUNTIME:** current executor, outer Grid layout, nested Runtime count,
  effective Master Layer projection, and truthful nested host Positions.
- **POSITIONS:** canonical visible outer Positions with current slot identity,
  bounded content kind or URL hash, Runtime kind, and nested status. No
  diagnostic-only Panel identity is minted.
- **HISTORY:** bounded L1 undo/redo action counts and honest nested-history
  availability.
- **WORKSPACE / PRESET PROJECTION:** canonical active id/name, current visible
  workspace-tab label, and derived `MATCH` / `MISMATCH`. The known decorative
  folder glyph is removed before comparing label text.
- **PERSISTENCE:** browser origin, localStorage availability, safe repo name,
  branch truth, token configured yes/no, short in-memory and remote preset
  SHAs, their derived comparison, and last failed HTTP status availability.
- **REFERENCES:** the RM-1 contract and relevant Runtime/Panel/Chrome anchors.

The producer reads live Grid Runtime/Position/history state only when that state
exists in the current document. A Settings, Solo, or Design-Time document does
not pretend to own a departed Grid Runtime. Unavailable fields remain
`unknown`, rather than creating diagnostic shadow state.

## Values deliberately left unknown

- `build`: GS3 has no existing truthful runtime build identity; no build/hash
  system was created.
- `branch`: the existing GitHub configuration does not retain or prove a
  branch. The remote GET observes the configured repository’s default branch
  without labelling it `main`.
- `last failed HTTP status`: existing code does not retain request history.
- nested Runtime history depth: no read-only cross-frame history-depth contract
  exists. No instrumentation was added.
- visible workspace label on pages without the Workspace tab DOM.
- canonical preset name when preset state is not loaded in the current realm.
- Grid layout, Positions, Layer target, and history on documents that do not
  own a live Grid Runtime.
- remote SHA and comparison when repository configuration, fetch, response SHA,
  or the bounded request is unavailable.

No Reported facts were invented. Snapshot fields are visibly marked Observed
or Derived where the distinction matters.

## Privacy and redaction

The producer uses safe scalar construction instead of serializing source
objects. Reusable guards reject GitHub PATs, `github_pat_` values, Bearer and
Authorization-shaped values, JWTs, Google/OAuth-like tokens, and long
base64/hex-like strings even when embedded in another scalar.

URL sanitization permits HTTP(S), removes user information, query strings and
fragments, and redacts suspicious hostname/path segments. Live web Panel
content is represented by an eight-character SHA-256 identity hash. Preset and
playlist payloads, media URL collections, cookies, credentials, request
headers, database contents, iframe contents, and clipboard contents are never
placed in either the structured object or Markdown.

There is no unsafe/deep mode.

## GitHub read-only probe

The only remote diagnostic operation is:

```text
GET https://api.github.com/repos/<owner>/<repo>/contents/presets.json
```

It sends `Accept: application/vnd.github+json`, uses the configured token only
inside the request when present, sets `cache: no-store`, carries no body, and
uses an AbortController timeout of 4.5 seconds (hard-clamped to five seconds).
It performs one attempt. HTTP, timeout, response-shape, and network failures
become safe `unknown (<reason>)` values while all other snapshot sections still
complete. No POST, PUT, PATCH, DELETE, repair, retry, or Preset Sync behavior
change was introduced.

## Settings UX

`settings.html` now contains a collapsible Diagnostics card alongside existing
Settings sections. **Copy Diagnostics** generates a fresh artifact and writes
its exact Markdown to the clipboard. **Download Diagnostics** generates the
same artifact shape and downloads it as `CURRENT.md`. Both use the same
generator and renderer. Success appears in the existing card as a small
non-blocking status (`Diagnostics copied` / `Diagnostics downloaded`); failure
remains visible in that status surface and no success alert is used.

## Automated coverage

New `test/diagnostics.test.js` coverage proves:

- known Runtime Session, Position, Layer/nesting, history, Workspace, and
  persistence fixtures;
- Workspace projection `MATCH` and `MISMATCH`;
- preset SHA `MATCH`, `MISMATCH`, and fail-soft remote `unknown`;
- one GET-only remote request with no body and no mutation method;
- generation leaves localStorage, presets, preset SHA, Runtime Session,
  arrangement, layout, and history unchanged;
- adversarial redaction in both the structured snapshot and Markdown;
- ten-minute freshness behavior;
- natural output below 16 KB and the 40 KB boundary;
- Copy/Download byte-for-byte Markdown equivalence for one captured artifact;
- committed reader files and Settings transport wiring.

`test/boot-smoke.test.js` adds the browser-level acceptance case: Settings
copies an RM-1 artifact that diagnoses differing in-memory/remote preset SHAs,
does not expose the PAT, and issues only GET for the diagnostic probe. The
existing Settings section-order assertion was updated to include Diagnostics.

## Test results

Targeted and complete applicable non-browser suites:

```text
node --test test/diagnostics.test.js
10 passed, 0 failed

node --test test/positions-history.test.js
52 passed, 0 failed

node --test test/stabilization.test.js
5 passed, 0 failed

node --test test/shuffle-scope.test.js
3 passed, 0 failed

combined non-browser run
70 passed, 0 failed
```

Syntax checks passed for every changed JavaScript file in the dirty tree:

```text
js/diagnostics.js
js/grid-session.js
js/launch.js
js/positions.js
js/settings.js
js/sync.js
js/triple-mode.js
test/boot-smoke.test.js
test/diagnostics.test.js
test/positions-history.test.js
test/stabilization.test.js
```

`node --test test/boot-smoke.test.js` was attempted after adding the RM-1
browser case. All 100 cases were blocked before page launch because Playwright
could not find:

```text
C:\Users\dmcal\AppData\Local\ms-playwright\chromium_headless_shell-1234\chrome-headless-shell-win64\chrome-headless-shell.exe
```

This is the documented missing Windows Chromium revision. No browser page or
application assertion executed, so the result is an environment failure, not
an application regression. The harness was not changed to conceal it.

`git diff --check` passed. Git emitted only existing Windows line-ending
conversion warnings; it reported no whitespace errors.

## Anchors and testing documentation

- `Docs ANCHOR/000-INVARIANTS.md` now binds GS3 to RM-1, observe/never-act,
  valid `unknown`, ephemeral browser generation, gitignored evidence, and the
  explicitly absent higher tiers.
- `Docs ANCHOR/999-NEXT.md` records Tier 2 as implemented and keeps higher-tier
  features separately gated.
- `Docs REPORT/Tests/TESTING.md` records the permanent RM-1 test surface.

## Explicit scope exclusions

```text
Tier 1 Journal: NOT IMPLEMENTED
Incidents: NOT IMPLEMENTED
Last-Known-Good: NOT IMPLEMENTED
Automation diagnostics: NOT IMPLEMENTED
Diagnostic repair/actions: NOT IMPLEMENTED
```

Also not implemented: JSONL/event history, automatic incident capture,
background producers/timers, persistence rings, a diagnostics IndexedDB,
diagnostic session/device identity, cross-device diagnostics, sync retry,
stale-SHA repair, GitHub writes, generic logging, a diagnostics viewer,
notification redesign, or unrelated Stage 2.7 UI work. `pushPresetsToRemote()`
and its current generic failure alert were not changed.

## Final git state

The final tree remains intentionally dirty for human review. The complete
status is recorded below after the report itself was added. No commit and no
push occurred.

```text
## main...origin/main
 M "Docs ANCHOR/000-INVARIANTS.md"
 M "Docs ANCHOR/006-TERMINOLOGY.md"
 M "Docs ANCHOR/007-PANEL-IDENTITY.md"
 M "Docs ANCHOR/011-HOTSWAP-CHROME.md"
 M "Docs ANCHOR/999-NEXT.md"
 M "Docs REPORT/Tests/TESTING.md"
 M index.html
 M index2.html
 M index3.html
 M js/grid-session.js
 M js/launch.js
 M js/positions.js
 M js/settings.js
 M js/sync.js
 M js/triple-mode.js
 M settings.html
 M test/boot-smoke.test.js
 M test/positions-history.test.js
 M test/stabilization.test.js
?? Diagnostics/
?? "Docs REPORT/AntiGravity/"
?? "Docs REPORT/Claude Reports/GS3-Stage2-Architecture-Council__2026-09-10_11-15_MDT__decision.md"
?? "Docs REPORT/Claude Reports/GS3_Stage2_Field_Test_Findings_and_Revised_Roadmap_2026-09-10.md"
?? "Docs REPORT/Claude Reports/Stage-2.5-Layer-Clarity-Bottom-Shell-StageC__2026-09-09_14-30_MDT__implementation.md"
?? "Docs REPORT/Codex Reports/Stage-2.6-Runtime-Stabilization__2026-09-10_08-54_MDT__implementation.md"
?? "Docs REPORT/Codex Reports/Stage-2.6.1-Runtime-Memory-RM-1-Tier-2__2026-09-10_11-02_MDT__implementation.md"
?? js/diagnostics.js
?? test/diagnostics.test.js
```
