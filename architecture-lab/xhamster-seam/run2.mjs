// LAB ONLY. Rule A: Sec-Fetch-Dest -> document (xhamster sub_frame). Rule B: block xhamster /embed/* sub_frame.
// Question: does the full /videos/ document survive the blocked client-side /embed navigation, and does the player work?
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = path.dirname(fileURLToPath(import.meta.url)).replace(/^\/([A-Za-z]:)/, '$1');
const EXT = path.join(dir, 'ext');
const HOST = 'http://localhost:8080/architecture-lab/popout-shield/host.html';
const SHIELD = 'allow-same-origin allow-scripts allow-forms';
const XH = process.argv[2] || 'https://xhamster.com/videos/small-titted-babe-enjoys-a-rough-bbc-gangbang-3298012';
const doms = (process.env.DOMS || 'xhamster.com').split(',');
const BLOCK = process.env.NOBLOCK ? false : true;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cands = [
    { action: { type: 'modifyHeaders', requestHeaders: [{ header: 'Sec-Fetch-Dest', operation: 'set', value: 'document' }] }, condition: { requestDomains: doms, resourceTypes: ['sub_frame'] } },
];
if (BLOCK) cands.push({ action: { type: 'block' }, condition: { regexFilter: '^https://(' + doms.map((d) => d.replace(/\./g, '\\.')).join('|') + ')/embed/', resourceTypes: ['sub_frame'] } });
fs.writeFileSync(path.join(EXT, 'active-rules.json'), JSON.stringify({ name: BLOCK ? 'A+B' : 'A only', candidates: cands }));
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'gs3-seam2-'));
const ctx = await chromium.launchPersistentContext(prof, { channel: 'chromium', headless: true, viewport: { width: 1280, height: 720 },
    ignoreDefaultArgs: ['--disable-extensions'], args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--headless=new'] });
let sw = ctx.serviceWorkers()[0]; if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 10000 }).catch(() => null);
await sleep(1500);
const out = { dnr: sw ? await sw.evaluate(() => self.__dnr) : 'no sw' };
await ctx.addInitScript(() => { try { window.__docId = Math.random().toString(36).slice(2, 8); } catch (e) {} });
const page = await ctx.newPage(); const pops = [];
ctx.on('page', (p) => { if (p !== page) pops.push(p); });
const T0 = Date.now(); const ev = []; const log = (s) => ev.push(((Date.now() - T0) / 1000).toFixed(1) + 's ' + s);
const shortU = (u, n) => u.replace(/^https:\/\/[^/]+/, '').slice(0, n);
page.on('response', (r) => { const u = r.url(); if (/xhamster\.com\/(videos|embed)\//.test(u) && r.request().resourceType() === 'document') log('response ' + r.status() + ' ' + shortU(u, 50)); });
page.on('request', async (rq) => { const u = rq.url(); if (/xhamster\.com\/(videos|embed)\//.test(u) && rq.resourceType() === 'document') { const h = await rq.allHeaders().catch(() => ({})); log('request ' + shortU(u, 40) + ' Sec-Fetch-Dest=' + (h['sec-fetch-dest'] || '(absent)')); } });
page.on('requestfailed', (rq) => { if (/\/embed\//.test(rq.url())) log('REQUEST FAILED ' + shortU(rq.url(), 40) + ' ' + (rq.failure() && rq.failure().errorText)); });
const media = new Set();
page.on('request', (rq) => { const u = rq.url(); if (/\.(m3u8|mp4|webm|mpd)(\?|$)|media=hls|\.ts(\?|$)/i.test(u)) media.add(u.replace(/^https?:\/\//, '').slice(0, 70)); });
const msgs = []; page.on('console', (m) => { const t = m.text(); if (/Blocked opening|Unsafe attempt|ERR_BLOCKED/i.test(t)) msgs.push(t.slice(0, 160)); });
page.on('framenavigated', (f) => { if (f !== page.mainFrame()) log('framenavigated -> ' + shortU(f.url(), 50)); });
await page.goto(HOST + '?sandbox=' + encodeURIComponent(SHIELD) + '&url=' + encodeURIComponent(XH), { waitUntil: 'load' }).catch(() => {});
const samples = [];
for (let i = 0; i < 56; i++) {
    const f = page.frames().find((x) => x.parentFrame() === page.mainFrame());
    const s = f ? await f.evaluate(() => ({ id: window.__docId, url: location.pathname.slice(0, 40), videos: document.querySelectorAll('video').length, bodyLen: document.body ? document.body.innerText.length : 0 })).catch(() => ({ id: '(navigating)' })) : { id: '(no frame)' };
    samples.push(Object.assign({ t: ((Date.now() - T0) / 1000).toFixed(1) }, s)); await sleep(250);
}
const compact = []; for (const s of samples) { const last = compact[compact.length - 1]; if (!last || last.id !== s.id || last.url !== s.url || last.videos !== s.videos) compact.push(s); }
out.timeline = ev; out.documentSamples = compact; out.docIds = [...new Set(samples.map((s) => s.id))];
const ff = page.frames().find((x) => x.parentFrame() === page.mainFrame());
out.finalFrame = ff ? shortU(ff.url(), 60) : null;
out.embedRequestAttempts = ev.filter((e) => /request .*\/embed/.test(e)).length; out.embedBlocked = ev.some((e) => /REQUEST FAILED/.test(e));
const last = samples[samples.length - 1];
out.fullPagePreserved = /\/videos\//.test(last.url || '') && last.bodyLen > 500;
if (out.fullPagePreserved) {
    const f = ff;
    out.player = await f.evaluate(() => { const q = (s) => [...document.querySelectorAll(s)];
        return { videos: q('video').length, xplayer: q('[class*=xplayer i],[id*=player i],[class*=xp-]').length, poster: q('[class*=poster i]').filter((e) => e.offsetParent).length,
            playControls: q('[class*=play i],[data-role*=play i],[aria-label*=play i],button').filter((e) => e.offsetParent).slice(0, 6).map((e) => e.tagName + '.' + String(e.className).slice(0, 28)),
            fullscreen: q('[class*=fullscreen i],[aria-label*=full i]').length, title: document.title.slice(0, 50) }; }).catch(() => null);
    const nav0 = ev.length;
    const v = async () => (await Promise.all(page.frames().map((fr) => fr.evaluate(() => [...document.querySelectorAll('video')].map((x) => ({ paused: x.paused, t: Math.round(x.currentTime * 10) / 10, muted: x.muted, vol: x.volume, src: (x.currentSrc || '').slice(0, 40) }))).catch(() => [])))).flat();
    const box = await f.evaluate(() => { const e = document.querySelector('video') || document.querySelector('[class*=xplayer i]') || document.querySelector('[class*=player i]'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }).catch(() => null);
    out.clickAt = box || 'center-fallback';
    const hb = await page.locator('iframe').boundingBox();
    await page.mouse.click(hb.x + (box ? box.x : 640), hb.y + (box ? box.y : 330)); await sleep(5000);
    out.afterClick1 = await v();
    await page.mouse.click(hb.x + (box ? box.x : 640), hb.y + (box ? box.y : 330)); await sleep(5000);
    out.afterClick2 = await v();
    out.newEvents = ev.slice(nav0);
}
out.popups = pops.length; out.popupUrls = pops.map((p) => p.url().slice(0, 80)); out.consoleBlocked = [...new Set(msgs)].slice(0, 3);
out.mediaRequests = [...media].slice(0, 6); out.topUnchanged = page.url().startsWith(HOST);
console.log(JSON.stringify(out, null, 1));
await ctx.close(); await sleep(400); try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) {}
