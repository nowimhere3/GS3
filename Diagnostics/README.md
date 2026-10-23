# StreamLoop Runtime Memory

This directory is the reader front door for StreamLoop's native RUNTIME MEMORY
RM-1 binding. The repository commits this reader contract. Runtime evidence is
machine-specific, disposable, and never committed.

## Reader SOP

1. Start with `Diagnostics/local/CURRENT.md` when it exists.
2. Check its generated timestamp, age, and `FRESH` / `STALE` line first. The
   interactive freshness horizon is ten minutes. Regenerate stale evidence.
3. Read `VERDICT` before opening source files.
4. Read `RUNTIME`, `POSITIONS`, `HISTORY`, `WORKSPACE / PRESET PROJECTION`, and
   `PERSISTENCE` to identify the likely broken boundary.
5. Treat `unknown` literally. It is never zero, false, absent, or permission to
   infer a plausible value.
6. Preserve the distinction between Observed facts, Reported claims, and
   Derived comparisons. StreamLoop V1 contains no invented Reported data.
7. Begin source archaeology only after the snapshot identifies the boundary
   that needs inspection.

Generate the browser snapshot through:

```text
Settings → Diagnostics → Copy Diagnostics
```

When the problem is in a live top-level Grid Runtime, stay on that Runtime and
use the existing Master Bar `…` menu's `Copy Diagnostics` action instead. It
observes the live Grid document before navigation can discard its Runtime
context. Settings remains the place for its Copy and Download controls.

`Download Diagnostics` saves the same Markdown artifact as `CURRENT.md`. A
human may place a copied or downloaded snapshot at
`Diagnostics/local/CURRENT.md` so an agent can read it. Product code does not
know this repository path and never writes into it.

Everything in the artifact is produced through an allowlist. Credentials,
cookies, signed URL query strings, media collections, preset/playlist contents,
database dumps, iframe contents, and clipboard contents are never recorded.
User-chosen preset names and repository names are visible when they pass the
safe-scalar rules; review those names before pasting if the vocabulary itself
is sensitive.

Presentation-only defects can remain invisible to RM-1 when canonical state is
correct and only the view is wrong. The projection comparison catches the
specific active-preset label mismatch, but the snapshot is not a general view
inspector and “no anomalies detected” does not mean the product is bug-free.

Tier 1 Journal, Incidents, and Last-Known-Good are not implemented.
