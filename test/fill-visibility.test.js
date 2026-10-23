import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

// Settings answers WHERE Fill may appear; the Runtime answers whether Fill is available for THIS Panel now.
// configured + supported => every configured projection visible; configured + unsupported => all hidden.
// These tests drive the real Runtime projection path (index3.html, real Top/Runway/Deep Cuts builders, real
// assignment through Edit URL), not synthetic capability state.

const PORT = 4176;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const ORDER = ['toggle', 'folder', 'star', 'shuffle', 'shuffleAll', 'fillPanel', 'reload', 'launchpad', 'delete', 'kill', 'purge'];
const XVIDEOS = 'https://www.xvideos.com/video.zq9x81k/some_slug';
const XNXX = 'https://www.xnxx.com/video-9a8b7c6/some_slug';
const XHAMSTER = 'https://xhamster.com/videos/some-slug-3298012';
const UNSUPPORTED = 'https://example.com/some/page';
let server;
let browser;

function startServer() {
    const child = spawn(process.platform === 'win32' ? 'python' : 'python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: process.cwd(), stdio: 'ignore' });
    return new Promise((resolve, reject) => {
        child.once('error', reject);
        const deadline = Date.now() + 5000;
        const probe = async () => {
            try { const response = await fetch(ORIGIN); await response.arrayBuffer(); if (response.ok) return resolve(child); } catch {}
            if (Date.now() >= deadline) return reject(new Error('HTTP test server did not start'));
            setTimeout(probe, 50);
        };
        probe();
    });
}

before(async () => { server = await startServer(); browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); server?.kill(); });

