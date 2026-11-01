import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const ORIGIN = 'http://127.0.0.1:4202';
const order = ['vsplit', '4grid', '3col', 'top2', 'bottom2', 'lefttall', 'righttall', 'hsplit'];
const layoutTrigger = '#btn-master-layout-toggle';
const shuffleTrigger = '#btn-master-shuffle-toggle';
let browser, server;
before(async () => {
    server = spawn(process.platform === 'win32' ? 'python' : 'python3',
        ['-m', 'http.server', '4202', '--bind', '127.0.0.1'], { stdio: 'ignore' });
    const deadline = Date.now() + 5000;
    while (true) {
        try { const r = await fetch(ORIGIN); await r.arrayBuffer(); if (r.ok) break; } catch {}
        if (Date.now() > deadline) throw new Error('S2 server unavailable');
        await new Promise((r) => setTimeout(r, 50));
    }
    browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); server?.kill(); });

async function boot(count = 2) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.setDefaultTimeout(6000);
    page.errors = [];
    page.on('pageerror', (e) => page.errors.push(e.message));
    await page.route(/^https?:\/\/(?!127\.0\.0\.1:4202).*/, (r) => r.fulfill({ status: 204, body: '' }));
    await page.addInitScript(({ count, order }) => {
        if (window !== top) return;
        localStorage.clear();
        localStorage.setItem('loop_matrix_urls', JSON.stringify(['A', 'B', 'C', 'D'].map((id) => `/test/fixtures/canary.html?id=${id}`)));
        localStorage.setItem('grid_layout_slot_count', String(count));
        localStorage.setItem('grid_layout_slot_order', JSON.stringify(order));
    }, { count, order });
    await page.goto(`${ORIGIN}/index3.html?workspace=live`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelectorAll('.stream-panel iframe').length === 4);
    await page.locator('#btn-toggle-master').click();
    return page;
}
const expanded = (page, selector = layoutTrigger) => page.locator(selector).getAttribute('aria-expanded');
async function assertFloorplan(page, layout) {
    assert.equal(await page.locator(layoutTrigger).evaluate(async (n, layout) =>
        n.innerHTML === (await import('./js/grid-layouts.js')).getLayoutIconMarkup(layout), layout), true);
}

test('S2 Layouts starts collapsed, grows left, toggles and shares one-open state with Shuffle', async () => {
    const page = await boot();
    try {
        assert.equal(await expanded(page), 'false');
        assert.equal(await expanded(page, shuffleTrigger), 'false');
        assert.equal(await page.locator('#btn-master-layout-overflow').isVisible(), false);
        await assertFloorplan(page, 'lefttall');
        const closed = await page.locator(layoutTrigger).boundingBox();
        await page.locator(`${layoutTrigger} .layout-icon i`).first().click();
        const body = await page.locator('#master-layout-body').boundingBox();
        const open = await page.locator(layoutTrigger).boundingBox();
        assert.ok(body.x + body.width <= open.x, 'body is left of trigger');
        assert.ok(Math.abs(open.x - closed.x) < 1, 'right anchor stays fixed');
        assert.equal(await expanded(page), 'true');
        await page.locator(layoutTrigger).click();
        assert.equal(await expanded(page), 'false');
        await page.locator(shuffleTrigger).click();
        await page.locator(layoutTrigger).click();
        assert.equal(await expanded(page, shuffleTrigger), 'false');
        await page.locator(shuffleTrigger).click();
        assert.equal(await expanded(page), 'false');
        await page.locator(layoutTrigger).click();
        await page.keyboard.press('Escape');
        assert.equal(await expanded(page), 'false');
        await page.locator(layoutTrigger).focus();
        await page.keyboard.press('Enter');
        assert.equal(await expanded(page), 'true');
        await page.locator('#btn-master-overflow').click();
        assert.equal(await expanded(page), 'false');
        assert.deepEqual(page.errors, []);
    } finally { await page.close(); }
});

