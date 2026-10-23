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