/** Boot index3 with Fill configured at position 6 and the given Top / Runway counts. */
async function boot({ topCount, runwayCount, firstUrl = UNSUPPORTED }) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    page.setDefaultTimeout(5000);
    await page.route(/^https?:\/\/(?!127\.0\.0\.1:4176).*/, (route) => route.fulfill({ status: 204, body: '<html></html>', contentType: 'text/html' }));
    await page.addInitScript(([order, top, runway, url]) => {
        if (window !== window.top) return;
        const set = (key, value) => localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
        set('hotswap_action_order', order); set('hotswap_top_count', String(top));
        set('hotswap_quick_actions_enabled', 'true'); set('hotswap_quick_action_count', String(runway)); set('hotswap_quick_action_order', order);
        set('loop_matrix_urls', [url, '/test/fixtures/canary.html?id=B', '/test/fixtures/canary.html?id=C']);
    }, [ORDER, topCount, runwayCount, firstUrl]);
    await page.goto(`${ORIGIN}/index3.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelectorAll('.stream-panel iframe').length === 4);
    await page.waitForTimeout(300);
    return page;
}

const projections = (page) => page.evaluate(() => {
    const panel = document.querySelector('.stream-panel[data-slot-index="0"]');
    const state = (el) => (!el ? 'absent' : (el.hidden || getComputedStyle(el).display === 'none') ? 'hidden' : 'visible');
    return {
        canonical: state(panel.querySelector('.hotswap-overlay .btn-hotswap-fill-panel')),
        top: state(panel.querySelector('.hotswap-top-shortcuts [data-action-key="fillPanel"]')),
        runway: state(panel.querySelector('.hotswap-runway [data-action-key="fillPanel"]')),
    };
});

async function assign(page, url) {
    await page.evaluate(async (target) => {
        const panel = document.querySelector('.stream-panel[data-slot-index="0"]');
        panel.querySelector('.btn-hotswap-toggle').click();
        const input = panel.querySelector('.hotswap-input');
        input.value = target;
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 400));
    }, url);
}

test('unproven Bundle 2 providers hide Fill in the same live Panel between supported assignments', async () => {
    const page = await boot({ topCount: 8, runwayCount: 8 });
    for (const url of [
        'https://xhomealone.com/videos/162980/meadowthayer-chaturbate-cam-clip-live-cams-panties/',
        'https://cumcams.cc/video/190505100/play',
        'https://www.camwhoreshd.com/videos/1892550/neli-elinek-armpits-4-0f973bf750cd54bd/',
    ]) {
        await assign(page, XVIDEOS);
        let state = await projections(page);
        assert.equal(state.top, 'visible');
        assert.equal(state.runway, 'visible');
        await assign(page, url);
        assert.deepEqual(await projections(page), { canonical: 'hidden', top: 'hidden', runway: 'hidden' }, url);
        assert.equal(await page.evaluate(() => document.querySelector('.stream-panel[data-slot-index="0"] > iframe').getAttribute('data-last-src')), url);
        await assign(page, XNXX);
        state = await projections(page);
        assert.equal(state.top, 'visible');
        assert.equal(state.runway, 'visible');
    }
    await page.close();
});

test('Fill in Top + Runway: hidden for unsupported, visible for supported, re-derived on every assignment (no Runtime reload)', async () => {
    const page = await boot({ topCount: 8, runwayCount: 8 });
    // configured + unsupported
    assert.deepEqual(await projections(page), { canonical: 'hidden', top: 'hidden', runway: 'hidden' }, 'boot with an unsupported URL');
    await assign(page, XHAMSTER);
    assert.deepEqual(await projections(page), { canonical: 'hidden', top: 'hidden', runway: 'hidden' }, 'xHamster is unsupported');
    await assign(page, XVIDEOS);
    let p = await projections(page);
    assert.equal(p.top, 'visible', 'Top shortcut visible for a supported URL');
    assert.equal(p.runway, 'visible', 'Runway shortcut visible for a supported URL');
    assert.equal(p.canonical, 'hidden', 'canonical tray button is Deep Cuts only: inside the Top cutoff it stays out of the tray');
    await assign(page, UNSUPPORTED);
    assert.deepEqual(await projections(page), { canonical: 'hidden', top: 'hidden', runway: 'hidden' }, 'back to unsupported');
    await assign(page, XNXX);
    p = await projections(page);
    assert.equal(p.top, 'visible', 'second supported provider, Top');
    assert.equal(p.runway, 'visible', 'second supported provider, Runway');
    await page.close();
});

test('real library shapes (legacy xvideos, eporner /hd-porn/, m.tnaflix) show Fill; search/playlist/favorite pages do not — in one live Panel', async () => {
    const page = await boot({ topCount: 8, runwayCount: 8 });
    const visible = async () => { const p = await projections(page); return p.top === 'visible' && p.runway === 'visible'; };
    const hidden = async () => { const p = await projections(page); return p.top === 'hidden' && p.runway === 'hidden'; };
    for (const [url, expectVisible] of [
        ['https://www.xvideos.com/video7461269/mary_anne_black_attack_gangbang', true],
        ['https://www.xvideos.com/favorite/83907575/high_as_hell', false],
        ['https://www.eporner.com/hd-porn/2KQFuGdodJO/Extreme-fuck-and-BJ/', true],
        ['https://www.eporner.com/cat/group-sex/13/', false],
        ['https://m.tnaflix.com/anal-porn/Skinny-Schoolgirl/video7123328', true],
        ['https://spankbang.com/8mh1c-fkw7k5/playlist/1feet+playlist', false],
        ['https://de.xvideos.com/video.uavehkb6ea2/slug', true],
        ['https://www.wxx.wtf/videos/96805/blondiekayy-slug/', true],
        ['http://www.wxx.wtf/search/blondiekayy/', false],
    ]) {
        await assign(page, url);
        assert.equal(expectVisible ? await visible() : await hidden(), true, `${url} -> Fill ${expectVisible ? 'visible' : 'hidden'}`);
    }
    await page.close();
});

test('Fill beyond the Top and Runway cutoff appears only in Deep Cuts, and only when supported', async () => {
    const page = await boot({ topCount: 2, runwayCount: 2 });
    assert.deepEqual(await projections(page), { canonical: 'hidden', top: 'absent', runway: 'absent' }, 'unsupported: hidden even in Deep Cuts');
    await assign(page, XVIDEOS);
    assert.deepEqual(await projections(page), { canonical: 'visible', top: 'absent', runway: 'absent' }, 'supported: Deep Cuts only');
    await assign(page, XHAMSTER);
    assert.deepEqual(await projections(page), { canonical: 'hidden', top: 'absent', runway: 'absent' }, 'unsupported again');
    await page.close();
});

test('Top, Runway and Deep Cuts all run the SAME Fill executor and produce the same overlay', async () => {
    const expected = 'https://www.xvideos.com/embedframe/zq9x81k';
    const overlay = (page) => page.evaluate(() => [...document.querySelectorAll('.stream-panel[data-slot-index="0"] .gs3-fill-embed')].map((f) => f.getAttribute('src')));
    const press = (page, selector) => page.evaluate((s) => document.querySelector(`.stream-panel[data-slot-index="0"] ${s}`).click(), selector);

    const wide = await boot({ topCount: 8, runwayCount: 8, firstUrl: XVIDEOS });
    for (const [label, selector] of [['Top', '.hotswap-top-shortcuts [data-action-key="fillPanel"]'], ['Runway', '.hotswap-runway [data-action-key="fillPanel"]']]) {
        await press(wide, selector);
        assert.deepEqual(await overlay(wide), [expected], `${label} opens the overlay`);
        await press(wide, selector);
        assert.deepEqual(await overlay(wide), [], `${label} exits it again`);
    }
    await wide.close();

    const narrow = await boot({ topCount: 2, runwayCount: 2, firstUrl: XVIDEOS });
    await press(narrow, '.hotswap-overlay .btn-hotswap-fill-panel');
    assert.deepEqual(await overlay(narrow), [expected], 'Deep Cuts opens the same overlay');
    await press(narrow, '.hotswap-overlay .btn-hotswap-fill-panel');
    assert.deepEqual(await overlay(narrow), [], 'Deep Cuts exits it again');
    await narrow.close();
});

test('assignment is never mutated by Fill availability or Fill itself', async () => {
    const page = await boot({ topCount: 8, runwayCount: 8, firstUrl: XVIDEOS });
    await page.evaluate(() => document.querySelector('.stream-panel[data-slot-index="0"] .hotswap-top-shortcuts [data-action-key="fillPanel"]').click());
    const during = await page.evaluate(() => document.querySelector('.stream-panel[data-slot-index="0"] > iframe:not(.gs3-fill-embed)').getAttribute('data-last-src'));
    assert.equal(during, XVIDEOS);
    await page.close();
});

test('new providers re-derive Fill in the same live Panel; executor preserves identity, shield and Exit', async () => {
    const page = await boot({ topCount: 8, runwayCount: 8 });
    for (const [origin, id] of [['https://xcamladyx.com', '270156'], ['https://stream-leak.com', '156860'], ['https://www.webpussi.com', '57354']]) {
        const url = `${origin}/videos/${id}/specimen/?source=library#t=9`;
        for (const candidate of [url, origin + '/search/person/', url]) {
            await assign(page, candidate);
            const p = await projections(page);
            const expected = candidate === url ? 'visible' : 'hidden';
            assert.equal(p.top, expected);
            assert.equal(p.runway, expected);
        }
        const before = await page.evaluate(async () => {
            const panel = document.querySelector('.stream-panel[data-slot-index="0"]');
            window.__providerOriginal = panel.querySelector('iframe');
            return { src: window.__providerOriginal.src, assigned: window.__providerOriginal.getAttribute('data-last-src'), session: (await import('./js/grid-session.js')).getSessionUrls()[0] };
        });
        await page.evaluate(() => document.querySelector('.stream-panel[data-slot-index="0"] .hotswap-top-shortcuts [data-action-key="fillPanel"]').click());
        const filled = await page.evaluate(() => {
            const f = document.querySelector('.stream-panel[data-slot-index="0"] .gs3-fill-embed');
            return {src:f.src, sandbox:f.getAttribute('sandbox'), assigned:window.__providerOriginal.getAttribute('data-last-src')};
        });
        assert.equal(filled.src, `${origin}/embed/${id}`);
        assert.equal(filled.sandbox, 'allow-same-origin allow-scripts allow-forms');
        assert.equal(filled.assigned, url);
        await page.evaluate(() => document.querySelector('.stream-panel[data-slot-index="0"] .hotswap-runway [data-action-key="fillPanel"]').click());
        const after = await page.evaluate(async () => ({src:window.__providerOriginal.src, assigned:window.__providerOriginal.getAttribute('data-last-src'), session:(await import('./js/grid-session.js')).getSessionUrls()[0], same:window.__providerOriginal === document.querySelector('.stream-panel[data-slot-index="0"] > iframe'), overlays:document.querySelectorAll('.gs3-fill-embed').length}));
        assert.deepEqual({src:after.src,assigned:after.assigned,session:after.session},before);
        assert.equal(after.same,true);
        assert.equal(after.overlays,0);
    }
    await page.close();
});

