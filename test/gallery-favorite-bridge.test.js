import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const ORIGIN = 'http://127.0.0.1:4203';
let server, browser;
before(async () => {
    server = spawn(process.platform === 'win32' ? 'python' : 'python3',
        ['-m', 'http.server', '4203', '--bind', '127.0.0.1'], { stdio: 'ignore' });
    const deadline = Date.now() + 5000;
    while (true) {
        try { const r = await fetch(ORIGIN); await r.arrayBuffer(); if (r.ok) break; } catch {}
        if (Date.now() > deadline) throw new Error('Gallery test server unavailable');
        await new Promise(r => setTimeout(r, 50));
    }
    browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); server?.kill(); });

async function boot() {
    const page = await browser.newPage();
    page.setDefaultTimeout(6000);
    await page.route(/^https?:\/\/(?!127\.0\.0\.1:4203|localhost:4203).*/, r => r.fulfill({ status: 204, body: '' }));
    await page.addInitScript(() => {
        if (window !== top) return;
        localStorage.clear();
        localStorage.setItem('loop_matrix_urls', JSON.stringify([
            'http://localhost:4203/test/fixtures/gallery-capability-stub.html',
            '/test/fixtures/canary.html?id=gallery-lookalike',
        ]));
    });
    await page.goto(ORIGIN + '/index3.html?workspace=live', { waitUntil: 'networkidle' });
    await page.evaluate(async () => {
        window.gallery = await import('./js/gallery-favorite-bridge.js');
        window.panels = [...document.querySelectorAll('.stream-panel')];
        window.changes = 0;
        document.addEventListener(gallery.GALLERY_CAPABILITY_CHANGED, () => changes++);
    });
    const frame = page.frames().find(f => f.url().includes('gallery-capability-stub'));
    await frame.waitForFunction(() => queries.length > 0);
    return { page, frame };
}
const state = page => page.evaluate(() => gallery.getGalleryFavoriteCapability(panels[0]));
const waitPresent = page => page.waitForFunction(() => gallery.isGalleryFavoriteCapable(panels[0]));

test('Gallery explicit cross-origin handshake is panel-local, retains features and deduplicates notifications', async () => {
    const { page, frame } = await boot();
    try {
        assert.equal((await state(page)).capable, false);
        const before = await page.evaluate(async () => {
            window.session = await import('./js/grid-session.js');
            window.snapshot = () => JSON.stringify([session.getSessionPanels(), session.getSessionLayout(),
                session.getSessionArrangement(), session.getGridHistory(), { ...localStorage }]);
            return snapshot();
        });
        await frame.evaluate(() => report(['mediaChanged', 'favoriteCurrent', 'keyForward', 'nativeHeartFeedback']));
        await waitPresent(page);
        assert.deepEqual((await state(page)).features, ['favoriteCurrent', 'keyForward', 'mediaChanged', 'nativeHeartFeedback']);
        assert.equal(await page.evaluate(() => gallery.isGalleryFavoriteCapable(panels[1])), false);
        await frame.evaluate(() => report(['nativeHeartFeedback', 'keyForward', 'favoriteCurrent', 'mediaChanged', 'mediaChanged']));
        await page.waitForTimeout(30);
        assert.equal(await page.evaluate(() => changes), 1);
        await frame.evaluate(() => report(['favoriteCurrent']));
        await page.waitForFunction(() => changes === 2);
        assert.equal(await page.evaluate(() => snapshot()), before);
        assert.equal(await page.evaluate(async () => (await import('./js/current-url-observation.js')).getCurrentUrlObservation(panels[0]).observedCurrentUrl), null);
        assert.equal(await page.evaluate(() => {
            const copy = gallery.getGalleryFavoriteCapability(panels[0]);
            copy.features.push('fabricated');
            return gallery.getGalleryFavoriteCapability(panels[0]).features.includes('fabricated');
        }), false);
    } finally { await page.close(); }
});

