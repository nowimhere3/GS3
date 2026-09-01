import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 4173;
const ORIGIN = `http://127.0.0.1:${PORT}`;
let server;
let browser;

before(async () => {
    server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], {
        cwd: process.cwd(), stdio: 'ignore',
    });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        const deadline = Date.now() + 5000;
        const probe = async () => {
            try {
                const response = await fetch(ORIGIN);
                if (response.ok) return resolve();
            } catch {}
            if (Date.now() >= deadline) return reject(new Error('HTTP test server did not start'));
            setTimeout(probe, 50);
        };
        probe();
    });
    browser = await chromium.launch({ headless: true });
});

after(async () => {
    await browser?.close();
    server?.kill();
});

for (const pageName of ['index.html', 'index2.html', 'index3.html', 'settings.html']) {
    test(`${pageName} boots its module graph without application errors`, async () => {
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', (error) => errors.push(`uncaught: ${error.message}`));
        page.on('console', (message) => {
            // Chromium reports handled HTTP failures itself. They are network
            // diagnostics, not console.error calls made by application code.
            if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) {
                errors.push(`console.error: ${message.text()}`);
            }
        });
        await page.route(/^https?:\/\/(?!127\.0\.0\.1:4173).*/, (route) =>
            route.fulfill({ status: 204, body: '' }));
        await page.goto(`${ORIGIN}/${pageName}`, { waitUntil: 'networkidle' });
        await page.waitForTimeout(100);
        assert.deepEqual(errors, []);
        await page.close();
    });
}

test('workspace UI is data-driven and shows Live Builder plus presets 1-9', async () => {
    const page = await browser.newPage();
    await page.goto(`${ORIGIN}/index.html`, { waitUntil: 'networkidle' });
    const labels = await page.locator('#workspace-tabs button').allTextContents();
    assert.equal(labels.length, 10);
    assert.match(labels[0], /Live Builder/);
    for (let id = 1; id <= 9; id += 1) assert.match(labels[id], new RegExp(`Preset ${id}`));
    await page.close();
});

test('legacy remote presets 1-5 normalize to nine without changing remote entries', async () => {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
        if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) errors.push(message.text());
    });
    const remote = Array.from({ length: 5 }, (_, index) => ({
        id: index + 1, name: `Remote ${index + 1}`, panels: [], folderMap: {}, lockState: {},
        layout: index === 0 ? 'righttall' : null, rowCount: 0, streamCount: 0,
        isEmpty: true, savedAt: `2026-01-0${index + 1}T00:00:00.000Z`,
        customMetadata: { preserved: index + 1 },
    }));
    const encode = (value) => Buffer.from(JSON.stringify(value, null, 2)).toString('base64');
    await page.addInitScript(() => {
        localStorage.setItem('git_sync_token', 'test-token');
        localStorage.setItem('git_sync_repo', 'owner/repo');
    });
    await page.route('https://api.github.com/**', async (route) => {
        const pathname = new URL(route.request().url()).pathname;
        if (pathname.endsWith('/contents/links-index.json')) {
            await route.fulfill({ status: 404, body: '{}' });
        } else if (pathname.endsWith('/contents/links.json')) {
            await route.fulfill({ json: { sha: 'links-sha', encoding: 'base64', content: encode({}) } });
        } else if (pathname.endsWith('/contents/presets.json')) {
            await route.fulfill({ json: { sha: 'presets-sha', encoding: 'base64', content: encode(remote) } });
        } else {
            await route.fulfill({ status: 404, body: '{}' });
        }
    });
    await page.goto(`${ORIGIN}/index.html`, { waitUntil: 'networkidle' });
    assert.deepEqual(errors, []);
    assert.equal(await page.locator('#workspace-tabs button').count(), 10);
    const loaded = await page.evaluate(async () => {
        const { getPresetsStructure } = await import('./js/state.js');
        return getPresetsStructure();
    });
    assert.deepEqual(loaded.slice(0, 5), remote);
    assert.deepEqual(loaded.slice(5).map((preset) => preset.id), [6, 7, 8, 9]);
    assert.ok(loaded.slice(5).every((preset) => preset.isEmpty && preset.panels.length === 0));
    await page.close();
});

