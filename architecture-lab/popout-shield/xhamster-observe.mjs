import { chromium } from 'playwright';
const HOST = 'http://localhost:8080/architecture-lab/popout-shield/host.html';
const URLS = process.argv.slice(2).length ? process.argv.slice(2) : ['https://xhamster.com/videos/small-titted-babe-enjoys-a-rough-bbc-gangbang-3298012'];
const POL = { SHIELD: 'allow-same-origin allow-scripts allow-forms', CURRENT: 'allow-same-origin allow-scripts allow-forms allow-popups' };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const url of URLS) for (const [pn, sb] of Object.entries(POL)) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await ctx.route('**/*', async (route) => { const rq = route.request(); if (rq.resourceType() !== 'document' || rq.url().startsWith('http://localhost')) return route.continue();
        try { const resp = await route.fetch(); const h = { ...resp.headers() }; delete h['x-frame-options']; if (h['content-security-policy']) h['content-security-policy'] = h['content-security-policy'].replace(/frame-ancestors[^;]*;?/gi, ''); await route.fulfill({ response: resp, headers: h }); } catch { await route.continue().catch(() => {}); } });
    const page = await ctx.newPage(); const pops = []; ctx.on('page', (p) => { if (p !== page) pops.push(p); });
    const nav = []; const media = []; const msgs = [];
    page.on('framenavigated', (f) => { if (f !== page.mainFrame()) nav.push((f.parentFrame() === page.mainFrame() ? 'panel: ' : 'nested: ') + f.url().slice(0, 110)); });
    page.on('request', (r) => { const u = r.url(); if (/\.(m3u8|mp4|webm|mpd)(\?|$)|\/embed|player|video-?src|\.ts(\?|$)/i.test(u) && !/\.(js|css|png|jpg|webp|svg|woff2?)(\?|$)/i.test(u)) media.push(r.resourceType() + ' ' + u.replace(/^https?:\/\//, '').slice(0, 100)); });
    page.on('console', (m) => { const t = m.text(); if (/Blocked opening|Unsafe attempt|sandbox/i.test(t)) msgs.push(t.slice(0, 200)); });
    console.log(`\n=== ${pn} :: ${url}`);
    await page.goto(`${HOST}?sandbox=${encodeURIComponent(sb)}&url=${encodeURIComponent(url)}`, { waitUntil: 'load', timeout: 30000 }).catch((e) => console.log('goto', e.message.slice(0, 80)));
    await sleep(7000);
    const f0 = page.frames().find((f) => f.parentFrame() === page.mainFrame());
    const info = f0 ? await f0.evaluate(() => ({ url: location.href.slice(0, 110), title: document.title.slice(0, 60), videos: document.querySelectorAll('video').length, iframes: [...document.querySelectorAll('iframe')].map((i) => (i.src || '').slice(0, 90)).slice(0, 4), playish: [...document.querySelectorAll('[class*=play i],[data-role*=play i],button')].filter((e) => e.offsetParent).slice(0, 5).map((e) => (e.tagName + '.' + String(e.className).slice(0, 40) + (e.getAttribute('href') ? ' href=' + e.getAttribute('href').slice(0, 50) : ''))) })).catch((e) => ({ err: e.message.slice(0, 80) })) : null;
    console.log('before Play:', JSON.stringify(info));
    const clicks = [];
    for (let i = 0; i < 2; i++) { await page.mouse.click(640, 330); clicks.push('center'); await sleep(4500); }
    const vids = (await Promise.all(page.frames().map((f) => f.evaluate(() => [...document.querySelectorAll('video')].map((x) => ({ paused: x.paused, t: Math.round(x.currentTime * 10) / 10, src: (x.currentSrc || '').slice(0, 60) }))).catch(() => [])))).flat();
    const f1 = page.frames().find((f) => f.parentFrame() === page.mainFrame());
    console.log('after 2 Play clicks: panel url', f1 ? f1.url().slice(0, 110) : null);
    console.log('videos:', JSON.stringify(vids));
    console.log('popups:', pops.length, JSON.stringify(await Promise.all(pops.map(async (p) => { await p.waitForLoadState('domcontentloaded', { timeout: 4000 }).catch(() => {}); return p.url().slice(0, 110); }))));
    console.log('frame navigations:', JSON.stringify(nav.slice(0, 8)));
    console.log('console blocked/unsafe:', JSON.stringify([...new Set(msgs)].slice(0, 3)));
    console.log('media/player requests:', JSON.stringify([...new Set(media)].slice(0, 8)));
    console.log('top page unchanged:', page.url().startsWith(HOST));
    await page.screenshot({ path: `shots/xhamster-${pn}.png` }).catch(() => {});
    await ctx.close();
}
await browser.close();
