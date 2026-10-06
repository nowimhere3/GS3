// Real index3.html (working tree, http://localhost:8080) + real installed Chrome + live providers.
// For each provider: assigned watch-page URL in a Panel -> press the REAL Fill button -> embed overlay -> play -> resize -> Exit.
// X-Frame-Options/CSP are stripped for third-party documents (lab stand-in for the Human's "Ignore X-Frame headers" extension).
// Run: node architecture-lab/fill-panel/verify-fill-embed.mjs [provider ...]
import { chromium } from 'playwright';
const O = 'http://localhost:8080';
import fs from 'node:fs';
const SPEC_DEFAULT = {
    'xvideos.com': 'https://www.xvideos.com/video.ufplmdf83c4/rough_use_of_a_bad_girl_s_holes_sofa_weber',
    'xvideos.red': 'https://www.xvideos.red/video.iudovpf6236/destroying_nataly_gold_s_holes',
    'xnxx.com': 'https://www.xnxx.com/video-1164yzbf/petite_polly_petrova_gets_hardcore_pounding_in_the_pooter_in_first_dap',
    'pornhub.com': 'https://www.pornhub.com/view_video.php?viewkey=ph5f400e89c6cde',
    'spankbang.com': 'https://spankbang.com/1hh0h/video/erotic+feet+piper+perri+living+photos',
    'eporner.com': 'https://www.eporner.com/video-HmplBhciaIa/charlie-gangbang/',
    'porntrex.com': 'https://www.porntrex.com/video/2322361/marica-shanti-gets-her-first-dvp-from-five-big-cocks',
    'tnaflix.com': 'https://www.tnaflix.com/babe-videos/%5BLT22%5D-neli_elinek-2022-03-14-07-52-21/video7460891',
};
const SPEC = process.env.SPEC_FILE ? JSON.parse(fs.readFileSync(process.env.SPEC_FILE, 'utf8')) : SPEC_DEFAULT;
const OTHER = 'https://www.xnxx.com/video-vp2l99b/subservient_blonde_throated_by_huge_black_cock._white_busty_girl_gagging_on_dark_meat_getting_fucked_in_her_cunt._interracial_deep_blowjob.';
const only = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ channel: 'chrome', headless: !process.env.HEADED });

