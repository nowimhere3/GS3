import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const ORIGIN = 'http://127.0.0.1:4208';
const STUB = 'http://localhost:4208/test/fixtures/gallery-capability-stub.html';
let server, browser;
before(async () => {
    server = spawn(process.platform === 'win32' ? 'python' : 'python3',
        ['-m', 'http.server', '4208', '--bind', '127.0.0.1'], { stdio: 'ignore' });
    const deadline = Date.now() + 5000;
    while (true) {
        try { const r = await fetch(ORIGIN); await r.arrayBuffer(); if (r.ok) break; } catch {}
        if (Date.now() > deadline) throw new Error('test server unavailable');
        await new Promise(r => setTimeout(r, 50));
    }
    browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); server?.kill(); });

async function newContext() {
    const context = await browser.newContext();
    await context.route(/^https?:\/\/(?!127\.0\.0\.1:4208|localhost:4208).*/, r => r.fulfill({ status: 204, body: '' }));
    return context;
}

/** urls: panel URLs for slots 0.. (stub url fragments or '' for canary). Does NOT clear storage. */
async function openRuntime(context, urls) {
    const page = await context.newPage();
    page.setDefaultTimeout(6000);
    await page.addInitScript(list => {
        if (window !== top) return;
        localStorage.setItem('loop_matrix_urls', JSON.stringify(list));
    }, urls.map((u, i) => u ? STUB + u : '/test/fixtures/canary.html?id=plain' + i));
    await page.goto(ORIGIN + '/index3.html?workspace=live', { waitUntil: 'networkidle' });
    await page.evaluate(async () => {
        window.gallery = await import('./js/gallery-favorite-bridge.js');
        window.launch = await import('./js/launch.js');
        window.panels = [...document.querySelectorAll('.stream-panel')];
    });
    return page;
}
const floatBtns = page => page.locator('#floating-hearts-body button').allTextContents();
const bottomBtns = page => page.locator('#master-hearts-body button').allTextContents();
const showFloating = async page => {
    await page.locator('#btn-toggle-master').click();
    await page.locator('#btn-master-overflow').click();
    await page.locator('#btn-master-floating-hearts').click();
};
const expandFloating = async page => {
    if (await page.locator('#floating-hearts').getAttribute('data-open') !== 'true') await page.locator('#btn-floating-hearts-toggle').click();
};
const stubFrame = (page, key) => page.frames().find(f => f.url().includes(key));

test('permanent station: opens and closes with zero Galleries, shows no fake hearts, populates and empties live', async () => {
    const context = await newContext();
    const page = await openRuntime(context, ['', '']);
    try {
        assert.equal(await page.locator('#floating-hearts').isVisible(), false);
        await showFloating(page);
        assert.equal(await page.locator('#floating-hearts').isVisible(), true);
        assert.equal(await page.locator('#master-hearts-group').isVisible(), false); // bottom group still hides
        assert.match(await page.locator('#btn-floating-hearts-toggle').textContent(), /◀ ❤/);
        await expandFloating(page);
        assert.deepEqual(await floatBtns(page), []);
        assert.equal(await page.locator('#floating-hearts').isVisible(), true);

        await page.evaluate(() => launch.updateRenderedPanel(panels[0], { url: '/test/fixtures/gallery-capability-stub.html?state=unfav' }));
        // Same-origin stub is not on the trusted localhost list? 127.0.0.1 http is allowed by policy.
        await page.waitForFunction(() => document.querySelector('#floating-hearts-body button'));
        assert.deepEqual(await floatBtns(page), ['♡1']);
        assert.deepEqual(await bottomBtns(page), ['♡1']);

        await page.evaluate(() => launch.updateRenderedPanel(panels[0], { url: '/test/fixtures/canary.html?gone=1' }));
        await page.waitForFunction(() => !document.querySelector('#floating-hearts-body button'));
        assert.equal(await page.locator('#floating-hearts').isVisible(), true); // station remains

        // Open preference persists; Close hides and persists.
        assert.equal(await page.evaluate(() => localStorage.getItem('floating_heart_bar_open')), 'true');
        await page.reload({ waitUntil: 'networkidle' });
        assert.equal(await page.locator('#floating-hearts').isVisible(), true);
        await page.locator('#btn-floating-hearts-close').click();
        assert.equal(await page.locator('#floating-hearts').isVisible(), false);
        assert.equal(await page.evaluate(() => localStorage.getItem('floating_heart_bar_open')), 'false');
    } finally { await context.close(); }
});

