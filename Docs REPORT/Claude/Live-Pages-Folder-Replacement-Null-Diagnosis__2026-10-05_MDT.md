<!-- sideline-provenance: {"gameId":"game_git_042782b8","clientRef":"ref_1791230500290_4f8b6caf","playerInstanceId":"claude-1352dbb4","playerType":"claude","provider":"claude","model":"sonnet","effort":"medium","at":"2026-10-05T20:01:40.290Z"} -->
# GS3 Live GitHub Pages — Folder Replacement Null Diagnosis

- **Calgary time:** Monday 2026-10-05, ~14:20 MDT
- **Agent / model:** Claude Sonnet 5.5 (medium)
- **Branch / HEAD:** `main` / `f96d712`
- **Git status before:** untracked only (`Docs REPORT/`, `Docs ANCHOR/Breadcrumbs/`, `architecture-lab/*`). No tracked changes.
- **Verdict:** **PARTIAL / BLOCKED ON ONE READ-ONLY HUMAN MEASUREMENT.** The deployed code is proven identical to the code that passed clean verification, and the published site with the real database and an empty blacklist works for all 24 folders. The failing state lives only in the Human's browser; I cannot read it without a connection to the Human's Chrome (not opened) or the Human's token. Nothing was changed.

## Step 1 — Live public environment
Served files from `https://nowimhere3.github.io/GS3/` vs `git show f96d712:<file>` (CR-normalised SHA-1):

| File | Result |
|---|---|
| `js/launch.js` | **IDENTICAL** |
| `js/blacklist.js` | IDENTICAL |
| `js/state.js` | IDENTICAL |
| `js/triple-mode.js` | IDENTICAL |
| `js/sync.js` | IDENTICAL |

**LIVE DEPLOYED SHA: f96d712.**

## Step 4 — Fresh live profile (natural initialization, nothing seeded)
Fresh Playwright context on `index3.html`: 4 Panels, `gitToken` absent, `gitRepo` absent, `getDatabaseStructure() === null`, blacklist size 0. The folder chooser shows exactly one row, **"No folders available"** (that row has no handler). So **a fresh profile cannot reproduce the Human's symptom** — it has no database at all; the Human's chooser lists folders, so the Human's tab has a database a fresh profile does not.

Why a fresh profile can't load a database: `index3` loads folders only through `fetchDatabaseSilently()` → GitHub API with the user's PAT (`git_sync_token` + `git_sync_repo` in localStorage). No token ⇒ `Not connected`.

## Step 2/3 — what I could measure with the real data
Because the GS3 repo is public, I fed the **published app** its own real database through a mocked GitHub API response (dummy token/repo `nowimhere3/GS3`; the repo's public `links.json`, byte-identical to the local file; `links-index.json` → 404 so the legacy single-file path is used). This simulates the likely database, not the Human's actual state.

- Database: **24 folders, all arrays, 0 empty**; largest hosts: elitebabes (4083 URLs), xvideos.red (2241), imagefap (962), spankbang (195), xvideos.com (144)…; 9/24 folders use a single hostname.
- Blacklist loaded on `index3`: 0 (it is initialised at `triple-mode.js:1293` from `localStorage` key `matrix_blacklist`).
- For **every one of the 24 folders**, Folder Assign (slot 0) produced: a URL inside that folder, `data-last-src` changed, Session folder = that folder. **24 / 24 routed; 0 failures.**
- Data-shape check: none of the 24 folders could make `loadReplacement()` null with an empty blacklist (all non-empty arrays of parseable URLs).

Therefore, on published `f96d712` with the repo's real folders, the null path (`loadReplacement()` → null) does **not** occur unless something per-user changes the inputs. The only per-user inputs to `loadReplacement(folderName)` are:
1. `getDatabaseStructure()` — whatever the user's token/repo returns (possibly a different repo or the cassette format `links-index.json` + cassettes, which GS3's own repo does not contain), and
2. `isBlacklisted()` — the **hostname** blacklist in the user's `localStorage` (`matrix_blacklist`; grows whenever GS3 marks a dead domain). One bad domain blacklists its entire hostname for every folder, and for single-host folders (9/24 here) that empties the usable pool.