test('SpankBang crop keeps the measured 90vh player and controls inside the Panel at fractional sizes; Exit removes the viewport', async () => {
    const url = 'https://spankbang.com/5dew5/video/zelda';
    const page = await boot({ topCount: 8, runwayCount: 8, firstUrl: url });
    // Controlled provider geometry fixture models the measured CSS, without
    // confusing a network/Cloudflare failure with a clipping regression.
    await page.route('https://spankbang.com/*/embed/', route => route.fulfill({contentType:'text/html',body:'<!doctype html><style>html,body{margin:0}main{height:90vh;position:relative;background:black}button{position:absolute;bottom:0;left:0;height:30px}aside{height:10vh}</style><main><button onclick="this.dataset.clicked=\'yes\'">Pause</button></main><aside>Provider footer</aside>'}));
    await page.evaluate(() => { const p=document.querySelector('.stream-panel[data-slot-index="0"]');window.__cropOriginal=p.querySelector('iframe');p.querySelector('.hotswap-top-shortcuts [data-action-key="fillPanel"]').click(); });
    const overlay = page.locator('.gs3-fill-embed');
    const frame = await (await overlay.elementHandle()).contentFrame();
    await frame.waitForSelector('main');
    const beforeDrag=await page.locator('.gs3-fill-viewport').boundingBox();
    const seam=await page.locator('.resizer-v').first().boundingBox();
    assert.ok(seam,'real Position resizer available');
    await page.mouse.move(seam.x+seam.width/2,seam.y+seam.height/4);
    await page.mouse.down();
    for (const offset of [40,80,120]) {
        await page.mouse.move(seam.x+seam.width/2+offset,seam.y+seam.height/4);
        const clip=await page.locator('.gs3-fill-viewport').boundingBox();
        const footer=await frame.locator('aside').boundingBox();
        assert.ok(footer.y >= clip.y+clip.height,'no footer leak during Position drag');
    }
    await page.mouse.up();
    assert.notEqual((await page.locator('.gs3-fill-viewport').boundingBox()).width,beforeDrag.width,'Position resized while Filled');
    for (const size of [{width:1600,height:900},{width:1200,height:700},{width:903,height:603}]) {
        await page.setViewportSize(size);
        const clip=await page.locator('.gs3-fill-viewport').boundingBox();
        const player=await frame.locator('main').boundingBox();
        const footer=await frame.locator('aside').boundingBox();
        const controls=await frame.locator('button').boundingBox();
        assert.ok(Math.abs(player.height-clip.height)<2,'player fills clip');
        assert.ok(footer.y >= clip.y+clip.height,'footer fully outside clip');
        assert.ok(controls.y+controls.height <= clip.y+clip.height+2,'controls remain visible');
        await frame.locator('button').click();
        assert.equal(await frame.locator('button').getAttribute('data-clicked'),'yes');
    }
    await page.evaluate(() => document.querySelector('.stream-panel[data-slot-index="0"] .btn-hotswap-fill-panel').click());
    assert.equal(await page.locator('.gs3-fill-embed,.gs3-fill-viewport').count(),0);
    assert.equal(await page.evaluate(() => window.__cropOriginal===document.querySelector('.stream-panel[data-slot-index="0"] > iframe')&&window.__cropOriginal.getAttribute('data-last-src')),url);
    await page.evaluate(() => document.querySelector('.stream-panel[data-slot-index="0"] .btn-hotswap-fill-panel').click());
    await assign(page, 'https://example.com/new-content/');
    assert.equal(await page.locator('.gs3-fill-embed,.gs3-fill-viewport').count(),0,'new content clears the old crop');
    await assign(page, XVIDEOS);
    await page.evaluate(() => document.querySelector('.stream-panel[data-slot-index="0"] .hotswap-top-shortcuts [data-action-key="fillPanel"]').click());
    assert.equal(await page.locator('.gs3-fill-viewport').count(),0,'other providers retain their original geometry');
    assert.equal(await page.locator('.gs3-fill-embed').count(),1);
    await page.close();
});
