import { chromium } from 'playwright';
const HOST = 'http://localhost:8080/architecture-lab/popout-shield/host.html';
const URL_ = 'https://www.cloudbate.com/video/1136214/lylith-606-sex-porn-cam-05-oct-2026/';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
for (const [name, sb] of [['CURRENT', 'allow-same-origin allow-scripts allow-forms allow-popups'], ['R0', 'allow-same-origin allow-scripts allow-forms']]) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await ctx.route('**/*', async (route) => { const rq = route.request(); if (rq.resourceType() !== 'document' || rq.url().startsWith('http://localhost')) return route.continue();
        const resp = await route.fetch(); const h = { ...resp.headers() }; delete h['x-frame-options']; await route.fulfill({ response: resp, headers: h }); });
    const page = await ctx.newPage(); const pops = []; ctx.on('page', (p) => pops.push(p));
    const msgs = []; page.on('console', (m) => msgs.push(m.text().slice(0, 230)));
    await page.goto(`${HOST}?sandbox=${encodeURIComponent(sb)}&url=${encodeURIComponent(URL_)}`); await new Promise((r) => setTimeout(r, 6000));
    const f = page.frames().find((x) => x !== page.mainFrame());
    const info = await f.evaluate(() => [...document.querySelectorAll('a,button,div,span')].filter((e) => /play/i.test(e.className + ' ' + (e.id || '')) && e.offsetParent).slice(0, 6).map((e) => ({ tag: e.tagName, cls: String(e.className).slice(0, 40), href: e.getAttribute('href'), target: e.getAttribute('target'), onclick: (e.getAttribute('onclick') || '').slice(0, 80), box: (([r]) => [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)])([e.getBoundingClientRect()]) })));
    console.log(`\n== ${name}: play-ish elements`, JSON.stringify(info));
    const players = await f.evaluate(() => ({ video: document.querySelectorAll('video').length, iframes: [...document.querySelectorAll('iframe')].map((i) => i.src.slice(0, 80)), player: !!document.querySelector('.fp-player,.video-js,#kt_player,.player') }));
    console.log('player markers', JSON.stringify(players));
    await page.mouse.click(640, 300); await new Promise((r) => setTimeout(r, 4000));   // click on the video/poster area
    const pl = await Promise.all(page.frames().map((x) => x.evaluate(() => [...document.querySelectorAll('video')].map((v) => ({ paused: v.paused, t: Math.round(v.currentTime * 10) / 10, src: (v.currentSrc || '').slice(0, 60) }))).catch(() => [])));
    console.log('after poster-area click: popups', pops.length - 1, JSON.stringify(pops.slice(1).map((p) => p.url().slice(-40))), 'videos', JSON.stringify(pl.flat()));
    console.log('console:', JSON.stringify([...new Set(msgs.filter((m) => /Blocked|Unsafe|sandbox/i.test(m)))]));
    await page.screenshot({ path: `shots/cloudbate-probe-${name}.png` });
    await ctx.close();
}
await browser.close();
