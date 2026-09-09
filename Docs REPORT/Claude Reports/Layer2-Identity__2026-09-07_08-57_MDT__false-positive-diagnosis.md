# Layer 2 Identity — False `[L2][L1]` Diagnosis

**Calgary time:** 2026-09-07 08:57 MDT
**Branch:** `main` @ `2bf92d7` (clean tree)
**Scope:** architecture / diagnosis only. No implementation, no commit, no push.
**Subject:** Grid Runtime (`index3.html`) master toolbar shows `[L2][L1]` with no nested Runtime present.

---

## 0. Summary in one paragraph

`isLayerTwoUrl()` does not test whether a panel holds a nested Runtime. It tests whether a
*string*, resolved **relative to the Runtime page itself**, has a last path segment in a
hardcoded filename list — and when the path has **no last segment it substitutes the literal
string `'index.html'`**. Those two facts together mean an entire family of ordinary content
strings — anything schemeless, fragment-only, query-only, whitespace-only, or ending in a
slash — is classified as our own Runtime. `_sessionHasLayerTwo()` then feeds that predicate
from `getSessionUrls()`, a **lossy string projection** of the typed Panel array, and the
result decides whether the master `[L2][L1]` selector is shown. The false positive is
therefore not a stale-state bug and not a same-origin coincidence: it is a **fabricated
default** inside the predicate, reachable from ordinary user-entered content because
**GS3 performs no URL scheme normalization at either URL entry point**. The same lossy
projection also produces the mirror-image defect: a genuine typed Workspace Panel is
invisible to Layer 2 detection *and* is silently overwritten at boot.

---

## 1. Root cause

### 1.1 PROVEN — the fabricated `'index.html'` default

`js/hotswap-chrome.js:314-327`

```js
const RUNTIME_EXECUTORS = ['index.html', 'index2.html', 'index3.html'];

export function isLayerTwoUrl(url) {
    if (typeof url !== 'string' || url === '') return false;
    try {
        const resolved = new URL(url, window.location.href);   // ← (B)
        if (resolved.origin !== window.location.origin) return false;
        const file = resolved.pathname.split('/').pop() || 'index.html';  // ← (A)
        return RUNTIME_EXECUTORS.includes(file);
    } catch {
        return false;
    }
}
```

**(A) is the defect.** `pathname.split('/').pop()` returns `''` for every path ending in
`/` (including the bare origin). The `|| 'index.html'` fallback then *invents* an executor
filename that was never present. Every same-origin directory-style URL is therefore
classified as Layer 1's own Launchpad.

**(B) amplifies it.** Resolving against `window.location.href` makes *any* string that is
not an absolute URL same-origin by construction, so the origin guard on the line above —
the guard the code comments cite as proof that "third-party content is never our runtime" —
never fires for relative input. Combined with (A), a bare `#fragment` or `?query` inherits
the Runtime's **own** pathname (`/index3.html`) and returns `true` directly.

**Reproduced against the real module**, using the project's own test-harness window shape
(`test/positions-history.test.js:802` — `href: 'https://host.test/index3.html'`,
`origin: 'https://host.test'`):

| input | `isLayerTwoUrl` | resolves to |
|---|---|---|
| `"/"` | **true** | `https://host.test/` |
| `"./"` | **true** | `https://host.test/` |
| `"#gallery-01-1"` | **true** | `https://host.test/index3.html#gallery-01-1` |
| `"?workspace=2"` | **true** | `https://host.test/index3.html?workspace=2` |
| `"   "` (whitespace) | **true** | `https://host.test/index3.html` |
| `"some/dir/"` | **true** | `https://host.test/some/dir/` |
| `"www.elitebabes.com/gallery/"` | **true** | `https://host.test/www.elitebabes.com/gallery/` |
| `"https://host.test"` | **true** | `https://host.test/` |
| `"https://example.com/"` | false | — |
| `"about:blank"` | false | — |

Note `"#gallery-01-1"` in particular: **every** panel URL in `presets.json` Preset 1 ends in
that fragment. Those are absolute and cross-origin so they are safe today, but it shows how
close the fragment shape sits to the live data.

### 1.2 PROVEN — the false-positive family is reachable from ordinary user input

There is **no URL scheme normalization anywhere in GS3** except `blacklist.js:159`.
Both URL entry points write the raw trimmed string straight into state:

* Builder rows — `js/grid.js:80` → `urls.push(input.value.trim())` → `Store.set('matrixUrls', urls)`
* Runtime panel 🌐 URL edit — `js/launch.js:902-908` → `inputField.value.trim()` → `setIframeUrl(newUrl)` → `ctx.onPanelContentChanged` → `updateGridSession`

