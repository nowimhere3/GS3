import { chromium } from 'playwright';
const HOST = 'http://localhost:8080/architecture-lab/popout-shield/host.html';
const URL_ = 'https://www.cloudbate.com/video/1136214/lylith-606-sex-porn-cam-05-oct-2026/?play=true';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
for (const [name, sb] of [['R0', 'allow-same-origin allow-scripts allow-forms'], ['CURRENT', 'allow-same-origin allow-scripts allow-forms allow-popups']]) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await ctx.route('**/*', async (route) => { const rq = route.request(); if (rq.resourceType() !== 'document' || rq.url().startsWith('http://localhost')) return route.continue();
        const resp = await route.fetch(); const h = { ...resp.headers() }; delete h['x-frame-options']; await route.fulfill({ response: resp, headers: h }); });
    const page = await ctx.newPage(); const pops = []; ctx.on('page', (p) => pops.push(p));
    await page.goto(`${HOST}?sandbox=${encodeURIComponent(sb)}&url=${encodeURIComponent(URL_)}`); await new Promise((r) => setTimeout(r, 8000));
    const v = async () => (await Promise.all(page.frames().map((f) => f.evaluate(() => [...document.querySelectorAll('video')].map((x) => ({ paused: x.paused, t: Math.round(x.currentTime * 10) / 10 }))).catch(() => [])))).flat();
    console.log(name, '?play=true loaded directly in Panel: videos (no click)', JSON.stringify(await v()), 'popups', pops.length);
    await page.mouse.click(640, 360); await new Promise((r) => setTimeout(r, 4000));
    console.log(name, '  after one click in panel: videos', JSON.stringify(await v()), 'popups', pops.length);
    await ctx.close();
}
await browser.close();