async function run(name, url) {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    await ctx.route('**/*', async (route) => { const rq = route.request(); if (rq.resourceType() !== 'document' || rq.url().startsWith(O)) return route.continue();
        try { const resp = await route.fetch(); const h = { ...resp.headers() }; delete h['x-frame-options']; delete h['content-security-policy']; await route.fulfill({ response: resp, headers: h }); } catch { await route.continue().catch(() => {}); } });
    const page = await ctx.newPage(); const pops = []; ctx.on('page', (p) => { if (p !== page) pops.push(p); });
    const msgs = []; page.on('console', (m) => { const t = m.text(); if (/Blocked opening|Unsafe attempt/i.test(t)) msgs.push(t.slice(0, 120)); });
    const errs = []; page.on('pageerror', (e) => errs.push(String(e).slice(0, 120)));
    await page.addInitScript(([a, b, c]) => { if (window === window.top) localStorage.setItem('loop_matrix_urls', JSON.stringify([a, b, c])); }, [url, OTHER, '/test/fixtures/canary.html?id=C']);
    await page.goto(`${O}/index3.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelectorAll('.stream-panel iframe').length === 4);
    await sleep(5000);
    const r = { provider: name };
    const snap = () => page.evaluate(async () => {
        const gs = await import('./js/grid-session.js'); const nav = await import('./js/panel-navigation.js'); const cb = await import('./js/capability-bridge.js');
        const panel = (s) => document.querySelector(`.stream-panel[data-slot-index="${s}"]`);
        const f = (s) => panel(s).querySelector(':scope > iframe:not(.gs3-fill-embed)');
        return { assigned: f(0).getAttribute('data-last-src'), session: String(gs.getSessionUrls()[0]), iframeSrc: f(0).getAttribute('src'), gen: nav.getPanelNavigationState(0).generation,
            overlays: panel(0).querySelectorAll('.gs3-fill-embed').length, overlaySrc: panel(0).querySelector('.gs3-fill-embed')?.getAttribute('src') || null,
            btnHidden: [0, 1, 2].map((s) => panel(s).querySelector('.btn-hotswap-fill-panel').hidden), btnTitle: panel(0).querySelector('.btn-hotswap-fill-panel').title,
            state: cb.getFillPanelCapabilityState(panel(0)), other: { src: f(1).getAttribute('src'), loads: f(1).__loads || 0 }, links: f(0).getAttribute('data-last-src') };
    });
    await page.evaluate(() => { document.querySelectorAll('.stream-panel > iframe').forEach((f) => { f.__loads = 0; f.addEventListener('load', () => { f.__loads++; }); f.__marker = Math.random(); }); window.__fillIframe0 = document.querySelector('.stream-panel[data-slot-index="0"] > iframe'); });
    const before = await snap();
    r.before = { assigned: before.assigned === url, sessionSame: before.session === url, btnHidden: before.btnHidden, genBefore: before.gen };
    // press the real Fill control
    await page.evaluate(() => document.querySelector('.stream-panel[data-slot-index="0"] .btn-hotswap-fill-panel').click());
    await sleep(9000);
    const filled = await snap();
    r.fill = { overlays: filled.overlays, overlaySrc: filled.overlaySrc, buttonTitle: filled.btnTitle, assignedUnchanged: filled.assigned === url, sessionUnchanged: filled.session === url, iframeSrcUnchanged: filled.iframeSrc === before.iframeSrc, genUnchanged: filled.gen === before.gen };
    const ov = page.frames().find((fr) => fr.parentFrame() === page.mainFrame() && fr.frameElement && false);
    const overlayFrame = async () => { const h = await page.locator('.stream-panel[data-slot-index="0"] iframe.gs3-fill-embed').elementHandle(); return h ? h.contentFrame() : null; };
    const of = await overlayFrame();
    r.overlayLoaded = of ? { url: of.url().replace(/^https:\/\//, '').slice(0, 70), title: (await of.title().catch(() => '')).slice(0, 40), bodyChars: await of.evaluate(() => (document.body ? document.body.innerText.length : 0)).catch(() => -1) } : null;
    const vstate = async () => { const f2 = await overlayFrame(); if (!f2) return []; const frames = [f2, ...f2.childFrames()]; return (await Promise.all(frames.map((fr) => fr.evaluate(() => [...document.querySelectorAll('video')].map((v) => ({ paused: v.paused, t: Math.round(v.currentTime * 10) / 10, muted: v.muted, vol: v.volume, ready: v.readyState, w: v.videoWidth }))).catch(() => [])))).flat(); };
    r.videoBeforePlay = await vstate();
    const bb = async () => page.locator('.stream-panel[data-slot-index="0"] iframe.gs3-fill-embed').boundingBox();
    const ib = async () => page.evaluate(() => { const r = window.__fillIframe0.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; });
    const box = await bb();
    const near = (a, b) => a && b && Math.abs(a.x - b.x) <= 2 && Math.abs(a.y - b.y) <= 2 && Math.abs(a.width - b.w) <= 2 && Math.abs(a.height - b.h) <= 2;
    // press Play (trusted clicks on the embed player), twice with a pause between
    let played = [];
    for (let i = 0; i < 2; i++) { await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); await sleep(4500); played = await vstate(); if (played.some((v) => !v.paused)) break; }
    r.afterPlay = played;
    r.playing = played.some((v) => !v.paused && v.t > 0.3);
    r.audio = played.length ? played.map((v) => ({ muted: v.muted, volume: v.vol })) : 'no video element';
    // controls: a second click should toggle play state if the player honours click-to-pause
    if (r.playing) {
        const f2 = await overlayFrame();
        r.nativeControlsAttr = await f2.evaluate(() => [...document.querySelectorAll('video')].some((v) => v.controls)).catch(() => null);
        // hover to reveal custom controls, then click a pause-looking control (real trusted click), else fall back to centre click
        await page.mouse.move(box.x + box.width / 2, box.y + box.height - 30); await sleep(600);
        const ctl = await f2.evaluate(() => { const els = [...document.querySelectorAll('[class*="pause" i],[aria-label*="pause" i],[title*="pause" i],[class*="play-pause" i],[class*="playpause" i],[class*="vjs-play-control"],[class*="jw-icon-playback"],[class*="plyr__control"],[class*="play" i]')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 4 && r.height > 4 && getComputedStyle(e).visibility !== 'hidden'; }); const e = els.find((x) => /pause|play-?pause|playback|vjs-play-control|plyr__control/i.test(x.className + ' ' + (x.getAttribute('aria-label') || '') + ' ' + (x.title || ''))) || els[0]; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, name: (e.tagName + '.' + String(e.className).slice(0, 30)) }; }).catch(() => null);
        if (ctl) { await page.mouse.click(box.x + ctl.x, box.y + ctl.y); r.controlClicked = ctl.name; }
        else await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await sleep(1500); const after = await vstate(); r.controlToggledPause = after.some((v) => v.paused);
        await page.mouse.click(box.x + (ctl ? ctl.x : box.width / 2), box.y + (ctl ? ctl.y : box.height / 2)); await sleep(1500);
    }
    // resize while filled: real resizer drag, then viewport change
    const rz = page.locator('.resizer').first();
    const rzb = await rz.boundingBox().catch(() => null);
    r.resize = {};
    r.resize.beforeMatch = near(await bb(), await ib());
    if (rzb) { await page.mouse.move(rzb.x + rzb.width / 2, rzb.y + rzb.height / 2); await page.mouse.down(); await page.mouse.move(rzb.x + rzb.width / 2 - 160, rzb.y + rzb.height / 2, { steps: 8 }); await page.mouse.up(); await sleep(600); }
    const afterDrag = { overlay: await bb(), iframe: await ib() };
    r.resize.afterRealResizerDragMatch = near(afterDrag.overlay, afterDrag.iframe); r.resize.sizeChanged = afterDrag.iframe.w !== Math.round(box.width) || afterDrag.iframe.h !== Math.round(box.height);
    await page.setViewportSize({ width: 1200, height: 700 }); await sleep(600);
    r.resize.afterViewportChangeMatch = near(await bb(), await ib());
    await page.setViewportSize({ width: 1600, height: 900 }); await sleep(400);
    r.popups = pops.length; r.consoleBlocked = [...new Set(msgs)].slice(0, 2); r.pageErrors = errs.slice(0, 2);
    // Exit
    await page.evaluate(() => document.querySelector('.stream-panel[data-slot-index="0"] .btn-hotswap-fill-panel').click());
    await sleep(800);
    const after = await snap();
    const same = await page.evaluate(() => window.__fillIframe0 === document.querySelector('.stream-panel[data-slot-index="0"] > iframe') && window.__fillIframe0.isConnected);
    r.exit = { overlaysLeft: after.overlays, buttonTitle: after.btnTitle, sameIframeElement: same, assigned: after.assigned === url, session: after.session === url, iframeSrcUnchanged: after.iframeSrc === before.iframeSrc, genUnchanged: after.gen === before.gen };
    r.otherPanel = { srcUnchanged: after.other.src === before.other.src, reloadsDuringTest: after.other.loads };
    r.sandbox = await page.evaluate(() => [...new Set([...document.querySelectorAll('.stream-panel > iframe')].map((f) => f.getAttribute('sandbox')))]);
    console.log(JSON.stringify(r));
    await ctx.close();
    return r;
}
const all = [];
for (const [name, url] of Object.entries(SPEC)) { if (only.length && !only.includes(name)) continue; try { all.push(await run(name, url)); } catch (e) { console.log(JSON.stringify({ provider: name, error: e.message.split('\n')[0].slice(0, 150) })); } }
await browser.close();