test('floating and bottom MultiHeart share one projection: glyphs, Gallery-local changes, no-media, unknown, Position following', async () => {
    const context = await newContext();
    const page = await openRuntime(context, ['?state=fav', '', '?state=unfav&third=1']);
    try {
        await page.waitForFunction(() => gallery.getGalleryFavoriteState(panels[0]) && gallery.getGalleryFavoriteState(panels[2]));
        await showFloating(page);
        await page.locator('#btn-master-hearts-toggle').click();
        await expandFloating(page);
        assert.deepEqual(await floatBtns(page), ['♥1', '♡3']);
        assert.deepEqual(await bottomBtns(page), ['♥1', '♡3']);
        assert.equal(await page.locator('#floating-hearts-body [data-position="1"] .heart-glyph').evaluate(n => getComputedStyle(n).color), 'rgb(255, 59, 78)');

        const first = stubFrame(page, 'state=fav');
        const third = stubFrame(page, 'third=1');
        await first.evaluate(() => publishState({ mediaKey: 'k2', isFavorite: false }));   // media change
        await page.waitForFunction(() => document.querySelector('#floating-hearts-body [data-position="1"]').textContent === '♡1');
        assert.deepEqual(await bottomBtns(page), ['♡1', '♡3']);
        await third.evaluate(() => publishState({ isFavorite: true }));                     // Gallery-local favorite
        await page.waitForFunction(() => document.querySelector('#floating-hearts-body [data-position="3"]').textContent === '♥3');
        assert.deepEqual(await bottomBtns(page), ['♡1', '♥3']);

        await first.evaluate(() => publishState({ hasMedia: false, mediaKey: null, isFavorite: false }));
        await page.waitForFunction(() => document.querySelector('#floating-hearts-body [data-position="1"]').dataset.favoriteState === 'no-media');
        assert.equal(await page.locator('#floating-hearts-body [data-position="1"]').isDisabled(), true);
        assert.equal(await page.locator('#floating-hearts-body [data-position="1"]').textContent(), '❤1');

        // Panel moves Position 1 <-> 3: truth follows the Panel on both surfaces.
        await page.evaluate(async () => {
            (await import('./js/grid-session.js')).setSessionArrangement(['screen3', 'screen2', 'screen1', 'screen4']);
        });
        await third.evaluate(() => publishState({ mediaKey: 'k7', isFavorite: true }));
        await page.waitForFunction(() => document.querySelector('#floating-hearts-body [data-position="1"]').textContent === '♥1');
        assert.deepEqual(await floatBtns(page), ['♥1', '❤3']);
        assert.deepEqual(await bottomBtns(page), ['♥1', '❤3']);

        // Older Gallery (favoriteCurrent only): neutral, still actionable.
        await page.evaluate(() => launch.updateRenderedPanel(panels[1], { url: '/test/fixtures/gallery-capability-stub.html?auto=1&second=1' }));
        await page.waitForFunction(() => document.querySelectorAll('#floating-hearts-body button').length === 3);
        const old = page.locator('#floating-hearts-body [data-position="2"]');
        assert.equal(await old.textContent(), '❤2');
        assert.equal(await old.isDisabled(), false);
    } finally { await context.close(); }
});

