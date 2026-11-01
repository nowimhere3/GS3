import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const ORIGIN = 'http://127.0.0.1:4207';
const STUB = 'http://localhost:4207/test/fixtures/gallery-capability-stub.html';
let server, browser;
before(async () => {
    server = spawn(process.platform === 'win32' ? 'python' : 'python3',
        ['-m', 'http.server', '4207', '--bind', '127.0.0.1'], { stdio: 'ignore' });
    const deadline = Date.now() + 5000;
    while (true) {
        try { const r = await fetch(ORIGIN); await r.arrayBuffer(); if (r.ok) break; } catch {}
        if (Date.now() > deadline) throw new Error('Gallery test server unavailable');
        await new Promise(r => setTimeout(r, 50));
    }
    browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); server?.kill(); });

async function boot(query) {
    const page = await browser.newPage();
    page.setDefaultTimeout(6000);
    await page.route(/^https?:\/\/(?!127\.0\.0\.1:4207|localhost:4207).*/, r => r.fulfill({ status: 204, body: '' }));
    await page.addInitScript(url => {
        if (window !== top) return;
        localStorage.clear();
        localStorage.setItem('loop_matrix_urls', JSON.stringify([url, '/test/fixtures/canary.html?id=lookalike']));
    }, STUB + query);
    await page.goto(ORIGIN + '/index3.html?workspace=live', { waitUntil: 'networkidle' });
    await page.evaluate(async () => {
        window.gallery = await import('./js/gallery-favorite-bridge.js');
        window.panels = [...document.querySelectorAll('.stream-panel')];
        window.stateEvents = 0;
        document.addEventListener(gallery.GALLERY_FAVORITE_STATE_CHANGED, () => stateEvents++);
    });
    const frame = page.frames().find(f => f.url().includes('gallery-capability-stub'));
    await frame.waitForFunction(() => queries.length > 0);
    return { page, frame };
}
const hearts = page => page.locator('#master-hearts-body button').allTextContents();
const openHearts = async page => {
    await page.locator('#btn-toggle-master').click();
    await page.locator('#btn-master-hearts-toggle').click();
};
const gstate = page => page.evaluate(() => gallery.getGalleryFavoriteState(panels[0]));

test('live state projects automatically: handshake -> snapshot -> glyph, with no manual render', async () => {
    const { page, frame } = await boot('?state=unfav');
    try {
        await page.waitForFunction(() => document.querySelector('#master-hearts-body button')?.dataset.favoriteState === 'unfavorited');
        await openHearts(page);
        assert.deepEqual(await hearts(page), ['♡1']);
        const heart = page.locator('#master-hearts-body [data-position="1"]');
        assert.match(await heart.getAttribute('aria-label'), /not currently favorited/);

        await frame.evaluate(() => publishState({ isFavorite: true }));          // Gallery-local favorite
        await page.waitForFunction(() => document.querySelector('#master-hearts-body button').textContent === '♥1');
        assert.match(await heart.getAttribute('aria-label'), /is favorited/);
        assert.equal(await heart.locator('.heart-glyph').evaluate(n => getComputedStyle(n).color), 'rgb(255, 59, 78)');

        await frame.evaluate(() => publishState({ mediaKey: 'k2', isFavorite: false })); // media change
        await page.waitForFunction(() => document.querySelector('#master-hearts-body button').textContent === '♡1');
        await frame.evaluate(() => publishState({ mediaKey: 'k3', isFavorite: true }));  // back onto a favorite
        await page.waitForFunction(() => document.querySelector('#master-hearts-body button').textContent === '♥1');

        await frame.evaluate(() => publishState({ hasMedia: false, mediaKey: null, isFavorite: false }));
        await page.waitForFunction(() => document.querySelector('#master-hearts-body button').dataset.favoriteState === 'no-media');
        assert.deepEqual(await hearts(page), ['❤1']);
        assert.equal(await heart.isDisabled(), true);
        assert.match(await heart.getAttribute('aria-label'), /No current media/);
        assert.equal(await page.locator('#master-hearts-group').isVisible(), true);
    } finally { await page.close(); }
});