test('Solo controls are explicitly disabled when no database is available', async () => {
    const page = await browser.newPage();
    await page.goto(`${ORIGIN}/index2.html`, { waitUntil: 'networkidle' });
    const disabled = await page.locator('#btn-folder, #btn-favorite, #btn-purge, #btn-delete-replace, #btn-shuffle, #btn-shuffle-all, #btn-toggle-master').evaluateAll(
        (buttons) => buttons.map((button) => button.disabled)
    );
    assert.equal(disabled.length, 7);
    assert.ok(disabled.every(Boolean));
    await page.close();
});

test('typed URL persists and Launch Grid receives the exact visible value', async () => {
    const page = await browser.newPage();
    await page.route(/^https?:\/\/(?!127\.0\.0\.1:4173).*/, (route) => route.fulfill({ status: 204, body: '' }));
    await page.goto(`${ORIGIN}/index.html`, { waitUntil: 'networkidle' });
    const exactUrl = 'https://example.test/latest-visible-edit?value=exact';
    await page.locator('.url-grid-field').first().fill(exactUrl);
    const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('loop_matrix_urls'))[0]);
    assert.equal(persisted, exactUrl);
    await Promise.all([
        page.waitForURL(/index3\.html\?workspace=live/),
        page.locator('#btn-launch-grid').click(),
    ]);
    assert.equal(await page.locator('#screen-1-slot iframe').getAttribute('src'), exactUrl);
    await page.close();
});

