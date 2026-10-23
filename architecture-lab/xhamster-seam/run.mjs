// LAB ONLY. Can an MV3 declarativeNetRequest rule change the Sec-Fetch-Dest of a Panel (sub_frame) navigation?
// Real installed Chrome, temp profile, unpacked lab extension that contains a copy of the Human's "Ignore X-Frame headers" rule + one candidate.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = path.dirname(fileURLToPath(import.meta.url)).replace(/^\/([A-Za-z]:)/, '$1');
const EXT = path.join(dir, 'ext');
const HOST = 'http://localhost:8080/architecture-lab/popout-shield/host.html';
const SHIELD = 'allow-same-origin allow-scripts allow-forms';
const XH = 'https://xhamster.com/videos/small-titted-babe-enjoys-a-rough-bbc-gangbang-3298012';
const cond = { requestDomains: ['xhamster.com', '127.0.0.1'], resourceTypes: ['sub_frame'] };
const CANDS = {
    baseline: null,
    'A remove': { action: { type: 'modifyHeaders', requestHeaders: [{ header: 'Sec-Fetch-Dest', operation: 'remove' }] }, condition: cond },
    'B set document': { action: { type: 'modifyHeaders', requestHeaders: [{ header: 'Sec-Fetch-Dest', operation: 'set', value: 'document' }] }, condition: cond },
    'C set frame': { action: { type: 'modifyHeaders', requestHeaders: [{ header: 'Sec-Fetch-Dest', operation: 'set', value: 'frame' }] }, condition: cond },
};
// echo server: shows what a server actually receives from Chrome
let lastEcho = null;
const echo = http.createServer((req, res) => { lastEcho = { dest: req.headers['sec-fetch-dest'] ?? '(absent)', mode: req.headers['sec-fetch-mode'] ?? '(absent)', site: req.headers['sec-fetch-site'] ?? '(absent)' };
    res.writeHead(200, { 'content-type': 'text/html' }); res.end('<h3>echo</h3>'); });
await new Promise((r) => echo.listen(9101, '127.0.0.1', r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
for (const [name, cand] of Object.entries(CANDS)) {
    fs.writeFileSync(path.join(EXT, 'active-rules.json'), JSON.stringify({ name, candidate: cand }));
    const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'gs3-seam-'));
    const ctx = await chromium.launchPersistentContext(prof, { channel: process.env.CH || 'chromium', headless: true, viewport: { width: 1280, height: 720 },
        ignoreDefaultArgs: ['--disable-extensions'], args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--headless=new', '--disable-features=DisableLoadExtensionCommandLineSwitch'] });
    let sw = ctx.serviceWorkers()[0]; if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 10000 }).catch(() => null);
    await sleep(1500);
    const dnr = sw ? await sw.evaluate(() => self.__dnr).catch((e) => ({ err: String(e) })) : { err: 'no service worker (extension not loaded)' };
    const r = { candidate: name, dnr };
    const page = await ctx.newPage(); const pops = []; ctx.on('page', (p) => { if (p !== page) pops.push(p); });
    // (1) what a server sees
    lastEcho = null;
    await page.goto(`${HOST}?sandbox=${encodeURIComponent(SHIELD)}&url=${encodeURIComponent('http://127.0.0.1:9101/echo')}`); await sleep(1500);
    r.serverSawEcho = lastEcho;
    // (2) xHamster canonical in a shielded Panel
    const seen = [];
    page.on('response', (resp) => { const u = resp.url(); if (/xhamster\.com\/(videos|embed)\//.test(u) && resp.request().resourceType() === 'document') seen.push({ status: resp.status(), url: u.replace(/^https:\/\/xhamster\.com/, '').slice(0, 60), type: resp.request().resourceType() }); });
    const reqHdr = [];
    page.on('request', async (rq) => { if (/xhamster\.com\/videos\//.test(rq.url()) && rq.resourceType() === 'document') { const h = await rq.allHeaders().catch(() => ({})); reqHdr.push({ dest: h['sec-fetch-dest'] ?? '(absent)', mode: h['sec-fetch-mode'], isFrame: !!rq.frame().parentFrame() }); } });
    await page.goto(`${HOST}?sandbox=${encodeURIComponent(SHIELD)}&url=${encodeURIComponent(XH)}`, { waitUntil: 'load' }).catch(() => {});
    await sleep(8000);
    const f = page.frames().find((x) => x.parentFrame() === page.mainFrame());
    r.xhamsterRequest = reqHdr[0] || null; r.xhamsterResponses = seen.slice(0, 3); r.finalPanelUrl = f ? f.url().replace(/^https:\/\/xhamster\.com/, '').slice(0, 70) : null;
    r.fullPage = !!(f && /\/videos\//.test(f.url()) && !/\/embed\//.test(f.url()));
    if (r.fullPage) {
        r.player = await f.evaluate(() => ({ videos: document.querySelectorAll('video').length, title: document.title.slice(0, 50), playish: [...document.querySelectorAll('[class*=play i],[class*=player i]')].filter((e) => e.offsetParent).slice(0, 4).map((e) => e.tagName + '.' + String(e.className).slice(0, 30)) })).catch(() => null);
        const nav = []; page.on('framenavigated', (fr) => nav.push(fr.url().slice(0, 80)));
        await page.mouse.click(640, 330); await sleep(5000); await page.mouse.click(640, 330); await sleep(4000);
        const vids = (await Promise.all(page.frames().map((fr) => fr.evaluate(() => [...document.querySelectorAll('video')].map((v) => ({ paused: v.paused, t: Math.round(v.currentTime * 10) / 10 }))).catch(() => [])))).flat();
        r.afterPlay = { videos: vids, popups: pops.length, panelUrl: (page.frames().find((x) => x.parentFrame() === page.mainFrame()) || f).url().slice(0, 80), frameNavs: nav.slice(0, 4), topUnchanged: page.url().startsWith(HOST) };
    }
    console.log(JSON.stringify(r, null, 1));
    results.push(r);
    await ctx.close(); await sleep(500); try { fs.rmSync(prof, { recursive: true, force: true }); } catch {}
}
fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(results, null, 1));
echo.close();
