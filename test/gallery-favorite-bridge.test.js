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

async function boot(auto = false, extra = '') {
    const page = await browser.newPage();
    page.setDefaultTimeout(6000);
    await page.route(/^https?:\/\/(?!127\.0\.0\.1:4203|localhost:4203).*/, r => r.fulfill({ status: 204, body: '' }));
    await page.addInitScript(({ auto, extra }) => {
        if (window !== top) return;
        localStorage.clear();
        window.autoChanges = 0;
        document.addEventListener('gs3:gallery-favorite-capability-changed', () => window.autoChanges++);
        localStorage.setItem('loop_matrix_urls', JSON.stringify([
            'http://localhost:4203/test/fixtures/gallery-capability-stub.html' + (auto ? '?auto=1' + extra : ''),
            '/test/fixtures/canary.html?id=gallery-lookalike',
        ]));
    }, { auto, extra });
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

test('MultiHeart eligibility, disclosures, status feedback and state isolation', async () => {
    const { page, frame } = await boot();
    try {
        assert.equal(await page.locator('#master-hearts-group').isVisible(), false);
        await frame.evaluate(() => report([]));
        await waitPresent(page);
        assert.equal(await page.locator('#master-hearts-body button').count(), 0);
        await frame.evaluate(() => report(['favoriteCurrent']));
        await page.waitForFunction(() => document.querySelector('#master-hearts-body button'));
        await page.locator('#btn-toggle-master').click();
        const trigger = page.locator('#btn-master-hearts-toggle');
        const heart = page.locator('#master-hearts-body [data-position="1"]');
        for (const sibling of ['#btn-master-shuffle-toggle', '#btn-master-layout-toggle', '#btn-master-overflow']) {
            await page.locator(sibling).click();
            await trigger.click();
            assert.equal(await page.locator(sibling).getAttribute('aria-expanded'), 'false');
            await page.locator(sibling).click();
            assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
            await page.keyboard.press('Escape');
        }
        const before = await page.evaluate(async () => {
            window.session = await import('./js/grid-session.js');
            window.snap = () => JSON.stringify([session.getSessionPanels(), session.getSessionArrangement(),
                session.getSessionLayout(), session.getGridHistory(), { ...localStorage },
                ...[...document.querySelectorAll('.stream-panel')].map(n => n.getBoundingClientRect().toJSON())]);
            return snap();
        });
        await trigger.click();
        for (const [status, text] of [['favorited', 'Favorited'], ['already-favorite', 'Already favorited'],
            ['no-media', 'No current media'], ['unavailable', 'Gallery favorite unavailable']]) {
            await frame.evaluate(s => window.resultStatus = s, status);
            await heart.click();
            await page.waitForFunction(text => document.querySelector('#master-status').textContent === text, text);
            assert.equal(await heart.textContent(), '❤1');
        }
        assert.equal(await page.evaluate(() => snap()), before);
        await page.keyboard.press('Escape');
        assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
        await trigger.click();
        await page.locator('#master-status').click();
        assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
        await trigger.click();
        await page.locator('#btn-toggle-master').click();
        assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
        await frame.evaluate(() => report([]));
        await page.waitForFunction(() => document.querySelector('#master-hearts-group').hidden);
    } finally { await page.close(); }
});

test('MultiHeart routes physical Positions at click time, supports independent busy requests and replacement', async () => {
    const { page, frame } = await boot(true);
    try {
        await waitPresent(page);
        await page.evaluate(async () => (await import('./js/launch.js')).updateRenderedPanel(panels[2], {
            url: '/test/fixtures/gallery-capability-stub.html?auto=1&third=1',
        }));
        await page.waitForFunction(() => gallery.isGalleryFavoriteCapable(panels[2]));
        const third = page.frames().find(f => f.url().includes('third=1'));
        await page.locator('#btn-toggle-master').click();
        await page.locator('#btn-master-hearts-toggle').click();
        assert.deepEqual(await page.locator('#master-hearts-body button').allTextContents(), ['❤1', '❤3']);
        // Change authoritative arrangement without a UI render: click must still resolve current truth.
        await page.evaluate(async () => {
            window.s = await import('./js/grid-session.js');
            s.setSessionArrangement(['screen3', 'screen2', 'screen1', 'screen4']);
        });
        for (const f of [frame, third]) await f.evaluate(() => window.holdResults = true);
        await page.locator('#master-hearts-body [data-position="1"]').click();
        await third.waitForFunction(() => commands.length === 1);
        assert.equal(await frame.evaluate(() => commands.length), 0);
        assert.equal(await page.locator('#master-hearts-body [data-position="1"]').isDisabled(), true);
        await page.locator('#master-hearts-body [data-position="1"]').dispatchEvent('click');
        assert.equal(await third.evaluate(() => commands.length), 1);
        await page.locator('#master-hearts-body [data-position="3"]').click();
        await frame.waitForFunction(() => commands.length === 1);
        for (const f of [frame, third]) await f.evaluate(() => reply(commands[0]));
        await page.waitForFunction(() => [...document.querySelectorAll('#master-hearts-body button')].every(b => !b.disabled));
        for (const width of [1280, 700, 360]) {
            await page.setViewportSize({ width, height: 800 });
            const h = await page.locator('#master-bar').evaluate(n => n.getBoundingClientRect().height);
            for (const b of await page.locator('#master-hearts-body button').all()) {
                await b.scrollIntoViewIfNeeded();
                assert.ok(await b.evaluate(n => { const r = n.getBoundingClientRect(); return n.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }));
            }
            await page.keyboard.press('Escape');
            assert.equal(await page.locator('#master-bar').evaluate(n => n.getBoundingClientRect().height), h);
            await page.locator('#btn-master-hearts-toggle').click();
        }
        await page.evaluate(async () => (await import('./js/launch.js')).updateRenderedPanel(panels[2], { url: '/test/fixtures/canary.html?replacement=1' }));
        await page.waitForFunction(() => document.querySelectorAll('#master-hearts-body button').length === 1);
        assert.deepEqual(await page.locator('#master-hearts-body button').allTextContents(), ['❤3']);
        // Real canonical layout change reprojects physical labels using positions.js.
        await page.evaluate(() => document.getElementById('btn-layout-righttall').click());
        assert.deepEqual(await page.locator('#master-hearts-body button').allTextContents(), ['❤2']);
    } finally { await page.close(); }
});

test('favorite intent preserves all statuses, exact envelope and Runtime state', async () => {
    const { page, frame } = await boot(true);
    try {
        await waitPresent(page);
        const before = await page.evaluate(async () => {
            window.s = await import('./js/grid-session.js');
            window.snap = () => JSON.stringify([s.getSessionPanels(), s.getSessionLayout(), s.getSessionArrangement(), s.getGridHistory(), { ...localStorage }]);
            return snap();
        });
        assert.deepEqual(await page.evaluate(() => gallery.requestGalleryFavoriteCurrent(panels[1])), { status: 'unavailable' });
        for (const status of ['favorited', 'already-favorite', 'no-media', 'unavailable']) {
            await frame.evaluate(status => window.resultStatus = status, status);
            assert.deepEqual(await page.evaluate(() => gallery.requestGalleryFavoriteCurrent(panels[0])), { status });
        }
        const commands = await frame.evaluate(() => commands);
        assert.equal(new Set(commands.map(c => c.requestId)).size, 4);
        for (const c of commands) {
            assert.deepEqual(Object.keys(c).sort(), ['capability', 'generation', 'requestId', 'source', 'type', 'version']);
            assert.equal(c.source, 'gs3-capability-bridge');
            assert.equal(c.version, 1);
            assert.equal(c.type, 'FAVORITE_CURRENT');
            assert.equal(c.capability, 'GALLERY_FAVORITE');
            assert.equal(c.generation, (await state(page)).generation);
        }
        assert.equal(await page.evaluate(() => snap()), before);
        await frame.evaluate(() => report([]));
        await page.waitForFunction(() => gallery.getGalleryFavoriteCapability(panels[0]).features.length === 0);
        assert.deepEqual(await page.evaluate(() => gallery.requestGalleryFavoriteCurrent(panels[0])), { status: 'unavailable' });
        assert.equal(await frame.evaluate(() => commands.length), 4);
    } finally { await page.close(); }
});

test('favorite rejects mismatches, limits in-flight work, times out and invalidates on reset', async () => {
    const { page, frame } = await boot(true);
    try {
        await waitPresent(page);
        await frame.evaluate(() => window.holdResults = true);
        await page.evaluate(() => {
            window.result = null;
            window.promise = gallery.requestGalleryFavoriteCurrent(panels[0]).then(r => window.result = r);
        });
        await frame.waitForFunction(() => commands.length === 1);
        assert.deepEqual(await page.evaluate(() => gallery.requestGalleryFavoriteCurrent(panels[0])), { status: 'unavailable' });
        const command = await frame.evaluate(() => commands[0]);
        const rejected = await page.evaluate(c => {
            const data = { ...c, type: 'FAVORITE_RESULT', status: 'favorited' };
            const source = panels[0].querySelector('iframe').contentWindow;
            const origin = 'http://localhost:4203';
            return [
                [{ ...data, requestId: 'unknown' }, source, origin],
                [{ ...data, generation: 'old' }, source, origin],
                [{ ...data, status: true }, source, origin],
                [{ ...data, status: 'success' }, source, origin],
                [data, panels[1].querySelector('iframe').contentWindow, origin],
                [data, source, 'https://evil.test'],
                [{ ...data, version: 2 }, source, origin],
            ].map(([data, source, origin]) => gallery.handleGalleryFavoriteMessage({ data, source, origin }));
        }, command);
        assert.ok(rejected.every(r => !r));
        assert.equal(await page.evaluate(() => result), null);
        assert.deepEqual(await page.evaluate(() => promise), { status: 'unavailable' });
        await page.evaluate(() => window.promise = gallery.requestGalleryFavoriteCurrent(panels[0]));
        await frame.waitForFunction(() => commands.length === 2);
        await frame.evaluate(() => reply(commands[0]));
        await page.evaluate(() => gallery.resetGalleryFavoriteCapability(panels[0]));
        assert.deepEqual(await page.evaluate(() => promise), { status: 'unavailable' });
        assert.equal(await page.evaluate(c => gallery.handleGalleryFavoriteMessage({
            data: { ...c, type: 'FAVORITE_RESULT', status: 'favorited' },
            source: panels[0].querySelector('iframe').contentWindow, origin: 'http://localhost:4203',
        }), command), false);
    } finally { await page.close(); }
});

test('independent Gallery Panels may each complete a pending favorite', async () => {
    const { page, frame } = await boot(true);
    try {
        await waitPresent(page);
        await page.evaluate(async () => (await import('./js/launch.js')).updateRenderedPanel(panels[1], {
            url: '/test/fixtures/gallery-capability-stub.html?auto=1&second=1',
        }));
        await page.waitForFunction(() => gallery.isGalleryFavoriteCapable(panels[1]));
        const second = page.frames().find(f => f.url().includes('second=1'));
        for (const f of [frame, second]) await f.evaluate(() => window.holdResults = true);
        await page.evaluate(() => window.both = [0, 1].map(i => gallery.requestGalleryFavoriteCurrent(panels[i])));
        for (const f of [frame, second]) await f.waitForFunction(() => commands.length === 1);
        await second.evaluate(() => reply(commands[0], 'no-media'));
        await frame.evaluate(() => reply(commands[0], 'already-favorite'));
        assert.deepEqual(await page.evaluate(() => Promise.all(both)), [{ status: 'already-favorite' }, { status: 'no-media' }]);
    } finally { await page.close(); }
});

test('automatic Gallery handshake completes on cold-start load without trailing registration reset', async () => {
    const { page, frame } = await boot(true);
    try {
        await waitPresent(page);
        assert.equal(await page.evaluate(() => autoChanges), 1);
        const generation = await frame.evaluate(() => queries.at(-1).generation);
        assert.equal((await state(page)).generation, generation);
        assert.equal((await state(page)).acceptingReports, true);
    } finally { await page.close(); }
});

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

test('MultiHeart appears automatically when the child installs its listener after iframe load', async () => {
    // Field failure: the real Gallery registers its message listener after top-level
    // await, so the one query sent on load was lost and the group stayed hidden.
    const { page, frame } = await boot(true, '&lateMs=900');
    try {
        // boot() returned only after the late listener first saw a query.
        // No manual render or re-query helper: the lifecycle alone must discover it.
        await page.waitForFunction(() => !document.querySelector('#master-hearts-group').hidden, null, { timeout: 5000 });
        assert.equal(await page.locator('#master-hearts-group').isVisible(), true);
        assert.match(await page.locator('#btn-master-hearts-toggle').textContent(), /◀ ❤/);
        await page.locator('#btn-toggle-master').click();
        await page.locator('#btn-master-hearts-toggle').click();
        assert.deepEqual(await page.locator('#master-hearts-body button').allTextContents(), ['❤1']);
        // Discovery stops once answered: no further queries accumulate.
        const settled = await frame.evaluate(() => queries.length);
        await page.waitForTimeout(700);
        assert.equal(await frame.evaluate(() => queries.length), settled);
    } finally { await page.close(); }
});

test('Gallery discovery retries stop when the generation is replaced or the child never answers', async () => {
    const { page, frame } = await boot(false);
    try {
        const first = await frame.evaluate(() => queries.length);
        await page.waitForTimeout(800);
        const during = await frame.evaluate(() => queries.length);
        assert.ok(during > first, 'unanswered discovery retries');
        await page.evaluate(() => gallery.unregisterGalleryFavoriteCapability(panels[0]));
        const stopped = await frame.evaluate(() => queries.length);
        await page.waitForTimeout(700);
        assert.equal(await frame.evaluate(() => queries.length), stopped);
    } finally { await page.close(); }
});