## Step 5 — Why Live Builder and Preset 9 fail identically
They share the same two process-global inputs: the single database in `state.js` (loaded once from the Human's GitHub repo) and the single blacklist in `blacklist.js` (one `matrix_blacklist` key, not per-workspace). A workspace/preset only changes layout and assigned URLs, not these. That is consistent with — but does not prove — a state-level cause, and rules out a workspace-specific one. (No other shared dependency was found: folder UI and lookup use the same `getDatabaseStructure()` call, so class G is unlikely.)

## What is still unmeasured (needs the Human's tab)
`LOADREPLACEMENT RESULT`, raw/blacklisted/usable counts, and null-classification A–I cannot be measured honestly without the Human's state. I did not guess them.

### Read-only snippet for the Human (prints counts only; writes nothing)
File: `architecture-lab/folder-assign-verify/human-diagnostic.js` (tested on the published site with the simulated database; returned all fields). Paste it into the DevTools Console of the failing live tab (`https://nowimhere3.github.io/GS3/`, Live Builder or Preset 9). It reports: DB loaded?, folder count, token/repo present (booleans) and whether the repo is `nowimhere3/GS3`, blacklist size and domains, per-folder `shape / raw / blacklisted / usable / hosts`, folders with zero usable URLs, and each Panel's DOM folder, Session folder and assigned host.

Reading the result:
- `foldersWithZeroUsable` non-empty / most folders have `blacklisted ≈ raw` → class **C** (all URLs blacklisted; **H**: persisted `matrix_blacklist` stale/overbroad).
- `dbLoaded: true` but folder names/counts unlike the public 24 → class **F** (a different repository/source than `nowimhere3/GS3`).
- `shape` ≠ `array` → class **D**; `raw: 0` → class **B**.
- All folders have `usable > 0` → the null hypothesis is **disproven** and the cause is elsewhere (then trace a real click with probes on that tab).

## Required verdict
```
LIVE DEPLOYED SHA:
f96d712 (5 key JS files byte-identical to f96d712)

LIVE FRESH PROFILE REPRODUCES:
NO — a fresh profile has no token, so no database ("No folders available"). With the repo's real public database mocked in, all 24 folders route correctly.

HUMAN PERSISTENT STATE LIKELY REQUIRED:
YES (the only per-user inputs to loadReplacement are the user's loaded database and the user's hostname blacklist)

FAILING FOLDER:
not measured (needs Human snippet)

RAW COUNT:
not measured

BLACKLISTED COUNT:
not measured

USABLE COUNT:
not measured

LOADREPLACEMENT RESULT:
not measured for the Human's state (URL in all 24 folders with an empty blacklist)

CURRENT-URL FALLBACK:
Consistent with the symptom by code (`setIframeUrl(newUrl || currentUrl, folder)`), not yet confirmed on the Human's tab

LIVE BUILDER:
same shared inputs; not measured

PRESET 9:
same shared inputs; not measured

COMMON ROOT CAUSE:
Not yet proven. Leading candidate: the Human's persisted state — an overbroad hostname blacklist (`matrix_blacklist`) and/or a database source that differs from the public repo — leaves no usable URL, so loadReplacement returns null and GS3 falls back to the current page.

MINIMUM FIX SURFACE:
none proven

IMPLEMENTATION:
NOT PERFORMED
```

> **The live GitHub Pages Folder Assignment reloads the same page because — as far as the evidence reaches — its folder lookup returns no usable URL (the null-replacement fallback), which cannot happen with the published code and the repo's public database but can with the Human's persisted blacklist or database source; the exact folder counts need one read-only snippet run on the failing tab.**

## Production / git
- **Production files touched: NO.** No storage reset, no seeding of the Human's profile, no connection to the Human's Chrome. Lab files only (`architecture-lab/folder-assign-verify/live.mjs`, `live-db.mjs`, `human-diagnostic.js`). Mocked GitHub responses were used only inside my own temporary Playwright context.
- No commit, no push. Git status after: unchanged tracked tree; untracked lab folders and reports.
