<!-- sideline-provenance: {"gameId":"game_git_042782b8","clientRef":"ref_1791231057937_5113bb59","playerInstanceId":"claude-1352dbb4","playerType":"claude","provider":"claude","model":"sonnet","effort":"medium","at":"2026-10-05T20:10:57.937Z"} -->
# Human Diagnostic Snippet — Folder Assignment (read-only)

Source file (unchanged): `architecture-lab/folder-assign-verify/human-diagnostic.js`

**How to use:** open `https://nowimhere3.github.io/GS3/` on the failing tab (Live Builder or Preset 9), open DevTools (F12) → Console, paste the block below, press Enter. If Chrome blocks pasting, type `allow pasting` first. Copy back the full JSON the console prints (the object that starts with `"page":`).

**Guarantees:** read-only. No `Store.set`, no clicks, no blacklist change, no database change, no network request, no Remote Debugging.

```javascript
(async () => {
  // READ-ONLY. Paste into DevTools Console on https://nowimhere3.github.io/GS3/ (index3 / Live Builder or a Preset).
  // Writes nothing: no Store.set, no clicks, no network. Prints counts only (plus blacklisted domain names).
  const st = await import('./js/state.js'), bl = await import('./js/blacklist.js'), gs = await import('./js/grid-session.js');
  const { Store } = await import('./js/storage.js');
  const db = st.getDatabaseStructure();
  const black = bl.getBlacklist();
  const rows = db ? Object.keys(db).map((name) => {
    const v = db[name], arr = Array.isArray(v) ? v : null;
    const b = arr ? arr.filter((u) => bl.isBlacklisted(u)).length : null;
    const hosts = new Set(); (arr || []).forEach((u) => { try { hosts.add(new URL(u).hostname); } catch { hosts.add('(unparseable)'); } });
    return { name, shape: arr ? 'array' : typeof v, raw: arr ? arr.length : null, blacklisted: b, usable: arr ? arr.length - b : null, hosts: hosts.size };
  }) : null;
  const panels = [...document.querySelectorAll('.stream-panel')].map((p) => {
    const f = p.querySelector('iframe'); const s = (f && f.getAttribute('data-last-src')) || '';
    let host = ''; try { host = new URL(s).hostname; } catch {}
    return { slot: p.dataset.slotIndex, domFolder: f && f.getAttribute('data-source-folder'), sessionFolder: gs.getSessionFolderMap()[p.dataset.slotIndex] ?? null, assignedHost: host };
  });
  const out = {
    page: location.pathname + location.search,
    dbLoaded: !!db, folderCount: rows ? rows.length : 0,
    tokenPresent: !!Store.get('gitToken'), repoPresent: !!Store.get('gitRepo'), repoIsGS3: Store.get('gitRepo') === 'nowimhere3/GS3',
    blacklistSize: black.length, blacklist: black.slice(0, 40),
    foldersWithZeroUsable: rows ? rows.filter((r) => r.usable === 0 || r.shape !== 'array').map((r) => r.name) : null,
    folderSummary: rows, panels,
  };
  console.log(JSON.stringify(out, null, 1));
  return out;
})();
```

**Copy back:** the full JSON text printed by `console.log` (starts with `{ "page": ...`, includes `dbLoaded`, `folderCount`, `blacklistSize`, `blacklist`, `foldersWithZeroUsable`, `folderSummary`, `panels`). If it is long, at minimum copy `dbLoaded`, `folderCount`, `repoIsGS3`, `blacklistSize`, `blacklist`, `foldersWithZeroUsable`, and the `folderSummary` entry of the folder you tested. No token value is printed.