So a user who types `elitebabes.com/some-gallery/` (no scheme) or pastes a fragment-only
string gets a Runtime Session entry that `isLayerTwoUrl()` reports as Layer 2, while the
iframe loads a same-origin 404 or the Runtime page itself. This is the mechanism the report
brief asked for: **it is not the `RUNTIME_EXECUTORS` filename check by itself.** No stored
data trips it — I scanned every string in `presets.json` (87) and `links.json` (9,450)
against the exact predicate: **zero hits**. The offending string is runtime-entered or
`localStorage`-resident, not repository data.

### 1.3 PROVEN — a second, independent producer: 🚀 writes `'index.html'` into the session

`js/launch.js:1050-1057`

```js
launchpadBtn.onclick = (e) => {
    ...
    setIframeUrl('index.html', '');   // relative, same-origin, in RUNTIME_EXECUTORS
};
```

This is today's **only** deliberate way to create "Layer 2", and it loads the
**Design-Time Workspace**, not a Runtime. Two consequences:

* On `index.html` (no `ctx.onPanelContentChanged`), `setIframeUrl` falls through to
  `js/launch.js:344-348` → `Store.set('matrixUrls', urls)`. A single 🚀 press **persists**
  the literal string `'index.html'` into `loop_matrix_urls`, where it is loaded by every
  later `?workspace=live` Grid launch (`js/grid-session.js:93`). This is a durable,
  invisible-to-`presets.json` source of `[L2][L1]`.
* Under the target family (`index.html = Workspace / Design-Time`), `index.html` is **not**
  a Runtime executor at all, so the list is already wrong for the direction of travel.

### 1.4 LIKELY — which member of the family produced the observed case

Static state cannot single out which string was in the user's session, because the two
candidate stores are outside the repository. Ranked, with a decisive probe below:

1. **A relative / schemeless / fragment / trailing-slash entry** from §1.2, in a slot the
   user did not inspect. This is the highest-probability path and needs no unusual history.
2. **A leftover `'index.html'`** in `loop_matrix_urls` from a previous 🚀 press (§1.3) —
   applies only to `?workspace=live` launches, and would show the Launchpad in that panel.
3. **A hidden slot.** `_renderPanels` builds **all four** `SLOT_IDS` regardless of layout;
   `_applyLayout` only sets `display:none` on the unused ones
   (`js/triple-mode.js:503-508`). `_sessionHasLayerTwo()` scans the whole session array, so
   in a 2-screen layout (`top2`/`bottom2`/`vsplit`/`hsplit`) slots 3–4 can light the master
   selector while being **invisible on screen** — exactly matching "I inspected the
   Workspace and saw no nested Runtime."

Decisive probe (paste in the Grid Runtime console; no code change required):

```js
const { getSessionUrls } = await import('./js/grid-session.js');
const { isLayerTwoUrl }  = await import('./js/hotswap-chrome.js');
console.table(getSessionUrls().map((u, i) => ({
  slot: i, url: u, l2: isLayerTwoUrl(u),
  resolved: (() => { try { return new URL(u || ' ', location.href).href; } catch { return '<throw>'; } })(),
})));
```

The row with `l2: true` names the cause, and `resolved` names which sub-case it is.

### 1.5 PROVEN — the mirror defect: genuine Layer 2 is invisible *and* destroyed

The brief's example panel `{ type:'workspace', source:2, options:{ layer:2 } }` — the one
shape that is unambiguously Layer 2 — currently produces the **opposite** of the truth:

* `getUrlPanelSource()` returns `''` for any non-url panel (`js/panels.js:112`), so
  `getSessionUrls()` projects it to `''`, and `isLayerTwoUrl('')` is `false`.
  **A real Workspace Panel never shows the selector.**
* Worse, `_buildTripleSet()` treats the resulting `''` as an empty slot
  (`js/triple-mode.js:138-142`) and overwrites it with a random pick from the database.
  `_renderPanels` then writes that back via `setGridSessionSilently`.
  **A real Workspace Panel is silently destroyed on the first render.**
* `createWorkspacePanel()` has **zero call sites** in `js/`. The typed Workspace Panel is
  declared architecture with no producer, which is why this has not been noticed.

### 1.6 PROVEN — every session mutation flattens the typed Panel array

```js
// js/grid-session.js:146
export function updateGridSession(urls, folderMap) {
    _panels = normalizePanelsArray(urls);   // strings in → url panels out
    ...
}
```

Every caller passes `getSessionUrls()` (strings): `_renderPanels`, `onPanelContentChanged`,
`onPanelRemoved`, `_copyUrlToPosition`. So even if a typed panel entered the session, the
**next Shuffle, folder assignment, URL edit or Copy would erase its type and options.**
This is the single lossy hop in the whole model — and it is why any repair that stores
Layer identity in Panel metadata must close it.