test('floating click uses the canonical action: click-time Position, idempotent, shared busy, no direct postMessage', async () => {
    const source = await readFile('js/triple-mode.js', 'utf8');
    const installer = source.slice(source.indexOf('function _installFloatingHearts'), source.indexOf('async function _favoriteAtPosition'));
    assert.ok(installer.length > 200 && !/postMessage/.test(installer));

    const context = await newContext();
    const page = await openRuntime(context, ['?state=unfav', '', '?state=fav&third=1']);
    try {
        await page.waitForFunction(() => gallery.getGalleryFavoriteState(panels[0]) && gallery.getGalleryFavoriteState(panels[2]));
        await showFloating(page);
        await page.locator('#btn-master-hearts-toggle').click();
        await expandFloating(page);
        const first = stubFrame(page, 'state=unfav');
        const third = stubFrame(page, 'third=1');
        const snapshot = () => page.evaluate(async () => {
            const s = await import('./js/grid-session.js');
            const ls = Object.fromEntries(Object.entries(localStorage).filter(([k]) => !k.startsWith('floating_heart')));
            return JSON.stringify({ ls, history: s.getGridHistory().length, urls: s.getSessionUrls(), layout: s.getSessionLayout() });
        });
        const before = await snapshot();

        // Position 1 is re-pointed to the third Panel without a render: click must resolve NOW.
        await page.evaluate(async () => {
            (await import('./js/grid-session.js')).setSessionArrangement(['screen3', 'screen2', 'screen1', 'screen4']);
        });
        for (const f of [first, third]) await f.evaluate(() => { window.holdResults = true; });
        await page.locator('#floating-hearts-body [data-position="1"]').click();
        await third.waitForFunction(() => commands.length === 1);
        assert.equal(await first.evaluate(() => commands.length), 0);
        // Busy is shared: the same pending Panel is disabled on both surfaces.
        await page.waitForFunction(() => document.querySelector('#floating-hearts-body [data-position="1"]').disabled);
        const pendingPosition = await page.evaluate(() => [...document.querySelectorAll('#master-hearts-body button')].filter(b => b.disabled).length);
        assert.ok(pendingPosition >= 1);
        await page.locator('#floating-hearts-body [data-position="1"]').dispatchEvent('click');
        assert.equal(await third.evaluate(() => commands.length), 1);
        // Separate Panel stays independently actionable.
        await page.locator('#floating-hearts-body [data-position="3"]').click();
        await first.waitForFunction(() => commands.length === 1);

        // Already-favorite result is a no-op for visual truth: the heart stays filled (never toggles).
        await third.evaluate(() => reply(commands[0], 'already-favorite'));
        await first.evaluate(() => reply(commands[0], 'favorited'));
        await page.waitForFunction(() => document.querySelector('#floating-hearts-body [data-position="1"]') && !document.querySelector('#floating-hearts-body [data-position="1"]').disabled);
        assert.equal(await page.locator('#floating-hearts-body [data-position="1"]').textContent(), '♥1');
        assert.equal(await page.locator('#floating-hearts-body [data-position="3"]').textContent(), '♡3'); // ack alone changes nothing

        assert.equal(await snapshot(), before); // no Runtime history/session/layout/storage mutation
    } finally { await context.close(); }
});

test('floating bar is an overlay: drag stays in viewport and Runtime geometry, toolbar row and Dock reserve are untouched', async () => {
    const context = await newContext();
    const page = await openRuntime(context, ['?state=unfav', '']);
    try {
        await page.locator('#btn-toggle-master').click();
        await page.waitForTimeout(450); // let the bar finish its slide-in before measuring
        const geometry = () => page.evaluate(() => JSON.stringify([
            document.querySelector('#master-bar').getBoundingClientRect().toJSON(),
            document.documentElement.style.getPropertyValue('--gs3-dock-reserve'),
            ...[...document.querySelectorAll('.stream-slot')].map(n => n.getBoundingClientRect().toJSON()),
        ]));
        const before = await geometry();
        await page.locator('#btn-master-overflow').click();
        await page.locator('#btn-master-floating-hearts').click();
        await page.keyboard.press('Escape');
        const afterOpen = await geometry();
        assert.equal(afterOpen, before);
        await expandFloating(page);
        const grip = await page.locator('#floating-hearts-grip').boundingBox();
        const start = await page.locator('#floating-hearts').boundingBox();
        await page.mouse.move(grip.x + 4, grip.y + 4);
        await page.mouse.down();
        await page.mouse.move(grip.x - 200, grip.y - 150, { steps: 5 });
        await page.mouse.up();
        const moved = await page.locator('#floating-hearts').boundingBox();
        assert.ok(Math.abs(moved.x - start.x) > 100 && Math.abs(moved.y - start.y) > 80);
        // Beyond the edge it stays inside the viewport.
        await page.mouse.move(moved.x + 4, moved.y + 4);
        await page.mouse.down();
        await page.mouse.move(-500, -500, { steps: 3 });
        await page.mouse.up();
        const clamped = await page.locator('#floating-hearts').boundingBox();
        assert.ok(clamped.x >= 0 && clamped.y >= 0);
        assert.equal(await geometry(), before);
        // Dragging never activates a heart (no command sent).
        assert.equal(await stubFrame(page, 'state=unfav').evaluate(() => commands.length), 0);
        // Toolbar remains a single row.
        const rows = await page.locator('.master-shell-content > *').evaluateAll(nodes =>
            new Set(nodes.filter(n => n.getBoundingClientRect().height > 0).map(n => Math.round(n.getBoundingClientRect().top / 10))).size);
        assert.ok(rows <= 2);
    } finally { await context.close(); }
});

