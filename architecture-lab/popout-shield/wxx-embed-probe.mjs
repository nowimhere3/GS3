import { chromium } from 'playwright';
const HOST = 'http://localhost:8080/architecture-lab/popout-shield/host.html';
const URLS = process.argv.slice(2);
const SHIELD = 'allow-same-origin allow-scripts allow-forms';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const url of URLS) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await ctx.route('**/*', async (route) => { const rq = route.request(); if (rq.resourceType() !== 'document' || rq.url().startsWith('http://localhost')) return route.continue();
        try { const resp = await route.fetch(); const h = { ...resp.headers() }; delete h['x-frame-options']; delete h['content-security-policy']; await route.fulfill({ response: resp, headers: h }); } catch { await route.continue().catch(() => {}); } });
    const page = await ctx.newPage(); const pops = []; ctx.on('page', (p) => { if (p !== page) pops.push(p); });
    const nav = []; page.on('framenavigated', (f) => { if (f !== page.mainFrame()) nav.push((f.parentFrame() === page.mainFrame() ? 'panel:' : 'nested:') + f.url().replace(/^https:\/\//, '').slice(0, 70)); });
    const msgs = []; page.on('console', (m) => { if (/Blocked opening|Unsafe attempt/i.test(m.text())) msgs.push(m.text().slice(0, 110)); });
    await page.goto(HOST + '?sandbox=' + encodeURIComponent(SHIELD) + '&url=' + encodeURIComponent(url), { waitUntil: 'load' });
    await sleep(7000);
    const vids = async () => (await Promise.all(page.frames().map((f) => f.evaluate(() => [...document.querySelectorAll('video')].map((v) => ({ paused: v.paused, t: Math.round(v.currentTime * 10) / 10, w: v.videoWidth, muted: v.muted }))).catch(() => [])))).flat();
    const before = await vids();
    const hb = await page.locator('iframe').boundingBox();
    for (let i = 0; i < 2; i++) { await page.mouse.click(hb.x + hb.width / 2, hb.y + hb.height / 2); await sleep(4500); }
    const after = await vids();
    const panelFrame = page.frames().find((f) => f.parentFrame() === page.mainFrame());
    console.log('\n' + url.replace(/^https:\/\//, '').slice(0, 90));
    console.log('  videos before:', JSON.stringify(before), '| after 2 clicks:', JSON.stringify(after));
    console.log('  popups:', pops.length, '| panel url now:', panelFrame.url().replace(/^https:\/\//, '').slice(0, 80), '| top unchanged:', page.url().startsWith(HOST));
    console.log('  blocked msgs:', JSON.stringify([...new Set(msgs)]), '| navs:', JSON.stringify(nav.slice(0, 5)));
    await ctx.close();
}
await browser.close();