**Good news:** the action history is *already* Panel-aware. `_snapshotState()` stores
`_panels.map(p => ({...p}))`, and `_applyActionSide()` restores with
`_panels[index] = normalizePanel(panel)` (`js/grid-session.js`, History section). Undo/Redo
already round-trips type and options correctly. Only the write side is lossy.

### 1.7 Unrelated architectural smells (noted, out of scope)

* **DOM/session divergence on restore.** `_reconcileUndo()` writes
  `restored.urls[index] || 'https://example.com'` into `data-last-src`
  (`js/triple-mode.js`), and `_renderPanels` does the same. The session says `''`; the DOM
  says `example.com`. Benign for L2 today (cross-origin) but it is literally
  *"No fabricated URL may enter Runtime Session"* being violated one layer out, in the DOM
  the panel-level `refreshPanelLayerScope()` reads from.
* **Two disagreeing L2 authorities.** `_sessionHasLayerTwo()` reads the session;
  `_dispatchMasterToLayerTwo()` reads `data-last-src` off live iframes
  (`js/triple-mode.js:815-828`). The selector can be visible while dispatch finds no target,
  and vice versa.
* **History change-detection is URL-only.** `_commitPendingAction()` compares slots with
  `getUrlPanelSource()`, so a slot whose *type* changed but whose source string did not
  would not register as changed.
* **Save Session As truncates.** `_handleSaveSessionAs` writes `getSessionUrls()` (4 slots)
  over a preset that may hold 7–9 panels (`presets.json` Preset 1 has 7, Preset 2 has 9).
  Separate issue; flagging only because it rides the same lossy projection.

---

## 2. Current architecture (as built)

```
presets.json / Store('matrixUrls')
        │  normalizePanelsArray()          ← typed Panel[] enters here
        ▼
grid-session._panels : Panel[]             ← the only place type/options exist
        │  getSessionUrls() = _panels.map(getUrlPanelSource)
        │      · url panel      → its source string
        │      · workspace panel→ ''        ← LOSSY, intentionally
        ▼
string[]  ──────────────────────────────────────────────┐
        │                                               │
        │ _buildTripleSet(): '' means "empty, fill      │
        │   me with a random link"   ← destroys L2      │
        ▼                                               │
_renderPanels / onPanelContentChanged                   │
        │  updateGridSession(strings)                   │
        │  _panels = normalizePanelsArray(strings)      │
        └──► type + options erased ─────────────────────┘

           _sessionHasLayerTwo()  ← reads the string[] above
                  │
           isLayerTwoUrl(str)  ← relative-resolve + filename guess + fabricated default
                  │
           #master-layer-selector.hidden
```

Anchors already in force that this violates:

* **000-INVARIANTS → Honest Capability** — *"The Runtime never pretends to observe what the
  browser does not expose… No fabricated URL may enter Runtime Session."* The
  `|| 'index.html'` default is exactly a fabricated URL, used to make an identity claim.
* **000-INVARIANTS → Single Source of Truth** — *"No state should have multiple competing
  owners."* Layer identity currently has two derivations (session strings vs. iframe
  `data-last-src`) and no owner.
* **004-RUNTIME-SESSION → Content State** — content is *"URLs, folder assignments,
  collections, runtime variables, future runtime metadata."* Layer identity is content
  metadata and belongs in the Runtime Session, not in a re-derivation from a string view.
* **006-TERMINOLOGY → Layer 2** — *"A Runtime executing inside another Runtime."* Not
  "a URL that looks like one."

---

## 3. Why the false positive happened — the precise chain

1. A string that is not a Runtime enters the session (typed without a scheme, pasted as a
   fragment, or left behind by 🚀 in `loop_matrix_urls`).
2. `getSessionUrls()` hands it to `_sessionHasLayerTwo()` as a bare string, stripped of the
   only metadata that could have said what it is.
3. `isLayerTwoUrl()` resolves it **against the Runtime's own href**, which makes it
   same-origin and lets it inherit the Runtime's own pathname.
4. If the resulting pathname has no final segment, the function **substitutes the literal
   `'index.html'`** — inventing the very evidence it is about to test.
5. `RUNTIME_EXECUTORS.includes('index.html')` is true.
6. `_refreshMasterLayerSelector()` sets `selector.hidden = false` and `[L2][L1]` appears,
   with `_masterLayerScope` defaulted to `LAYER_2` — so the toolbar is now silently aimed at
   a runtime that does not exist.

**No stale state, no compatibility fallback, no same-origin coincidence is required.**
Steps 3 and 4 are unconditional fabrications in the predicate itself.