test('Settings -> Ghost Mode: Floating Heart Bar Opacity persists, affects only the floating bar, is recoverable', async () => {
    const context = await newContext();
    const runtime = await openRuntime(context, ['?state=unfav', '']);
    try {
        await showFloating(runtime);
        const opacity = sel => runtime.locator(sel).evaluate(n => getComputedStyle(n).opacity);
        assert.equal(await opacity('#floating-hearts'), '1');

        const settings = await context.newPage();
        await settings.goto(ORIGIN + '/settings.html', { waitUntil: 'networkidle' });
        const card = settings.locator('.config-card[data-section="ghost"]');
        assert.ok((await card.textContent()).includes('Floating Heart Bar Opacity'));
        const ghostBefore = await settings.evaluate(() => [localStorage.getItem('hotswap_ghost_opacity'), localStorage.getItem('hotswap_hover_opacity'), localStorage.getItem('hotswap_ghost_targets')]);
        const slider = settings.locator('#floating-heart-opacity-slider');
        assert.equal(await slider.inputValue(), '100');

        await settings.locator('#floating-heart-opacity-input').fill('30');
        await settings.locator('#floating-heart-opacity-input').blur();
        assert.equal(await settings.evaluate(() => localStorage.getItem('floating_heart_bar_opacity')), '30'); // canonical Store key
        assert.deepEqual(await settings.evaluate(() => [localStorage.getItem('hotswap_ghost_opacity'), localStorage.getItem('hotswap_hover_opacity'), localStorage.getItem('hotswap_ghost_targets')]), ghostBefore);

        // Open Runtime follows live (storage event); only the floating bar changes.
        await runtime.waitForFunction(() => getComputedStyle(document.querySelector('#floating-hearts')).opacity === '0.3');
        assert.equal(await opacity('#master-bar'), '1');
        assert.equal(await opacity('.stream-slot iframe >> nth=0'), '1');
        assert.equal(await opacity('#orchestration-dock'), '1');

        // Persists across reload (head script, before first paint).
        await runtime.reload({ waitUntil: 'networkidle' });
        assert.equal(await opacity('#floating-hearts'), '0.3');
        // Hover/focus gives it back full opacity.
        await runtime.locator('#floating-hearts').hover();
        assert.equal(await opacity('#floating-hearts'), '1');

        // Very low value, then recover through Settings (not through the bar).
        await settings.locator('#floating-heart-opacity-slider').fill('0');
        assert.equal(await settings.evaluate(() => localStorage.getItem('floating_heart_bar_opacity')), '0');
        await settings.reload({ waitUntil: 'networkidle' });
        assert.equal(await settings.locator('#floating-heart-opacity-slider').inputValue(), '0');
        await settings.locator('#floating-heart-opacity-slider').fill('100');
        await runtime.mouse.move(5, 5);
        await runtime.waitForFunction(() => getComputedStyle(document.querySelector('#floating-hearts')).opacity === '1');
    } finally { await context.close(); }
});
