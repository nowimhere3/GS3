// Real index3.html (working tree) + live Cloudbate in real Chrome. X-Frame-Options is stripped (lab assumption: the Human's setup does the same).
import { chromium } from 'playwright';
const O = 'http://localhost:8080';
const V = 'https://www.cloudbate.com/video/1136214/lylith-606-sex-porn-cam-05-oct-2026/';
const HOME = 'https://www.cloudbate.com/';
const XN = 'https://www.xnxx.com/video-1164yzbf/petite_polly_petrova_gets_hardcore_pounding_in_the_pooter_in_first_dap';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
await ctx.route('**/*', async (route) => { const rq = route.request(); if (rq.resourceType() !== 'document' || rq.url().startsWith(O)) return route.continue();
    try { const resp = await route.fetch(); const h = { ...resp.headers() }; delete h['x-frame-options']; await route.fulfill({ response: resp, headers: h }); } catch { await route.continue().catch(() => {}); } });
const page = await ctx.newPage(); const pops = []; ctx.on('page', (p) => { if (p !== page) pops.push(p); });
const msgs = []; page.on('console', (m) => msgs.push(m.text()));
await page.addInitScript(([a, b, c]) => { if (window === window.top) localStorage.setItem('loop_matrix_urls', JSON.stringify([a, b, c])); }, [V, HOME, XN]);
await page.goto(`${O}/index3.html`, { waitUntil: 'load' });
await page.waitForFunction(() => document.querySelectorAll('.stream-panel iframe').length === 4);
await page.waitForTimeout(8000);
const state = () => page.evaluate(async () => {
    const gs = await import('./js/grid-session.js'); const nav = await import('./js/panel-navigation.js');
    return [0, 1, 2].map((s) => { const f = document.querySelector(`.stream-panel[data-slot-index="${s}"] iframe`);
        return { slot: s, dataLastSrc: f.getAttribute('data-last-src'), iframeSrc: f.getAttribute('src'), sessionUrl: String(gs.getSessionUrls()[s]), anchor: nav.getPanelNavigationState(s).anchor, sandbox: f.getAttribute('sandbox') }; });
});
const t = (u) => u.replace('https://www.', '').slice(0, 80);
let st = await state();
for (const s of st) console.log(`slot ${s.slot}: assigned(data-last-src)=${t(s.dataLastSrc)} | effective iframe src=${t(s.iframeSrc)} | session=${s.sessionUrl === s.dataLastSrc ? 'same as assigned' : 'DIFFERS ' + s.sessionUrl} | anchor same=${s.anchor === s.dataLastSrc}`);
console.log('sandbox (all):', JSON.stringify([...new Set(st.map((s) => s.sandbox))]));
const panelFrame = () => page.frames().find((f) => f.url().startsWith(V.split('?')[0]));
console.log('panel frame loaded URL:', t(panelFrame()?.url() || 'none'));
// Human flow: press Play inside the Panel (real trusted clicks at the player), check playback
const video = async () => (await Promise.all(page.frames().map((f) => f.evaluate(() => [...document.querySelectorAll('video')].map((x) => ({ paused: x.paused, t: Math.round(x.currentTime * 10) / 10 }))).catch(() => [])))).flat();
console.log('before click: videos', JSON.stringify(await video()));
const box = await page.locator('.stream-panel[data-slot-index="0"] iframe').boundingBox();
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); await page.waitForTimeout(5000);
console.log('after one Play click: videos', JSON.stringify(await video()), '| popups/new tabs:', pops.length, '| Chrome blocked-popup messages:', msgs.filter((m) => /Blocked opening/.test(m)).length);
console.log('GS3 host page still on index3 (focus/URL unchanged):', page.url().startsWith(`${O}/index3.html`));
st = await state();
console.log('after play: assigned unchanged:', st[0].dataLastSrc === V, '| session unchanged:', st[0].sessionUrl === V);
// Reload button path (about:blank, then presentation URL) + assigned URL stays original
await page.evaluate(() => document.querySelector('.stream-panel[data-slot-index="0"] .btn-hotswap-reload').click());
await page.waitForTimeout(4000);
st = await state();
console.log('after GS3 ⟳ Reload: iframe src =', t(st[0].iframeSrc), '| assigned =', t(st[0].dataLastSrc));
await browser.close();