---

## 4. Recommended canonical Layer 2 identity model

### 4.1 Answer to Question 2 — is `getSessionUrls() → isLayerTwoUrl() → _sessionHasLayerTwo()` the wrong authority?

**Yes, on three independent grounds.**

* **It reads a view that was designed to discard the answer.** `getSessionUrls()` is
  documented as *"the legacy view used by code that hasn't been made panel-aware yet"*
  (`panels.js:105-111`) and the 2026-08-31 audit signed it off as *"lossy by design —
  workspace panel reads as `''`"* (§7 invariant #6, marked ✅). That sign-off was correct
  for `state.js`'s iframe-src compatibility purpose. It was **never** an argument that the
  projection may be used to make a *decision*. The brief's instruction — *do not treat a
  lossy compatibility projection as authoritative unless you can prove that is intentional
  and safe* — resolves against it: the lossiness is intentional, but only for rendering.
* **It infers identity from shape.** A URL predicate can, at best, say "this string
  resembles one of our filenames." Resemblance is exactly what the product truth forbids.
* **It has no way to be right about the future.** Adding `index1.html` means editing a
  filename array that is consulted by a relative-resolving parser — the brittle guess the
  brief explicitly wants eliminated.

### 4.2 Answer to Question 3 — what should be canonical

**Declaration in typed Panel metadata is the authority. A runtime handshake is the
confirmation. The URL predicate is demoted to a candidate detector used only at the moment
GS3 assigns content — never as a live scan.**

Evaluating the four options the brief lists:

| Candidate | Verdict |
|---|---|
| **Typed Panel metadata** | ✅ **Authority.** Already exists (`PANEL_TYPES.WORKSPACE`, `options`), already survives Undo/Redo, already travels with the Panel and not the Position. Zero parallel state. |
| **Explicit Workspace Panel identity** | ✅ Same thing, and the right long-term producer — a Workspace Panel *is* the declaration. But it cannot be the *only* mechanism, because 🚀 and a manual URL edit legitimately create a nested Runtime from a `url` panel. |
| **Actual Runtime/executor state** | ⚠️ Necessary for *confirmation*, insufficient as authority — an iframe that has not loaded yet, or was killed, has no state, and the DOM is never state (000-INVARIANTS). |
| **Runtime registration / handshake** | ✅ **Confirmation.** Turns "declared" into "observed." 010-PANEL-NAVIGATION already names *"Cooperative Layer 2 runtimes reporting via postMessage"* as a planned adapter, and `_installLayerScopeReceiver` is already the receiving seam. This is not a new subsystem. |
| **Combination** | ✅ **Recommended:** declaration decides *eligibility*; handshake decides *confirmed*. |

**The rule, stated for the anchor:**

> A Panel hosts a Layer 2 Runtime when the Runtime Session says it does.
> The Runtime Session says so only because GS3 deliberately assigned a Runtime executor to
> that Panel, or the Panel is an explicit Workspace Panel.
> A nested Runtime that has announced itself is *confirmed*; one that has not is *declared*.
> The Layer selector requires **declared**. Automation requires **confirmed**.
> Resemblance is never evidence. Absence of evidence is never Layer 2.

### 4.3 Where the flag lives

In the Panel's own `options`, on the panel already in `_panels[slotIndex]` — **not** in a
new map, not on the DOM element, not keyed by grid-area or Position.

```js
// url panel that GS3 knowingly pointed at a Runtime executor
{ type: 'url', source: 'index3.html?workspace=2', options: { runtime: { layer: 2 } } }

// explicit Workspace Panel — the declaration is the type itself
{ type: 'workspace', source: 2, options: { layer: 2 } }
```

This satisfies **Panel owns content identity; Position owns physical placement** for free,
because `_arrangement` is a separate array and Position operations never touch `_panels`.

### 4.4 Executor identity as a registry, not a filename guess

Replace the filename array with a declared registry so `index1.html` is additive:

```js
// One place. Each executor declares what it IS, not just what it is called.
export const RUNTIME_EXECUTORS = Object.freeze([
    { file: 'index1.html', kind: 'stream', layer: 'runtime' },
    { file: 'index2.html', kind: 'solo',   layer: 'runtime' },
    { file: 'index3.html', kind: 'grid',   layer: 'runtime' },
    { file: 'index.html',  kind: 'workspace', layer: 'design-time' }, // NOT a Runtime
]);
```

