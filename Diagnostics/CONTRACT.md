# StreamLoop RM-1 Contract

```text
protocol: RM-1
snapshot schema: 1
project slug: streamloop
Tier 2: implemented
Tier 1 Journal: NOT implemented
Incidents: NOT implemented
Last-Known-Good: NOT implemented
```

## Tier 2 snapshot

The snapshot is generated in browser memory on demand. One structured object
feeds one Markdown renderer; Copy Diagnostics and Download Diagnostics use that
same artifact. The fixed V1 sections are `HEADER`, `VERDICT`, `RUNTIME`,
`POSITIONS`, `HISTORY`, `WORKSPACE / PRESET PROJECTION`, `PERSISTENCE`, and
`REFERENCES`. Adding another section requires a demonstrated debugging need and
a contract change.

Top-level Grid exposes `Copy Diagnostics` through its existing Master Bar `…`
menu so the snapshot can observe that live Runtime before the user navigates
away. Settings keeps Copy and Download. Both access points call the same
generator and renderer; live Grid access does not add parent/child messaging,
cross-frame collection, or diagnostic state.

Snapshots have a ten-minute interactive freshness horizon. Every artifact has
an ISO 8601 generated timestamp with an explicit offset, rendered age, and
`FRESH` or `STALE`. A stale snapshot is evidence of the earlier moment only.

`Observed` means read directly from the browser, canonical GS3 state, current
DOM projection, existing Store, or the permitted remote GET. `Derived` means a
deterministic comparison of Observed values, currently workspace projection,
preset SHA comparison, and effective Layer target. `Reported` is reserved for
another component's retained claim; V1 emits no Reported fields.

`unknown` is a valid result. A failed or unavailable probe renders
`unknown (<safe reason>)` and cannot abort the snapshot.

## Observation boundary

Diagnostics observe and never act. Generation cannot change Runtime Session,
Panel assignments, history, presets, workspace state, credentials, Layer
selection, iframe navigation, or GitHub state. It cannot repair, refresh,
retry, or reload anything. The only permitted remote operation is one bounded,
read-only `GET /repos/<owner>/<repo>/contents/presets.json` used to observe the
current remote preset SHA. No POST, PUT, PATCH, or DELETE is permitted.

The GitHub branch is `unknown` unless an existing configured or observed value
proves it. Last failed HTTP status is `unknown` because V1 does not retain HTTP
history. Nested Runtime history is `unknown` where it cannot be read without
new instrumentation.

## Privacy and redaction

The producer uses an allowlist. It never records GitHub PATs, Authorization
headers, cookies, OAuth credentials, signed query strings, media URL lists,
preset or playlist contents, database dumps, iframe document contents, or
clipboard contents. There is no deep or unsafe mode.

Token-shaped values are rejected, including GitHub PATs, JWTs, Bearer values,
Google/OAuth-like tokens, and long base64/hex strings. URLs lose query and
fragment components; suspicious path segments are replaced with `[redacted]`.
Panel web content is represented only by an eight-character SHA-256 identity
hash. Counts, hashes, canonical identity, and safe scalar values replace
payloads.

The Markdown target is below 16 KB and has a 40 KB hard cap. Any hard-cap
fallback states that lower-priority sections were truncated; truncation is
never silent.

## Repository boundary

Runtime evidence is never committed. `Diagnostics/.gitignore` ignores all of
`Diagnostics/local/` without exceptions. That folder is a manual projection of
copied/downloaded browser evidence and is disposable. Browser product code has
no repository path and never writes there.
