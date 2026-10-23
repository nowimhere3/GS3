// Published site (f96d712), fresh context. The repo's own PUBLIC links.json is served to the app through a mocked GitHub API
// response (the Human's real token/repo are not available). Dummy credentials only; no write path is exercised.
// Purpose: with the real 24-folder database and an EMPTY blacklist, does Folder Assignment route for EVERY folder?
import { chromium } from 'playwright';
const LIVE = 'https://nowimhere3.github.io/GS3/';
const links = await (await fetch(LIVE + 'links.json')).text();
const b64 = Buffer.from(links, 'utf8').toString('base64');
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
await ctx.addInitScript(() => { if (window === window.top) { localStorage.setItem('git_sync_token', 'dummy'); localStorage.setItem('git_sync_repo', 'nowimhere3/GS3'); } });
await ctx.route('https://api.github.com/**', (r) => {
    const u = r.request().url();
    if (u.endsWith('/links-index.json')) return r.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
    if (u.endsWith('/links.json')) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sha: 'x', content: b64 }) });
    return r.fulfill({ status: 404, body: '{}' });
});
await ctx.route(/^https?:\/\/(?!nowimhere3\.github\.io|api\.github\.com).*/, (r) => r.fulfill({ status: 204, body: '' }));
const page = await ctx.newPage();
await page.goto(LIVE + 'index3.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const res = await page.evaluate(async () => {
    const st = await import('./js/state.js'); const bl = await import('./js/blacklist.js'); const gs = await import('./js/grid-session.js');
    const db = st.getDatabaseStructure(); const out = { dbLoaded: !!db, folders: db ? Object.keys(db).length : 0, blacklist: bl.getBlacklist().length, rows: [] };
    if (!db) return out;
    const panel = document.querySelector('.stream-panel[data-slot-index="0"]'); const f = panel.querySelector('iframe');
    for (const name of Object.keys(db)) {
        const raw = db[name].length, black = db[name].filter((u) => bl.isBlacklisted(u)).length;
        const before = f.getAttribute('data-last-src');
        panel.querySelector('.btn-hotswap-folder').click();
        [...panel.querySelectorAll('.hotswap-folder-item')].find((i) => i.firstElementChild.textContent === name).click();
        await new Promise((r) => setTimeout(r, 150));
        const after = f.getAttribute('data-last-src');
        out.rows.push({ name, raw, black, usable: raw - black, routed: after !== before, inFolder: db[name].includes(after), folderNow: gs.getSessionFolderMap()[0] });
    }
    return out;
});
console.log(`db loaded=${res.dbLoaded} folders=${res.folders} blacklist=${res.blacklist}`);
const bad = res.rows.filter((r) => !r.routed || !r.inFolder || r.folderNow !== r.name);
console.log(`folders tested=${res.rows.length}, routed to a URL inside the folder with folder adopted: ${res.rows.length - bad.length}, NOT: ${bad.length}`, bad.length ? JSON.stringify(bad) : '');
console.log('sample:', JSON.stringify(res.rows.slice(0, 3)));
await browser.close();