`index.html` stays recognised (so today's 🚀 keeps working) but is tagged `design-time`.
When the family splits, the 🚀 target moves to `index1.html` and `index.html` drops out of
Layer-2 eligibility by **editing one field**, not by chasing call sites.

---

## 5. Truth maintenance (Question 4)

One principle covers every row: **layer identity is written exactly where content is
assigned, and read nowhere else.** There is one write funnel already —
`updateGridSession()` / `_applyActionSide()` — so there is one place to be correct.

| Event | What must happen | Why it works |
|---|---|---|
| Workspace / Preset launch | `initGridSession` keeps `_panels` typed; a workspace panel is **not** treated as an empty slot by `_buildTripleSet` | fixes §1.5 destruction |
| Content replacement (🌐, 🎲, 🎲🎲, ❌, 🗑️, folder assign) | assignment re-derives the flag from the *assigned* value and **overwrites** it, including clearing it | replacement is an assignment; identity is recomputed, never inherited |
| Manual URL edit | same funnel; a hand-typed `index3.html?workspace=2` legitimately becomes L2-eligible | user intent through the one entry point |
| Shuffle | writes a database URL → flag cleared for that slot | Shuffle is content replacement |
| Shuffle All | same, every slot | — |
| Position swap / Move to Position | **touches nothing.** `setSessionArrangement()` only | identity rides `_panels[slotIndex]`; Position is `_arrangement` |
| Copy to Position | copies the **whole Panel** (type + options + folder), not just the URL string | today `_copyUrlToPosition` copies only the string — must copy the panel |
| Undo / Redo | already correct — history stores whole Panels and restores with `normalizePanel` | §1.6; only needs change-detection widened past `getUrlPanelSource` |
| Restored session (Save Session As → relaunch) | `presets.js` must persist `panels` with `options` intact — `buildPresetFromWorkspace` already runs `normalizePanelsArray`, which preserves `options` | close the `getSessionUrls()` hop in `_handleSaveSessionAs` |
| Panel navigates **away** from a nested Runtime (browsing inside the frame) | **nothing changes.** Per 010-PANEL-NAVIGATION, in-content navigation does not mutate the session | correct: GS3 still has a Runtime assigned there; the user browsing away inside it is not a session event |
| Nested Runtime loaded **later** | declared at assignment; `confirmed` flips when the handshake arrives | the handshake is the only asynchronous input |
| Nested Runtime removed (☠ Kill, ❌, replaced) | `onPanelRemoved` writes an empty panel; flag gone with it | removal is an assignment |
| Future `index1.html` | one registry row | §4.4 |
| Design-Time / Runtime separation | flip `index.html` to `layer: 'design-time'`; retarget 🚀 | §4.4 |

**Explicitly preserved:** Position changes must not fabricate or destroy Layer identity.
The recommended model achieves this structurally rather than by convention — Position
operations write to `_arrangement`, Layer identity lives in `_panels`, and the two arrays
are never derived from one another.

---

## 6. UI behaviour (Question 5)

No toolbar redesign. Only the *input* to the existing visibility rule changes.

```
_sessionHasLayerTwo()                 →  _sessionLayerTwoSlots()
  reads getSessionUrls()                 reads getSessionPanels()
  asks "does this string look like        asks "did the Runtime Session record a
   one of our filenames?"                  nested Runtime for this Panel?"
```

* **No nested Runtime** → `_sessionLayerTwoSlots()` is empty → `selector.hidden = true`.
  Nothing else changes; the CSS already honours `[hidden]` (`index3.html:474`).
* **One genuine nested Runtime** → selector appears, `L2` lit by default (unchanged —
  011-HOTSWAP-CHROME: *"the scope is a preference"*, never rewritten by absence).
* **Removed / replaced** → the assignment clears the slot's flag → selector hides on the
  next `_refreshHistoryButtons()`, which is already called from every mutation path.

**Additionally, fix the two-authorities split (§1.7):** `_dispatchMasterToLayerTwo()` should
select its targets from the *same* `_sessionLayerTwoSlots()` list and then look up each
slot's iframe, rather than re-deriving from `data-last-src`. One authority, two readers.

Recommend restricting the master selector to slots the current layout actually renders
(`getLayoutSlotOrder(_currentLayout)`), so a hidden slot 3–4 can never light a control the
user cannot correlate with anything on screen (§1.4 case 3).

---

## 7. Minimal implementation plan for Codex

Tier 1 alone fixes the reported bug. Tiers 2–3 are what make it durable. Nothing here
invents parallel state; every store already exists.

### Tier 1 — stop fabricating (smallest possible repair, ~15 lines)

1. **`js/hotswap-chrome.js`** — rename `isLayerTwoUrl` → `isRuntimeExecutorUrl` and fix it:
   * delete the `|| 'index.html'` fallback — **no segment means no executor, full stop**;
   * require an absolute URL, or a relative one **only** when the caller passes an explicit
     base, so a bare fragment/query/whitespace can never inherit the Runtime's own pathname;
   * return the matched registry entry (or `null`) instead of a boolean, so callers can
     distinguish `runtime` from `design-time`.
2. Keep the export name available as a deprecated alias only if a call site still needs it;
   otherwise update the three call sites (`triple-mode.js:793, 819`, `launch.js:242, 1094`).

*After Tier 1, every row in the §1.1 table returns false except a real executor filename.*

### Tier 2 — make Panel metadata the authority (the durable repair)

3. **`js/hotswap-chrome.js`** — introduce the executor registry from §4.4; keep `LAYER_1`
   / `LAYER_2` exactly as they are.
4. **`js/panels.js`** — add two pure helpers next to `isWorkspacePanel`:
   * `markPanelRuntime(panel, entry)` — returns a copy with `options.runtime = { layer: 2, kind }`
   * `getPanelRuntimeLayer(panel)` — returns `2` for a workspace panel **or** a url panel
     carrying `options.runtime`, else `null`.
   No new module, no new store.
5. **`js/grid-session.js`** — close the one lossy write hop (§1.6):
   * add `getSessionPanels()` returning `_panels.map(p => ({...p}))`;
   * make `updateGridSession(urls, folderMap)` **merge by index** — when
     `urls[i] === getUrlPanelSource(_panels[i])`, keep the existing panel object (type +
     options) instead of rebuilding it as a bare url panel; when it differs, re-derive
     `options.runtime` from the registry. This preserves every existing caller signature,
     so no call site has to change to get the fix.
   * widen `_commitPendingAction()`'s change detection to also compare
     `getPanelRuntimeLayer()`, so a type-only change is recorded.
6. **`js/triple-mode.js`**
   * `_sessionHasLayerTwo()` → `_sessionLayerTwoSlots()` reading `getSessionPanels()` and
     `getPanelRuntimeLayer()`, filtered to `getLayoutSlotOrder(_currentLayout)`;
   * `_dispatchMasterToLayerTwo()` selects targets from that same list;
   * `_buildTripleSet()` must treat a **workspace panel as occupied**, not empty — read
     `getSessionPanels()` and use `isEmptyPanel()` rather than falsiness of the URL string;
   * `_copyUrlToPosition()` copies the whole Panel, not just the string;
   * `_handleSaveSessionAs()` passes `getSessionPanels()` to `saveWorkspaceToPreset`.
7. **`js/launch.js`** — `refreshPanelLayerScope()` takes its answer from the session for
   that slot (`panel.dataset.slotIndex`) rather than from `data-last-src`. This is the
   000-INVARIANTS *"The DOM is never treated as state"* fix, and it is what makes the panel
   and master selectors agree by construction.

### Tier 3 — confirmation handshake (small, and unblocks automation honestly)

8. Nested Runtimes announce themselves on boot: when `window.parent !== window`, post
   `{ source: LAYER_MESSAGE_SOURCE, action: 'runtimeReady', kind }` to
   `window.location.origin`. Add the receiving case to `_installLayerScopeReceiver` and
   record `confirmed` on the slot's panel.
9. Selector visibility keys on **declared**. Automation eligibility (006-TERMINOLOGY:
   *"Only Layer 2 objects participate in Runtime automation"*) keys on **confirmed**.

### Not part of this task

Do **not** implement `index1.html`, and do **not** retarget 🚀 yet. Tier 2 step 3 is what
makes both a one-line change later.

---

## 8. Tests required

Add to `test/positions-history.test.js` (unit — the `freshChrome()` harness already provides
the right window shape) and to `Docs REPORT/Tests/TESTING.md` §4.9, which currently tests
**only** the positive case and does so via `index.html`.

**Predicate (unit, `hotswap-chrome.js`) — these are the regression locks:**

1. `isRuntimeExecutorUrl` returns falsey for every row in the §1.1 table:
   `'/'`, `'./'`, `'../'`, `'#frag'`, `'?q=1'`, `'   '`, `'some/dir/'`,
   `'www.site.com/gallery/'`, `'https://host.test/'`, `'https://host.test'`,
   `'https://host.test/videos/'`.
   *This single test is the one that would have caught the reported bug.*
2. Third-party same-filename stays false: `'https://example.com/index3.html'`.
3. Same-origin non-Runtime stays false: `'https://host.test/other.html'`,
   `'https://host.test/settings.html'`.
4. Junk never throws: `null`, `undefined`, `'not a url at all'`, `'javascript:void(0)'`.
5. Registry-driven: adding an `index1.html` row makes it recognised **without touching the
   parser**; asserting that no test hardcodes a filename list of its own.
6. `index.html` is recognised but tagged `design-time`, not `runtime`.

**Identity (unit, `panels.js` + `grid-session.js`):**

7. A `{type:'workspace'}` panel yields `getPanelRuntimeLayer() === 2` and
   `isEmptyPanel() === false`.
8. `updateGridSession(getSessionUrls(), folderMap)` — the exact no-op call every render
   makes — **preserves** a workspace panel's type and options. (Fails today.)
9. Replacing a nested-Runtime slot with an ordinary URL **clears** `options.runtime`; no
   stale flag survives.
10. Undo restores the workspace panel with its type and options; Redo re-applies the
    replacement. Assert on `getSessionPanels()`, never on `getSessionUrls()`.
11. Position swap: after `setSessionArrangement`, `getSessionPanels()` is **byte-identical**
    — Layer identity moved with the Panel, not with the Position, and neither fabricated nor
    destroyed.
12. Save Session As → relaunch round-trips a workspace panel through `presets.js` intact.

**UI (Playwright, `boot-smoke.test.js` / TESTING.md §4.9):**

13. **Negative case, new and load-bearing:** launch a Workspace of ordinary third-party
    panels → `#master-layer-selector` has `hidden` and computed `display: none`; every
    panel's `.hotswap-layer-selector` is hidden too.
14. Same-origin non-Runtime content (`settings.html` in a panel) → still no selector.
15. Boot a preset containing a genuine workspace panel → selector appears, and the panel's
    content is **not** replaced by a random shuffle pick (regression lock for §1.5).
16. 🚀 in a panel → selector appears; replace that panel's URL with ordinary content →
    selector disappears on the same tick, with no reload of the other panels.
17. Panel selector and master selector never disagree: assert both derive from the same
    slot list across launch, replace, swap, undo, redo.
18. A hidden slot (2-screen layout, slot 3 holding a Runtime) does **not** light the master
    selector.

---

## 9. Backward compatibility / migration

* **No data migration.** Every existing preset is `{type:'url', source, options:{}}`;
  `getPanelRuntimeLayer()` returns `null` for all of them, which is the truthful answer.
  Legacy `urls: string[]` presets keep working through `getPresetPanels()` unchanged.
* **`updateGridSession(urls, folderMap)` keeps its signature**, so no caller is forced to
  change to receive the fix. Panel-aware call sites can be migrated slot by slot.
* **`getSessionUrls()` stays**, and stays lossy — it remains the correct compatibility view
  for `state.js` and iframe-src assignment. It simply stops being consulted for decisions.
  Its docblock should say so.
* **Behaviour change users will see:** a panel that today shows `[L2][L1]` because of a
  schemeless or trailing-slash URL will stop showing it. That is the fix, but it is a
  visible change; worth a line in the commit message.
* **`loop_matrix_urls` may already hold `'index.html'`** from a past 🚀 press (§1.3). That
  is a *genuine* nested Design-Time page and will keep showing the selector until the panel
  is replaced. Correct under Tier 1–2. When `index.html` is reclassified as `design-time`
  (Tier 3 / the family split), it will correctly stop being Layer 2 — flag that as an
  intentional behaviour change at that time, not now.
* **Nothing in `presets.json` or `links.json` trips the current predicate** (verified: 0
  hits across 9,537 strings), so no stored data needs cleaning.

---

## 10. What Codex must explicitly NOT change

* **Do not implement `index1.html`.** Registry-only; the file is out of scope.
* **Do not retarget the 🚀 button** away from `index.html` in this pass.
* **Do not redesign the bottom Master Toolbar / Orchestration Dock.** Only the *input* to
  the existing `selector.hidden` assignment changes.
* **Do not change the "scope is a preference" rule.** `_masterLayerScope` and
  `panel.dataset.layerScope` must keep defaulting to `LAYER_2` and must **not** be rewritten
  when Layer 2 is absent (011-HOTSWAP-CHROME §"The scope is a preference").
* **Do not touch Hotswap Chrome behaviour** — reveal/retract, ghost opacity, tray/runway
  ordering, Deep Cuts dismissal, picker placement. The Layer selector's *structural* status
  (never removable, never consuming configurable capacity) is unchanged.
* **Do not add a parallel Layer registry, map, or Store key.** The flag lives in the Panel
  that already exists in `_panels`.
* **Do not make Position, `_arrangement`, or grid-area carry Layer identity**, and do not
  make any Position operation write to `_panels`.
* **Do not change Runtime Session ownership**: `grid-session.js` still writes nothing to
  `Store` or `presets.json`; Save Session As remains the only write path.
* **Do not remove `getSessionUrls()` or `getUrlPanelSource()`**, and do not make them
  non-lossy. Other consumers depend on the string view.
* **Do not widen `LAYER_SCOPED_ACTIONS`.** Which actions forward is settled
  (011-HOTSWAP-CHROME §"What actually forwards").
* **Not in this task:** Browser Gallery Hearts, Portrait/Grid orientation, the
  `_reconcileUndo` `'https://example.com'` DOM fabrication (§1.7), Save Session As
  truncation (§1.7), and the `links.json` size ceiling (H-3, still open from the
  2026-08-31 audit).

---

## 11. Report housekeeping

Reviewed `Docs REPORT/Claude Reports` and `Docs REPORT/Tests` for findings bearing on this
investigation.

**Stale assumption found and corrected by this report:**

* `2026-08-31-audit-tier0-tier3.md` §7 invariant **#6** — *"`state.js` string view is lossy
  by design | workspace panel reads as `''` through `getTargetUrls()` | ✅"*. Correct as
  scoped (the string view is *supposed* to be lossy), but it has since been read as a
  general blessing. This report establishes the missing half: **the lossy view may render;
  it may not decide.** `_sessionHasLayerTwo()` is the first place a decision was taken
  downstream of it, and it is wrong.

**Test-coverage gap found:**

* `TESTING.md` §4.9 "Layer 2 nesting" and the §8 regression row #10 test only the
  **positive** case (🚀 → nested `index.html`, no UI collision). There is **no negative
  assertion anywhere** that ordinary content must *not* produce Layer 2. `AUDIT-PROGRESS.md`
  records §4.9 as ✅ DONE, which is accurate for what it covers and misleading about what it
  proves. §8 tests 13–18 above close this.
* `positions-history.test.js:934-943` asserts `isLayerTwoUrl` "matches only our own
  same-origin runtime pages" — but every negative case it checks is an *absolute*
  cross-origin URL or empty/null. It never tests a relative or directory-shaped input, which
  is exactly the family that fails. The assertion's stated claim is stronger than what it
  verifies.

**Unresolved findings elsewhere, unrelated to this task, still open:** H-3 (`links.json` at
97.3% of GitHub's 1 MB inline limit) and §5.2 (the deferred "Push rejected" sync bug). Left
untouched.

**Anchor breadcrumbs to write when Codex implements** (durable truth, not report-only —
per the brief, this must not live only here):

* **`000-INVARIANTS.md`** — new section under *Honest Capability*:
  > **Layer Identity**
  > A Panel hosts a Layer 2 Runtime only when the Runtime Session recorded that GS3 assigned
  > one. Resemblance is never evidence. A URL that looks like a Runtime is not a Runtime.
  > No default, fallback, or projection may create Layer identity that was not assigned.
  > A lossy compatibility projection may render state. It may never decide state.
  > Position changes never fabricate or destroy Layer identity.
* **`006-TERMINOLOGY.md`** — under *Layer 2*, add: declared vs confirmed; and correct the
  Runtime family list, which currently labels `index.html` "Stream Runtime" while the target
  architecture makes it Workspace / Design-Time.
* **`007-PANEL-IDENTITY.md`** — Layer identity is Panel-scoped content metadata; it travels
  with the Panel through Position swaps and is restored by Undo with the Panel.
* **`011-HOTSWAP-CHROME.md`** §Layer scope — the selector's visibility derives from the
  Runtime Session, not from the iframe's `data-last-src`; panel and master selectors read
  one authority.
* **`999-NEXT.md`** — under *Phase 5 — Runtime Separation*, note that the executor registry
  (§4.4) is the prerequisite that makes `index1.html` and the Design-Time split additive.

---

## 12. Answers, condensed

1. **Root cause** — `isLayerTwoUrl()`'s `|| 'index.html'` default fabricates an executor
   filename for any same-origin path with no final segment, and relative resolution against
   `window.location.href` makes ordinary user-entered strings same-origin. Proven against
   the real module. Which specific string was in the user's session is *likely* a
   schemeless/trailing-slash/fragment entry or a persisted `'index.html'` from 🚀; the §1.4
   console probe settles it in one line.
2. **Current authority** — wrong. It decides identity from a projection documented as lossy
   and from a predicate that tests resemblance.
3. **Canonical identity** — typed Panel metadata declares it; a runtime handshake confirms
   it; the URL predicate becomes a candidate detector used only at assignment time.
4. **Truth maintenance** — write at assignment, read nowhere else; Position ops touch
   `_arrangement` only; Undo/Redo already carry Panels correctly.
5. **UI** — same rule, truthful input; also make panel and master selectors read one list.
6. **Tests** — §8, with the §1.1 false-positive table as the primary regression lock and a
   negative Playwright case that does not exist today.