test('Gallery assignment, iframe load, reload and removal invalidate old generations', async () => {
    const { page, frame } = await boot();
    try {
        await frame.evaluate(() => report(['favoriteCurrent']));
        await waitPresent(page);
        const old = (await state(page)).generation;
        await page.evaluate(async () => {
            const launch = await import('./js/launch.js');
            launch.updateRenderedPanel(panels[0], { url: '/test/fixtures/gallery-capability-stub.html?new=1' });
            window.closedGate = gallery.getGalleryFavoriteCapability(panels[0]);
        });
        assert.equal(await page.evaluate(() => closedGate.acceptingReports), false);
        assert.equal(await page.evaluate(() => closedGate.capable), false);
        await page.waitForFunction(() => gallery.getGalleryFavoriteCapability(panels[0]).acceptingReports);
        const fresh = page.frames().find(f => f.url().includes('?new=1'));
        await fresh.waitForFunction(() => queries.length > 0);
        await fresh.evaluate(old => report(['favoriteCurrent'], old), old);
        await page.waitForTimeout(30);
        assert.equal((await state(page)).capable, false);
        await fresh.evaluate(() => report(['favoriteCurrent']));
        await waitPresent(page);
        const beforeLoad = (await state(page)).generation;
        await fresh.evaluate(() => location.reload());
        await page.waitForFunction(g => gallery.getGalleryFavoriteCapability(panels[0]).generation !== g, beforeLoad);
        assert.equal((await state(page)).capable, false);
        const reloaded = page.frames().find(f => f.url().includes('?new=1'));
        await reloaded.waitForFunction(() => queries.length > 0);
        await reloaded.evaluate(() => report(['favoriteCurrent']));
        await waitPresent(page);
        await page.locator('.stream-panel').first().locator('.btn-hotswap-kill').dispatchEvent('click');
        await page.waitForFunction(() => !panels[0].isConnected);
        assert.equal(await state(page), null);
        assert.equal(await page.evaluate(() => gallery.isGalleryFavoriteCapable(panels[0])), false);
    } finally { await page.close(); }
});

test('Gallery rejects malformed, unfenced, disallowed-origin and unrelated-window reports', async () => {
    const { page, frame } = await boot();
    try {
        const results = await page.evaluate(() => {
            const good = {
                source: 'gs3-capability-bridge', version: 1, capability: 'GALLERY_FAVORITE',
                type: 'CAPABILITY_PRESENT', generation: gallery.getGalleryFavoriteCapability(panels[0]).generation,
                features: ['favoriteCurrent'],
            };
            const source = panels[0].querySelector('iframe').contentWindow;
            const origin = 'http://localhost:4203';
            return [
                ...[null, [], { ...good, version: 2 }, { ...good, generation: undefined },
                    { ...good, features: [1] }, { ...good, capability: 'FILL_PANEL' },
                    { ...good, features: ['bad-name'] }, { ...good, type: 'FAVORITE_CURRENT' }]
                    .map(data => gallery.handleGalleryFavoriteMessage({ data, source, origin })),
                gallery.handleGalleryFavoriteMessage({ data: good, source: window, origin }),
                gallery.handleGalleryFavoriteMessage({ data: good, source, origin: 'https://evil.test' }),
                gallery.handleGalleryFavoriteMessage({ data: good, source, origin: 'null' }),
            ];
        });
        assert.ok(results.every(r => r === false));
        assert.equal((await state(page)).capable, false);
        assert.equal(await page.evaluate(() => changes), 0);
        // A real message from the top window cannot claim an iframe identity.
        await page.evaluate(() => window.postMessage({
            source: 'gs3-capability-bridge', version: 1, type: 'CAPABILITY_PRESENT',
            capability: 'GALLERY_FAVORITE', features: [],
            generation: gallery.getGalleryFavoriteCapability(panels[0]).generation, slot: 0,
        }, '*'));
        await page.waitForTimeout(30);
        assert.equal((await state(page)).capable, false);
    } finally { await page.close(); }
});