test('bridge accepts only fenced, well-formed, favoriteState-advertised snapshots and dedupes', async () => {
    const { page, frame } = await boot('?state=unfav');
    try {
        await page.waitForFunction(() => gallery.getGalleryFavoriteState(panels[0]));
        const generation = (await gstate(page)).generation;
        assert.deepEqual(await gstate(page), { generation, hasMedia: true, mediaKey: 'k1', isFavorite: false });
        const send = (extra, over = {}) => page.evaluate(({ extra, over }) => {
            const win = panels[0].querySelector('iframe').contentWindow;
            return gallery.handleGalleryFavoriteMessage({
                source: over.source === 'other' ? window : win, origin: over.origin || 'http://localhost:4207',
                data: { source: 'gs3-capability-bridge', version: 1, type: 'CURRENT_FAVORITE_STATE',
                    capability: 'GALLERY_FAVORITE', generation: over.generation || gallery.getGalleryFavoriteCapability(panels[0]).generation,
                    hasMedia: true, mediaKey: 'k1', isFavorite: false, ...extra },
            });
        }, { extra, over });
        const before = await page.evaluate(() => stateEvents);
        // Identical snapshot: accepted, but no redundant change event.
        assert.equal(await send({}), true);
        assert.equal(await page.evaluate(() => stateEvents), before);
        // Rejections never alter state.
        assert.equal(await send({ isFavorite: true }, { generation: 'stale' }), false);
        assert.equal(await send({ isFavorite: true }, { source: 'other' }), false);
        assert.equal(await send({ isFavorite: true }, { origin: 'https://evil.example' }), false);
        assert.equal(await send({ hasMedia: 'yes' }), false);
        assert.equal(await send({ isFavorite: 1 }), false);
        assert.equal(await send({ hasMedia: false, mediaKey: 'k1', isFavorite: false }), false);
        assert.equal(await send({ hasMedia: false, mediaKey: null, isFavorite: true }), false);
        assert.equal(await send({ mediaKey: '' }), false);
        assert.equal(await send({ mediaKey: null }), false);
        assert.equal(await send({ mediaKey: 'x'.repeat(257) }), false);
        assert.deepEqual(await gstate(page), { generation, hasMedia: true, mediaKey: 'k1', isFavorite: false });
        assert.equal(await page.evaluate(() => stateEvents), before);
        // Meaningful changes each emit exactly one event; opaque key is stored unchanged.
        assert.equal(await send({ isFavorite: true }), true);
        assert.equal(await send({ isFavorite: false }), true);
        assert.equal(await send({ mediaKey: 'Opaque/Key 9=' }), true);
        assert.equal((await gstate(page)).mediaKey, 'Opaque/Key 9=');
        assert.equal(await page.evaluate(() => stateEvents), before + 3);
    } finally { await page.close(); }
});

test('favoriteState feature is required; favoriteCurrent-only Gallery keeps the neutral action heart', async () => {
    const { page, frame } = await boot('?auto=1');
    try {
        await page.waitForFunction(() => gallery.isGalleryFavoriteCapable(panels[0]));
        await frame.evaluate(() => publishState({ isFavorite: true }));
        await page.waitForTimeout(150);
        assert.equal(await gstate(page), null);
        await openHearts(page);
        assert.deepEqual(await hearts(page), ['❤1']);
        assert.equal(await page.locator('#master-hearts-body button').isDisabled(), false);
        // Losing the feature drops an existing snapshot.
        await frame.evaluate(() => report(['favoriteCurrent', 'favoriteState']));
        await page.waitForFunction(() => gallery.getGalleryFavoriteCapability(panels[0]).features.includes('favoriteState'));
        await frame.evaluate(() => publishState({ isFavorite: true }));
        await page.waitForFunction(() => gallery.getGalleryFavoriteState(panels[0]));
        await frame.evaluate(() => report(['favoriteCurrent']));
        await page.waitForFunction(() => !gallery.getGalleryFavoriteState(panels[0]));
        await page.waitForFunction(() => document.querySelector('#master-hearts-body button').textContent === '❤1');
    } finally { await page.close(); }
});

test('state is generation-fenced: reset, replacement and unregister clear it; late old-generation state is refused', async () => {
    const { page, frame } = await boot('?state=fav');
    try {
        await page.waitForFunction(() => gallery.getGalleryFavoriteState(panels[0])?.isFavorite);
        const old = (await gstate(page)).generation;
        await openHearts(page);
        assert.deepEqual(await hearts(page), ['♥1']);
        await page.evaluate(() => gallery.resetGalleryFavoriteCapability(panels[0], { acceptingReports: false }));
        assert.equal(await gstate(page), null);
        await page.waitForFunction(() => document.querySelector('#master-hearts-group').hidden); // no stale red heart
        const accepted = await page.evaluate(g => gallery.handleGalleryFavoriteMessage({
            source: panels[0].querySelector('iframe').contentWindow, origin: 'http://localhost:4207',
            data: { source: 'gs3-capability-bridge', version: 1, type: 'CURRENT_FAVORITE_STATE',
                capability: 'GALLERY_FAVORITE', generation: g, hasMedia: true, mediaKey: 'late', isFavorite: true },
        }), old);
        assert.equal(accepted, false);
        assert.equal(await gstate(page), null);
        // Re-handshake builds a fresh generation with a fresh snapshot.
        await page.evaluate(() => gallery.resetGalleryFavoriteCapability(panels[0], { acceptingReports: true }));
        await page.waitForFunction(() => gallery.getGalleryFavoriteState(panels[0]));
        assert.notEqual((await gstate(page)).generation, old);
        await page.evaluate(() => gallery.unregisterGalleryFavoriteCapability(panels[0]));
        assert.equal(await gstate(page), null);
    } finally { await page.close(); }
});

