import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const ORIGIN = 'http://127.0.0.1:4199';
let server, browser;
before(async () => {
    server = spawn(process.platform === 'win32' ? 'python' : 'python3',
        ['-m', 'http.server', '4199', '--bind', '127.0.0.1'], { stdio: 'ignore' });
    const deadline = Date.now() + 5000;
    while (true) {
        try { const r = await fetch(ORIGIN); await r.arrayBuffer(); if (r.ok) break; } catch {}
        if (Date.now() > deadline) throw new Error('S1 server unavailable');
        await new Promise((r) => setTimeout(r, 50));
    }
    browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); server?.kill(); });

async function boot() {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.setDefaultTimeout(7000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.errors = errors;
    await page.route(/^https?:\/\/(?!127\.0\.0\.1:4199).*/, (r) => r.fulfill({ status: 204, body: '' }));
    await page.addInitScript(() => {
        if (window !== window.top) return;
        localStorage.clear();
        localStorage.setItem('loop_matrix_urls', JSON.stringify(['A', 'B', 'C', 'D'].map((id) => `/test/fixtures/canary.html?id=${id}`)));
        localStorage.setItem('matrix_folder_map', JSON.stringify({ 0: 'Alpha', 1: 'Alpha', 2: 'Alpha' }));
    });
    await page.goto(`${ORIGIN}/index3.html?workspace=live`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelectorAll('.stream-panel iframe').length === 4);
    await page.evaluate(async () => {
        window.session = await import('./js/grid-session.js');
        window.store = (await import('./js/storage.js')).Store;
    });
    await page.locator('#btn-toggle-master').click();
    return page;
}
const trigger = '#btn-master-shuffle-toggle';

test('S1 disclosure opens right, dismisses, and preserves session, Store and iframe lifecycles', async () => {
    const page = await boot();
    try {
        const before = await page.evaluate(() => {
            window.framesBefore = [...document.querySelectorAll('.stream-panel iframe')];
            window.loads = 0; window.writes = 0;
            framesBefore.forEach((f) => f.addEventListener('load', () => window.loads++));
            const original = store.set.bind(store);
            store.set = (...args) => { window.writes++; return original(...args); };
            return JSON.stringify([session.getSessionPanels(), session.getSessionFolderMap(), session.getSessionArrangement(), session.getGridHistory(), { ...localStorage }]);
        });
        assert.equal(await page.locator(trigger).getAttribute('aria-expanded'), 'false');
        assert.equal(await page.locator('#btn-master-shuffle').isVisible(), false);
        const start = await page.locator(trigger).boundingBox();
        await page.locator(`${trigger} span`).first().click();
        assert.equal(await page.locator(trigger).getAttribute('aria-expanded'), 'true');
        const body = await page.locator('#master-shuffle-body').boundingBox();
        assert.ok(body.x >= start.x + start.width, 'body grows right of the trigger');
        await page.locator(trigger).click();
        assert.equal(await page.locator('#btn-master-shuffle').isVisible(), false);
        await page.locator(trigger).click();
        await page.keyboard.press('Escape');
        assert.equal(await page.locator(trigger).getAttribute('aria-expanded'), 'false');
        assert.equal(await page.locator(trigger).evaluate((n) => document.activeElement === n), true);
        await page.locator(trigger).click();
        await page.locator('#btn-master-overflow').click();
        assert.equal(await page.locator(trigger).getAttribute('aria-expanded'), 'false');
        assert.equal(await page.locator('#master-general-menu').isVisible(), true);
        for (const id of ['btn-master-folder', 'btn-master-save', 'btn-master-copy-diagnostics', 'btn-master-close']) {
            assert.equal(await page.locator(`#${id}`).isVisible(), true, id);
        }
        await page.locator(trigger).click();
        await page.locator('#btn-toggle-master').click();
        assert.equal(await page.locator(trigger).getAttribute('aria-expanded'), 'false');
        assert.equal(await page.locator('#master-bar').evaluate((n) => n.classList.contains('open')), false);
        const after = await page.evaluate(() => ({
            state: JSON.stringify([session.getSessionPanels(), session.getSessionFolderMap(), session.getSessionArrangement(), session.getGridHistory(), { ...localStorage }]),
            loads, writes, sameFrames: framesBefore.every((f, i) => f === document.querySelectorAll('.stream-panel iframe')[i]),
        }));
        assert.equal(after.state, before);
        assert.equal(after.loads, 0); assert.equal(after.writes, 0); assert.ok(after.sameFrames);
        assert.deepEqual(page.errors, []);
    } finally { await page.close(); }
});

test('controller permits one registered group and supports left groups without action ownership', async () => {
    const page = await browser.newPage();
    try {
        await page.goto(`${ORIGIN}/test/fixtures/canary.html`);
        const result = await page.evaluate(async () => {
            const { createToolbarDisclosure } = await import('/js/toolbar-disclosure.js');
            const root = document.createElement('div');
            root.innerHTML = ['right', 'left'].map((dir) => `<div id="${dir}" data-dir="${dir}"><button><span>toggle</span></button><div id="${dir}-body" class="tool-group-body"></div></div>`).join('');
            document.body.append(root);
            const c = createToolbarDisclosure(root);
            const groups = [...root.children];
            groups.forEach((g) => c.register(g, g.querySelector('button')));
            c.open('right'); c.open('left');
            const oneOpen = groups[0].dataset.open === 'false' && groups[1].dataset.open === 'true';
            groups[1].querySelector('span').click();
            const toggled = groups[1].dataset.open === 'false';
            c.destroy();
            groups[0].querySelector('button').click();
            return { oneOpen, toggled, destroyed: groups[0].dataset.open === 'false' };
        });
        assert.deepEqual(result, { oneOpen: true, toggled: true, destroyed: true });
    } finally { await page.close(); }
});

test('canonical Shuffle, Shuffle All and compact Undo/Redo keep one session history', async () => {
    const page = await boot();
    try {
        for (const [id, glyph, label] of [['undo', '↩', 'Undo'], ['redo', '↪', 'Redo']]) {
            const n = page.locator(`#btn-master-${id}`);
            assert.equal(await n.textContent(), glyph);
            assert.equal(await n.getAttribute('title'), label);
            assert.equal(await n.getAttribute('aria-label'), label);
            assert.equal(await n.isDisabled(), true);
            const styles = await n.evaluate((n, id) => {
                const top = document.querySelector(`.btn-hotswap-${id}`);
                const keys = ['width', 'height', 'borderRadius', 'backgroundColor', 'borderColor', 'color', 'fontSize'];
                return keys.map((k) => [k, getComputedStyle(n)[k], getComputedStyle(top)[k]]);
            }, id);
            styles.forEach(([k, a, b]) => assert.equal(a, b, k));
        }
        const initial = await page.evaluate(() => session.getSessionUrls());
        await page.evaluate(async () => {
            const state = await import('./js/state.js');
            state.setDatabaseStructure({ Alpha: ['/test/fixtures/canary.html?id=NEW'] });
        });
        await page.locator(trigger).click();
        await page.locator('#btn-master-shuffle').click();
        const shuffled = await page.evaluate(() => session.getSessionUrls());
        assert.notDeepEqual(shuffled, initial);
        assert.equal(await page.locator('#btn-master-undo').isDisabled(), false);
        assert.equal(await page.evaluate(() => session.getGridHistory().length), 1);
        await page.locator('#btn-master-undo').click();
        assert.deepEqual(await page.evaluate(() => session.getSessionUrls()), initial);
        assert.equal(await page.locator('#btn-master-redo').isDisabled(), false);
        await page.locator('#btn-master-redo').click();
        assert.deepEqual(await page.evaluate(() => session.getSessionUrls()), shuffled);
        assert.equal(await page.locator('#btn-master-redo').isDisabled(), true);
        await page.evaluate(async () => (await import('./js/state.js')).setDatabaseStructure({ Beta: ['/test/fixtures/canary.html?id=ALL'] }));
        await page.locator(trigger).click();
        await page.locator('#btn-master-shuffle-all').click();
        assert.ok((await page.evaluate(() => session.getSessionUrls())).slice(0, 3).every((u) => u.includes('ALL')));
        assert.equal(await page.evaluate(() => session.getGridHistory().length), 2);
        assert.deepEqual(page.errors, []);
    } finally { await page.close(); }
});

test('visible Shuffle buttons forward to the selected L2 and preserve the parent session', async () => {
    const page = await boot();
    try {
        await page.evaluate(() => {
            const input = document.querySelector('.stream-panel .hotswap-input');
            input.value = 'index3.html?workspace=live';
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
        });
        await page.waitForFunction(() => document.querySelector('#master-layer-selector [data-slot="0"]'));
        await page.locator('#master-layer-selector [data-slot="0"]').click();
        await page.evaluate(() => {
            window.sent = [];
            document.querySelector('.stream-panel iframe').contentWindow.postMessage = (m) => sent.push(m);
        });
        const before = await page.evaluate(() => JSON.stringify([session.getSessionPanels(), session.getGridHistory()]));
        await page.locator(trigger).click();
        await page.locator('#btn-master-shuffle').click();
        await page.locator('#btn-master-shuffle-all').click();
        assert.deepEqual(await page.evaluate(() => sent.map((m) => m.action)), ['shuffle', 'shuffleAll']);
        assert.equal(await page.evaluate(() => JSON.stringify([session.getSessionPanels(), session.getGridHistory()])), before);
    } finally { await page.close(); }
});

test('Shuffle remains inline with no Dock overlap or extra rows at narrow widths and four layout shortcuts', async () => {
    const page = await boot();
    try {
        await page.evaluate(async () => {
            const h = await import('./js/hotswap-chrome.js');
            h.setGridLayoutShortcutCount(4);
        });
        await page.reload({ waitUntil: 'networkidle' });
        await page.locator('#btn-toggle-master').click();
        for (const width of [1280, 900, 700, 480, 360]) {
            await page.setViewportSize({ width, height: 800 });
            const height = await page.locator('#master-bar').evaluate((n) => n.getBoundingClientRect().height);
            await page.locator(trigger).click();
            const geo = await page.evaluate(() => {
                const r = (s) => document.querySelector(s).getBoundingClientRect();
                const shell = r('.master-shell-content'), dock = r('#orchestration-dock');
                const children = [...document.querySelector('.master-shell-content').children].filter((e) => e.getBoundingClientRect().width > 0);
                return { right: shell.right, dockLeft: dock.left, height: r('#master-bar').height,
                    centers: children.map((n) => n.getBoundingClientRect().top + n.getBoundingClientRect().height / 2) };
            });
            assert.ok(geo.right <= geo.dockLeft, `Dock overlap at ${width}`);
            assert.equal(geo.height, height, `bar height at ${width}`);
            assert.ok(Math.max(...geo.centers) - Math.min(...geo.centers) < 2, `wrapping at ${width}`);
            await page.locator('#btn-master-shuffle-all').scrollIntoViewIfNeeded();
            assert.equal(await page.locator('#btn-master-shuffle-all').isVisible(), true);
            for (const selector of ['#btn-master-shuffle-all', '#btn-master-undo', '#btn-master-redo', '#btn-master-layout-overflow', '#btn-master-overflow']) {
                await page.locator(selector).scrollIntoViewIfNeeded();
                assert.ok(await page.locator(selector).evaluate((n) => {
                    const r = n.getBoundingClientRect();
                    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
                    return n === hit || n.contains(hit);
                }), `control reachable at ${width}: ${selector}`);
            }
            await page.locator(trigger).click();
        }
    } finally { await page.close(); }
});
