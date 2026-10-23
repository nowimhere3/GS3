import { chromium } from 'playwright';
const HOST = 'http://localhost:8080/architecture-lab/popout-shield/host.html';
const E = 'https://xhamster.com/embed/3298012';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
await ctx.route('**/*', async (route) => { const rq = route.request(); if (rq.resourceType() !== 'document' || rq.url().startsWith('http://localhost')) return route.continue();
    try { const resp = await route.fetch(); const h = { ...resp.headers() }; delete h['x-frame-options']; if (h['content-security-policy']) h['content-security-policy'] = h['content-security-policy'].replace(/frame-ancestors[^;]*;?/gi, ''); await route.fulfill({ response: resp, headers: h }); } catch { await route.continue().catch(() => {}); } });
const page = await ctx.newPage(); const pops = []; ctx.on('page', (p) => { if (p !== page) pops.push(p); });
await page.goto(`${HOST}?sandbox=${encodeURIComponent('allow-same-origin allow-scripts allow-forms')}&url=${encodeURIComponent(E)}`); await new Promise((r) => setTimeout(r, 7000));
const f = page.frames().find((x) => x.parentFrame() === page.mainFrame());
const dom = await f.evaluate(() => {
    const q = (s) => [...document.querySelectorAll(s)];
    const brief = (e) => ({ tag: e.tagName, cls: String(e.className).slice(0, 60), id: e.id, href: (e.getAttribute('href') || '').slice(0, 110), target: e.getAttribute('target'), rel: e.getAttribute('rel'), box: (([r]) => [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)])([e.getBoundingClientRect()]) });
    return { anchors: q('a').filter((a) => a.offsetParent).slice(0, 8).map(brief), videos: q('video').map((v) => ({ ...brief(v), src: (v.currentSrc || '').slice(0, 80), paused: v.paused })), xp: q('[class*="xp-"]').slice(0, 12).map(brief), canvas: q('canvas').length, bodyHtml: document.body.innerHTML.length };
});
console.log(JSON.stringify(dom, null, 1).slice(0, 3500));
await browser.close();