test('favorite state belongs to the Panel and follows it across physical Positions', async () => {
    const { page, frame } = await boot('?state=fav');
    try {
        await page.evaluate(async () => (await import('./js/launch.js')).updateRenderedPanel(panels[2], {
            url: '/test/fixtures/gallery-capability-stub.html?state=unfav&third=1',
        }));
        await page.waitForFunction(() => gallery.getGalleryFavoriteState(panels[0])?.isFavorite
            && gallery.getGalleryFavoriteState(panels[2]));
        const third = page.frames().find(f => f.url().includes('third=1'));
        await openHearts(page);
        assert.deepEqual(await hearts(page), ['♥1', '♡3']);
        // Authoritative swap of Positions 1 and 3; the next accepted state event re-projects.
        await page.evaluate(async () => {
            const s = await import('./js/grid-session.js');
            s.setSessionArrangement(['screen3', 'screen2', 'screen1', 'screen4']);
        });
        await third.evaluate(() => publishState({ mediaKey: 'k9' }));
        await page.waitForFunction(() => document.querySelector('#master-hearts-body button').textContent === '♡1');
        assert.deepEqual(await hearts(page), ['♡1', '♥3']);
    } finally { await page.close(); }
});

test('FAVORITE_CURRENT results never set visual truth; only Gallery snapshots do; no Runtime/storage mutation', async () => {
    const { page, frame } = await boot('?state=unfav');
    try {
        await page.waitForFunction(() => gallery.getGalleryFavoriteState(panels[0]));
        await openHearts(page);
        const barHeight = await page.locator('#master-bar').evaluate(n => n.getBoundingClientRect().height);
        const reserve = await page.evaluate(() => document.documentElement.style.getPropertyValue('--gs3-dock-reserve'));
        const snapshot = () => page.evaluate(async () => ({
            ls: JSON.stringify(Object.entries(localStorage).sort()),
            history: (await import('./js/grid-session.js')).getGridHistory().length,
            session: JSON.stringify((await import('./js/grid-session.js')).getSessionUrls()),
        }));
        const before = await snapshot();
        const heart = page.locator('#master-hearts-body [data-position="1"]');
        await heart.click();                                   // child replies 'favorited' but publishes no state
        await frame.waitForFunction(() => commands.length === 1);
        await page.waitForFunction(() => document.getElementById('master-status').textContent === 'Favorited');
        await page.waitForTimeout(200);
        assert.equal(await heart.textContent(), '♡1');          // action ack alone changes nothing
        await frame.evaluate(() => publishState({ isFavorite: true }));
        await page.waitForFunction(() => document.querySelector('#master-hearts-body button').textContent === '♥1');
        // A favorited heart stays idempotent: clicking sends the same command, never un-favorites.
        await frame.evaluate(() => { window.resultStatus = 'already-favorite'; });
        await heart.click();
        await frame.waitForFunction(() => commands.length === 2);
        await page.waitForFunction(() => document.getElementById('master-status').textContent === 'Already favorited');
        assert.equal(await heart.textContent(), '♥1');
        assert.deepEqual(await snapshot(), before);
        assert.equal(await page.locator('#master-bar').evaluate(n => n.getBoundingClientRect().height), barHeight);
        assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--gs3-dock-reserve')), reserve);
    } finally { await page.close(); }
});

test('zero eligible Panels still hides the whole group', async () => {
    const { page } = await boot('?state=fav');
    try {
        await page.waitForFunction(() => !document.querySelector('#master-hearts-group').hidden);
        await page.evaluate(() => gallery.unregisterGalleryFavoriteCapability(panels[0]));
        await page.waitForFunction(() => document.querySelector('#master-hearts-group').hidden);
    } finally { await page.close(); }
});
