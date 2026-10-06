// Read-only: natural initialization of the published site in a genuinely fresh browser context. No seeding.
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
const LIVE = 'https://nowimhere3.github.io/GS3/';
const sha = (t) => crypto.createHash('sha1').update(t.replace(/\r/g, '')).digest('hex').slice(0, 10);
for (const f of ['js/launch.js', 'js/blacklist.js', 'js/state.js', 'js/triple-mode.js', 'js/sync.js']) {
    const live = await (await fetch(LIVE + f + '?cb=' + Date.now())).text();
    const local = execSync(`git show f96d712:${f}`, { cwd: 'C:/Users/dmcal/Documents/GitHub/GS3', maxBuffer: 1 << 26 }).toString();
    console.log(f.padEnd(18), 'live', sha(live), 'f96d712', sha(local), sha(live) === sha(local) ? 'IDENTICAL' : 'DIFFERENT');
}
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await ctx.newPage();
const logs = []; page.on('console', (m) => logs.push(`${m.type()}: ${m.text().slice(0, 200)}`));
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message.slice(0, 200)));
await page.goto(LIVE + 'index3.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const r = await page.evaluate(async () => {
    const st = await import('./js/state.js'); const { Store } = await import('./js/storage.js'); const bl = await import('./js/blacklist.js');
    const db = st.getDatabaseStructure();
    return { url: location.href, panels: document.querySelectorAll('.stream-panel').length,
        tokenPresent: !!Store.get('gitToken'), repoPresent: !!Store.get('gitRepo'), dbType: db === null ? 'null' : typeof db, folders: db ? Object.keys(db).length : 0,
        blacklistSize: bl.getBlacklist().length, localStorageKeys: Object.keys(localStorage).length };
});
console.log('FRESH LIVE:', JSON.stringify(r));
const chooser = await page.evaluate(() => { const p = document.querySelector('.stream-panel'); p.querySelector('.btn-hotswap-folder')?.click(); return [...p.querySelectorAll('.hotswap-folder-item')].map((i) => i.textContent.trim().slice(0, 40)); });
console.log('chooser rows:', JSON.stringify(chooser));
console.log(logs.filter((l) => /app\]|error|Failed/i.test(l)).slice(0, 8).join('\n'));
await browser.close();
