import { chromium } from 'playwright';
const HOST = 'http://localhost:8080/architecture-lab/popout-shield/host.html';
const URL_ = 'https://www.cloudbate.com/video/1136214/lylith-606-sex-porn-cam-05-oct-2026/';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
await ctx.route('**/*', async (route) => { const rq = route.request(); if (rq.resourceType() !== 'document' || rq.url().startsWith('http://localhost')) return route.continue();
    const resp = await route.fetch(); const h = { ...resp.headers() }; delete h['x-frame-options']; await route.fulfill({ response: resp, headers: h }); });
const page = await ctx.newPage(); const pops = []; ctx.on('page', (p) => pops.push(p));
await page.goto(`${HOST}?sandbox=${encodeURIComponent('allow-same-origin allow-scripts allow-forms allow-popups')}&url=${encodeURIComponent(URL_)}`); await new Promise((r) => setTimeout(r, 6000));
await page.mouse.click(640, 300); await new Promise((r) => setTimeout(r, 7000));
console.log('CURRENT policy: popups =', pops.length);
for (const p of pops) {
    await p.waitForLoadState('domcontentloaded').catch(() => {});
    const v = await Promise.all(p.frames().map((f) => f.evaluate(() => [...document.querySelectorAll('video')].map((x) => ({ paused: x.paused, t: Math.round(x.currentTime * 10) / 10 }))).catch(() => [])));
    console.log('popup url', p.url().slice(-45), 'opener=GS3 host:', !!(await p.opener()), 'videos', JSON.stringify(v.flat()));
}
const inPanel = await Promise.all(page.frames().map((f) => f.evaluate(() => [...document.querySelectorAll('video')].map((x) => ({ paused: x.paused, t: Math.round(x.currentTime * 10) / 10 }))).catch(() => [])));
console.log('inside GS3 panel videos', JSON.stringify(inPanel.flat()), '| panel frame url', page.frames().find((f) => f !== page.mainFrame())?.url().slice(-45));
console.log('host page url unchanged:', page.url().startsWith(HOST));
await browser.close();