test('position swap and Undo preserve iframe nodes, parents, loads, and canary contexts', async () => {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    await page.route(/^https?:\/\/(?!127\.0\.0\.1:4173).*/, (route) => route.fulfill({ status: 204, body: '' }));
    await page.addInitScript(() => {
        if (window === window.top) localStorage.setItem('loop_matrix_urls', JSON.stringify([
            '/test/fixtures/canary.html?id=A', '/test/fixtures/canary.html?id=B', '/test/fixtures/canary.html?id=C'
        ]));
    });
    await page.goto(`${ORIGIN}/index3.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelectorAll('.stream-panel iframe').length === 4);
    await page.waitForTimeout(200);
    const framesBefore = page.frames().filter((frame) => frame.url().includes('/test/fixtures/canary.html'));
    assert.equal(framesBefore.length, 3);
    const canariesBefore = await Promise.all(framesBefore.map((frame) => frame.evaluate(() => ({
        startedAt: window.__canaryStartedAt, ticks: window.__canaryTicks,
    }))));
    await page.evaluate(() => {
        window.__swapProbe = [...document.querySelectorAll('.stream-panel iframe')].map((iframe) => ({
            iframe, parent: iframe.closest('[id^="screen-"]'), loads: 0,
        }));
        window.__areasBefore = [...document.querySelectorAll('[id^="screen-"][id$="-slot"]')]
            .map((slot) => getComputedStyle(slot).gridArea);
        window.__swapProbe.forEach((probe) => probe.iframe.addEventListener('load', () => { probe.loads += 1; }));
    });
    await page.evaluate(() => document.querySelector('.btn-hotswap-position').click());
    await page.evaluate(() => document.querySelector('.hotswap-position-item').click());
    assert.equal(await page.locator('#btn-master-undo').isDisabled(), false);
    await page.evaluate(() => document.getElementById('btn-master-undo').click());
    await page.waitForTimeout(100);
    const canariesAfter = await Promise.all(framesBefore.map((frame) => frame.evaluate(() => ({
        startedAt: window.__canaryStartedAt, ticks: window.__canaryTicks,
    }))));
    const probe = await page.evaluate(() => ({
        zeroLoads: window.__swapProbe.every((item) => item.loads === 0),
        sameNodes: window.__swapProbe.every((item) => item.iframe.isConnected),
        sameParents: window.__swapProbe.every((item) => item.iframe.closest('[id^="screen-"]') === item.parent),
        arrangementRestored: [...document.querySelectorAll('[id^="screen-"][id$="-slot"]')]
            .every((slot, index) => getComputedStyle(slot).gridArea === window.__areasBefore[index]),
    }));
    probe.sameContexts = canariesAfter.every((value, index) => value.startedAt === canariesBefore[index].startedAt);
    probe.countersAdvanced = canariesAfter.every((value, index) => value.ticks > canariesBefore[index].ticks);
    assert.deepEqual(probe, {
        zeroLoads: true, sameNodes: true, sameParents: true, sameContexts: true,
        countersAdvanced: true, arrangementRestored: true,
    });
    await page.close();
});

test('single URL Undo reloads only the changed panel and preserves untouched canaries', async () => {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    await page.route(/^https?:\/\/(?!127\.0\.0\.1:4173).*/, (route) => route.fulfill({ status: 204, body: '' }));
    await page.addInitScript(() => {
        if (window === window.top) localStorage.setItem('loop_matrix_urls', JSON.stringify([
            '/test/fixtures/canary.html?id=A', '/test/fixtures/canary.html?id=B', '/test/fixtures/canary.html?id=C'
        ]));
    });
    await page.goto(`${ORIGIN}/index3.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelectorAll('.stream-panel iframe').length === 4);
    await page.waitForTimeout(200);
    const framesBefore = page.frames().filter((frame) => frame.url().includes('/test/fixtures/canary.html'));
    assert.equal(framesBefore.length, 3);
    const untouchedBefore = await Promise.all([framesBefore[0], framesBefore[2]].map((frame) => frame.evaluate(() => ({
        startedAt: window.__canaryStartedAt, ticks: window.__canaryTicks,
    }))));
    await page.evaluate(() => {
        window.__urlProbe = [...document.querySelectorAll('.stream-panel iframe')].map((iframe) => ({
            iframe, parent: iframe.closest('[id^="screen-"]'), loads: 0,
        }));
        window.__urlProbe.forEach((probe) => probe.iframe.addEventListener('load', () => { probe.loads += 1; }));
        const panel = document.querySelectorAll('.stream-panel')[1];
        panel.querySelector('.btn-hotswap-toggle').click();
        panel.querySelector('.hotswap-input').value = '/test/fixtures/canary.html?id=D';
        panel.querySelector('.hotswap-submit-btn').click();
    });
    await page.waitForLoadState('networkidle');
    assert.equal(await page.locator('#btn-master-undo').isDisabled(), false);
    await page.evaluate(() => document.getElementById('btn-master-undo').click());
    await page.waitForFunction(() => document.querySelectorAll('.stream-panel iframe')[1].getAttribute('data-last-src').endsWith('?id=B'));
    await page.waitForTimeout(100);
    const untouchedAfter = await Promise.all([framesBefore[0], framesBefore[2]].map((frame) => frame.evaluate(() => ({
        startedAt: window.__canaryStartedAt, ticks: window.__canaryTicks,
    }))));
    const probe = await page.evaluate(() => ({
        restoredB: document.querySelectorAll('.stream-panel iframe')[1].getAttribute('data-last-src').endsWith('?id=B'),
        untouchedZeroLoads: [0, 2].every((index) => window.__urlProbe[index].loads === 0),
        changedPanelReloaded: window.__urlProbe[1].loads >= 2,
        sameNodes: window.__urlProbe.every((item) => item.iframe.isConnected),
        sameParents: window.__urlProbe.every((item) => item.iframe.closest('[id^="screen-"]') === item.parent),
    }));
    probe.untouchedContexts = untouchedAfter.every((value, index) => value.startedAt === untouchedBefore[index].startedAt);
    probe.untouchedCountersAdvanced = untouchedAfter.every((value, index) => value.ticks > untouchedBefore[index].ticks);
    assert.deepEqual(probe, {
        restoredB: true, untouchedZeroLoads: true, changedPanelReloaded: true,
        sameNodes: true, sameParents: true, untouchedContexts: true, untouchedCountersAdvanced: true,
    });
    await page.close();
});