test('S2 counts 1-4, custom order, active highlighting and canonical trigger updates', async () => {
    for (const count of [1, 2, 3, 4]) {
        const page = await boot(count);
        try {
            await page.locator(layoutTrigger).click();
            assert.deepEqual(await page.locator('#master-layout-shortcuts button').evaluateAll((ns) => ns.map((n) => n.dataset.layout)), order.slice(0, count));
            await page.locator('#master-layout-shortcuts [data-layout="vsplit"]').click();
            await assertFloorplan(page, 'vsplit');
            assert.equal(await page.locator('#master-layout-shortcuts .active').getAttribute('data-layout'), 'vsplit');
            assert.equal(await page.locator('#triple-layout').evaluate((n) => n.classList.contains('layout-vsplit')), true);
            assert.deepEqual(await page.evaluate(() => [localStorage.getItem('grid_layout_slot_count'), JSON.parse(localStorage.getItem('grid_layout_slot_order'))]), [String(count), order]);
            await page.locator('#btn-toggle-master').click();
            await page.locator('#btn-toggle-master').click();
            await assertFloorplan(page, 'vsplit');
            assert.equal(await expanded(page), 'false');
            // Existing external layout action also updates the collapsed trigger.
            await page.evaluate(() => document.getElementById('btn-layout-righttall').click());
            await assertFloorplan(page, 'righttall');
            assert.equal(await expanded(page), 'false');
            await page.locator(layoutTrigger).click();
            await page.locator('#btn-master-layout-overflow').click();
            assert.deepEqual(await page.locator('#master-layout-tier2 button').evaluateAll(ns => ns.map(n => n.dataset.layout)), order.slice(count));
            assert.equal(await page.locator('#master-layout-body [data-layout]').count(), 8);
            assert.deepEqual(page.errors, []);
        } finally { await page.close(); }
    }
});

test('S3 overflow reveals omitted layouts inline and resets with its parent', async () => {
    const page = await boot(1);
    try {
        await page.locator(layoutTrigger).click();
        const height = await page.locator('#master-bar').evaluate(n => n.getBoundingClientRect().height);
        await page.locator('#btn-master-layout-overflow .layout-icon i').first().click();
        assert.equal(await page.locator('#master-layout-menu').count(), 0);
        assert.equal(await page.locator('#master-layout-tier2').isVisible(), true);
        assert.deepEqual(await page.locator('#master-layout-tier2 button').evaluateAll(ns => ns.map(n => n.dataset.layout)), order.slice(1));
        const tier2 = await page.locator('#master-layout-tier2').boundingBox();
        const tier1 = await page.locator('#master-layout-shortcuts').boundingBox();
        assert.ok(tier2.x + tier2.width <= tier1.x);
        assert.equal(await page.locator('#master-bar').evaluate(n => n.getBoundingClientRect().height), height);
        assert.equal(await page.locator('#master-layout-tier2 .active').getAttribute('data-layout'), 'lefttall');
        await page.locator('#btn-layout-hsplit').click();
        await assertFloorplan(page, 'hsplit');
        assert.equal(await page.locator('#triple-layout').evaluate(n => n.classList.contains('layout-hsplit')), true);
        assert.equal(await page.evaluate(async () => (await import('./js/grid-session.js')).getSessionLayout()), 'hsplit');
        assert.equal(await page.locator('#master-layout-tier2 .active').getAttribute('data-layout'), 'hsplit');
        // Selection retains the existing open-group behavior.
        await page.keyboard.press('Escape');
        for (const dismiss of ['toggle', 'shuffle', 'escape', 'outside', 'minimize']) {
            await page.locator(layoutTrigger).click();
            assert.equal(await page.locator('#btn-master-layout-overflow').getAttribute('aria-expanded'), 'false');
            await page.locator('#btn-master-layout-overflow').click();
            if (dismiss === 'toggle') await page.locator(layoutTrigger).click();
            if (dismiss === 'shuffle') await page.locator(shuffleTrigger).click();
            if (dismiss === 'escape') await page.keyboard.press('Escape');
            if (dismiss === 'outside') await page.locator('#btn-master-overflow').click();
            if (dismiss === 'minimize') await page.locator('#btn-toggle-master').click();
            assert.equal(await page.locator('#master-layout-tier2').isVisible(), false, dismiss);
            await page.keyboard.press('Escape');
            assert.equal(await expanded(page), 'false');
        }
        assert.deepEqual(page.errors, []);
    } finally { await page.close(); }
});

