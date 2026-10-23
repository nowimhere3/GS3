<!-- sideline-provenance: {"gameId":"game_git_042782b8","clientRef":"ref_1791239100800_8bf5f3b1","playerInstanceId":"claude-1352dbb4","playerType":"claude","provider":"claude","model":"sonnet","effort":"medium","at":"2026-10-05T22:25:00.800Z"} -->
# GS3 Folder Picker Height Increase

- **Agent / model:** Claude Sonnet 5.5 (medium) — Monday 2026-10-05, Calgary (MDT)
- **Branch / HEAD:** `main` / `f96d712`
- **Result:** PASS (CSS only)

## Change
The Folder picker (`.hotswap-folder-row`) shared one rule with the Position and Copy pickers (`max-height: 160px`). I added one folder-only rule after it in each page that defines the picker:

```css
.hotswap-folder-row { max-height: min(256px, calc(100% - 16px)); }
```

- **Files:** `index3.html` (after line 401), `index.html` (same rule, after the matching block). No JS, no DOM change.
- **Height:** 160px → 256px (×1.6). The `calc(100% - 16px)` term clamps it to the Panel (the picker is absolutely positioned in the Panel), so a short Panel never overflows; the existing `placePicker` top clamp is untouched.
- Position/Copy pickers keep 160px.

## Validation (real index3.html, Playwright, 40 folders; BEFORE = same page with the new rule stripped in memory)
| Check | Before | After |
|---|---|---|
| Tray 📁 picker height | 160 | **256** (7 rows visible vs 5) |
| Top-toolbar shortcut folder mirror | 160 | **256** (same picker) |
| Width | 190 | 190 |
| Folder item height / font / padding / gap | 30px / 12px / 6px 10px / 4px | identical |
| Scrolls (scrollHeight > clientHeight, scrollTop moves) | yes | yes |
| Inside Panel bounds (900px and 420px viewports) | yes | yes |
| Select "Folder 7": Session = DOM = Folder 7, URL f7 assigned, picker closes | yes | yes |
| Escape closes picker | yes | yes |

**Not verified:** the Runway folder shortcut, because the default configuration has no folder control on the Runway (the mirror delegates to the same canonical handler and opens the same row). Outside-click dismissal was not separately exercised; no JS was touched. The full `boot-smoke` suite was started but produced no result within my time limit, so it was not used as evidence.

## Production / git
Two tracked HTML files changed (2 lines added each). No commit, no push.