test('metadata-only folder Undo does not reload any live panel', async () => {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    await page.route(/^https?:\/\/(?!127\.0\.0\.1:4173).*/, (route) => route.fulfill({ status: 204, body: '' }));
    await page.addInitScript(() => {
        if (window === window.top) localStorage.setItem('loop_matrix_urls', JSON.stringify([
            '/test/fixtures/canary.html?id=A', '/test/fixtures/canary.html?id=B', '/test/fixtures/canary.html?id=C'
        ]));
    });
    await page.goto(`${ORIGIN}/index3.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelectorAll('.stream-panel iframe').length === 4);
    await page.evaluate(async () => {
        const { setDatabaseStructure } = await import('./js/state.js');
        setDatabaseStructure({ Empty: [] });
        const panel = document.querySelector('.stream-panel');
        panel.querySelector('.btn-hotswap-folder').click();
        panel.querySelector('.hotswap-folder-item').click();
    });
    await page.waitForTimeout(150);
    const frames = page.frames().filter((frame) => frame.url().includes('/test/fixtures/canary.html'));
    const before = await Promise.all(frames.map((frame) => frame.evaluate(() => ({
        startedAt: window.__canaryStartedAt, ticks: window.__canaryTicks,
    }))));
    await page.evaluate(() => {
        window.__metadataProbe = [...document.querySelectorAll('.stream-panel iframe')].map((iframe) => ({
            iframe, parent: iframe.closest('[id^="screen-"]'), loads: 0,
        }));
        window.__metadataProbe.forEach((probe) => probe.iframe.addEventListener('load', () => { probe.loads += 1; }));
        document.getElementById('btn-master-undo').click();
    });
    await page.waitForTimeout(100);
    const after = await Promise.all(frames.map((frame) => frame.evaluate(() => ({
        startedAt: window.__canaryStartedAt, ticks: window.__canaryTicks,
    }))));
    const probe = await page.evaluate(() => ({
        zeroLoads: window.__metadataProbe.every((item) => item.loads === 0),
        sameNodes: window.__metadataProbe.every((item) => item.iframe.isConnected),
        sameParents: window.__metadataProbe.every((item) => item.iframe.closest('[id^="screen-"]') === item.parent),
    }));
    probe.sameContexts = after.every((value, index) => value.startedAt === before[index].startedAt);
    probe.countersAdvanced = after.every((value, index) => value.ticks > before[index].ticks);
    assert.deepEqual(probe, {
        zeroLoads: true, sameNodes: true, sameParents: true, sameContexts: true, countersAdvanced: true,
    });
    await page.close();
});

test('Save Session As writes current layout to Preset 6 and leaves source untouched', async () => {
    const page = await browser.newPage();
    await page.route(/^https?:\/\/(?!127\.0\.0\.1:4173).*/, (route) => route.fulfill({ status: 204, body: '' }));
    await page.goto(`${ORIGIN}/index3.html?workspace=2`, { waitUntil: 'networkidle' });
    const sourceBefore = await page.evaluate(async () => {
        const { getPresetsStructure } = await import('./js/state.js');
        return structuredClone(getPresetsStructure().find((preset) => preset.id === 2));
    });
    await page.evaluate(() => document.getElementById('btn-layout-righttall').click());
    await page.evaluate(() => document.getElementById('btn-master-save').click());
    await page.evaluate(() => {
        const item = [...document.querySelectorAll('.save-session-item')]
            .find((candidate) => candidate.textContent.includes('Preset 6'));
        if (!item) throw new Error('Preset 6 was not listed by Save Session As');
        item.click();
    });
    await page.waitForTimeout(50);
    const result = await page.evaluate(async () => {
        const { getPresetsStructure } = await import('./js/state.js');
        const presets = getPresetsStructure();
        return { source: presets.find((preset) => preset.id === 2), target: presets.find((preset) => preset.id === 6) };
    });
    assert.deepEqual(result.source, sourceBefore);
    assert.equal(result.target.layout, 'righttall');
    assert.ok(Array.isArray(result.target.panels));
    assert.equal(typeof result.target.folderMap, 'object');
    await page.close();
});