test('S3 disclosure tiers leave Store, history, media and Panel geometry untouched', async () => {
    const page = await boot();
    try {
        const before = await page.evaluate(async () => {
            window.s = await import('./js/grid-session.js');
            window.Store = (await import('./js/storage.js')).Store;
            window.beforeFrames = [...document.querySelectorAll('.stream-panel iframe')];
            window.parents = beforeFrames.map((f) => f.parentNode);
            window.loads = 0; window.writes = 0; window.srcWrites = 0;
            beforeFrames.forEach((f) => {
                f.addEventListener('load', () => window.loads++);
                new MutationObserver((records) => window.srcWrites += records.length).observe(f, { attributes: true, attributeFilter: ['src'] });
            });
            const set = Store.set.bind(Store);
            Store.set = (...args) => { window.writes++; return set(...args); };
            window.snapshot = () => JSON.stringify([s.getSessionPanels(), s.getSessionArrangement(), s.getSessionLayout(), s.getGridHistory(), { ...localStorage },
                [...document.querySelectorAll('.stream-panel')].map((n) => n.getBoundingClientRect().toJSON())]);
            return snapshot();
        });
        for (let i = 0; i < 3; i++) {
            await page.locator(layoutTrigger).click();
            await page.locator('#btn-master-layout-overflow').click();
            await page.keyboard.press('Escape');
        }
        await page.locator(layoutTrigger).click();
        await page.locator(shuffleTrigger).click();
        await page.keyboard.press('Escape');
        const result = await page.evaluate(() => ({ state: snapshot(), loads, writes, srcWrites,
            same: beforeFrames.every((f, i) => f === document.querySelectorAll('.stream-panel iframe')[i] && f.parentNode === parents[i]) }));
        assert.equal(result.state, before);
        assert.equal(result.loads, 0); assert.equal(result.writes, 0); assert.equal(result.srcWrites, 0); assert.ok(result.same);
        assert.deepEqual(page.errors, []);
    } finally { await page.close(); }
});

test('S2 layouts and overflow stay reachable within the scrolling single row at narrow CSS viewports', async () => {
    const page = await boot(4);
    try {
        for (const width of [1280, 900, 700, 640, 480, 360]) {
            await page.setViewportSize({ width, height: 800 });
            const h = await page.locator('#master-bar').evaluate((n) => n.getBoundingClientRect().height);
            await page.locator(layoutTrigger).click();
            assert.equal(await page.locator('#master-bar').evaluate((n) => n.getBoundingClientRect().height), h);
            assert.ok(await page.evaluate(() => document.querySelector('.master-shell-content').getBoundingClientRect().right <= document.querySelector('#orchestration-dock').getBoundingClientRect().left));
            for (const selector of ['#master-layout-shortcuts button', '#btn-master-layout-overflow', layoutTrigger, '#btn-master-overflow']) {
                for (const n of await page.locator(selector).all()) {
                    await n.scrollIntoViewIfNeeded();
                    assert.ok(await n.evaluate((n) => {
                        const r = n.getBoundingClientRect();
                        return n.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
                    }), `${selector} reachable at ${width}`);
                }
            }
            await page.locator('#btn-master-layout-overflow').click();
            for (const button of await page.locator('#master-layout-tier2 button').all()) {
                await button.scrollIntoViewIfNeeded();
                assert.ok(await button.evaluate(n => {
                    const r = n.getBoundingClientRect();
                    return n.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
                }), `Tier 2 reachable at ${width}`);
            }
            await page.locator('#btn-layout-lefttall').click();
            await assertFloorplan(page, 'lefttall');
            assert.equal(await expanded(page), 'false');
        }
        assert.deepEqual(page.errors, []);
    } finally { await page.close(); }
});
