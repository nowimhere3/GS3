// Popout Shield R0: same sites, same clicks, two sandbox policies. Real installed Chrome (H.264 capable), fresh context per run.
// Run: node architecture-lab/popout-shield/run.mjs [siteKey ...]   (needs python -m http.server 8080 at repo root)
import { chromium } from 'playwright';
import fs from 'node:fs';
const HOST = 'http://localhost:8080/architecture-lab/popout-shield/host.html';
const POLICIES = {
    CURRENT: 'allow-same-origin allow-scripts allow-forms allow-popups',
    R0: 'allow-same-origin allow-scripts allow-forms',
};
const SITES = {
    'cloudbate-home': 'https://www.cloudbate.com/',
    'cloudbate-video': 'https://www.cloudbate.com/video/1136214/lylith-606-sex-porn-cam-05-oct-2026/',
    'xvideos.com': 'https://www.xvideos.com/video.hdktood31e6/ultra_rare_skinny_teen_anal_slut_gets_dominated',
    'xvideos.red': 'https://www.xvideos.red/video.iudovpf6236/destroying_nataly_gold_s_holes',
    xnxx: 'https://www.xnxx.com/video-1164yzbf/petite_polly_petrova_gets_hardcore_pounding_in_the_pooter_in_first_dap',
    pornhub: 'https://www.pornhub.com/view_video.php?viewkey=ph5f400e89c6cde',
    spankbang: 'https://spankbang.com/1hh0h/video/erotic+feet+piper+perri+living+photos',
    eporner: 'https://www.eporner.com/video-HmplBhciaIa/charlie-gangbang/',
    porntrex: 'https://www.porntrex.com/video/2322361/marica-shanti-gets-her-first-dvp-from-five-big-cocks',
    tnaflix: 'https://www.tnaflix.com/babe-videos/%5BLT22%5D-neli_elinek-2022-03-14-07-52-21/video7460891',
};
const only = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'.replace('no-user-gesture-required', 'document-user-activation-required')] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];

async function runOne(site, url, policyName, sandbox) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, userAgent: undefined });
    const popups = []; const blocked = []; const stripped = new Set();
    // The Human's GS3 evidently frames sites that send X-Frame-Options (cloudbate does). A stock Chrome would refuse, so this lab
    // strips X-Frame-Options / CSP frame-ancestors from third-party DOCUMENT responses (assumed equivalent of the Human's setup).
    await ctx.route('**/*', async (route) => {
        const req = route.request();
        if (req.resourceType() !== 'document' || req.url().startsWith('http://localhost')) return route.continue();
        try {
            const resp = await route.fetch(); const h = { ...resp.headers() };
            if (h['x-frame-options']) { stripped.add('X-Frame-Options:' + h['x-frame-options']); delete h['x-frame-options']; }
            if (h['content-security-policy'] && /frame-ancestors/i.test(h['content-security-policy'])) { stripped.add('CSP frame-ancestors'); h['content-security-policy'] = h['content-security-policy'].replace(/frame-ancestors[^;]*;?/gi, ''); }
            await route.fulfill({ response: resp, headers: h });
        } catch { await route.continue().catch(() => {}); }
    });
    const page = await ctx.newPage();
    ctx.on('page', (p) => popups.push(p));
    page.on('console', (m) => { const t = m.text(); if (/Blocked opening|sandbox|popup/i.test(t)) blocked.push(t.slice(0, 160)); });
    const hostUrl = `${HOST}?sandbox=${encodeURIComponent(sandbox)}&url=${encodeURIComponent(url)}`;
    const child = () => page.frames().find((f) => f !== page.mainFrame() && f.parentFrame() === page.mainFrame());
    const r = { site, policy: policyName };
    try {
        await page.goto(hostUrl, { waitUntil: 'load', timeout: 30000 });
        await sleep(6000);
        const f0 = child(); r.loadedUrl = f0 ? f0.url().slice(0, 90) : null;
        r.bodyText = f0 ? (await f0.evaluate(() => document.body ? document.body.innerText.slice(0, 80) : '').catch(() => '')) : '';
        r.title = f0 ? await f0.title().catch(() => '') : '';
        r.bodyChars = f0 ? await f0.evaluate(() => document.body ? document.body.innerText.length : 0).catch(() => -1) : -1;
        r.hasVideo = f0 ? await f0.evaluate(() => document.querySelectorAll('video').length).catch(() => -1) : -1;
        const beforeUrl = f0 ? f0.url() : null;
        // "Press Play": real trusted clicks (twice, like the Human repeating it)
        r.clickLog = [];
        for (let i = 0; i < 2; i++) {
            const f = child(); if (!f) break;
            const sels = ['video', '.vjs-big-play-button', '[class*="play" i]:not(script)', '[aria-label*="play" i]', 'button'];
            let clicked = null;
            for (const s of sels) {
                const loc = f.locator(s).first();
                if (await loc.count().catch(() => 0) && await loc.isVisible().catch(() => false)) { try { await loc.click({ timeout: 2500 }); clicked = s; break; } catch {} }
            }
            if (!clicked) { await page.mouse.click(640, 360); clicked = 'center'; }
            r.clickLog.push(clicked);
            await sleep(3500);
        }
        const f1 = child();
        r.finalUrl = f1 ? f1.url().slice(0, 90) : null;
        r.sameFrameNav = !!(beforeUrl && r.finalUrl && beforeUrl.slice(0, 90) !== r.finalUrl);
        r.topUrlChanged = page.url() !== hostUrl;
        r.playing = false;
        for (const f of page.frames()) {
            const p = await f.evaluate(() => [...document.querySelectorAll('video')].some((v) => !v.paused && v.currentTime > 0.3)).catch(() => false);
            if (p) { r.playing = true; break; }
        }
        r.popupCount = popups.length;
        r.popupUrls = [];
        for (const p of popups) { await p.waitForLoadState('domcontentloaded', { timeout: 4000 }).catch(() => {}); r.popupUrls.push(p.url().slice(0, 90)); }
        r.blockedMessages = [...new Set(blocked)].slice(0, 3); r.framingHeadersStripped = [...stripped];
        await page.screenshot({ path: new URL(`./shots/${site}-${policyName}.png`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1') }).catch(() => {});
    } catch (e) { r.error = e.message.split('\n')[0].slice(0, 120); }
    await ctx.close();
    return r;
}
fs.mkdirSync(new URL('./shots', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), { recursive: true });
for (const [site, url] of Object.entries(SITES)) {
    if (only.length && !only.includes(site)) continue;
    for (const [pn, sb] of Object.entries(POLICIES)) {
        const r = await runOne(site, url, pn, sb); results.push(r);
        console.log(JSON.stringify(r));
    }
}
fs.writeFileSync(new URL(`./results-${only.join('+') || 'all'}.json`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), JSON.stringify(results, null, 1));
await browser.close();
