# GS3 Slice 3 — Current Fill Resolver + Cloudbate Playable Presentation
<!-- sideline-provenance: {"gameId":"game_git_042782b8","clientRef":"ref_1791309253299_3c105dfe","playerInstanceId":"codex-d5040989","playerType":"codex","provider":"codex","model":"gpt-6.1-sol","effort":"medium","at":"2026-10-06T17:54:13.299Z"} -->

BASE BRANCH: `fill-panel-provider-expansion`

BASE HEAD: `6ae0e6a873895f4c4c3bf552a7087925e01d9552` — Add observed current URL receiver

WORKING TREE BEFORE: Two untracked Human files, preserved untouched:

- `Docs REPORT/Claude/Undo-Stack-Regression-Test__2026-10-06_MDT.md`
- `test/undo-stack.test.js`

IMPLEMENTATION: Fill reads the existing generation-fenced, panel-scoped observation and validates Current through the Fill adapter before trying Assigned. Meaningful observation changes refresh Fill presentation availability, including SPA navigation without iframe load. Duplicate URL reports do not rerender. No new Current store or generation counter was added.

FILL RESOLUTION ORDER: CURRENT CAPABLE → ASSIGNED CAPABLE

```javascript
getFillPresentationUrl(getCurrentUrlObservation(panel)?.observedCurrentUrl)
    ?? getFillPresentationUrl(assignedUrl)
```

CLOUDBATE FILL: IMPLEMENTED. Shared normal-presentation host/path recognition accepts the root host and its subdomains, with existing optional-slug path semantics. Fill additionally requires a positive numeric ID. It sets `u.searchParams.set('play', 'true')`, preserves other query parameters/hash, and is idempotent. Normal `getPresentationUrl()` behavior remains unchanged, including its existing zero-ID recognition. Home/search, invalid IDs, look-alike hosts and evil suffix domains are rejected by Fill.

CURRENT URL MUTATED: NO — Fill reads the observation; the existing receiver still records reporter updates and clears observation on Refresh.

ASSIGNED URL MUTATED: NO

PERSISTENCE MUTATED: NO

MODULE CYCLE: PRESENT + JUSTIFIED. `capability-bridge.js` reads `getCurrentUrlObservation()`; `current-url-observation.js` uses the bridge's existing envelope, panel lookup and refresh function. Imported exports are accessed only inside functions after initialization. This direct dependency avoids injecting observation plumbing through unrelated orchestration or creating another state store. A focused browser test imports either module first in separate pages, registers both subsystems and refreshes presentation successfully. Existing bridge/visibility regression coverage also passes.

FOCUSED TESTS: 13 passed, 0 failed across `test/fill-embed.test.js` and `test/current-url-observation.test.js`.

BROADER REGRESSION: All six requested files passed: 36 passed, 0 failed. Full repository suite was not run. `git diff --check` passed.

```text
node --test test/fill-embed.test.js test/current-url-observation.test.js test/fill-visibility.test.js test/capability-bridge.test.js test/fill-provider-expansion.test.js test/fill-provider-bundle2.test.js
```

Integration evidence uses the existing reporter harness and intercepted Cloudbate/XVideos fixture documents. It proves reporter-driven SPA changes, B's exact Fill presentation URL, unchanged `data-last-src`, underlying iframe source, Runtime Session URLs/panels, localStorage and complete panel-navigation state; Exit removes the overlay only; Refresh returns to Assigned A and clears Current. XVideos supported B wins over supported A, while unsupported Current falls back to A. An unsupported assignment also gains/loses visible Fill as Current capability changes.

PRODUCTION FILES CHANGED:

- `js/presentation-url.js`
- `js/capability-bridge.js`
- `js/current-url-observation.js`

TEST FILES CHANGED:

- `test/fill-embed.test.js`
- `test/current-url-observation.test.js`

DOC FILES CHANGED:

- `Docs REPORT/Codex/Slice-3-Current-Fill-Cloudbate__2026-10-06.md`

COMMIT: NO

PUSH: NO

## Human field test

1. With the Live URL Reporter enabled, assign Cloudbate video A to a GS3 Panel.
2. Browse inside that Panel to Cloudbate video B.
3. In GS3's top-frame DevTools console, run the following and inspect the target slot: `assignedUrl` must be A and `observedCurrentUrl` must be B.

   ```javascript
   (await import('./js/current-url-observation.js')).getCurrentUrlObservations()
   ```

4. Press Fill. Expect B presented using `B?play=true`. Inspect that Panel's `.gs3-fill-embed` source to confirm.
5. Repeat the diagnostic: A remains the canonical assignment and B remains observed Current. The underlying iframe's `data-last-src` remains A.
6. Exit Fill. Expect only the temporary Fill presentation to disappear.
7. Press Refresh. Expect the Panel to return to A (through its normal `A?play=true` presentation).
8. Repeat the diagnostic: `assignedUrl = A`, `observedCurrentUrl = null`.

Please record: Did Fill B play? Did any popup appear? Was there duplicate audio? Did Exit work? Did Refresh return to A?

Live provider playback is pending Human verification. Duplicate audio is an observation for this experiment; no underlying Pause/Mute, exclusive playback, TamperFill or next-slice work was implemented.
