import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 4173;
const ORIGIN = `http://127.0.0.1:${PORT}`;
// A SECOND server on the same host, serving the same files, on another port.
// Same host so it always resolves (unlike `localhost`, which can resolve to ::1
// while the harness binds IPv4 only), different port so the browser treats it
// as a genuinely different ORIGIN — which is what makes cross-origin reads
// really throw SecurityError in the opaque-navigation test.
const CROSS_PORT = 4174;
const CROSS_ORIGIN = `http://127.0.0.1:${CROSS_PORT}`;
let server;
let crossServer;
let browser;

function startServer(port) {
    const child = spawn(process.platform === 'win32' ? 'python' : 'python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], {
        cwd: process.cwd(), stdio: 'ignore',
    });
    return new Promise((resolve, reject) => {
        child.once('error', reject);
        const deadline = Date.now() + 5000;
        const probe = async () => {
            try {
                const response = await fetch(`http://127.0.0.1:${port}`);
                // Drain the body. An unconsumed response keeps its socket (and
                // undici's stream state) alive past the run, which surfaces as a
                // spurious "asynchronous activity after the test ended" failure.
                await response.arrayBuffer();
                if (response.ok) return resolve(child);
            } catch {}
            if (Date.now() >= deadline) return reject(new Error(`HTTP test server on ${port} did not start`));
            setTimeout(probe, 50);
        };
        probe();
    });
}

before(async () => {
    server = await startServer(PORT);
    crossServer = await startServer(CROSS_PORT);
    browser = await chromium.launch({ headless: true });
});

after(async () => {
    await browser?.close();
    server?.kill();
    crossServer?.kill();
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

test('workspace selector projects the canonical selected preset immediately and after reload', async () => {
    const page = await browser.newPage();
    const presets = Array.from({ length: 9 }, (_, index) => ({
        id: index + 1, name: index === 0 ? 'Cleaned Bookmarks' : `Preset ${index + 1}`,
        panels: [], folderMap: {}, lockState: {}, layout: null, rowCount: 0,
        streamCount: 0, isEmpty: true, savedAt: null,
    }));
    const encode = (value) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
    await page.addInitScript(() => {
        localStorage.setItem('git_sync_token', 'test-token');
        localStorage.setItem('git_sync_repo', 'owner/repo');
        localStorage.setItem('workspace_active_id', '1');
    });
    await page.route('https://api.github.com/**', (route) => route.fulfill({
        json: { sha: 'preset-labels', encoding: 'base64', content: encode(presets) },
    }));
    await page.goto(`${ORIGIN}/index.html`, { waitUntil: 'networkidle' });
    const activeLabel = () => page.locator('#workspace-tabs .workspace-tab.active .workspace-tab-name').textContent();
    assert.match(await activeLabel(), /Cleaned Bookmarks/);
    await page.locator('#workspace-tabs .workspace-tab').filter({ hasText: 'Preset 2' }).click();
    assert.match(await activeLabel(), /Preset 2/);
    await page.locator('#workspace-tabs .workspace-tab').filter({ hasText: 'Preset 5' }).click();
    assert.match(await activeLabel(), /Preset 5/);
    await page.locator('#workspace-tabs .workspace-tab').filter({ hasText: 'Cleaned Bookmarks' }).click();
    assert.match(await activeLabel(), /Cleaned Bookmarks/);
    await page.reload({ waitUntil: 'networkidle' });
    assert.match(await activeLabel(), /Cleaned Bookmarks/, 'reload projects the persisted canonical selection');
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

test('Builder Shuffle Scope stays sticky, Shuffle All preserves it, and dropdown rebuild is non-mutating', async () => {
    const page = await browser.newPage();
    await page.goto(`${ORIGIN}/index.html`, { waitUntil: 'networkidle' });
    await page.evaluate(async () => {
        const { setDatabaseStructure } = await import('./js/state.js');
        const { updateDirectoryDropdown } = await import('./js/folders.js');
        const db = Object.fromEntries(['A', 'B', 'C', 'D'].map((folder) => [folder,
            Array.from({ length: 20 }, (_, i) => `https://fixture.test/${folder}/${i}`)]));
        setDatabaseStructure(db);
        updateDirectoryDropdown(document.getElementById('directory-dropdown'));
    });
    await page.locator('#directory-dropdown').selectOption('A');

    for (let press = 0; press < 50; press += 1) {
        const state = await page.evaluate(() => {
            document.getElementById('dice-shuffle-btn').click();
            return {
                dropdown: document.getElementById('directory-dropdown').value,
                stored: localStorage.getItem('builder_shuffle_folder'),
                urls: [...document.querySelectorAll('.url-grid-field')].map((input) => input.value),
            };
        });
        assert.equal(state.dropdown, 'A');
        assert.equal(state.stored, 'A');
        assert.ok(state.urls.every((url) => url.includes('/A/')));
    }

    await page.locator('#dice-shuffle-all-btn').click();
    assert.deepEqual(await page.evaluate(() => ({
        dropdown: document.getElementById('directory-dropdown').value,
        stored: localStorage.getItem('builder_shuffle_folder'),
    })), { dropdown: 'A', stored: 'A' });
    await page.locator('#dice-shuffle-btn').click();
    assert.ok((await page.locator('.url-grid-field').evaluateAll((inputs) => inputs.map((input) => input.value)))
        .every((url) => url.includes('/A/')));

    const rebuild = await page.evaluate(async () => {
        const { getDatabaseStructure, setDatabaseStructure, getTargetUrls } = await import('./js/state.js');
        const { updateDirectoryDropdown } = await import('./js/folders.js');
        const select = document.getElementById('directory-dropdown');
        const before = [...getTargetUrls()];
        updateDirectoryDropdown(select);
        const preserved = { value: select.value, stored: localStorage.getItem('builder_shuffle_folder'),
            gridUnchanged: JSON.stringify(before) === JSON.stringify(getTargetUrls()) };
        const db = getDatabaseStructure();
        delete db.A;
        setDatabaseStructure(db);
        updateDirectoryDropdown(select);
        return { preserved, fallback: select.value, stored: localStorage.getItem('builder_shuffle_folder'),
            gridUnchanged: JSON.stringify(before) === JSON.stringify(getTargetUrls()) };
    });
    assert.deepEqual(rebuild.preserved, { value: 'A', stored: 'A', gridUnchanged: true });
    assert.equal(rebuild.fallback, 'B');
    assert.equal(rebuild.stored, 'B');
    assert.equal(rebuild.gridUnchanged, true);
    await page.close();
});

test('Runtime unassigned Shuffle availability is canonical and ROOT-changing actions resync it', async () => {
    const page = await bootCanaryGrid();
    const result = await page.evaluate(async () => {
        const { setDatabaseStructure } = await import('./js/state.js');
        const { updateRenderedPanel } = await import('./js/launch.js');
        setDatabaseStructure({ CARS: ['/test/fixtures/canary.html?id=car'], PETS: ['/test/fixtures/canary.html?id=pet'] });
        const panel = document.querySelectorAll('.stream-panel')[0];
        updateRenderedPanel(panel, { folder: '' });
        const availability = () => ({
            tray: panel.querySelector('.btn-hotswap-shuffle').disabled,
            mirrors: [...panel.querySelectorAll('.hotswap-mirror-btn[data-action-key="shuffle"]')]
                .map((button) => button.disabled),
            shuffleAll: panel.querySelector('.btn-hotswap-shuffle-all').disabled,
            folder: panel.querySelector('.btn-hotswap-folder').disabled,
            edit: panel.querySelector('.btn-hotswap-toggle').disabled,
            root: panel.querySelector('iframe').getAttribute('data-source-folder'),
        });
        const unassigned = availability();
        panel.querySelector('.btn-hotswap-shuffle-all').click();
        const afterAll = availability();
        panel.querySelector('.btn-hotswap-toggle').click();
        panel.querySelector('.hotswap-input').value = '/test/fixtures/canary.html?id=manual';
        panel.querySelector('.hotswap-submit-btn').click();
        const afterEditAssigned = availability();
        updateRenderedPanel(panel, { folder: '' });
        panel.querySelector('.btn-hotswap-toggle').click();
        panel.querySelector('.hotswap-input').value = '/test/fixtures/canary.html?id=unknown';
        panel.querySelector('.hotswap-submit-btn').click();
        const afterEditUnassigned = availability();
        return { unassigned, afterAll, afterEditAssigned, afterEditUnassigned };
    });
    assert.equal(result.unassigned.tray, true);
    assert.ok(result.unassigned.mirrors.every(Boolean));
    assert.equal(result.unassigned.shuffleAll, false);
    assert.equal(result.unassigned.folder, false);
    assert.equal(result.unassigned.edit, false);
    assert.ok(['CARS', 'PETS'].includes(result.afterAll.root));
    assert.equal(result.afterAll.tray, false);
    assert.equal(result.afterEditAssigned.root, result.afterAll.root);
    assert.equal(result.afterEditAssigned.tray, false);
    assert.equal(result.afterEditUnassigned.root, '');
    assert.equal(result.afterEditUnassigned.tray, true);
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
    // The panel's OWN Position is listed but disabled — pick a real destination.
    await page.evaluate(() => document.querySelector('.hotswap-position-item:not(.current)').click());
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

// ─────────────────────────────────────────────────────────────────────────────
// Part 1-6: Builder rehydration / data-loss fix.
//
// The human's exact scenario: Preset 5 active in the Builder, Launch Grid,
// change the Runtime, Save Session As back into Preset 5, return to the
// Builder. Before the fix the Builder kept rendering its stale pre-launch
// rows, and the NEXT Builder edit mirrored those stale rows back over the
// Preset, destroying the Runtime save. This drives the real UI end to end
// across a real page navigation (not a direct function call), against a
// mocked GitHub backend, so persistence genuinely round-trips like production.
// ─────────────────────────────────────────────────────────────────────────────

test('Builder rehydrates a stale Workspace projection instead of clobbering a Runtime save', async () => {
    const page = await browser.newPage();
    page.setDefaultTimeout(8000);
    await page.route(/^https?:\/\/(?!127\.0\.0\.1:4173|api\.github\.com).*/, (route) =>
        route.fulfill({ status: 204, body: '' }));

    const encode = (value) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
    const decode = (base64) => JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
    const emptyPreset = (id) => ({
        id, name: `Preset ${id}`, panels: [], folderMap: {}, lockState: {}, layout: null,
        rowCount: 0, streamCount: 0, isEmpty: true, savedAt: null,
    });
    // The human's exact scenario: 4 rows, with a duplicate the Runtime edit
    // collapses. The Grid Runtime session always resolves 4 slots regardless
    // of layout — an unspecified slot is auto-filled with 'https://example.com'
    // — so all 4 are supplied explicitly here to keep the session fully
    // deterministic.
    const X = [
        '/test/fixtures/canary.html?id=A1', '/test/fixtures/canary.html?id=A1',
        '/test/fixtures/canary.html?id=B1', '/test/fixtures/canary.html?id=C1',
    ];
    let remotePresets = [1, 2, 3, 4].map(emptyPreset).concat([{
        id: 5, name: 'Preset 5', panels: X, folderMap: {}, lockState: {}, layout: null,
        rowCount: X.length, streamCount: X.length, isEmpty: false, savedAt: '2026-01-01T00:00:00.000Z',
    }]).concat([6, 7, 8, 9].map(emptyPreset));
    let remoteSha = 'sha-0';

    await page.route('https://api.github.com/**', async (route) => {
        const req = route.request();
        const pathname = new URL(req.url()).pathname;
        if (!pathname.endsWith('/contents/presets.json')) {
            await route.fulfill({ status: 404, body: '{}' });
            return;
        }
        if (req.method() === 'PUT') {
            remotePresets = decode(JSON.parse(req.postData()).content);
            remoteSha = `sha-${Date.now()}`;
            await route.fulfill({ json: { content: { sha: remoteSha } } });
        } else {
            await route.fulfill({ json: { sha: remoteSha, encoding: 'base64', content: encode(remotePresets) } });
        }
    });

    await page.addInitScript(() => {
        localStorage.setItem('git_sync_token', 'test-token');
        localStorage.setItem('git_sync_repo', 'owner/repo');
        localStorage.setItem('workspace_active_id', '5');
    });

    // 1. Builder boots directly into Preset 5 and shows its persisted content
    //    (a fresh boot with nothing in Store yet also exercises the rehydrate
    //    path, since an empty Store surface diverges from the Preset).
    await page.goto(`${ORIGIN}/index.html`, { waitUntil: 'networkidle' });
    // The DOM renders 3 EMPTY rows immediately on boot, before presets.json
    // has even been fetched — waiting on row count alone would race the
    // rehydrate this test exists to prove. Wait on the actual values instead.
    await page.waitForFunction((expected) =>
        [...document.querySelectorAll('.url-grid-field')].map((i) => i.value).join('|') === expected.join('|'), X);
    const rowsBefore = await page.locator('.url-grid-field').evaluateAll((inputs) => inputs.map((i) => i.value));
    assert.deepEqual(rowsBefore, X, 'Builder shows the persisted Preset 5 content');

    // 2. Edit a row and IMMEDIATELY Launch Grid, with no pause for the 1500ms
    //    debounce — proving the pending preset mirror is flushed rather than
    //    abandoned to a dying timer when the page navigates away.
    const X0_EDITED = '/test/fixtures/canary.html?id=A2';
    await page.locator('.url-grid-field').first().fill(X0_EDITED);
    await Promise.all([
        page.waitForURL(/index3\.html/),
        page.click('#btn-launch-grid'),
    ]);
    await page.waitForFunction(() => document.querySelectorAll('.stream-panel iframe').length === 4);
    const XFlushed = [X0_EDITED, X[1], X[2], X[3]];
    const initialSessionUrls = await page.evaluate(async () => {
        const { getSessionUrls } = await import('./js/grid-session.js');
        return getSessionUrls();
    });
    assert.deepEqual(initialSessionUrls, XFlushed,
        'the flushed edit reached the Preset before the Runtime read it, not just before navigation');

    // 3. Change ONE panel in the Runtime — row 1, collapsing the duplicate.
    // This is the human's exact scenario: [A2, A1, B1, C1] -> [A2, B1, B1, C1].
    const Y = [X0_EDITED, X[2], X[2], X[3]];
    await page.evaluate((newUrl) => {
        const panel = document.querySelectorAll('.stream-panel')[1];
        panel.querySelector('.btn-hotswap-toggle').click();
        panel.querySelector('.hotswap-input').value = newUrl;
        panel.querySelector('.hotswap-submit-btn').click();
    }, Y[1]);
    await page.waitForLoadState('networkidle');

    // 4. Save Session As -> Preset 5, the SAME preset the Runtime came from.
    await page.evaluate(() => document.getElementById('btn-master-save').click());
    await Promise.all([
        page.waitForResponse((res) =>
            res.url().endsWith('/contents/presets.json') && res.request().method() === 'PUT'),
        page.evaluate(() => {
            const item = [...document.querySelectorAll('.save-session-item')]
                .find((candidate) => candidate.textContent.includes('Preset 5'));
            if (!item) throw new Error('Preset 5 was not listed by Save Session As');
            item.click();
        }),
    ]);
    assert.deepEqual(remotePresets.find((p) => p.id === 5).panels.map((p) => p.source ?? p), Y,
        'the mocked remote actually received the Runtime save');

    // 5. Return to the Builder via a FRESH full page load. Preset 5 is still
    //    active — exactly the path that used to render stale rows and then
    //    clobber the Runtime save on the next edit.
    await page.goto(`${ORIGIN}/index.html`, { waitUntil: 'networkidle' });
    await page.waitForFunction((expected) =>
        [...document.querySelectorAll('.url-grid-field')].map((i) => i.value).join('|') === expected.join('|'),
        Y);
    const rowsAfter = await page.locator('.url-grid-field').evaluateAll((inputs) => inputs.map((i) => i.value));
    assert.deepEqual(rowsAfter, Y, 'Builder rehydrates to the Runtime save instead of staying stale');

    // 6. The next Builder edit must land on TOP of the rehydrated content, not
    //    clobber it with the stale pre-launch rows (the actual data-loss bug).
    await page.locator('.url-grid-field').first().fill('/test/fixtures/canary.html?id=EDITED');
    await page.waitForTimeout(1700); // past the 1500ms debounce
    assert.deepEqual(remotePresets.find((p) => p.id === 5).panels.map((p) => p.source ?? p),
        ['/test/fixtures/canary.html?id=EDITED', ...Y.slice(1)],
        'the edit applies on top of the rehydrated content, not the stale pre-launch rows');

    await page.close();
});

test('Builder rehydration respects isolation: no-save, Live Builder, and a different-preset save', async () => {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    await page.route(/^https?:\/\/(?!127\.0\.0\.1:4173).*/, (route) => route.fulfill({ status: 204, body: '' }));
    await page.goto(`${ORIGIN}/index.html`, { waitUntil: 'networkidle' });

    const result = await page.evaluate(async () => {
        const { Store } = await import('./js/storage.js');
        const { setPresetsStructure } = await import('./js/state.js');
        const {
            switchWorkspace, notifyWorkspaceEdited, rehydrateActiveWorkspaceIfStale,
            flushPendingWorkspaceSync, clearUndoHistory, pushUndoSnapshot, canUndo,
        } = await import('./js/workspace.js');
        const { createEmptyPreset } = await import('./js/presets.js');

        const out = {};

        // ── No-save isolation: a Runtime change that was never saved must
        // never appear in the Builder, and the Preset itself must stay X. ──
        const presetA = { ...createEmptyPreset(1), panels: ['X0', 'X1'], isEmpty: false };
        setPresetsStructure([presetA, createEmptyPreset(2)]);
        switchWorkspace('1');
        clearUndoHistory();
        // Nothing ever calls notifyWorkspaceEdited for a Runtime change that
        // was not saved — the Preset itself is simply never touched.
        out.noSaveRehydrated = rehydrateActiveWorkspaceIfStale();
        out.noSaveRows = Store.get('matrixUrls');

        // ── Different-preset save: saving into Preset 2 must never disturb
        // the still-active Preset 1. ──
        Store.set('matrixUrls', ['Y0', 'Y1']);
        notifyWorkspaceEdited(['Y0', 'Y1'], {}, {}); // pending mirror targets Preset 1
        flushPendingWorkspaceSync(); // Preset 1 now persisted as Y0,Y1
        switchWorkspace('2');
        Store.set('matrixUrls', ['Z0']);
        notifyWorkspaceEdited(['Z0'], {}, {}); // pending mirror targets Preset 2 instead
        flushPendingWorkspaceSync(); // Preset 2 now persisted as Z0, Preset 1 untouched
        switchWorkspace('1'); // return with Preset 1 still the target
        out.preset1AfterOtherSave = Store.get('matrixUrls');

        // ── Live Builder is never rehydrated, even if a preset changed. ──
        switchWorkspace('live');
        Store.set('matrixUrls', ['LIVE0', 'LIVE1']);
        setPresetsStructure([{ ...presetA, panels: ['CHANGED-BY-SOMETHING-ELSE'] }, createEmptyPreset(2)]);
        out.liveRehydrated = rehydrateActiveWorkspaceIfStale();
        out.liveRows = Store.get('matrixUrls');

        // ── No unnecessary rehydration: resuming twice with nothing changed
        // must return false the second time and not clear undo history. ──
        setPresetsStructure([{ ...createEmptyPreset(3), panels: ['P0', 'P1'] }, createEmptyPreset(2)]);
        switchWorkspace('3');
        clearUndoHistory();
        pushUndoSnapshot();
        out.firstRehydrate = rehydrateActiveWorkspaceIfStale(); // same content -> false
        out.undoSurvivedFirst = canUndo();
        out.secondRehydrate = rehydrateActiveWorkspaceIfStale();
        out.undoSurvivedSecond = canUndo();

        return out;
    });

    assert.equal(result.noSaveRehydrated, false, 'nothing changed the Preset, so nothing to rehydrate');
    assert.deepEqual(result.noSaveRows, ['X0', 'X1'], 'Builder keeps showing the unsaved-but-never-diverged content');
    assert.deepEqual(result.preset1AfterOtherSave, ['Y0', 'Y1'],
        'saving into a DIFFERENT preset never disturbs the still-active one');
    assert.equal(result.liveRehydrated, false, 'Live Builder is never rehydrated, no matter what a preset does');
    assert.deepEqual(result.liveRows, ['LIVE0', 'LIVE1'], 'Live Builder surface is untouched');
    assert.equal(result.firstRehydrate, false, 'nothing diverged, so the first resume is already a no-op');
    assert.equal(result.undoSurvivedFirst, true);
    assert.equal(result.secondRehydrate, false, 'resuming again with still nothing changed stays a no-op');
    assert.equal(result.undoSurvivedSecond, true, 'undo history is not cleared for a no-op rehydrate');
    await page.close();
});

// ─────────────────────────────────────────────────────────────────────────────
// Fixed Positions, panel-scoped history, and Copy to Position.
//
// Every test below runs against the real Grid Runtime with three live
// same-origin canary documents, each ticking a counter in its own context. That
// is what makes the continuity claims real rather than structural: if an iframe
// were reloaded, recreated or reparented, its performance.timeOrigin would
// change and its counter would restart.
// ─────────────────────────────────────────────────────────────────────────────

const CANARY = (id) => `/test/fixtures/canary.html?id=${id}`;

/** Boot index3.html with A/B/C canaries live in Positions 1-3. */
async function bootCanaryGrid() {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    await page.route(/^https?:\/\/(?!127\.0\.0\.1:4173).*/, (route) => route.fulfill({ status: 204, body: '' }));
    await page.addInitScript(() => {
        if (window === window.top) {
            localStorage.setItem('loop_matrix_urls', JSON.stringify([
                '/test/fixtures/canary.html?id=A',
                '/test/fixtures/canary.html?id=B',
                '/test/fixtures/canary.html?id=C',
            ]));
        }
    });
    await page.goto(`${ORIGIN}/index3.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelectorAll('.stream-panel iframe').length === 4);
    await page.waitForTimeout(200);
    await exposeNav(page);
    return page;
}

/** Canary document identity + liveness, keyed by canary id. */
async function readCanaries(page, ids) {
    const entries = await Promise.all(ids.map(async (id) => {
        const frame = page.frames().find((candidate) => candidate.url().includes(`id=${id}`));
        if (!frame) throw new Error(`canary ${id} is not present`);
        return [id, await frame.evaluate(() => ({ startedAt: window.__canaryStartedAt, ticks: window.__canaryTicks }))];
    }));
    return Object.fromEntries(entries);
}

/** Start counting loads, and remember each live iframe's node and parent. */
function armContinuityProbe(page) {
    return page.evaluate(() => {
        window.__probe = [...document.querySelectorAll('.stream-panel iframe')]
            .filter((iframe) => (iframe.getAttribute('data-last-src') || '').includes('canary.html'))
            .map((iframe) => ({ iframe, parent: iframe.closest('[id^="screen-"]'), loads: 0, id: iframe.getAttribute('data-last-src') }));
        window.__probe.forEach((entry) => entry.iframe.addEventListener('load', () => { entry.loads += 1; }));
    });
}

function readContinuityProbe(page) {
    return page.evaluate(() => ({
        loads: Object.fromEntries(window.__probe.map((entry) => [entry.id.split('id=')[1], entry.loads])),
        sameNodes: window.__probe.every((entry) => entry.iframe.isConnected),
        sameParents: window.__probe.every((entry) => entry.iframe.closest('[id^="screen-"]') === entry.parent),
    }));
}

/** What the USER sees: which canary is showing at each labelled Position. */
function readPositionMap(page) {
    return page.evaluate(() => {
        const map = {};
        document.querySelectorAll('[id^="screen-"][id$="-slot"]').forEach((slot) => {
            if (slot.style.display === 'none') return;
            const label = slot.querySelector('.slot-label')?.textContent || '';
            const src = slot.querySelector('iframe')?.getAttribute('data-last-src') || '';
            map[label] = src.includes('id=') ? src.split('id=')[1] : src;
        });
        return map;
    });
}

/** Drive the real 📍 Move to Position control on the panel showing `canaryId`. */
/** Drive the real [Position N] pop-under, the only customer-facing path. */
function moveCanaryToPosition(page, canaryId, position) {
    return page.evaluate(([id, target]) => {
        const panel = [...document.querySelectorAll('.stream-panel')].find((candidate) =>
            (candidate.querySelector('iframe')?.getAttribute('data-last-src') || '').endsWith(`id=${id}`));
        if (!panel) throw new Error(`no panel is showing canary ${id}`);
        panel.classList.add('chrome-revealed');
        panel.querySelector('.hotswap-position-btn').click();
        const group = [...panel.querySelectorAll('.hotswap-position-group')]
            .find((candidate) => candidate.querySelector('.hotswap-position-group-title')
                .textContent === 'Swap Position');
        const item = [...group.querySelectorAll('.hotswap-position-item:not(.current)')]
            .find((candidate) => candidate.textContent.trim().startsWith(`Position ${target}`));
        if (!item) throw new Error(`Position ${target} was not offered to canary ${id}`);
        item.click();
    }, [canaryId, position]);
}

/** Click a panel's own ↩ / ↪, addressed by slot index. */
function clickPanelHistory(page, slotIndex, which) {
    return page.evaluate(([index, action]) => {
        const button = document.querySelectorAll('.stream-panel')[index]
            .querySelector(action === 'undo' ? '.btn-hotswap-undo' : '.btn-hotswap-redo');
        if (button.disabled) throw new Error(`panel ${index} ${action} is disabled`);
        button.click();
    }, [slotIndex, which]);
}

function readPanelHistoryButtons(page) {
    return page.evaluate(() => [...document.querySelectorAll('.stream-panel')].map((panel) => ({
        undo: !panel.querySelector('.btn-hotswap-undo').disabled,
        redo: !panel.querySelector('.btn-hotswap-redo').disabled,
    })).slice(0, 3));
}

test('Move to Position always lands media in the physical Position, whatever the swap history', async () => {
    const page = await bootCanaryGrid();
    const before = await readCanaries(page, ['A', 'B', 'C']);
    await armContinuityProbe(page);

    assert.deepEqual(await readPositionMap(page), { 'Position 1': 'A', 'Position 2': 'B', 'Position 3': 'C' });

    await moveCanaryToPosition(page, 'A', 2);
    assert.deepEqual(await readPositionMap(page), { 'Position 1': 'B', 'Position 2': 'A', 'Position 3': 'C' });

    // A is no longer in the slot it started in. "Position 3" must still mean
    // the third physical place, not "screen 3".
    await moveCanaryToPosition(page, 'A', 3);
    assert.deepEqual(await readPositionMap(page), { 'Position 1': 'B', 'Position 2': 'C', 'Position 3': 'A' });

    await moveCanaryToPosition(page, 'B', 2);
    assert.deepEqual(await readPositionMap(page), { 'Position 1': 'C', 'Position 2': 'B', 'Position 3': 'A' });

    // The panel's own Position is offered but disabled, never as a live option.
    const offered = await page.evaluate(() => {
        const panel = [...document.querySelectorAll('.stream-panel')].find((candidate) =>
            (candidate.querySelector('iframe')?.getAttribute('data-last-src') || '').endsWith('id=B'));
        panel.classList.add('chrome-revealed');
        panel.querySelector('.hotswap-position-btn').click();
        const group = [...panel.querySelectorAll('.hotswap-position-group')][0];
        return [...group.querySelectorAll('.hotswap-position-item')].map((item) => ({
            text: item.textContent.trim(), current: item.classList.contains('current'),
        }));
    });
    assert.deepEqual(offered.map((item) => item.text.replace('current', '')), ['Position 1', 'Position 2', 'Position 3']);
    assert.deepEqual(offered.map((item) => item.current), [false, true, false]);

    // Internal slot identity never leaked into the UX: content stayed bound to
    // its own slot the whole time, only the presentation moved.
    const sessionUrls = await page.evaluate(async () => {
        const { getSessionUrls } = await import('./js/grid-session.js');
        return getSessionUrls().slice(0, 3).map((url) => url.split('id=')[1]);
    });
    assert.deepEqual(sessionUrls, ['A', 'B', 'C']);

    const probe = await readContinuityProbe(page);
    const after = await readCanaries(page, ['A', 'B', 'C']);
    assert.deepEqual(probe, {
        loads: { A: 0, B: 0, C: 0 }, sameNodes: true, sameParents: true,
    }, 'a Position move is pure presentation: no reload, no recreation, no reparent');
    assert.ok(['A', 'B', 'C'].every((id) => after[id].startedAt === before[id].startedAt), 'same documents');
    assert.ok(['A', 'B', 'C'].every((id) => after[id].ticks > before[id].ticks), 'all three still running');
    await page.close();
});

test('Position Undo/Redo is one linked action, reversible once from either panel', async () => {
    const page = await bootCanaryGrid();
    const before = await readCanaries(page, ['A', 'B', 'C']);
    await armContinuityProbe(page);

    await moveCanaryToPosition(page, 'A', 3); // links A (slot 0) and C (slot 2)
    assert.deepEqual(await readPositionMap(page), { 'Position 1': 'C', 'Position 2': 'B', 'Position 3': 'A' });

    await clickPanelHistory(page, 0, 'undo');
    assert.deepEqual(await readPositionMap(page), { 'Position 1': 'A', 'Position 2': 'B', 'Position 3': 'C' });

    await clickPanelHistory(page, 0, 'redo');
    assert.deepEqual(await readPositionMap(page), { 'Position 1': 'C', 'Position 2': 'B', 'Position 3': 'A' });

    // Undo the very same action from the OTHER panel in the swap.
    await clickPanelHistory(page, 2, 'undo');
    assert.deepEqual(await readPositionMap(page), { 'Position 1': 'A', 'Position 2': 'B', 'Position 3': 'C' });

    // It is now undone once and for all: neither linked panel, nor master, can
    // reverse it a second time.
    assert.deepEqual((await readPanelHistoryButtons(page)).map((state) => state.undo), [false, false, false]);
    assert.equal(await page.locator('#btn-master-undo').isDisabled(), true);

    const probe = await readContinuityProbe(page);
    const after = await readCanaries(page, ['A', 'B', 'C']);
    assert.deepEqual(probe, { loads: { A: 0, B: 0, C: 0 }, sameNodes: true, sameParents: true },
        'zero iframe loads through the entire Position move / undo / redo / undo cycle');
    assert.ok(['A', 'B', 'C'].every((id) => after[id].startedAt === before[id].startedAt));
    assert.ok(['A', 'B', 'C'].every((id) => after[id].ticks > before[id].ticks));
    await page.close();
});

test('panel Undo and Redo of a URL touch only that panel, and master Undo cannot repeat them', async () => {
    const page = await bootCanaryGrid();
    const before = await readCanaries(page, ['A', 'C']);
    await armContinuityProbe(page);

    assert.deepEqual(await readPanelHistoryButtons(page),
        [{ undo: false, redo: false }, { undo: false, redo: false }, { undo: false, redo: false }],
        'nothing is clickable before there is any history');

    await page.evaluate(() => {
        const panel = document.querySelectorAll('.stream-panel')[1];
        panel.querySelector('.btn-hotswap-toggle').click();
        panel.querySelector('.hotswap-input').value = '/test/fixtures/canary.html?id=D';
        panel.querySelector('.hotswap-submit-btn').click();
    });
    await page.waitForLoadState('networkidle');
    assert.deepEqual(await readPanelHistoryButtons(page),
        [{ undo: false, redo: false }, { undo: true, redo: false }, { undo: false, redo: false }],
        'only the panel that changed gained history');

    await clickPanelHistory(page, 1, 'undo');
    await page.waitForFunction(() =>
        document.querySelectorAll('.stream-panel iframe')[1].getAttribute('data-last-src').endsWith('id=B'));
    assert.deepEqual((await readPanelHistoryButtons(page))[1], { undo: false, redo: true });

    // Master Undo must not now "undo panel B again" into some older state.
    assert.equal(await page.locator('#btn-master-undo').isDisabled(), true);

    let probe = await readContinuityProbe(page);
    let after = await readCanaries(page, ['A', 'C']);
    assert.equal(probe.loads.A, 0, 'panel A never reloaded');
    assert.equal(probe.loads.C, 0, 'panel C never reloaded');
    assert.ok(probe.sameNodes && probe.sameParents);
    assert.ok(['A', 'C'].every((id) => after[id].startedAt === before[id].startedAt));
    assert.ok(['A', 'C'].every((id) => after[id].ticks > before[id].ticks));

    await clickPanelHistory(page, 1, 'redo');
    await page.waitForFunction(() =>
        document.querySelectorAll('.stream-panel iframe')[1].getAttribute('data-last-src').endsWith('id=D'));
    assert.deepEqual((await readPanelHistoryButtons(page))[1], { undo: true, redo: false });

    probe = await readContinuityProbe(page);
    after = await readCanaries(page, ['A', 'C']);
    assert.equal(probe.loads.A, 0, 'Redo left A alone too');
    assert.equal(probe.loads.C, 0, 'Redo left C alone too');
    assert.ok(['A', 'C'].every((id) => after[id].startedAt === before[id].startedAt), 'same documents throughout');
    assert.ok(['A', 'C'].every((id) => after[id].ticks > before[id].ticks), 'still playing throughout');
    await page.close();
});

test('interleaved panel histories: undoing A leaves B changed', async () => {
    const page = await bootCanaryGrid();
    const editPanel = (index, id) => page.evaluate(([slot, canary]) => {
        const panel = document.querySelectorAll('.stream-panel')[slot];
        panel.querySelector('.btn-hotswap-toggle').click();
        panel.querySelector('.hotswap-input').value = `/test/fixtures/canary.html?id=${canary}`;
        panel.querySelector('.hotswap-submit-btn').click();
    }, [index, id]);
    const srcs = () => page.evaluate(() => [...document.querySelectorAll('.stream-panel iframe')]
        .slice(0, 3).map((iframe) => iframe.getAttribute('data-last-src').split('id=')[1]));

    await editPanel(0, 'A2');
    await editPanel(1, 'B2');
    await page.waitForLoadState('networkidle');
    assert.deepEqual(await srcs(), ['A2', 'B2', 'C']);

    await clickPanelHistory(page, 0, 'undo'); // reaches past B's newer change
    await page.waitForFunction(() =>
        document.querySelectorAll('.stream-panel iframe')[0].getAttribute('data-last-src').endsWith('id=A'));
    assert.deepEqual(await srcs(), ['A', 'B2', 'C'], 'B stays changed');
    assert.equal((await readPanelHistoryButtons(page))[1].undo, true, "B's own history is untouched");

    await clickPanelHistory(page, 0, 'redo');
    await page.waitForFunction(() =>
        document.querySelectorAll('.stream-panel iframe')[0].getAttribute('data-last-src').endsWith('id=A2'));
    assert.deepEqual(await srcs(), ['A2', 'B2', 'C'], "B unchanged by A's history operations");
    await page.close();
});

test('Copy to Position copies URL and ROOT to the destination, undoably', async () => {
    const page = await bootCanaryGrid();
    const before = await readCanaries(page, ['A', 'B']);
    await armContinuityProbe(page);

    const folderMapBefore = await page.evaluate(async () => {
        const { updateGridSession, getSessionUrls, getSessionFolderMap } = await import('./js/grid-session.js');
        updateGridSession(getSessionUrls(), { 0: 'FolderA', 2: 'FolderC' });
        return getSessionFolderMap();
    });
    assert.deepEqual(folderMapBefore, { 0: 'FolderA', 2: 'FolderC' });

    // From the panel at Position 1 (A), copy to Position 3 (C).
    await page.evaluate(() => {
        const panel = document.querySelectorAll('.stream-panel')[0];
        panel.querySelector('.btn-hotswap-copy-position').click();
        const item = [...panel.querySelectorAll('.hotswap-copy-row .hotswap-position-item:not(.current)')]
            .find((candidate) => candidate.textContent.trim().startsWith('Copy to Position 3'));
        if (!item) throw new Error('Copy to Position 3 was not offered');
        item.click();
    });
    await page.waitForFunction(() =>
        document.querySelectorAll('.stream-panel iframe')[2].getAttribute('data-last-src').endsWith('id=A'));

    const srcs = () => page.evaluate(() => [...document.querySelectorAll('.stream-panel iframe')]
        .slice(0, 3).map((iframe) => iframe.getAttribute('data-last-src').split('id=')[1]));
    assert.deepEqual(await srcs(), ['A', 'B', 'A'], 'source untouched, destination received the URL');
    assert.deepEqual(await page.evaluate(async () => {
        const { getSessionFolderMap } = await import('./js/grid-session.js');
        return getSessionFolderMap();
    }), { 0: 'FolderA', 2: 'FolderA' }, 'copy duplicates the source content assignment, including ROOT');

    assert.deepEqual(await readPanelHistoryButtons(page),
        [{ undo: false, redo: false }, { undo: false, redo: false }, { undo: true, redo: false }],
        'only the destination panel gained history');

    let probe = await readContinuityProbe(page);
    let after = await readCanaries(page, ['A', 'B']);
    assert.equal(probe.loads.A, 0, 'the source never reloaded');
    assert.equal(probe.loads.B, 0, 'the unrelated panel never reloaded');
    assert.ok(probe.sameNodes && probe.sameParents);
    assert.ok(['A', 'B'].every((id) => after[id].startedAt === before[id].startedAt));
    assert.ok(['A', 'B'].every((id) => after[id].ticks > before[id].ticks));

    await clickPanelHistory(page, 2, 'undo');
    await page.waitForFunction(() =>
        document.querySelectorAll('.stream-panel iframe')[2].getAttribute('data-last-src').endsWith('id=C'));
    assert.deepEqual(await srcs(), ['A', 'B', 'C'], 'the destination is back to what it was playing');

    await clickPanelHistory(page, 2, 'redo');
    await page.waitForFunction(() =>
        document.querySelectorAll('.stream-panel iframe')[2].getAttribute('data-last-src').endsWith('id=A'));
    assert.deepEqual(await srcs(), ['A', 'B', 'A'], 'the copied URL returns');

    probe = await readContinuityProbe(page);
    after = await readCanaries(page, ['A', 'B']);
    assert.equal(probe.loads.A, 0, 'Undo and Redo of a copy never touched the source');
    assert.equal(probe.loads.B, 0, 'nor any unrelated panel');
    assert.ok(['A', 'B'].every((id) => after[id].startedAt === before[id].startedAt), 'same documents throughout');
    assert.ok(['A', 'B'].every((id) => after[id].ticks > before[id].ticks), 'still playing throughout');
    await page.close();
});

test('a stale panel Redo cannot overwrite newer state on that panel', async () => {
    const page = await bootCanaryGrid();
    const editPanel = (id) => page.evaluate((canary) => {
        const panel = document.querySelectorAll('.stream-panel')[1];
        panel.querySelector('.btn-hotswap-toggle').click();
        panel.querySelector('.hotswap-input').value = `/test/fixtures/canary.html?id=${canary}`;
        panel.querySelector('.hotswap-submit-btn').click();
    }, id);

    await editPanel('B2');
    await page.waitForLoadState('networkidle');
    await clickPanelHistory(page, 1, 'undo');
    await page.waitForFunction(() =>
        document.querySelectorAll('.stream-panel iframe')[1].getAttribute('data-last-src').endsWith('id=B'));
    assert.equal((await readPanelHistoryButtons(page))[1].redo, true);

    await editPanel('B3'); // conflicting new action on the same panel
    await page.waitForLoadState('networkidle');
    assert.deepEqual((await readPanelHistoryButtons(page))[1], { undo: true, redo: false },
        'the stale Redo is dropped, and its button is not left clickable');

    await clickPanelHistory(page, 1, 'undo');
    await page.waitForFunction(() =>
        document.querySelectorAll('.stream-panel iframe')[1].getAttribute('data-last-src').endsWith('id=B'));
    await clickPanelHistory(page, 1, 'redo');
    await page.waitForFunction(() =>
        document.querySelectorAll('.stream-panel iframe')[1].getAttribute('data-last-src').endsWith('id=B3'),
        undefined, { timeout: 5000 });
    await page.close();
});

test('Quick Action runway mirrors track real availability instead of sitting there dead', async () => {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    await page.route(/^https?:\/\/(?!127\.0\.0\.1:4173).*/, (route) => route.fulfill({ status: 204, body: '' }));
    await page.addInitScript(() => {
        if (window === window.top) {
            localStorage.setItem('hotswap_quick_actions_enabled', 'true');
            localStorage.setItem('hotswap_quick_action_count', '2');
            localStorage.setItem('hotswap_quick_action_order', JSON.stringify(['undo', 'redo']));
            localStorage.setItem('loop_matrix_urls', JSON.stringify([
                '/test/fixtures/canary.html?id=A',
                '/test/fixtures/canary.html?id=B',
                '/test/fixtures/canary.html?id=C',
            ]));
        }
    });
    await page.goto(`${ORIGIN}/index3.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelectorAll('.stream-panel iframe').length === 4);

    const runway = (slotIndex) => page.evaluate((index) =>
        [...document.querySelectorAll('.stream-panel')[index].querySelectorAll('.hotswap-runway-btn')]
            .map((button) => ({ key: button.dataset.actionKey, enabled: !button.disabled })), slotIndex);

    // The tray and the runway are independent presentation collections now, so
    // an action on the runway is ALSO still reachable in the tray.
    assert.equal(await page.evaluate(() =>
        document.querySelectorAll('.stream-panel')[1].querySelector('.btn-hotswap-undo').style.display), 'none');
    assert.deepEqual(await runway(1), [{ key: 'undo', enabled: false }, { key: 'redo', enabled: false }]);

    await page.evaluate(() => {
        const panel = document.querySelectorAll('.stream-panel')[1];
        panel.querySelector('.btn-hotswap-toggle').click();
        panel.querySelector('.hotswap-input').value = '/test/fixtures/canary.html?id=D';
        panel.querySelector('.hotswap-submit-btn').click();
    });
    await page.waitForLoadState('networkidle');
    assert.deepEqual(await runway(1), [{ key: 'undo', enabled: true }, { key: 'redo', enabled: false }]);
    assert.deepEqual(await runway(0), [{ key: 'undo', enabled: false }, { key: 'redo', enabled: false }],
        'availability is per panel, not global');

    // The mirror really drives the canonical action, and its own state follows.
    await page.evaluate(() => document.querySelectorAll('.stream-panel')[1]
        .querySelector('.hotswap-runway-btn[data-action-key="undo"]').click());
    await page.waitForFunction(() =>
        document.querySelectorAll('.stream-panel iframe')[1].getAttribute('data-last-src').endsWith('id=B'));
    assert.deepEqual(await runway(1), [{ key: 'undo', enabled: false }, { key: 'redo', enabled: true }]);
    await page.close();
});

test('pages without Position geometry or panel history hide those actions entirely', async () => {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    await page.route(/^https?:\/\/(?!127\.0\.0\.1:4173).*/, (route) => route.fulfill({ status: 204, body: '' }));
    // index.html's free-form feed supplies none of the Position/history ctx
    // hooks, so those four controls must hide rather than be dead buttons —
    // and must never be offered as a Quick Action there either.
    await page.addInitScript(() => {
        if (window === window.top) {
            localStorage.setItem('hotswap_quick_actions_enabled', 'true');
            localStorage.setItem('hotswap_quick_action_count', '2');
            localStorage.setItem('hotswap_quick_action_order', JSON.stringify(['undo', 'redo']));
        }
    });
    await page.goto(`${ORIGIN}/index.html`, { waitUntil: 'networkidle' });
    await page.locator('.url-grid-field').first().fill('https://example.test/stream');
    await page.locator('#launch-btn').click();
    await page.waitForSelector('.stream-panel');
    const state = await page.evaluate(() => {
        const panel = document.querySelector('.stream-panel');
        return {
            hidden: ['position', 'copy-position', 'undo', 'redo']
                .map((name) => panel.querySelector(`.btn-hotswap-${name}`).style.display),
            // Supported actions may legitimately ride the toolbar here; what
            // must never appear is a mirror for an action this page cannot do.
            unsupportedMirrors: [...panel.querySelectorAll('.hotswap-mirror-btn')]
                .map((button) => button.dataset.actionKey)
                .filter((key) => ['position', 'copyPosition', 'undo', 'redo'].includes(key)),
        };
    });
    assert.deepEqual(state, { hidden: ['none', 'none', 'none', 'none'], unsupportedMirrors: [] },
        'an action this page cannot perform is never offered on any other surface either');
    await page.close();
});

test('Panel Undo after a Master Shuffle restores only that panel, leaving the rest playing', async () => {
    const page = await bootCanaryGrid();

    // Give every panel its own single-URL folder so the real 🎲 master Shuffle
    // (which reshuffles each panel from its OWN assigned folder) has a
    // deterministic outcome while still keeping the four panels distinguishable.
    await page.evaluate(async () => {
        const { setDatabaseStructure, setUrlFolderMap } = await import('./js/state.js');
        setDatabaseStructure({
            F0: ['/test/fixtures/canary.html?id=A2'],
            F1: ['/test/fixtures/canary.html?id=B2'],
            F2: ['/test/fixtures/canary.html?id=C2'],
            F3: ['/test/fixtures/canary.html?id=D2'],
        });
        setUrlFolderMap({ 0: 'F0', 1: 'F1', 2: 'F2', 3: 'F3' });
    });
    await page.evaluate(() => document.getElementById('btn-master-shuffle').click());
    await page.waitForFunction(() => [...document.querySelectorAll('.stream-panel iframe')].slice(0, 3)
        .every((iframe, index) => iframe.getAttribute('data-last-src').endsWith(`id=${['A2', 'B2', 'C2'][index]}`)));
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(150);

    const srcs = () => page.evaluate(() => [...document.querySelectorAll('.stream-panel iframe')]
        .slice(0, 3).map((iframe) => iframe.getAttribute('data-last-src').split('id=')[1]));
    assert.deepEqual(await srcs(), ['A2', 'B2', 'C2']);

    // One master action, but every panel gained history of its own from it.
    assert.deepEqual(await readPanelHistoryButtons(page),
        [{ undo: true, redo: false }, { undo: true, redo: false }, { undo: true, redo: false }]);

    // Measure continuity from AFTER the shuffle: a master Shuffle legitimately
    // reloads every panel, the panel Undo that follows must not.
    const before = await readCanaries(page, ['A2', 'C2']);
    await armContinuityProbe(page);

    await clickPanelHistory(page, 1, 'undo');
    await page.waitForFunction(() =>
        document.querySelectorAll('.stream-panel iframe')[1].getAttribute('data-last-src').endsWith('id=B'));
    assert.deepEqual(await srcs(), ['A2', 'B', 'C2'], 'ONLY panel B went back');

    let probe = await readContinuityProbe(page);
    // A canary ticks every 25 ms. Undo can finish sooner; poll for liveness
    // rather than assuming a timer tick occurred between two immediate reads.
    await page.waitForFunction((previous) => [0, 2].every((slot, index) => {
        const frame = document.querySelectorAll('.stream-panel iframe')[slot];
        return frame.contentWindow.__canaryTicks > previous[['A2', 'C2'][index]].ticks;
    }), before);
    const afterUndo = await readCanaries(page, ['A2', 'C2']);
    assert.equal(probe.loads.A2, 0, 'panel A did not reload');
    assert.equal(probe.loads.C2, 0, 'panel C did not reload');
    assert.ok(probe.sameNodes && probe.sameParents, 'no node was recreated or reparented');
    assert.ok(['A2', 'C2'].every((id) => afterUndo[id].startedAt === before[id].startedAt), 'same documents');
    assert.ok(['A2', 'C2'].every((id) => afterUndo[id].ticks > before[id].ticks), 'still playing');

    await clickPanelHistory(page, 1, 'redo');
    await page.waitForFunction(() =>
        document.querySelectorAll('.stream-panel iframe')[1].getAttribute('data-last-src').endsWith('id=B2'));
    assert.deepEqual(await srcs(), ['A2', 'B2', 'C2'], 'ONLY panel B came forward');
    probe = await readContinuityProbe(page);
    assert.equal(probe.loads.A2, 0, "Redo of B's portion left A alone too");
    assert.equal(probe.loads.C2, 0, "Redo of B's portion left C alone too");

    // Other panels reverse their own portions of the same action, independently.
    await clickPanelHistory(page, 0, 'undo');
    await page.waitForFunction(() =>
        document.querySelectorAll('.stream-panel iframe')[0].getAttribute('data-last-src').endsWith('id=A'));
    assert.deepEqual(await srcs(), ['A', 'B2', 'C2']);

    await clickPanelHistory(page, 2, 'undo');
    await page.waitForFunction(() =>
        document.querySelectorAll('.stream-panel iframe')[2].getAttribute('data-last-src').endsWith('id=C'));
    assert.deepEqual(await srcs(), ['A', 'B2', 'C']);
    assert.deepEqual(await readPanelHistoryButtons(page),
        [{ undo: false, redo: true }, { undo: true, redo: false }, { undo: false, redo: true }],
        'each panel tracks its own portion of the one shuffle');

    // `data-last-src` is set synchronously by the restore, so waiting on it
    // alone races the `load` event that the counters actually observe. Wait for
    // each panel's pending GS3 load to land before reading load counts.
    await waitForPanelSettled(page, 0);
    await waitForPanelSettled(page, 2);
    probe = await readContinuityProbe(page);
    assert.equal(probe.loads.A2, 1, 'A reloaded exactly once, for its own Undo');
    assert.equal(probe.loads.C2, 1, 'C reloaded exactly once, for its own Undo');

    // Master Undo still reverses the Shuffle as one session action, skipping the
    // portions the panels already reversed rather than restoring them twice.
    await page.evaluate(() => document.getElementById('btn-master-undo').click());
    await page.waitForFunction(() =>
        document.querySelectorAll('.stream-panel iframe')[1].getAttribute('data-last-src').endsWith('id=B'));
    assert.deepEqual(await srcs(), ['A', 'B', 'C'], 'the whole Shuffle is now undone');
    assert.equal(await page.locator('#btn-master-undo').isDisabled(), true, 'and only once');
    assert.deepEqual((await readPanelHistoryButtons(page)).map((state) => state.undo), [false, false, false]);
    await page.close();
});

// ─────────────────────────────────────────────────────────────────────────────
// PANEL NAVIGATION HISTORY — browsing inside a panel's live content.
//
// These drive REAL navigations from inside the iframe (as a link click would),
// never by assigning src from the parent, so what is proven is the actual
// browser behavior GS3 has to cope with. The cross-origin test uses
// localhost:4173 against the same server as 127.0.0.1:4173 — a genuinely
// different origin, so its URL reads really do throw SecurityError.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Publish the navigation module on `window` so predicates can read it
 * SYNCHRONOUSLY. page.waitForFunction does not await a promise returned by its
 * predicate — an async predicate returns a Promise, which is always truthy, so
 * such a wait silently passes on its first poll and races the thing it is
 * supposed to be waiting for.
 */
function exposeNav(page) {
    return page.evaluate(async () => {
        window.__navState = (await import('./js/panel-navigation.js')).getPanelNavigationState;
        window.__hist = (await import('./js/grid-session.js')).getGridHistory;
    });
}

/** Read a panel's navigation state out of the live module. */
function panelNav(page, slotIndex) {
    return page.evaluate((slot) => window.__navState(slot), slotIndex);
}

/** The Frame backing one panel's iframe element — panel-scoped, not URL-guessed. */
async function frameForSlot(page, slotIndex) {
    const handle = await page.locator(`#screen-${slotIndex + 1}-slot iframe`).elementHandle();
    return handle.contentFrame();
}

/**
 * What the panel is REALLY showing right now, read live from the document.
 * Playwright's own frame.url() bookkeeping can lag a just-committed
 * navigation; the page never does. Returns null for an opaque (cross-origin)
 * context rather than guessing.
 */
function liveIdForSlot(page, slotIndex) {
    return page.evaluate((slot) => {
        const iframe = document.querySelector(`#screen-${slot + 1}-slot iframe`);
        try {
            const href = iframe.contentWindow.location.href;
            return href.includes('id=') ? href.split('id=')[1] : href;
        } catch { return null; }
    }, slotIndex);
}

/**
 * A panel's own pending-load count is back to zero — i.e. every load GS3 itself
 * caused has arrived and been accounted for. `location.href` flips at
 * navigation commit, BEFORE the load event fires, so waiting on the URL alone
 * would let a test drive an in-content navigation into a still-pending GS3
 * load and mis-attribute it.
 */
function waitForPanelSettled(page, slotIndex) {
    return page.waitForFunction((slot) => window.__navState(slot).pendingLoads === 0, slotIndex);
}

async function waitForLiveId(page, slotIndex, id) {
    await page.waitForFunction(async ([slot, wanted]) => {
        const iframe = document.querySelector(`#screen-${slot + 1}-slot iframe`);
        try {
            return iframe.contentWindow.location.href.includes(`id=${wanted}`);
        } catch { return false; }
    }, [slotIndex, id]);
    await waitForPanelSettled(page, slotIndex);
}

/**
 * A genuine content-initiated navigation: driven from inside the frame, so GS3
 * sees only a load event, exactly as it would for a user clicking a link.
 * The navigation is deferred a tick so the evaluate itself resolves before its
 * execution context is torn down.
 */
async function navigateInside(page, slotIndex, toId, origin = ORIGIN) {
    await waitForPanelSettled(page, slotIndex);
    const before = (await panelNav(page, slotIndex)).cursor;
    const frame = await frameForSlot(page, slotIndex);
    await frame.evaluate((url) => {
        setTimeout(() => { window.location.href = url; }, 0);
    }, `${origin}/test/fixtures/canary.html?id=${toId}`);
    await page.waitForFunction(([slot, cursor]) => window.__navState(slot).cursor > cursor,
        [slotIndex, before]);
    await waitForPanelSettled(page, slotIndex);
}

/** Assign a panel's content the way a user does: the 🌐 URL editor. */
async function assignPanelUrl(page, slotIndex, url) {
    await page.evaluate(([slot, value]) => {
        const panel = document.querySelectorAll('.stream-panel')[slot];
        panel.querySelector('.btn-hotswap-toggle').click();
        panel.querySelector('.hotswap-input').value = value;
        panel.querySelector('.hotswap-submit-btn').click();
    }, [slotIndex, url]);
}

test('Panel Undo walks in-content navigation first, then reaches GS3 action history', async () => {
    const page = await bootCanaryGrid();
    const before = await readCanaries(page, ['A', 'C']);

    // GS3 action: panel B is deliberately pointed at a "Site B" selection page.
    await assignPanelUrl(page, 1, `${ORIGIN}/test/fixtures/canary.html?id=browse`);
    await waitForLiveId(page, 1, 'browse');

    // Then the user browses INSIDE that content. GS3 caused none of this.
    await navigateInside(page, 1, 'category');
    await navigateInside(page, 1, 'video');
    assert.equal(await liveIdForSlot(page, 1), 'video');
    assert.deepEqual((await panelNav(page, 1)).entries.map((entry) => entry.url.split('id=')[1]),
        ['browse', 'category', 'video']);

    // Only now measure: the navigations above legitimately load panel B.
    await armContinuityProbe(page);

    // The reported bug was that this jumped straight back to the pre-assignment
    // URL. It must walk the browsing history first.
    await clickPanelHistory(page, 1, 'undo');
    await waitForLiveId(page, 1, 'category');
    assert.equal(await liveIdForSlot(page, 1), 'category');

    await clickPanelHistory(page, 1, 'undo');
    await waitForLiveId(page, 1, 'browse');
    assert.equal(await liveIdForSlot(page, 1), 'browse');
    assert.equal((await panelNav(page, 1)).canBack, false, 'back at the content GS3 assigned');

    // Browsing exhausted — NOW Undo reaches the canonical GS3 action history.
    await clickPanelHistory(page, 1, 'undo');
    await waitForLiveId(page, 1, 'B');
    assert.equal(await liveIdForSlot(page, 1), 'B', "the GS3 assignment itself is undone");
    assert.equal(await page.evaluate(async () => {
        const { getSessionUrls } = await import('./js/grid-session.js');
        return getSessionUrls()[1].split('id=')[1];
    }), 'B', 'the Runtime Session followed the action, not the browsing');

    const probe = await readContinuityProbe(page);
    const after = await readCanaries(page, ['A', 'C']);
    assert.equal(probe.loads.A, 0, 'panel A never reloaded through any of it');
    assert.equal(probe.loads.C, 0, 'panel C never reloaded through any of it');
    assert.ok(probe.sameNodes && probe.sameParents);
    assert.ok(['A', 'C'].every((id) => after[id].startedAt === before[id].startedAt), 'same documents');
    assert.ok(['A', 'C'].every((id) => after[id].ticks > before[id].ticks), 'still playing');
    await page.close();
});

test('Panel Redo retraces the in-content path before touching GS3 action history', async () => {
    const page = await bootCanaryGrid();
    await assignPanelUrl(page, 1, `${ORIGIN}/test/fixtures/canary.html?id=browse`);
    await waitForLiveId(page, 1, 'browse');
    await navigateInside(page, 1, 'category');
    await navigateInside(page, 1, 'video');

    await clickPanelHistory(page, 1, 'undo');
    await waitForLiveId(page, 1, 'category');
    assert.equal((await panelNav(page, 1)).canForward, true);

    await clickPanelHistory(page, 1, 'redo');
    await waitForLiveId(page, 1, 'video');
    assert.equal(await liveIdForSlot(page, 1), 'video');

    await clickPanelHistory(page, 1, 'undo');
    await waitForLiveId(page, 1, 'category');
    await clickPanelHistory(page, 1, 'undo');
    await waitForLiveId(page, 1, 'browse');
    await clickPanelHistory(page, 1, 'redo');
    await waitForLiveId(page, 1, 'category');
    await clickPanelHistory(page, 1, 'redo');
    await waitForLiveId(page, 1, 'video');
    assert.equal(await liveIdForSlot(page, 1), 'video', 'the whole path retraces both ways');
    await page.close();
});

test('a new in-content navigation invalidates the stale forward path', async () => {
    const page = await bootCanaryGrid();
    await assignPanelUrl(page, 1, `${ORIGIN}/test/fixtures/canary.html?id=browse`);
    await waitForLiveId(page, 1, 'browse');
    await navigateInside(page, 1, 'category');
    await navigateInside(page, 1, 'videoA');

    await clickPanelHistory(page, 1, 'undo');
    await waitForLiveId(page, 1, 'category');
    assert.equal((await panelNav(page, 1)).canForward, true, 'videoA is still ahead');

    await navigateInside(page, 1, 'videoB'); // the user went somewhere else
    assert.deepEqual((await panelNav(page, 1)).entries.map((entry) => entry.url.split('id=')[1]),
        ['browse', 'category', 'videoB']);
    assert.equal((await panelNav(page, 1)).canForward, false, 'Redo cannot resurrect videoA');

    // Redo now falls through to the GS3 action history rather than replaying a
    // branch the user abandoned.
    await clickPanelHistory(page, 1, 'undo');
    await waitForLiveId(page, 1, 'category');
    await clickPanelHistory(page, 1, 'undo');
    await waitForLiveId(page, 1, 'browse');
    assert.equal(await liveIdForSlot(page, 1), 'browse');
    await page.close();
});

test('two panels keep independent navigation histories', async () => {
    const page = await bootCanaryGrid();
    await assignPanelUrl(page, 0, `${ORIGIN}/test/fixtures/canary.html?id=browseA`);
    await waitForLiveId(page, 0, 'browseA');
    await assignPanelUrl(page, 1, `${ORIGIN}/test/fixtures/canary.html?id=browseB`);
    await waitForLiveId(page, 1, 'browseB');
    await navigateInside(page, 0, 'videoA');
    await navigateInside(page, 1, 'videoB');

    await clickPanelHistory(page, 0, 'undo');
    await waitForLiveId(page, 0, 'browseA');
    assert.equal(await liveIdForSlot(page, 0), 'browseA');
    assert.equal(await liveIdForSlot(page, 1), 'videoB', 'panel B did not move');
    assert.equal((await panelNav(page, 1)).canBack, true, "panel B's browsing is intact");

    await clickPanelHistory(page, 1, 'undo');
    await waitForLiveId(page, 1, 'browseB');
    assert.equal(await liveIdForSlot(page, 1), 'browseB');
    assert.equal(await liveIdForSlot(page, 0), 'browseA', 'no cross-panel leakage');
    await page.close();
});

test('a panel keeps its navigation history when it moves Position', async () => {
    const page = await bootCanaryGrid();
    await assignPanelUrl(page, 0, `${ORIGIN}/test/fixtures/canary.html?id=browse`);
    await waitForLiveId(page, 0, 'browse');
    await navigateInside(page, 0, 'video');

    // `data-last-src` — and so readPositionMap — deliberately keeps reporting the
    // content source GS3 assigned, not wherever the user browsed to inside it.
    await moveCanaryToPosition(page, 'browse', 3);
    assert.deepEqual(await readPositionMap(page), { 'Position 1': 'C', 'Position 2': 'B', 'Position 3': 'browse' });
    assert.equal(await liveIdForSlot(page, 0), 'video', 'the panel is still showing the video it browsed to');

    // Navigation is keyed to PANEL identity, so it travelled with the panel.
    assert.deepEqual((await panelNav(page, 0)).entries.map((entry) => entry.url.split('id=')[1]),
        ['browse', 'video']);

    // Undo steps the browsing back first — the Position move is a separate,
    // still-applied entry in the GS3 action history.
    await clickPanelHistory(page, 0, 'undo');
    await waitForLiveId(page, 0, 'browse');
    assert.deepEqual(await readPositionMap(page), { 'Position 1': 'C', 'Position 2': 'B', 'Position 3': 'browse' },
        'the panel stayed at Position 3');
    assert.equal(await liveIdForSlot(page, 0), 'browse');

    // Browsing exhausted, so Undo now falls through to the GS3 action history —
    // which is LIFO in its own right: the Position move is this panel's most
    // recent GS3 action, so it is reversed before the older URL assignment.
    await clickPanelHistory(page, 0, 'undo');
    assert.deepEqual(await readPositionMap(page), { 'Position 1': 'browse', 'Position 2': 'B', 'Position 3': 'C' },
        'the Position move is reversed, content untouched');
    assert.equal(await liveIdForSlot(page, 0), 'browse');

    await clickPanelHistory(page, 0, 'undo'); // and now the URL assignment itself
    await waitForLiveId(page, 0, 'A');
    assert.deepEqual(await readPositionMap(page), { 'Position 1': 'A', 'Position 2': 'B', 'Position 3': 'C' });
    await page.close();
});

test('a GS3 content assignment is never also recorded as a user navigation', async () => {
    const page = await bootCanaryGrid();
    await assignPanelUrl(page, 1, `${ORIGIN}/test/fixtures/canary.html?id=assigned`);
    await waitForLiveId(page, 1, 'assigned');

    const state = await panelNav(page, 1);
    assert.equal(state.entries.length, 1, 'the load it caused did not become a second entry');
    assert.equal(state.cursor, 0);
    assert.equal(state.canBack, false);
    assert.equal(state.pendingLoads, 0, 'the expected load was consumed exactly once');

    // One visible action, therefore exactly one Undo.
    await clickPanelHistory(page, 1, 'undo');
    await waitForLiveId(page, 1, 'B');
    assert.equal(await liveIdForSlot(page, 1), 'B');
    assert.deepEqual(await readPanelHistoryButtons(page),
        [{ undo: false, redo: false }, { undo: false, redo: true }, { undo: false, redo: false }],
        'nothing left to undo on that panel — the action was not counted twice');
    await page.close();
});

test('Master Undo follows Runtime action semantics and never consumes browsing history', async () => {
    const page = await bootCanaryGrid();
    await assignPanelUrl(page, 1, `${ORIGIN}/test/fixtures/canary.html?id=browse`);
    await waitForLiveId(page, 1, 'browse');
    await navigateInside(page, 1, 'category');
    await navigateInside(page, 1, 'video');

    // Master Undo is NOT smart browsing Back: it reverses the most recent GS3
    // Runtime action, which is the URL assignment — straight past the browsing.
    await page.evaluate(() => document.getElementById('btn-master-undo').click());
    await waitForLiveId(page, 1, 'B');
    assert.equal(await liveIdForSlot(page, 1), 'B');
    assert.equal(await page.locator('#btn-master-undo').isDisabled(), true);

    // And the replaced content's browsing history is gone with it, rather than
    // lingering to navigate back into a previous content generation.
    const state = await panelNav(page, 1);
    assert.deepEqual(state.entries.map((entry) => entry.url.split('id=')[1]), ['B']);
    assert.equal(state.canBack, false);
    assert.equal(state.canForward, false);
    await page.close();
});

test('cross-origin navigation is detected, never fabricated, and never falls through', async () => {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    // Same host, same files, different port — a genuinely different origin, so
    // reads across this boundary really do throw SecurityError.
    const CROSS = CROSS_ORIGIN;
    await page.route(/^https?:\/\/(?!127\.0\.0\.1:417[34]).*/, (route) =>
        route.fulfill({ status: 204, body: '' }));
    await page.addInitScript(() => {
        if (window === window.top) {
            localStorage.setItem('loop_matrix_urls', JSON.stringify([
                '/test/fixtures/canary.html?id=A',
                '/test/fixtures/canary.html?id=B',
                '/test/fixtures/canary.html?id=C',
            ]));
        }
    });
    await page.goto(`${ORIGIN}/index3.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelectorAll('.stream-panel iframe').length === 4);
    await page.waitForTimeout(200);
    await exposeNav(page);

    const before = await readCanaries(page, ['A', 'C']);
    await assignPanelUrl(page, 1, `${CROSS}/test/fixtures/canary.html?id=xbrowse`);
    await page.waitForFunction(() => {
        const state = window.__navState(1);
        return state.capability === 'opaque' && state.pendingLoads === 0;
    });
    assert.equal((await panelNav(page, 1)).capability, 'opaque',
        'GS3 knows it cannot read this browsing context');

    await armContinuityProbe(page);
    await navigateInside(page, 1, 'xvideo', CROSS); // a real cross-origin link click

    const state = await panelNav(page, 1);
    assert.equal(state.entries.length, 2, 'the navigation was DETECTED');
    assert.deepEqual(state.entries[1], { url: null, opaque: true, source: 'content' },
        'and recorded honestly as opaque rather than guessed at');
    assert.ok(state.entries[0].url.includes('id=xbrowse'), 'the GS3-assigned base is still known');
    assert.equal(state.canBack, true);

    // No fabricated URL reached the Runtime Session.
    assert.equal(await page.evaluate(async () => {
        const { getSessionUrls } = await import('./js/grid-session.js');
        return getSessionUrls()[1];
    }), `${CROSS}/test/fixtures/canary.html?id=xbrowse`);

    // THE KEY ASSERTION: Undo must not skip the navigation and jump to the older
    // GS3 URL just because the new one is unreadable. It returns the panel to
    // the content GS3 loaded.
    await clickPanelHistory(page, 1, 'undo');
    await page.waitForFunction(() => window.__navState(1).entries.length === 1
        && window.__navState(1).pendingLoads === 0);
    assert.equal((await frameForSlot(page, 1)).url(), `${CROSS}/test/fixtures/canary.html?id=xbrowse`);
    const collapsed = await panelNav(page, 1);
    assert.equal(collapsed.canForward, false, 'an unaddressable entry is not offered as Redo');
    assert.equal(collapsed.canBack, false, 'deterministic: now genuinely at the base');

    // Only THEN does Undo reach the GS3 action history.
    await clickPanelHistory(page, 1, 'undo');
    await waitForLiveId(page, 1, 'B');
    assert.equal(await liveIdForSlot(page, 1), 'B');

    assert.deepEqual(errors, [], 'no SecurityError escaped to the page');
    const probe = await readContinuityProbe(page);
    const after = await readCanaries(page, ['A', 'C']);
    assert.equal(probe.loads.A, 0, 'no unrelated panel changed');
    assert.equal(probe.loads.C, 0);
    assert.ok(['A', 'C'].every((id) => after[id].startedAt === before[id].startedAt));
    assert.ok(['A', 'C'].every((id) => after[id].ticks > before[id].ticks));
    await page.close();
});

/** Boot the Grid with a real cross-origin panel available (see CROSS_ORIGIN). */
async function bootCrossOriginGrid() {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    await page.route(/^https?:\/\/(?!127\.0\.0\.1:417[34]).*/, (route) =>
        route.fulfill({ status: 204, body: '' }));
    await page.addInitScript(() => {
        if (window === window.top) {
            localStorage.setItem('loop_matrix_urls', JSON.stringify([
                '/test/fixtures/canary.html?id=A',
                '/test/fixtures/canary.html?id=B',
                '/test/fixtures/canary.html?id=C',
            ]));
        }
    });
    await page.goto(`${ORIGIN}/index3.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelectorAll('.stream-panel iframe').length === 4);
    await page.waitForTimeout(200);
    await exposeNav(page);
    return page;
}

function slotAreas(page) {
    return page.evaluate(() => [...document.querySelectorAll('[id^="screen-"][id$="-slot"]')]
        .map((slot) => slot.style.gridArea));
}

test('opaque navigation blocks action-history fallthrough, then yields to it', async () => {
    const page = await bootCrossOriginGrid();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const ANCHOR = `${CROSS_ORIGIN}/test/fixtures/canary.html?id=xbrowse`;
    const before = await readCanaries(page, ['A', 'C']);

    // 1. GS3 loads a cross-origin website into panel 1.
    await assignPanelUrl(page, 1, ANCHOR);
    await page.waitForFunction(() => window.__navState(1).pendingLoads === 0
        && window.__navState(1).capability === 'opaque');
    assert.equal((await panelNav(page, 1)).anchor, ANCHOR, 'the anchor is safely known — GS3 assigned it');

    // 2. A Position swap involving that panel.
    await moveCanaryToPosition(page, 'xbrowse', 3);
    const areasAfterSwap = await slotAreas(page);
    assert.deepEqual(await readPositionMap(page),
        { 'Position 1': 'A', 'Position 2': 'C', 'Position 3': 'xbrowse' });

    // 3 & 4. The user browses inside the website — twice, unreadably.
    await armContinuityProbe(page);
    await navigateInside(page, 1, 'xcategory', CROSS_ORIGIN);
    await navigateInside(page, 1, 'xvideo', CROSS_ORIGIN);
    const browsed = await panelNav(page, 1);
    assert.equal(browsed.cursor, 2, 'both navigations were DETECTED');
    assert.ok(browsed.entries.slice(1).every((entry) => entry.opaque && entry.url === null),
        'and recorded as opaque markers — no URL was fabricated');
    assert.equal(browsed.canBack, true,
        'an opaque marker plus a known anchor is enough to make Undo reversible');

    // 5. Panel Undo — navigation must win over the older Position action.
    await clickPanelHistory(page, 1, 'undo');
    await page.waitForFunction(() => window.__navState(1).cursor === 0
        && window.__navState(1).pendingLoads === 0);
    assert.equal((await frameForSlot(page, 1)).url(), ANCHOR,
        'the panel returned to the anchor GS3 assigned');
    assert.deepEqual(await readPositionMap(page),
        { 'Position 1': 'A', 'Position 2': 'C', 'Position 3': 'xbrowse' },
        'the Position swap REMAINS APPLIED — no older action was consumed');
    assert.deepEqual(await slotAreas(page), areasAfterSwap);
    assert.equal(await page.evaluate(() =>
        window.__hist().find((action) => action.type === 'position').state), 'applied');

    // Multiple opaque steps collapse to the anchor, so there is no reachable
    // Redo target — and none is advertised.
    const collapsed = await panelNav(page, 1);
    assert.deepEqual(collapsed.entries.map((entry) => entry.url), [ANCHOR],
        'unaddressable entries are discarded, not kept as impossible Redo targets');
    assert.equal(collapsed.canForward, false);
    assert.equal(collapsed.canBack, false, 'deterministic: now genuinely at the anchor');

    // 6. Only NOW may Panel Undo reach the action history — and the Position
    // reversal stays surgical.
    await armContinuityProbe(page);
    await clickPanelHistory(page, 1, 'undo');
    await page.waitForFunction(() => document.querySelector('#screen-2-slot').style.gridArea === 'screen2');
    assert.deepEqual(await readPositionMap(page),
        { 'Position 1': 'A', 'Position 2': 'xbrowse', 'Position 3': 'C' },
        'the Position swap now reverses');

    const probe = await readContinuityProbe(page);
    const after = await readCanaries(page, ['A', 'C']);
    assert.deepEqual(probe.loads, { A: 0, xbrowse: 0, C: 0 },
        'reversing the Position change reloaded nothing — not even the panel that moved');
    assert.ok(probe.sameNodes && probe.sameParents, 'no iframe was rebuilt or reparented');
    assert.ok(['A', 'C'].every((id) => after[id].startedAt === before[id].startedAt), 'same documents');
    assert.ok(['A', 'C'].every((id) => after[id].ticks > before[id].ticks), 'still playing');
    assert.deepEqual(errors, [], 'no SecurityError escaped');
    await page.close();
});

test('Master Undo ignores opaque browsing and reverses the Runtime action', async () => {
    const page = await bootCrossOriginGrid();
    const ANCHOR = `${CROSS_ORIGIN}/test/fixtures/canary.html?id=xbrowse`;
    await assignPanelUrl(page, 1, ANCHOR);
    await page.waitForFunction(() => window.__navState(1).pendingLoads === 0
        && window.__navState(1).capability === 'opaque');
    await navigateInside(page, 1, 'xvideo', CROSS_ORIGIN);
    assert.equal((await panelNav(page, 1)).canBack, true);

    // Master Undo is Runtime-action-only: it reverses the URL assignment and
    // never consumes the panel's browsing history.
    await page.evaluate(() => document.getElementById('btn-master-undo').click());
    await waitForLiveId(page, 1, 'B');
    assert.equal(await liveIdForSlot(page, 1), 'B');
    const state = await panelNav(page, 1);
    assert.equal(state.anchor, `${ORIGIN}/test/fixtures/canary.html?id=B`,
        'a new generation, anchored on where the restored URL actually landed');
    assert.equal(state.canBack, false, 'the replaced generation cannot be browsed back into');
    await page.close();
});

test('a panel that loads via a redirect anchors on where it actually landed', async () => {
    const page = await bootCanaryGrid();
    // Same-origin, so the landing URL is readable and the anchor can be corrected.
    await page.route('**/redirect-me', (route) =>
        route.fulfill({ status: 302, headers: { location: '/test/fixtures/canary.html?id=landed' }, body: '' }));
    await assignPanelUrl(page, 1, `${ORIGIN}/redirect-me`);
    await waitForLiveId(page, 1, 'landed');

    const state = await panelNav(page, 1);
    assert.equal(state.anchor, `${ORIGIN}/test/fixtures/canary.html?id=landed`,
        'the anchor is where GS3 assignment came to rest, not the pre-redirect URL');
    assert.equal(state.cursor, 0, 'a redirect is part of the assignment, not a user navigation');
    assert.equal(state.canBack, false, 'so it does not advertise a pointless Undo');
    await page.close();
});

// ─────────────────────────────────────────────────────────────────────────────
// HOTSWAP CHROME — retractable top toolbar, right runway, layer scope.
// ─────────────────────────────────────────────────────────────────────────────

/** Geometry of one panel's Chrome, measured relative to the panel box. */
function chromeGeometry(page, slotIndex = 0) {
    return page.evaluate((index) => {
        const panel = document.querySelectorAll('.stream-panel')[index];
        const box = panel.getBoundingClientRect();
        const iframe = panel.querySelector('iframe').getBoundingClientRect();
        const toolbar = panel.querySelector('.hotswap-toolbar').getBoundingClientRect();
        const activation = panel.querySelector('.hotswap-activation').getBoundingClientRect();
        const runwayEl = panel.querySelector('.hotswap-runway');
        const runway = runwayEl && runwayEl.getBoundingClientRect();
        const style = getComputedStyle(panel);
        return {
            panelHeight: Math.round(box.height),
            iframeHeight: Math.round(iframe.height),
            iframeTop: Math.round(iframe.top - box.top),
            toolbarHeight: Math.round(toolbar.height),
            activationTop: Math.round(activation.top - box.top),
            activationHeight: Math.round(activation.height),
            runwayTop: runway ? Math.round(runway.top - box.top) : null,
            runwayHeight: runway ? Math.round(runway.height) : null,
            runwayButtons: runwayEl ? runwayEl.children.length : 0,
            toolbarHeightVar: parseFloat(style.getPropertyValue('--hotswap-toolbar-height')),
            // The offset is authored as calc(toolbar * 2.5), so the custom
            // property holds that expression rather than a number — the real
            // geometry is what matters, and is measured above.
            runwayOffsetExpr: style.getPropertyValue('--shortcut-runway-top-offset').trim(),
        };
    }, slotIndex);
}

function revealChrome(page, slotIndex = 0) {
    return page.evaluate((index) => {
        document.querySelectorAll('.stream-panel')[index]
            .querySelector('.hotswap-activation')
            .dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
    }, slotIndex);
}

function retractChrome(page, slotIndex = 0) {
    return page.evaluate((index) => {
        document.querySelectorAll('.stream-panel')[index]
            .dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
    }, slotIndex);
}

test('the top toolbar insets content only while revealed, and never touches the iframe', async () => {
    const page = await bootCanaryGrid();
    const before = await readCanaries(page, ['A', 'B', 'C']);
    await armContinuityProbe(page);

    // Retracted: the website owns essentially the entire panel.
    const retracted = await chromeGeometry(page);
    assert.equal(retracted.toolbarHeight, 0, 'no toolbar height is permanently reserved');
    assert.equal(retracted.iframeTop, 0);
    assert.equal(retracted.iframeHeight, retracted.panelHeight, 'the iframe gets the full panel');

    await revealChrome(page);
    await page.waitForFunction(() => document.querySelectorAll('.stream-panel')[0]
        .querySelector('.hotswap-toolbar').getBoundingClientRect().height > 0);
    await page.waitForTimeout(250); // let the height transition settle
    const revealed = await chromeGeometry(page);
    assert.equal(revealed.toolbarHeight, revealed.toolbarHeightVar,
        'revealing grows the toolbar to its configured height');
    assert.equal(revealed.iframeTop, revealed.toolbarHeight,
        'the content is PUSHED DOWN, not overlaid');
    assert.equal(revealed.iframeHeight, revealed.panelHeight - revealed.toolbarHeight);

    await retractChrome(page);
    await page.waitForFunction(() => document.querySelectorAll('.stream-panel')[0]
        .querySelector('.hotswap-toolbar').getBoundingClientRect().height === 0);
    await page.waitForTimeout(250);
    const again = await chromeGeometry(page);
    assert.equal(again.iframeTop, 0, 'retracting returns the full panel to the website');
    assert.equal(again.iframeHeight, again.panelHeight);

    // The whole reveal/retract cycle is presentation only.
    const probe = await readContinuityProbe(page);
    const after = await readCanaries(page, ['A', 'B', 'C']);
    assert.deepEqual(probe.loads, { A: 0, B: 0, C: 0 }, 'no iframe reloaded');
    assert.ok(probe.sameNodes && probe.sameParents, 'no iframe was recreated or reparented');
    assert.ok(['A', 'B', 'C'].every((id) => after[id].startedAt === before[id].startedAt), 'same documents');
    assert.ok(['A', 'B', 'C'].every((id) => after[id].ticks > before[id].ticks), 'still playing');
    assert.equal(await page.evaluate(() => document.querySelectorAll('.stream-panel iframe')[0]
        .getAttribute('data-last-src')), '/test/fixtures/canary.html?id=A', 'src untouched');
    await page.close();
});

test('the resize border and the Chrome activation region are separate hit targets', async () => {
    const page = await bootCanaryGrid();
    const geometry = await chromeGeometry(page);
    // The resizer's own grab zone reaches 4px into the panel; the activation
    // strip starts beyond it, so a pixel is never both.
    assert.ok(geometry.activationTop >= 5,
        `activation starts at ${geometry.activationTop}px, clear of the resizer grab zone`);
    assert.ok(geometry.activationHeight > 0 && geometry.activationHeight <= 20);

    const owner = await page.evaluate(() => {
        const panel = document.querySelectorAll('.stream-panel')[0];
        const box = panel.getBoundingClientRect();
        const at = (offset) => {
            const el = document.elementFromPoint(box.left + box.width / 2, box.top + offset);
            if (!el) return 'none';
            if (el.closest('.resizer')) return 'resize';
            if (el.classList.contains('hotswap-activation')) return 'activation';
            return el.tagName.toLowerCase();
        };
        return { atBorder: at(1), atActivation: at(12), inContent: at(200) };
    });
    assert.notEqual(owner.atActivation, 'resize', 'the activation strip is not the resize target');
    assert.equal(owner.atActivation, 'activation');
    assert.equal(owner.inContent, 'iframe', 'the website is clickable everywhere else');
    await page.close();
});

test('the Quick Action runway is an overlay below the top-right safe zone', async () => {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    await page.route(/^https?:\/\/(?!127\.0\.0\.1:4173).*/, (route) => route.fulfill({ status: 204, body: '' }));
    await page.addInitScript(() => {
        if (window === window.top) {
            localStorage.setItem('hotswap_quick_actions_enabled', 'true');
            localStorage.setItem('hotswap_quick_action_count', '4');
            localStorage.setItem('loop_matrix_urls', JSON.stringify([
                '/test/fixtures/canary.html?id=A', '/test/fixtures/canary.html?id=B',
                '/test/fixtures/canary.html?id=C',
            ]));
        }
    });
    await page.goto(`${ORIGIN}/index3.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelectorAll('.stream-panel iframe').length === 4);
    await page.waitForTimeout(200);

    const geometry = await chromeGeometry(page);
    assert.equal(geometry.runwayButtons, 4, 'the runway is exactly as long as configured');
    assert.match(geometry.runwayOffsetExpr, /calc\(.*1\.75\)/,
        'the safe-zone offset is authored proportionally, not as a magic pixel count');
    assert.equal(geometry.runwayTop, Math.round(geometry.toolbarHeightVar * 1.75),
        'and resolves to 1.75 toolbar heights below the top of the panel');
    assert.ok(geometry.runwayHeight < geometry.panelHeight / 2,
        'and does not reserve a full-height strip');

    // The site keeps its own top-right corner — including its clickability.
    const topRightOwner = await page.evaluate(() => {
        const panel = document.querySelectorAll('.stream-panel')[0];
        const box = panel.getBoundingClientRect();
        const el = document.elementFromPoint(box.right - 12, box.top + 30);
        return el ? (el.closest('.hotswap-runway') ? 'runway' : el.tagName.toLowerCase()) : 'none';
    });
    assert.equal(topRightOwner, 'iframe', 'no GS3 hitbox sits over the site top-right controls');

    // The content is never pushed sideways — width reflow is what breaks sites.
    assert.equal(await page.evaluate(() => {
        const panel = document.querySelectorAll('.stream-panel')[0];
        return Math.round(panel.querySelector('iframe').getBoundingClientRect().width)
            === Math.round(panel.getBoundingClientRect().width);
    }), true, 'the runway overlays rather than insetting');
    await page.close();
});

test('turning the runway off removes it entirely, leaving no dead hitbox', async () => {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    await page.route(/^https?:\/\/(?!127\.0\.0\.1:4173).*/, (route) => route.fulfill({ status: 204, body: '' }));
    await page.addInitScript(() => {
        if (window === window.top) {
            localStorage.setItem('hotswap_quick_actions_enabled', 'false');
            localStorage.setItem('hotswap_quick_action_count', '5');
            localStorage.setItem('loop_matrix_urls', JSON.stringify(['/test/fixtures/canary.html?id=A']));
        }
    });
    await page.goto(`${ORIGIN}/index3.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelectorAll('.stream-panel iframe').length === 4);
    assert.equal(await page.locator('.hotswap-runway').count(), 0, 'OFF means the runway does not exist');
    // The count survives being switched off — configuration is not destroyed.
    assert.equal(await page.evaluate(() => localStorage.getItem('hotswap_quick_action_count')), '5');
    await page.close();
});

test('the layer selector appears only when Layer 2 exists, defaulting to L2', async () => {
    const page = await bootCanaryGrid();
    const before = await readCanaries(page, ['B', 'C']);

    const scope = (slotIndex = 0) => page.evaluate((index) => {
        const panel = document.querySelectorAll('.stream-panel')[index];
        const selector = panel.querySelector('.hotswap-layer-selector');
        return {
            hidden: selector.hidden,
            preference: panel.dataset.layerScope,
            lit: [...selector.querySelectorAll('.hotswap-layer-btn')]
                .filter((button) => button.classList.contains('active')).map((button) => button.dataset.layer),
            masterHidden: document.getElementById('master-layer-selector').hidden,
        };
    }, slotIndex);

    assert.deepEqual(await scope(), { hidden: true, preference: 'L2', lit: ['L2'], masterHidden: true },
        'with only Layer 1 there is no choice to present, in the panel or the master bar');

    // Load one of our own runtimes into the panel — that IS a Layer 2.
    await assignPanelUrl(page, 0, 'index3.html');
    await page.waitForFunction(() => document.querySelectorAll('.stream-panel')[0]
        .querySelector('.hotswap-layer-selector').hidden === false);
    assert.deepEqual(await scope(), { hidden: false, preference: 'L2', lit: ['L2'], masterHidden: false },
        'Layer 2 is the active default the moment it exists');

    await armContinuityProbe(page);
    await page.evaluate(() => document.querySelectorAll('.stream-panel')[0]
        .querySelector('.hotswap-layer-btn[data-layer="L1"]').click());
    assert.deepEqual((await scope()).lit, ['L1'], 'the active layer is unmistakably lit');
    await page.evaluate(() => document.querySelectorAll('.stream-panel')[0]
        .querySelector('.hotswap-layer-btn[data-layer="L2"]').click());
    assert.deepEqual((await scope()).lit, ['L2']);

    // Nothing physically moved, and no content reloaded, merely because scope changed.
    const probe = await readContinuityProbe(page);
    const after = await readCanaries(page, ['B', 'C']);
    assert.equal(probe.loads.B, 0);
    assert.equal(probe.loads.C, 0);
    assert.ok(['B', 'C'].every((id) => after[id].startedAt === before[id].startedAt));

    // Replacing the content removes Layer 2, and the selector goes with it.
    await assignPanelUrl(page, 0, '/test/fixtures/canary.html?id=Z');
    await page.waitForFunction(() => document.querySelectorAll('.stream-panel')[0]
        .querySelector('.hotswap-layer-selector').hidden === true);
    assert.equal(await page.evaluate(() => document.getElementById('master-layer-selector').hidden), true);
    await page.close();
});

test('a Position swap moves the panel but not the Position labels', async () => {
    const page = await bootCanaryGrid();
    const labels = () => page.evaluate(() => [...document.querySelectorAll('.stream-panel')]
        .slice(0, 3).map((panel) => ({
            label: panel.querySelector('.hotswap-position-label').textContent,
            showing: (panel.querySelector('iframe').getAttribute('data-last-src') || '').split('id=')[1],
        })));
    assert.deepEqual(await labels(), [
        { label: 'Position 1', showing: 'A' },
        { label: 'Position 2', showing: 'B' },
        { label: 'Position 3', showing: 'C' },
    ]);

    await armContinuityProbe(page);
    await moveCanaryToPosition(page, 'A', 3);
    // Position 1 is still Position 1; the panel occupying it changed, and each
    // panel's toolbar now states the physical place it is actually sitting in.
    assert.deepEqual(await labels(), [
        { label: 'Position 3', showing: 'A' },
        { label: 'Position 2', showing: 'B' },
        { label: 'Position 1', showing: 'C' },
    ]);
    assert.deepEqual(await readPositionMap(page),
        { 'Position 1': 'C', 'Position 2': 'B', 'Position 3': 'A' });
    assert.deepEqual((await readContinuityProbe(page)).loads, { A: 0, B: 0, C: 0 });
    await page.close();
});

test('Settings drives all three collections and the runway-only opacity pair', async () => {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route(/^https?:\/\/(?!127\.0\.0\.1:4173).*/, (route) => route.fulfill({ status: 204, body: '' }));
    await page.goto(`${ORIGIN}/settings.html`, { waitUntil: 'networkidle' });

    const setSwitch = (id, on) => page.evaluate(([elementId, value]) => {
        const box = document.getElementById(elementId);
        box.checked = value;
        box.dispatchEvent(new Event('change', { bubbles: true }));
    }, [id, on]);

    // One unified Top/Deep collection plus an independent Runway collection.
    for (const listId of ['top-order-list', 'runway-order-list']) {
        assert.ok(await page.locator(`#${listId} .hotswap-toggle-row`).count() > 0, listId);
        assert.equal(await page.evaluate((id) =>
            document.querySelector(`#${id} .hotswap-toggle-row`).draggable, listId), true);
    }
    // Eligibility is derived, so the counts encode the ownership rules exactly:
    // Deep Cuts and the Runway both offer everything except the two
    // Position-owned actions; the Toolbar additionally excludes Undo/Redo,
    // which are already fixed controls on that same rail.
    const rows = async (id) => page.locator(`#${id} .hotswap-toggle-row`).count();
    const [runway, toolbar] = await Promise.all(
        ['runway-order-list', 'top-order-list'].map(rows));
    assert.equal(runway, toolbar + 2, 'Runway additionally offers Undo/Redo');
    const keys = (id) => page.evaluate((listId) =>
        [...document.querySelectorAll(`#${listId} .hotswap-toggle-row`)].map((r) => r.dataset.key), id);
    const toolbarKeys = await keys('top-order-list');
    assert.ok(!toolbarKeys.includes('undo') && !toolbarKeys.includes('redo'));
    // The drift this consolidation fixes: these were missing from both
    // shortcut surfaces purely because they open a picker.
    for (const listId of ['top-order-list', 'runway-order-list']) {
        const listed = await keys(listId);
        assert.ok(listed.includes('toggle'), `Edit URL is offered on ${listId}`);
        assert.ok(listed.includes('folder'), `Assign Folder is offered on ${listId}`);
        assert.ok(!listed.includes('position') && !listed.includes('copyPosition'),
            `${listId} does not duplicate the Position-owned actions`);
    }
    // The unified Top/Deep rows own intentional visibility.
    assert.equal(await page.locator('#top-order-list input[type="checkbox"]').count(), 10);

    // Runway: 1-8 in two rows of four. Top Shortcuts: 1-6, its own ceiling.
    assert.deepEqual(await page.locator('#slot-count-row .btn-slot-count').allTextContents(),
        ['1', '2', '3', '4', '5', '6', '7', '8']);
    assert.deepEqual(await page.locator('#top-count-row .btn-slot-count').allTextContents(),
        ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
        'Toolbar Shortcuts support 1-10 now that structural controls do not consume slots');
    assert.equal(await page.evaluate(() =>
        getComputedStyle(document.getElementById('top-count-row')).gridTemplateColumns.split(' ').length), 5,
        'laid out as two rows of five');
    assert.equal(await page.evaluate(() =>
        getComputedStyle(document.getElementById('slot-count-row')).gridTemplateColumns.split(' ').length), 4);

    // Runway: ON/OFF independent of count. Toolbar Shortcuts have no enable
    // switch at all — they are structurally available whenever the toolbar is
    // revealed, controlled only through count and order.
    assert.equal(await page.locator('#top-shortcuts-enabled').count(), 0,
        'Toolbar Shortcuts ON/OFF switch is gone');
    await setSwitch('quick-actions-enabled', true);
    await page.locator('#slot-count-row .btn-slot-count[data-count="6"]').click();
    await page.locator('#top-count-row .btn-slot-count[data-count="9"]').click();
    assert.equal(await page.evaluate(() => localStorage.getItem('hotswap_quick_action_count')), '6');
    assert.equal(await page.evaluate(() => localStorage.getItem('hotswap_top_count')), '9');
    await setSwitch('quick-actions-enabled', false);
    assert.equal(await page.evaluate(() => localStorage.getItem('hotswap_quick_actions_enabled')), 'false');
    assert.equal(await page.evaluate(() => localStorage.getItem('hotswap_quick_action_count')), '6',
        'switching a surface off keeps its configuration');
    assert.equal(await page.evaluate(() => localStorage.getItem('hotswap_top_count')), '9');
    // A stale stored "disabled" value from before this pass must be ignored.
    await page.evaluate(() => localStorage.setItem('hotswap_top_shortcuts_enabled', 'false'));
    await page.reload();
    assert.equal(await page.locator('.hotswap-toggle-row', { has: page.locator('[data-key]') }).count() > 0, true);
    assert.equal(await page.evaluate(() => document.getElementById('top-count-row')
        .querySelector('.btn-slot-count.active')?.dataset.count), '9',
        'Toolbar Shortcuts count/order still render normally despite the legacy disabled flag');

    // Exactly two opacity values, and they live in the RUNWAY card.
    await page.locator('#ghost-opacity-input').fill('0');
    await page.locator('#ghost-opacity-input').blur();
    await page.locator('#hover-opacity-input').fill('100');
    await page.locator('#hover-opacity-input').blur();
    assert.equal(await page.evaluate(() => localStorage.getItem('hotswap_ghost_opacity')), '0');
    assert.equal(await page.evaluate(() => localStorage.getItem('hotswap_hover_opacity')), '100');
    assert.equal(await page.locator('input[type="range"][id$="opacity-slider"]').count(), 2,
        'no third opacity control exists');
    assert.equal(await page.evaluate(() =>
        document.getElementById('ghost-opacity-slider').closest('#quick-actions-config') !== null), true,
        'the opacity pair belongs to the runway, not the toolbar');
    assert.deepEqual(errors, []);
    await page.close();
});

test('reordering in Settings changes what the runtime renders, not what actions do', async () => {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    await page.route(/^https?:\/\/(?!127\.0\.0\.1:4173).*/, (route) => route.fulfill({ status: 204, body: '' }));
    await page.addInitScript(() => {
        if (window === window.top) {
            localStorage.setItem('hotswap_quick_actions_enabled', 'true');
            localStorage.setItem('hotswap_quick_action_count', '3');
            localStorage.setItem('hotswap_quick_action_order', JSON.stringify(['reload', 'star', 'undo']));
            localStorage.setItem('hotswap_action_order', JSON.stringify(['reload', 'star', 'folder', 'undo', 'redo']));
            localStorage.setItem('loop_matrix_urls', JSON.stringify(['/test/fixtures/canary.html?id=A']));
        }
    });
    await page.goto(`${ORIGIN}/index3.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelectorAll('.stream-panel iframe').length === 4);

    assert.deepEqual(await page.evaluate(() =>
        [...document.querySelectorAll('.stream-panel')[0].querySelectorAll('.hotswap-runway-btn')]
            .map((button) => button.dataset.actionKey)), ['reload', 'star', 'undo'],
        'the runway renders in the configured order');

    // Only what the tray actually RENDERS — hidden buttons keep their markup
    // position and are not part of the presented order.
    const trayOrder = await page.evaluate(() =>
        [...document.querySelectorAll('.stream-panel')[0].querySelectorAll('.hotswap-icon-row button')]
            .filter((button) => button.style.display !== 'none')
            .map((button) => button.className.replace('btn-hotswap-', '').replace('btn-', '')));
    assert.ok(trayOrder.length > 0 && !trayOrder.includes('folder'),
        'Deep Cuts renders the unified remainder after the Top cutoff');

    // An action can appear in BOTH collections — they are presentation, not behavior.
    assert.equal(await page.evaluate(() => document.querySelectorAll('.stream-panel')[0]
        .querySelector('.btn-hotswap-undo').style.display), 'none');
    await page.close();
});

test('a small panel clips the runway instead of overflowing, keeping the config', async () => {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    await page.setViewportSize({ width: 900, height: 420 });
    await page.route(/^https?:\/\/(?!127\.0\.0\.1:4173).*/, (route) => route.fulfill({ status: 204, body: '' }));
    await page.addInitScript(() => {
        if (window === window.top) {
            localStorage.setItem('hotswap_quick_actions_enabled', 'true');
            localStorage.setItem('hotswap_quick_action_count', '8');
            localStorage.setItem('triple_screen_layout', '4grid');
            localStorage.setItem('loop_matrix_urls', JSON.stringify([
                '/test/fixtures/canary.html?id=A', '/test/fixtures/canary.html?id=B',
                '/test/fixtures/canary.html?id=C', '/test/fixtures/canary.html?id=D',
            ]));
        }
    });
    await page.goto(`${ORIGIN}/index3.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelectorAll('.stream-panel iframe').length === 4);
    await page.waitForTimeout(200);

    const fit = await page.evaluate(() => [...document.querySelectorAll('.stream-panel')].map((panel) => {
        const runway = panel.querySelector('.hotswap-runway');
        if (!runway) return { present: false };
        const panelBox = panel.getBoundingClientRect();
        const runwayBox = runway.getBoundingClientRect();
        return {
            present: true,
            configured: runway.children.length,
            withinPanel: runwayBox.bottom <= Math.ceil(panelBox.bottom)
                && runwayBox.right <= Math.ceil(panelBox.right),
        };
    }));
    fit.filter((entry) => entry.present).forEach((entry) => {
        assert.equal(entry.configured, 8, 'all 8 stay configured — nothing is silently deleted');
        assert.equal(entry.withinPanel, true, 'and nothing spills outside the panel');
    });

    // The complete set of actions is still reachable through the tray.
    assert.ok(await page.evaluate(() => document.querySelectorAll('.stream-panel')[0]
        .querySelectorAll('.hotswap-icon-row button').length) >= 8);
    assert.equal(await page.evaluate(() => localStorage.getItem('hotswap_quick_action_count')), '8');
    await page.close();
});

test('the layer selector actually retargets the same controls', async () => {
    const page = await bootCanaryGrid();
    const shownBySlot0 = () => page.evaluate(() =>
        document.querySelectorAll('.stream-panel iframe')[0].getAttribute('data-last-src'));

    // A GS3 action on panel 0, then load a nested runtime into it. Panel 0 now
    // has both its own action history AND a Layer 2 to aim at.
    await assignPanelUrl(page, 0, '/test/fixtures/canary.html?id=A2');
    await waitForLiveId(page, 0, 'A2');
    await assignPanelUrl(page, 0, 'index3.html');
    await page.waitForFunction(() => document.querySelectorAll('.stream-panel')[0]
        .querySelector('.hotswap-layer-selector').hidden === false);

    // L2 is active by default, so Undo is aimed INTO the nested runtime — it
    // must not reverse this panel's own action history.
    assert.equal(await page.evaluate(() => document.querySelectorAll('.stream-panel')[0].dataset.layerScope), 'L2');
    await clickPanelHistory(page, 0, 'undo');
    await page.waitForTimeout(150);
    assert.equal(await shownBySlot0(), 'index3.html',
        'with L2 selected the outer panel is left alone');

    // Aim the SAME control at L1 and it reverses this panel's own history.
    await page.evaluate(() => document.querySelectorAll('.stream-panel')[0]
        .querySelector('.hotswap-layer-btn[data-layer="L1"]').click());
    await clickPanelHistory(page, 0, 'undo');
    await waitForLiveId(page, 0, 'A2');
    assert.equal(await shownBySlot0(), '/test/fixtures/canary.html?id=A2',
        'nothing moved — only the stated scope changed');
    await page.close();
});

// Phase 3 — the [L2][L1] target is the conductor's routing control, not a
// layout shortcut or a Dock action, so it moved out of the right-side working
// cluster into its own central shell region. The right cluster itself
// (visible layouts -> layout gateway -> general overflow) must stay exactly
// as contiguous as before.
test('the Layer target sits centrally, apart from the contiguous right-side layout cluster', async () => {
    const page = await bootCanaryGrid();
    try {
        await assignPanelUrl(page, 0, 'index3.html');
        await page.waitForFunction(() => document.getElementById('master-layer-selector').hidden === false);
        await page.evaluate(() => document.getElementById('btn-toggle-master').click());
        await page.waitForTimeout(250);

        const geo = await page.evaluate(() => {
            const rect = (el) => el.getBoundingClientRect();
            const bar = rect(document.getElementById('master-bar'));
            const structural = rect(document.querySelector('.master-structural'));
            const layerRegion = rect(document.querySelector('.master-layer-region'));
            const shortcuts = rect(document.getElementById('master-layout-shortcuts'));
            const gateway = rect(document.getElementById('btn-master-layout-overflow'));
            const generalOverflow = rect(document.getElementById('btn-master-overflow'));
            const dock = rect(document.getElementById('orchestration-dock'));
            const hit = (a, b) => !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
            const contextualChildren = [...document.querySelector('.master-contextual').children].map((el) => el.id || el.className);
            return {
                barCenter: bar.left + bar.width / 2,
                layerCenter: layerRegion.left + layerRegion.width / 2,
                structuralRight: structural.right,
                shortcutsLeft: shortcuts.left,
                layerRightOfStructural: layerRegion.left >= structural.right,
                layerLeftOfShortcuts: layerRegion.right <= shortcuts.left,
                gatewayImmediatelyFollowsShortcuts: Math.round(gateway.left - shortcuts.right) < 20,
                generalOverflowFollowsGateway: generalOverflow.left >= gateway.right,
                layerNotInContextual: !contextualChildren.includes('master-layer-selector'),
                layerOverlapsDock: hit(layerRegion, dock),
            };
        });

        // Structural (far left) -> central Layer target -> the contiguous
        // right cluster (layouts -> gateway -> general overflow) -> Dock.
        assert.ok(geo.layerRightOfStructural, 'Layer target sits after the structural group');
        assert.ok(geo.layerLeftOfShortcuts, 'Layer target sits before the layout cluster, not inside it');
        assert.ok(geo.layerNotInContextual, 'the layer selector is no longer a child of .master-contextual');
        assert.ok(geo.gatewayImmediatelyFollowsShortcuts, 'the layout gateway is still glued to the visible shortcuts');
        assert.ok(geo.generalOverflowFollowsGateway, 'general overflow still follows the layout cluster, not the Layer target');
        assert.ok(!geo.layerOverlapsDock, 'moving toward the center never puts the Layer target under the Dock');

        // "Toward the center" — meaningfully closer to the bar's midpoint than
        // its old position glued against the layout cluster / Dock reserve.
        const distanceFromCenter = Math.abs(geo.layerCenter - geo.barCenter);
        assert.ok(distanceFromCenter < geo.barCenter * 0.35,
            `Layer target (${geo.layerCenter}) is reasonably close to bar center (${geo.barCenter})`);

        // Functionality is unchanged — the same control still retargets Undo.
        await assignPanelUrl(page, 0, '/test/fixtures/canary.html?id=A2');
        await waitForLiveId(page, 0, 'A2');
        await assignPanelUrl(page, 0, 'index3.html');
        await page.evaluate(() => document.querySelector('#master-layer-selector .hotswap-layer-btn[data-layer="L1"]').click());
        assert.equal(await page.evaluate(() => document
            .querySelector('#master-layer-selector .hotswap-layer-btn[data-layer="L1"]').classList.contains('active')), true);
    } finally { await page.close(); }
});

// Phase 4 — a nested Grid Runtime is still a real Grid Runtime: its own
// internal resizers must survive being hosted in a Panel whose iframe is
// narrower than the 900px small-viewport breakpoint, which is the ordinary
// case (a Panel is rarely as wide as a whole desktop monitor). Root cause was
// index3.html's own `@media (max-width: 900px)` firing on the NESTED
// document's iframe viewport width and disabling `.resizer` — now scoped to
// `html:not(.is-nested)` so a genuinely narrow TOP-LEVEL viewport still gets
// the fallback, but nesting-plus-narrow does not.
test('a nested Grid Runtime keeps its own internal resizers even when its iframe is under 900px', async () => {
    const page = await browser.newPage();
    page.setDefaultTimeout(8000);
    try {
        await page.route(/^https?:\/\/(?!127\.0\.0\.1:).*/, (route) =>
            route.fulfill({ contentType: 'text/html', body: '<p>Ordinary third-party content</p>' }));
        await page.goto(`${ORIGIN}/index3.html`, { waitUntil: 'load' });
        await page.waitForFunction(() => document.querySelectorAll('.stream-panel').length === 4);

        // Position 2 (top-right in the default Left Tall) is comfortably under
        // 900px even at a generous desktop width — exactly the ordinary case.
        await assignPanelUrl(page, 1, 'index3.html?workspace=live');
        const nested = await frameForSlot(page, 1);
        await nested.waitForFunction(() => document.querySelectorAll('.stream-panel').length >= 1);
        await nested.waitForTimeout(300);

        const before = await nested.evaluate(() => ({
            innerWidth: window.innerWidth,
            resizerCount: document.querySelectorAll('.resizer').length,
            resizerDisplay: [...document.querySelectorAll('.resizer')]
                .map((r) => getComputedStyle(r).display),
            columns: getComputedStyle(document.getElementById('triple-layout')).gridTemplateColumns,
        }));
        assert.ok(before.innerWidth < 900, `sanity: the nested iframe is narrow (${before.innerWidth}px)`);
        assert.ok(before.resizerCount > 0, 'the nested Grid still injects its own resizers');
        assert.ok(before.resizerDisplay.every((d) => d !== 'none'), 'and they are not display:none');

        // Hit-testable and draggable via a genuine mouse drag at true viewport
        // coordinates (the only way to prove a real click/drag would reach it —
        // a same-frame element.click() bypasses hit-testing entirely).
        const panelOffset = await page.evaluate((slotId) => {
            const iframe = document.getElementById(slotId).querySelector('iframe');
            const r = iframe.getBoundingClientRect();
            return { left: r.left, top: r.top };
        }, 'screen-2-slot');
        const resizerLocal = await nested.evaluate(() => document.querySelector('.resizer').getBoundingClientRect());
        const rx = panelOffset.left + resizerLocal.x + resizerLocal.width / 2;
        const ry = panelOffset.top + resizerLocal.y + resizerLocal.height / 2;
        // elementFromPoint never crosses a document boundary — from the OUTER
        // page it correctly (and only) resolves to the hosting iframe itself.
        // Hit-testability of the resizer WITHIN its own document is what
        // actually matters, checked in the nested document's own coordinates.
        const hitLocal = await nested.evaluate(([x, y]) => {
            const el = document.elementFromPoint(x, y);
            return el ? el.className : null;
        }, [resizerLocal.x + resizerLocal.width / 2, resizerLocal.y + resizerLocal.height / 2]);
        assert.ok(String(hitLocal).includes('resizer'), `the resizer is hit-testable within its own document (got ${hitLocal})`);

        // Capture the OUTER Grid's own track sizing before dragging the INNER
        // resizer, so a leak between the two geometry owners is provable.
        const outerColumnsBefore = await page.evaluate(() =>
            getComputedStyle(document.getElementById('triple-layout')).gridTemplateColumns);

        await page.mouse.move(rx, ry);
        await page.mouse.down();
        await page.mouse.move(rx + 60, ry, { steps: 8 });
        await page.mouse.up();
        await page.waitForTimeout(150);

        const after = await nested.evaluate(() => ({
            columns: getComputedStyle(document.getElementById('triple-layout')).gridTemplateColumns,
            panelCount: document.querySelectorAll('.stream-panel').length,
        }));
        assert.notEqual(after.columns, before.columns, 'the real drag actually changed the NESTED Grid\'s own tracks');
        assert.equal(after.panelCount, 4, 'the nested document is still the same live document — no reload/rebuild');

        const outerColumnsAfter = await page.evaluate(() =>
            getComputedStyle(document.getElementById('triple-layout')).gridTemplateColumns);
        assert.equal(outerColumnsAfter, outerColumnsBefore,
            'dragging the INNER resizer never touches the OUTER Grid\'s own tracks');

        // The outer resizer still works independently, on the OUTER document.
        const outerResizer = await page.evaluate(() => document.querySelector('.resizer').getBoundingClientRect());
        await page.mouse.move(outerResizer.x + outerResizer.width / 2, outerResizer.y + outerResizer.height / 2);
        await page.mouse.down();
        await page.mouse.move(outerResizer.x + outerResizer.width / 2 + 60, outerResizer.y + outerResizer.height / 2, { steps: 8 });
        await page.mouse.up();
        await page.waitForTimeout(150);
        const outerColumnsAfterOwnDrag = await page.evaluate(() =>
            getComputedStyle(document.getElementById('triple-layout')).gridTemplateColumns);
        assert.notEqual(outerColumnsAfterOwnDrag, outerColumnsAfter, 'the outer resizer still works, on its own geometry');

        // A genuinely narrow TOP-LEVEL (never-nested) viewport still gets the
        // small-screen fallback — this task narrows the exclusion, it does not
        // delete the fallback.
        const narrowTop = await browser.newPage();
        try {
            await narrowTop.setViewportSize({ width: 700, height: 900 });
            await narrowTop.goto(`${ORIGIN}/index3.html`, { waitUntil: 'load' });
            await narrowTop.waitForTimeout(300);
            const topLevelNarrow = await narrowTop.evaluate(() => ({
                isNested: document.documentElement.classList.contains('is-nested'),
                resizerDisplay: [...document.querySelectorAll('.resizer')].map((r) => getComputedStyle(r).display),
                columns: getComputedStyle(document.getElementById('triple-layout')).gridTemplateColumns,
            }));
            assert.equal(topLevelNarrow.isNested, false);
            assert.ok(topLevelNarrow.resizerDisplay.every((d) => d === 'none'),
                'genuine top-level narrow viewport still hides resizers');
            assert.equal(topLevelNarrow.columns, '700px', 'genuine top-level narrow viewport still collapses to one column');
        } finally { await narrowTop.close(); }
    } finally { await page.close(); }
});

// ─────────────────────────────────────────────────────────────────────────────
// Stage 2.5 — explicit L2-P# addressing, nested local labels, subtle nested
// Chrome, capability routing, and nested global-shell suppression.
// ─────────────────────────────────────────────────────────────────────────────

/** The Master conductor's current [L2-P#]/[L1] buttons, in DOM order. */
const masterLayerButtons = (page) => page.evaluate(() => [
    ...document.querySelectorAll('#master-layer-selector .hotswap-layer-btn'),
].map((button) => ({
    text: button.textContent.trim(),
    slot: button.dataset.slot === undefined ? null : Number(button.dataset.slot),
    active: button.classList.contains('active'),
})));

test('Stage C: [L2-P#] truthfully addresses each nested Runtime by its HOST Position, and tracks a move', async () => {
    const page = await bootCanaryGrid();
    try {
        // Only Position 1 (slot 0) hosts a nested Runtime so far.
        await assignPanelUrl(page, 0, 'index3.html?workspace=live');
        await page.waitForFunction(() => document.getElementById('master-layer-selector').hidden === false);
        assert.deepEqual((await masterLayerButtons(page)).map((b) => b.text), ['L2-P1', 'L1'],
            'no L2-P2/P3 target exists — nothing hosts a nested Runtime there');

        // Nest a SECOND Runtime at slot 2 (Position 3 in the default Left Tall).
        await assignPanelUrl(page, 2, 'index3.html?workspace=live');
        await page.waitForFunction(() => document.querySelectorAll('#master-layer-selector .hotswap-layer-btn').length === 3);
        assert.deepEqual((await masterLayerButtons(page)).map((b) => b.text), ['L2-P1', 'L2-P3', 'L1'],
            'exactly the Positions that truthfully host an active nested Runtime, matching the brief\'s own example');

        // Move the Panel hosting the first nested Runtime from P1 to P4 (an
        // empty slot in Left Tall is never used, so swap with slot 1 = P2
        // instead, then move again to reach an otherwise-unoccupied Position
        // isn't necessary — a straight swap already proves the label follows
        // the PANEL, not the slot).
        await page.evaluate(() => {
            const panel = document.querySelectorAll('.stream-panel')[0];
            panel.querySelector('.btn-hotswap-position').click();
        });
        await page.evaluate(() => {
            const items = [...document.querySelectorAll('.stream-panel')[0].querySelectorAll('.hotswap-position-row .hotswap-position-item')];
            items.find((item) => item.textContent.includes('Position 2')).click();
        });
        await page.waitForFunction(() => {
            const texts = [...document.querySelectorAll('#master-layer-selector .hotswap-layer-btn')].map((b) => b.textContent.trim());
            return texts.includes('L2-P2');
        });
        const afterMove = await masterLayerButtons(page);
        assert.deepEqual(afterMove.map((b) => b.text).sort(), ['L1', 'L2-P2', 'L2-P3'].sort(),
            'L2-P1 became L2-P2 — the SAME nested Runtime, now entered through Position 2 — without recreating anything');
        assert.equal(afterMove.find((b) => b.text === 'L2-P2').slot, 0, 'still the Runtime hosted by slot 0, only its Position label changed');
    } finally { await page.close(); }
});

test('Stage C: the selector targets exactly ONE nested Runtime, never broadcasting to every nested Runtime', async () => {
    const page = await bootCanaryGrid();
    try {
        await assignPanelUrl(page, 0, 'index3.html?workspace=live');
        await assignPanelUrl(page, 2, 'index3.html?workspace=live');
        await page.waitForFunction(() => document.querySelectorAll('#master-layer-selector .hotswap-layer-btn').length === 3);

        const spy = () => page.evaluate(() => {
            window.__sent = { 0: [], 2: [] };
            [0, 2].forEach((slot) => {
                const iframe = document.querySelectorAll('.stream-panel iframe')[slot];
                iframe.contentWindow.postMessage = (message) => window.__sent[slot].push(message);
            });
        });
        const sent = () => page.evaluate(() => window.__sent);

        // Target P1 explicitly, then fire a Layer-scoped action.
        await page.evaluate(() => document
            .querySelector('#master-layer-selector .hotswap-layer-btn[data-slot="0"]').click());
        await spy();
        await page.evaluate(() => document.getElementById('btn-master-shuffle').click());
        let after = await sent();
        assert.equal(after[0].length, 1, 'the targeted nested Runtime (P1) received the action');
        assert.equal(after[2].length, 0, 'the OTHER nested Runtime (P3) received nothing — no broadcast');

        // Re-target P3 and repeat — the SAME control, a different target.
        await page.evaluate(() => document
            .querySelector('#master-layer-selector .hotswap-layer-btn[data-slot="2"]').click());
        await spy();
        await page.evaluate(() => document.getElementById('btn-master-shuffle').click());
        after = await sent();
        assert.equal(after[0].length, 0, 'no longer targeted — P1 receives nothing this time');
        assert.equal(after[2].length, 1, 'P3 is now the one that receives it');
    } finally { await page.close(); }
});

test('Stage C: Folder, Layout and Save Session As route to the targeted nested Runtime only', async () => {
    const page = await bootCanaryGrid();
    try {
        await assignPanelUrl(page, 0, 'index3.html?workspace=live');
        await assignPanelUrl(page, 2, 'index3.html?workspace=live');
        await page.waitForFunction(() => document.querySelectorAll('#master-layer-selector .hotswap-layer-btn').length === 3);
        await page.evaluate(() => document
            .querySelector('#master-layer-selector .hotswap-layer-btn[data-slot="0"]').click());

        const spy = () => page.evaluate(() => {
            window.__sent = { 0: [], 2: [] };
            [0, 2].forEach((slot) => {
                const iframe = document.querySelectorAll('.stream-panel iframe')[slot];
                iframe.contentWindow.postMessage = (message) => window.__sent[slot].push(message);
            });
        });
        await spy();

        // 💾 Save Session As... a specific preset — payload-carrying, key + data.
        await page.evaluate(() => document.getElementById('btn-master-overflow').click());
        await page.evaluate(() => document.getElementById('btn-master-save').click());
        await page.evaluate(() => [...document.querySelectorAll('.save-session-item')]
            .find((item) => item.textContent.includes('Preset 3')).click());
        let after = await page.evaluate(() => window.__sent);
        assert.deepEqual(after[0], [{ source: 'gs3-layer-scope', action: 'saveSessionAs', presetId: 3 }]);
        assert.deepEqual(after[2], [], 'the other nested Runtime is untouched');

        // 🌐 Folder — a specific folder name, forwarded rather than reshuffling
        // this (outer) Runtime's own panels.
        await spy();
        await page.evaluate(() => document.getElementById('btn-master-folder').click());
        await page.evaluate(() => [...document.querySelectorAll('.dropup-item')][0].click()); // "Any Folder"
        after = await page.evaluate(() => window.__sent);
        assert.deepEqual(after[0], [{ source: 'gs3-layer-scope', action: 'folder', folder: '' }]);
        assert.deepEqual(after[2], []);

        // ▦ Layout — forwarded, and provably does NOT touch the outer Grid's
        // own layout (real effect, not just the message).
        const outerLayoutBefore = await page.evaluate(() => document.getElementById('triple-layout').className);
        await spy();
        await page.evaluate(() => document.getElementById('btn-master-layout-overflow').click());
        await page.evaluate(() => document.getElementById('btn-layout-vsplit').click());
        after = await page.evaluate(() => window.__sent);
        assert.deepEqual(after[0], [{ source: 'gs3-layer-scope', action: 'layout', layout: 'vsplit' }]);
        assert.deepEqual(after[2], []);
        const outerLayoutAfter = await page.evaluate(() => document.getElementById('triple-layout').className);
        assert.equal(outerLayoutAfter, outerLayoutBefore, 'the outer Grid\'s own layout never changed — only the targeted nested Runtime was asked to');
    } finally { await page.close(); }
});

test('Stage C: Layout forwarding actually changes the targeted nested Grid, real effect not just the message', async () => {
    const page = await bootCanaryGrid();
    try {
        await assignPanelUrl(page, 1, 'index3.html?workspace=live');
        const nested = await frameForSlot(page, 1);
        await nested.waitForFunction(() => document.getElementById('triple-layout') !== null);
        const nestedBefore = await nested.evaluate(() => document.getElementById('triple-layout').className);

        await page.waitForFunction(() => document.getElementById('master-layer-selector').hidden === false);
        await page.evaluate(() => document
            .querySelector('#master-layer-selector .hotswap-layer-btn[data-slot="1"]').click());
        await page.evaluate(() => document.getElementById('btn-master-layout-overflow').click());
        await page.evaluate(() => document.getElementById('btn-layout-vsplit').click());

        await nested.waitForFunction(() => document.getElementById('triple-layout').classList.contains('layout-vsplit'));
        const nestedAfter = await nested.evaluate(() => document.getElementById('triple-layout').className);
        assert.notEqual(nestedAfter, nestedBefore);
        assert.match(nestedAfter, /layout-vsplit/);

        const outerLayout = await page.evaluate(() => document.getElementById('triple-layout').className);
        assert.match(outerLayout, /layout-lefttall/, 'the OUTER Grid stayed on its own default layout');
    } finally { await page.close(); }
});

test('Stage C: nested local Position labels read "L2 · P#", distinct from the host conductor\'s "L2-P#" addressing', async () => {
    const page = await bootCanaryGrid();
    try {
        await assignPanelUrl(page, 1, 'index3.html?workspace=live');
        const nested = await frameForSlot(page, 1);
        await nested.waitForFunction(() => document.querySelectorAll('.stream-panel').length >= 1);

        // The OUTER Runtime's own labels are ordinary — it is not nested.
        const outerLabel = await page.evaluate(() =>
            document.querySelectorAll('.slot-label')[1].textContent);
        assert.equal(outerLabel, 'Position 2', 'the outer Runtime is not nested — ordinary wording');

        // The NESTED Runtime's own internal Position 1 label uses the compact
        // Layer-2-local grammar, and the long-form tooltip spells it out.
        const nestedLabel = await nested.evaluate(() => document.querySelector('.slot-label').textContent);
        const nestedTooltip = await nested.evaluate(() => document.querySelector('.slot-label').title);
        assert.equal(nestedLabel, 'L2 · P1');
        assert.equal(nestedTooltip, 'Layer 2 · Position 1');

        // Master's addressing for the SAME nested Runtime uses the hyphenated
        // HOST-Position grammar — a deliberately different vocabulary so the
        // two concepts (internal Position vs. HOST entrance) are never conflated.
        await page.waitForFunction(() => document.getElementById('master-layer-selector').hidden === false);
        const masterText = (await masterLayerButtons(page)).find((b) => b.text.startsWith('L2-')).text;
        assert.equal(masterText, 'L2-P2');
    } finally { await page.close(); }
});

test('Stage C: nested Chrome carries a subtle, distinct visual hook (never only the L2 · P# text)', async () => {
    const page = await bootCanaryGrid();
    try {
        await assignPanelUrl(page, 1, 'index3.html?workspace=live');
        const nested = await frameForSlot(page, 1);
        await nested.waitForFunction(() => document.querySelector('.hotswap-toolbar') !== null);

        const outerBg = await page.evaluate(() =>
            getComputedStyle(document.querySelectorAll('.hotswap-toolbar')[1]).backgroundColor);
        const nestedBg = await nested.evaluate(() =>
            getComputedStyle(document.querySelector('.hotswap-toolbar')).backgroundColor);
        assert.notEqual(nestedBg, outerBg, 'nested top Chrome is visually distinguishable from outer Chrome, even before any text is read');

        const isNestedFlag = await nested.evaluate(() => document.documentElement.classList.contains('is-nested'));
        assert.equal(isNestedFlag, true, 'the distinction hangs off the existing .is-nested state hook, not a parallel one');
    } finally { await page.close(); }
});

test('Stage C: a nested Grid Runtime constructs no global Master Bar or Orchestration Dock, but keeps local Chrome and resizers; a standalone Grid still renders both', async () => {
    const page = await bootCanaryGrid();
    try {
        await assignPanelUrl(page, 1, 'index3.html?workspace=live');
        const nested = await frameForSlot(page, 1);
        await nested.waitForFunction(() => document.querySelectorAll('.stream-panel').length >= 1);

        const nestedShell = await nested.evaluate(() => ({
            masterBar: document.getElementById('master-bar') === null,
            dock: document.getElementById('orchestration-dock') === null,
            hasToolbar: document.querySelector('.hotswap-toolbar') !== null,
            resizerCount: document.querySelectorAll('.resizer').length,
        }));
        assert.equal(nestedShell.masterBar, true, 'not merely hidden — NOT CONSTRUCTED');
        assert.equal(nestedShell.dock, true, 'not merely hidden — NOT CONSTRUCTED');
        assert.ok(nestedShell.hasToolbar, 'local Panel Chrome survives suppression');
        assert.ok(nestedShell.resizerCount > 0, 'the nested Grid\'s own internal resizers survive suppression');

        // The OUTER (viewport-owning) Runtime still has exactly one of each.
        const outerShell = await page.evaluate(() => ({
            masterBarCount: document.querySelectorAll('#master-bar').length,
            dockCount: document.querySelectorAll('#orchestration-dock').length,
        }));
        assert.deepEqual(outerShell, { masterBarCount: 1, dockCount: 1 });

        // A standalone (never-nested) Grid renders both too — nesting alone
        // decides this, not "being a Grid".
        const standalone = await browser.newPage();
        try {
            await standalone.goto(`${ORIGIN}/index3.html`, { waitUntil: 'load' });
            await standalone.waitForFunction(() => document.querySelectorAll('.stream-panel').length === 4);
            const standaloneShell = await standalone.evaluate(() => ({
                masterBar: document.getElementById('master-bar') !== null,
                dock: document.getElementById('orchestration-dock') !== null,
            }));
            assert.deepEqual(standaloneShell, { masterBar: true, dock: true });
        } finally { await standalone.close(); }
    } finally { await page.close(); }
});

// ─────────────────────────────────────────────────────────────────────────────
// Chrome lifecycle: autonomous retraction, Deep Cuts dismissal, Position button.
// ─────────────────────────────────────────────────────────────────────────────

const isRevealed = (page, slotIndex = 0) => page.evaluate((index) =>
    document.querySelectorAll('.stream-panel')[index].classList.contains('chrome-revealed'), slotIndex);

/** Pointer leaves the whole Chrome family — the signal that starts the countdown. */
const leaveChrome = (page, slotIndex = 0) => page.evaluate((index) => {
    const panel = document.querySelectorAll('.stream-panel')[index];
    panel.querySelector('.hotswap-toolbar')
        .dispatchEvent(new PointerEvent('pointerleave', { bubbles: false, relatedTarget: null }));
}, slotIndex);

test('the toolbar retracts by itself, with no other panel involved', async () => {
    const page = await bootCanaryGrid();
    const delay = await page.evaluate(async () =>
        (await import('./js/hotswap-chrome.js')).CHROME_RETRACT_DELAY_MS);
    assert.ok(delay >= 750 && delay <= 1000, `retract delay ${delay}ms is forgiving but prompt`);

    await revealChrome(page);
    assert.equal(await isRevealed(page), true);

    await leaveChrome(page);
    // Still open immediately after leaving — the user is not made to race it.
    assert.equal(await isRevealed(page), true, 'a grace period exists');
    await page.waitForFunction(() =>
        !document.querySelectorAll('.stream-panel')[0].classList.contains('chrome-revealed'),
        undefined, { timeout: delay + 1500 });
    assert.equal(await isRevealed(page), false, 'it retracted on its own');

    // Nothing else was touched to make that happen.
    assert.equal(await isRevealed(page, 1), false);
    assert.equal(await isRevealed(page, 2), false);
    await page.close();
});

test('returning before the countdown expires cancels the retract', async () => {
    const page = await bootCanaryGrid();
    await revealChrome(page);
    await leaveChrome(page);
    await page.waitForTimeout(200);
    await revealChrome(page); // come back
    await page.waitForTimeout(900);
    assert.equal(await isRevealed(page), true, 'coming back cancels the countdown');
    await page.close();
});

test('an open menu or keyboard focus holds Chrome open, then it retracts', async () => {
    const page = await bootCanaryGrid();
    const openTray = () => page.evaluate(() =>
        document.querySelectorAll('.stream-panel')[0].querySelector('.hotswap-trigger').click());

    await revealChrome(page);
    await openTray();
    // Moving between family members must not start a countdown.
    await page.evaluate(() => {
        const panel = document.querySelectorAll('.stream-panel')[0];
        panel.querySelector('.hotswap-toolbar').dispatchEvent(new PointerEvent('pointerleave', {
            bubbles: false, relatedTarget: panel.querySelector('.hotswap-overlay'),
        }));
    });
    await page.waitForTimeout(500);
    assert.equal(await isRevealed(page), true, 'moving into the tray is not leaving');
    assert.equal(await page.evaluate(() => document.querySelectorAll('.stream-panel')[0]
        .querySelector('.hotswap-overlay').classList.contains('open')), true);

    // Focus inside the family keeps it alive too.
    await page.evaluate(() => document.querySelectorAll('.stream-panel')[0]
        .querySelector('.hotswap-trigger').focus());
    await page.waitForTimeout(400);
    assert.equal(await isRevealed(page), true);

    // But walking away still ends it — an open tray cannot hold the website's
    // height hostage indefinitely.
    await page.evaluate(() => {
        const panel = document.querySelectorAll('.stream-panel')[0];
        panel.querySelector('.hotswap-trigger').blur();
        panel.dispatchEvent(new PointerEvent('pointerleave', { bubbles: false, relatedTarget: null }));
    });
    await page.waitForFunction(() =>
        !document.querySelectorAll('.stream-panel')[0].classList.contains('chrome-revealed'),
        undefined, { timeout: 3000 });
    assert.equal(await page.evaluate(() => document.querySelectorAll('.stream-panel')[0]
        .querySelector('.hotswap-overlay').classList.contains('open')), false,
        'and the tray closes with it');
    await page.close();
});

test('Deep Cuts dismisses by outside click, Escape, or X — not only X', async () => {
    const page = await bootCanaryGrid();
    const trayOpen = () => page.evaluate(() => document.querySelectorAll('.stream-panel')[0]
        .querySelector('.hotswap-overlay').classList.contains('open'));
    const openTray = async () => {
        await revealChrome(page);
        await page.evaluate(() => document.querySelectorAll('.stream-panel')[0]
            .querySelector('.hotswap-trigger').click());
        assert.equal(await trayOpen(), true);
    };

    // Clicking inside keeps it open.
    await openTray();
    await page.evaluate(() => document.querySelectorAll('.stream-panel')[0]
        .querySelector('.hotswap-overlay').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    assert.equal(await trayOpen(), true, 'interacting inside the tray keeps it open');

    // An observable outside click dismisses it.
    await page.evaluate(() => document.getElementById('master-bar')
        .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    assert.equal(await trayOpen(), false, 'going back to work dismisses it');

    // Escape unwinds depth: submenu first, then the tray.
    await openTray();
    await page.evaluate(() => document.querySelectorAll('.stream-panel')[0]
        .querySelector('.btn-hotswap-folder').click());
    assert.equal(await page.evaluate(() => document.querySelectorAll('.stream-panel')[0]
        .querySelector('.hotswap-folder-row').classList.contains('open')), true);
    const escape = () => page.evaluate(() => document.querySelectorAll('.stream-panel')[0]
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    await escape();
    assert.equal(await page.evaluate(() => document.querySelectorAll('.stream-panel')[0]
        .querySelector('.hotswap-folder-row').classList.contains('open')), false, 'submenu closed first');
    assert.equal(await trayOpen(), true, 'the tray is still open');
    await escape();
    assert.equal(await trayOpen(), false, 'the next Escape closes the tray');
    await escape();
    assert.equal(await isRevealed(page), false, 'and the next retracts Chrome');

    // X still works — it is kept as the explicit close, not the only one.
    await openTray();
    await page.evaluate(() => document.querySelectorAll('.stream-panel')[0]
        .querySelector('.hotswap-trigger').click());
    assert.equal(await trayOpen(), false);
    await page.close();
});

test('the Position button opens a menu and moves nothing by itself', async () => {
    const page = await bootCanaryGrid();
    const before = await readCanaries(page, ['A', 'B', 'C']);
    await armContinuityProbe(page);
    await revealChrome(page);

    assert.equal(await page.evaluate(() => document.querySelectorAll('.stream-panel')[0]
        .querySelector('.hotswap-position-label').textContent), 'Position 1');

    await page.evaluate(() => document.querySelectorAll('.stream-panel')[0]
        .querySelector('.hotswap-position-btn').click());
    // Opening alone must not move content.
    assert.deepEqual(await readPositionMap(page),
        { 'Position 1': 'A', 'Position 2': 'B', 'Position 3': 'C' });

    const menu = await page.evaluate(() => {
        const panel = document.querySelectorAll('.stream-panel')[0];
        const el = panel.querySelector('.hotswap-position-menu');
        const box = el.getBoundingClientRect();
        const rail = panel.querySelector('.hotswap-toolbar').getBoundingClientRect();
        const hit = document.elementFromPoint(box.left + 20, box.top + 14);
        return {
            parent: el.parentElement.className.split(' ')[0],
            groups: [...el.querySelectorAll('.hotswap-position-group-title')].map((t) => t.textContent),
            visible: box.width > 0 && box.height > 0,
            belowRail: box.top >= rail.bottom - 1,
            // The regression that made this button look inert: the menu opened
            // inside the `overflow: hidden` rail and was clipped away entirely.
            hitTestable: Boolean(hit && hit.closest('.hotswap-position-menu')),
        };
    });
    assert.deepEqual(menu.groups, ['Swap Position', 'Copy To Position']);
    assert.equal(menu.parent, 'stream-panel', 'the pop-under is not inside the clipped rail');
    assert.ok(menu.visible && menu.belowRail, 'it renders below the toolbar');
    assert.equal(menu.hitTestable, true, 'and is actually clickable, not clipped away');

    // Swap goes through the canonical atomic pathway.
    await page.evaluate(() => {
        const group = [...document.querySelectorAll('.stream-panel')[0]
            .querySelectorAll('.hotswap-position-group')][0];
        [...group.querySelectorAll('.hotswap-position-item:not(.current)')]
            .find((item) => item.textContent.startsWith('Position 3')).click();
    });
    assert.equal(await page.evaluate(() => document.querySelectorAll('.stream-panel')[0]
        .querySelector('.hotswap-position-menu').hidden), true,
        'a completed Swap closes the menu — it never hangs open');
    assert.deepEqual(await readPositionMap(page),
        { 'Position 1': 'C', 'Position 2': 'B', 'Position 3': 'A' });
    assert.equal(await page.evaluate(() => window.__hist().at(-1).type), 'position');
    assert.equal(await page.evaluate(() => window.__hist().at(-1).atomic), true);

    const probe = await readContinuityProbe(page);
    const after = await readCanaries(page, ['A', 'B', 'C']);
    assert.deepEqual(probe.loads, { A: 0, B: 0, C: 0 }, 'zero reloads through the whole flow');
    assert.ok(probe.sameNodes && probe.sameParents);
    assert.ok(['A', 'B', 'C'].every((id) => after[id].startedAt === before[id].startedAt));
    await page.close();
});

test('Top Shortcuts render in order, reuse canonical actions, and adapt to width', async () => {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.route(/^https?:\/\/(?!127\.0\.0\.1:4173).*/, (route) => route.fulfill({ status: 204, body: '' }));
    await page.addInitScript(() => {
        if (window === window.top) {
            localStorage.setItem('hotswap_top_shortcuts_enabled', 'true');
            localStorage.setItem('hotswap_top_shortcut_count', '6');
            // Undo/Redo are FIXED rail controls now, so they are not eligible
            // as configurable Toolbar Shortcuts — these are all ordinary ones.
            localStorage.setItem('hotswap_top_shortcut_order', JSON.stringify(
                ['star', 'shuffle', 'reload', 'shuffleAll', 'toggle', 'folder']));
            localStorage.setItem('triple_screen_layout', '3col');
            localStorage.setItem('loop_matrix_urls', JSON.stringify([
                '/test/fixtures/canary.html?id=A', '/test/fixtures/canary.html?id=B',
                '/test/fixtures/canary.html?id=C',
            ]));
        }
    });
    await page.goto(`${ORIGIN}/index3.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelectorAll('.stream-panel iframe').length === 4);
    await revealChrome(page);
    await page.waitForTimeout(300);

    const visibleShortcuts = () => page.evaluate(() =>
        [...document.querySelectorAll('.stream-panel')[0].querySelectorAll('.hotswap-top-shortcut')]
            .filter((button) => !button.hidden).map((button) => button.dataset.actionKey));

    const wide = await visibleShortcuts();
    assert.deepEqual(wide, ['star', 'shuffle', 'reload', 'shuffleAll', 'toggle', 'folder'],
        'all six fit at this width, in the configured order');

    // Narrow the PANEL. (A merely narrow viewport is not enough: index3.html
    // stacks its layout below a breakpoint, which makes each panel wider.)
    await page.setViewportSize({ width: 330, height: 900 });
    await page.waitForTimeout(400);
    const narrow = await visibleShortcuts();
    assert.ok(narrow.length < wide.length, `fewer shortcuts at narrow width (${narrow.length})`);
    assert.deepEqual(narrow, wide.slice(0, narrow.length), 'and they drop from the end');
    const survivors = await page.evaluate(() => {
        const panel = document.querySelectorAll('.stream-panel')[0];
        const rail = panel.querySelector('.hotswap-toolbar').getBoundingClientRect();
        const fits = (sel) => {
            const el = panel.querySelector(sel);
            const box = el.getBoundingClientRect();
            return box.width > 0 && box.right <= rail.right + 1;
        };
        // Scoped to the permanent history group — the structural controls.
        return { position: fits('.hotswap-position-btn'), trigger: fits('.hotswap-trigger'),
                 undo: fits('.hotswap-toolbar-actions .hotswap-mirror-btn[data-action-key="undo"]'),
                 redo: fits('.hotswap-toolbar-actions .hotswap-mirror-btn[data-action-key="redo"]') };
    });
    assert.deepEqual(survivors, { position: true, trigger: true, undo: true, redo: true },
        'Position, Undo/Redo and ··· always survive');
    assert.equal(await page.evaluate(() => localStorage.getItem('hotswap_top_shortcut_count')), '6',
        'the preference is never rewritten to fit');

    // Widening restores them automatically.
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.waitForTimeout(400);
    assert.deepEqual(await visibleShortcuts(), wide, 'widening brings them back');

    // A Top Shortcut invokes the same canonical action as the tray button.
    await page.evaluate(() => document.querySelectorAll('.stream-panel')[0]
        .querySelector('.hotswap-top-shortcut[data-action-key="reload"]').click());
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => document.querySelectorAll('.stream-panel iframe')[0]
        .getAttribute('data-last-src')), '/test/fixtures/canary.html?id=A',
        'reload reused the canonical pathway and kept the panel on its own URL');
    await page.close();
});

test('the toolbar is full opacity while the runway ghosts', async () => {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    await page.route(/^https?:\/\/(?!127\.0\.0\.1:4173).*/, (route) => route.fulfill({ status: 204, body: '' }));
    await page.addInitScript(() => {
        if (window === window.top) {
            localStorage.setItem('hotswap_quick_actions_enabled', 'true');
            localStorage.setItem('hotswap_ghost_opacity', '0');
            localStorage.setItem('hotswap_hover_opacity', '100');
            localStorage.setItem('loop_matrix_urls', JSON.stringify(['/test/fixtures/canary.html?id=A']));
        }
    });
    await page.goto(`${ORIGIN}/index3.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelectorAll('.stream-panel iframe').length === 4);
    await revealChrome(page);
    await page.waitForTimeout(300);

    const opacity = await page.evaluate(() => {
        const panel = document.querySelectorAll('.stream-panel')[0];
        return {
            toolbar: getComputedStyle(panel.querySelector('.hotswap-toolbar')).opacity,
            runway: getComputedStyle(panel.querySelector('.hotswap-runway')).opacity,
        };
    });
    assert.equal(opacity.toolbar, '1', 'a Resting Opacity of 0 must NOT dim the toolbar');
    assert.equal(opacity.runway, '0', 'it applies to the runway alone');

    // A fully transparent runway must still not be a click-blocking wall over
    // the site's top-right, nor anywhere it does not occupy.
    const owner = await page.evaluate(() => {
        const panel = document.querySelectorAll('.stream-panel')[0];
        const box = panel.getBoundingClientRect();
        const at = (x, y) => {
            const el = document.elementFromPoint(x, y);
            return el && el.closest('.hotswap-runway') ? 'runway' : (el ? el.tagName.toLowerCase() : 'none');
        };
        return { topRight: at(box.right - 12, box.top + 30), lowerRight: at(box.right - 12, box.bottom - 40) };
    });
    assert.equal(owner.topRight, 'iframe', 'the safe zone stays the site’s');
    assert.equal(owner.lowerRight, 'iframe', 'and the runway does not span the whole edge');
    await page.close();
});

test('Deep Cuts trigger hover never inherits overlay geometry in either CSS copy', async () => {
    for (const pageName of ['index.html', 'index3.html']) {
        const page = await browser.newPage();
        page.setDefaultTimeout(5000);
        await page.route(/^https?:\/\/(?!127\.0\.0\.1:4173).*/, (route) => route.fulfill({ status: 204, body: '' }));
        await page.addInitScript(() => {
            localStorage.setItem('hotswap_ghost_targets', JSON.stringify({ trigger: true }));
            localStorage.setItem('hotswap_hover_opacity', '43');
            localStorage.setItem('loop_matrix_urls', JSON.stringify([
                '/test/fixtures/canary.html?id=A',
                '/test/fixtures/canary.html?id=B',
                '/test/fixtures/canary.html?id=C',
            ]));
        });
        await page.goto(`${ORIGIN}/${pageName}`, { waitUntil: 'load' });
        if (pageName === 'index.html') {
            await page.locator('.url-grid-field').first().fill('/test/fixtures/canary.html?id=A');
            await page.locator('#launch-btn').click();
        }
        await page.waitForSelector('.stream-panel .hotswap-trigger');
        // Hold the retractable rail open so this test isolates the trigger's
        // own real :hover geometry rather than racing the activation strip.
        await page.locator('.stream-panel').first().evaluate((panel) => panel.classList.add('chrome-revealed'));
        await page.locator('.stream-panel .hotswap-trigger').first().scrollIntoViewIfNeeded();
        await page.waitForTimeout(220);

        const geometry = () => page.evaluate(() => {
            const panel = document.querySelector('.stream-panel');
            const read = (selector) => {
                const box = panel.querySelector(selector).getBoundingClientRect();
                return { x: box.x, y: box.y, width: box.width, height: box.height };
            };
            const trigger = panel.querySelector('.hotswap-trigger');
            const undoSelector = '.hotswap-toolbar-actions [data-action-key="undo"]';
            const redoSelector = '.hotswap-toolbar-actions [data-action-key="redo"]';
            const undo = panel.querySelector(undoSelector);
            const redo = panel.querySelector(redoSelector);
            return {
                trigger: read('.hotswap-trigger'),
                undo: undo && read(undoSelector),
                redo: redo && read(redoSelector),
                opacity: getComputedStyle(trigger).opacity,
                visible: trigger.getClientRects().length > 0 && getComputedStyle(trigger).visibility === 'visible',
                historyDisabled: undo && redo ? [undo.disabled, redo.disabled] : null,
            };
        });
        const before = await geometry();
        await page.locator('.stream-panel .hotswap-trigger').first().hover();
        await page.waitForTimeout(180);
        const hovered = await geometry();

        assert.deepEqual(hovered.trigger, before.trigger, `${pageName}: trigger box stays fixed on hover`);
        assert.deepEqual(hovered.undo, before.undo, `${pageName}: Undo does not move`);
        assert.deepEqual(hovered.redo, before.redo, `${pageName}: Redo does not move`);
        assert.equal(hovered.visible, true, `${pageName}: trigger remains visible`);
        assert.equal(hovered.opacity, '0.43', `${pageName}: configured Ghost hover opacity applies`);
        assert.deepEqual(hovered.historyDisabled, before.historyDisabled, `${pageName}: history state is untouched`);

        await page.locator('.stream-panel .hotswap-trigger').first().click();
        assert.equal(await page.locator('.stream-panel .hotswap-overlay').first().evaluate((tray) =>
            tray.classList.contains('open') && getComputedStyle(tray).pointerEvents === 'auto'), true,
        `${pageName}: Deep Cuts still opens normally`);
        await page.close();
    }
});

const openPositionMenu = (page, slotIndex = 0) => page.evaluate((index) => {
    const panel = document.querySelectorAll('.stream-panel')[index];
    panel.classList.add('chrome-revealed');
    panel.querySelector('.hotswap-position-btn').click();
}, slotIndex);

const positionMenuOpen = (page, slotIndex = 0) => page.evaluate((index) =>
    !document.querySelectorAll('.stream-panel')[index]
        .querySelector('.hotswap-position-menu').hidden, slotIndex);

test('Copy To Position runs from the Position menu and closes it', async () => {
    const page = await bootCanaryGrid();
    const before = await readCanaries(page, ['A', 'B']);
    await armContinuityProbe(page);

    await openPositionMenu(page, 0);
    assert.equal(await positionMenuOpen(page), true);

    await page.evaluate(() => {
        const group = [...document.querySelectorAll('.stream-panel')[0]
            .querySelectorAll('.hotswap-position-group')]
            .find((g) => g.querySelector('.hotswap-position-group-title').textContent === 'Copy To Position');
        [...group.querySelectorAll('.hotswap-position-item:not(.current)')]
            .find((item) => item.textContent.startsWith('Position 3')).click();
    });
    await page.waitForFunction(() =>
        document.querySelectorAll('.stream-panel iframe')[2].getAttribute('data-last-src').endsWith('id=A'));

    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.stream-panel iframe')]
        .slice(0, 3).map((f) => f.getAttribute('data-last-src').split('id=')[1])), ['A', 'B', 'A'],
        'the canonical Copy pathway ran: source untouched, destination copied');
    assert.equal(await positionMenuOpen(page), false, 'a completed Copy closes the menu');

    const probe = await readContinuityProbe(page);
    const after = await readCanaries(page, ['A', 'B']);
    assert.equal(probe.loads.A, 0, 'the source never reloaded');
    assert.equal(probe.loads.B, 0, 'nor the unrelated panel');
    assert.ok(['A', 'B'].every((id) => after[id].startedAt === before[id].startedAt));
    await page.close();
});

test('the Position menu dismisses on Escape and on observable outside interaction', async () => {
    const page = await bootCanaryGrid();
    const before = await readCanaries(page, ['A', 'B', 'C']);
    await armContinuityProbe(page);

    // Opening and closing it is pure presentation.
    await openPositionMenu(page);
    assert.equal(await positionMenuOpen(page), true);
    await page.evaluate(() => document.querySelectorAll('.stream-panel')[0]
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    assert.equal(await positionMenuOpen(page), false, 'Escape closes it');

    await openPositionMenu(page);
    await page.evaluate(() => document.getElementById('master-bar')
        .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    assert.equal(await positionMenuOpen(page), false, 'so does going back to work');

    // It holds the toolbar open while it is up, using the one existing timer.
    await openPositionMenu(page);
    await page.evaluate(() => {
        const panel = document.querySelectorAll('.stream-panel')[0];
        panel.querySelector('.hotswap-toolbar').dispatchEvent(new PointerEvent('pointerleave', {
            bubbles: false, relatedTarget: panel.querySelector('.hotswap-position-menu'),
        }));
    });
    await page.waitForTimeout(500);
    assert.equal(await isRevealed(page), true, 'moving into the menu is not leaving Chrome');

    // And the ordinary autonomous retract still finishes the job.
    await page.evaluate(() => document.querySelectorAll('.stream-panel')[0]
        .dispatchEvent(new PointerEvent('pointerleave', { bubbles: false, relatedTarget: null })));
    await page.waitForFunction(() =>
        !document.querySelectorAll('.stream-panel')[0].classList.contains('chrome-revealed'),
        undefined, { timeout: 3000 });
    assert.equal(await positionMenuOpen(page), false, 'retraction closes the menu with it');

    const probe = await readContinuityProbe(page);
    const after = await readCanaries(page, ['A', 'B', 'C']);
    assert.deepEqual(probe.loads, { A: 0, B: 0, C: 0 }, 'opening/closing the menu reloads nothing');
    assert.ok(probe.sameNodes && probe.sameParents);
    assert.ok(['A', 'B', 'C'].every((id) => after[id].ticks > before[id].ticks));
    await page.close();
});

test('Deep Cuts no longer presents the Position-owned actions', async () => {
    const page = await bootCanaryGrid();
    await revealChrome(page);
    await page.evaluate(() => document.querySelectorAll('.stream-panel')[0]
        .querySelector('.hotswap-trigger').click());

    const tray = await page.evaluate(() =>
        [...document.querySelectorAll('.stream-panel')[0].querySelectorAll('.hotswap-icon-row button')]
            .filter((button) => button.style.display !== 'none')
            .map((button) => button.className));
    assert.ok(!tray.some((name) => name.includes('btn-hotswap-position')),
        'Move to Position is gone from the tray');
    assert.ok(!tray.some((name) => name.includes('btn-hotswap-copy-position')),
        'Copy To Position is gone from the tray');

    assert.ok(tray.length > 0, 'the configured remainder is still in Deep Cuts');

    // And Settings no longer offers them either.
    const settings = await browser.newPage();
    await settings.route(/^https?:\/\/(?!127\.0\.0\.1:4173).*/, (route) => route.fulfill({ status: 204, body: '' }));
    await settings.goto(`${ORIGIN}/settings.html`, { waitUntil: 'networkidle' });
    const listed = await settings.evaluate(() =>
        [...document.querySelectorAll('#top-order-list .hotswap-toggle-row')].map((row) => row.dataset.key));
    assert.ok(!listed.includes('position') && !listed.includes('copyPosition'));
    assert.ok(listed.includes('folder') && !listed.includes('undo'));
    await settings.close();

    // But both remain reachable — through the button that owns them.
    await openPositionMenu(page);
    assert.deepEqual(await page.evaluate(() =>
        [...document.querySelectorAll('.stream-panel')[0]
            .querySelectorAll('.hotswap-position-group-title')].map((t) => t.textContent)),
        ['Swap Position', 'Copy To Position']);
    await page.close();
});

test('Shuffle All stays horizontal in Top and stacks vertically in the same Runway action', async () => {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    await page.route(/^https?:\/\/(?!127\.0\.0\.1:4173).*/, (route) => route.fulfill({ status: 204, body: '' }));
    await page.addInitScript(() => {
        if (window === window.top) {
            localStorage.setItem('hotswap_top_shortcuts_enabled', 'true');
            localStorage.setItem('hotswap_top_shortcut_count', '2');
            localStorage.setItem('hotswap_top_shortcut_order', JSON.stringify(['shuffleAll', 'star']));
            localStorage.setItem('hotswap_quick_actions_enabled', 'true');
            localStorage.setItem('hotswap_quick_action_count', '2');
            localStorage.setItem('hotswap_quick_action_order', JSON.stringify(['shuffleAll', 'star']));
            localStorage.setItem('loop_matrix_urls', JSON.stringify([
                '/test/fixtures/canary.html?id=A', '/test/fixtures/canary.html?id=B',
                '/test/fixtures/canary.html?id=C',
            ]));
        }
    });
    await page.goto(`${ORIGIN}/index3.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelectorAll('.stream-panel iframe').length === 4);
    await revealChrome(page);
    await page.waitForTimeout(300);

    const icon = await page.evaluate(() => {
        const panel = document.querySelectorAll('.stream-panel')[0];
        const button = panel.querySelector('.hotswap-top-shortcut[data-action-key="shuffleAll"]');
        const rail = panel.querySelector('.hotswap-toolbar').getBoundingClientRect();
        const box = button.getBoundingClientRect();
        return {
            text: button.textContent,
            whiteSpace: getComputedStyle(button).whiteSpace,
            // Wrapping would make the content taller than the box.
            wrapped: button.scrollHeight > button.clientHeight + 1,
            wider: box.width >= box.height, // two glyphs side by side, not stacked
            insideRail: box.top >= rail.top - 0.5 && box.bottom <= rail.bottom + 0.5,
            railHeight: Math.round(rail.height),
        };
    });
    assert.equal(icon.text, '🎲🎲');
    assert.equal(icon.whiteSpace, 'nowrap', 'the glyphs cannot break onto a second line');
    assert.equal(icon.wrapped, false, 'no vertical stacking');
    assert.equal(icon.wider, true, 'the button grew sideways rather than wrapping');
    assert.equal(icon.insideRail, true, 'and still fits the rail');
    assert.equal(icon.railHeight, 30, 'the rail was not enlarged to accommodate it');

    const runwayIcon = await page.evaluate(() => {
        const button = document.querySelector('.hotswap-runway-btn[data-action-key="shuffleAll"]');
        const neighbour = document.querySelector('.hotswap-runway-btn[data-action-key="star"]');
        const box = button.getBoundingClientRect();
        const dice = [...button.children].map((die) => die.getBoundingClientRect());
        return { width: Math.round(box.width), height: Math.round(box.height), dice: dice.length,
            diagonalX: Math.round(dice[1].left - dice[0].left),
            visualGap: Math.round(dice[1].top - dice[0].bottom),
            neighbourWidth: Math.round(neighbour.getBoundingClientRect().width),
            neighbourGap: Math.round(neighbour.getBoundingClientRect().top - box.bottom) };
    });
    assert.deepEqual(runwayIcon, { width: 30, height: 30, dice: 2,
        diagonalX: 4, visualGap: -2, neighbourWidth: 30, neighbourGap: 6 });

    // Behavior is untouched: the icon is a mirror, and clicking it dispatches
    // to the ONE canonical Shuffle All button rather than reimplementing it.
    const reachedCanonical = await page.evaluate(() => {
        const panel = document.querySelectorAll('.stream-panel')[0];
        const canonical = panel.querySelector('.btn-hotswap-shuffle-all');
        let hits = 0;
        canonical.addEventListener('click', () => { hits += 1; });
        panel.querySelector('.hotswap-top-shortcut[data-action-key="shuffleAll"]').click();
        panel.querySelector('.hotswap-runway-btn[data-action-key="shuffleAll"]').click();
        return hits;
    });
    assert.equal(reachedCanonical, 2, 'both surface presentations invoke the same canonical action');
    await page.close();
});

// ─────────────────────────────────────────────────────────────────────────────
// The ··· Deep Cuts gateway. A human saw a crossed-out artifact near it that
// never appeared in screenshots; the cause was the DISABLED cursor on its
// neighbours, which the compositor draws and no capture contains.
// ─────────────────────────────────────────────────────────────────────────────

test('no control on the approach to ··· paints a crossed-out cursor', async () => {
    const page = await bootCanaryGrid();
    await revealChrome(page);
    await page.waitForTimeout(250);

    // Undo/Redo are genuinely disabled here — a fresh panel has no history —
    // and they sit directly between the pointer and the ··· gateway.
    const rail = await page.evaluate(() => {
        const panel = document.querySelectorAll('.stream-panel')[0];
        return [...panel.querySelectorAll('.hotswap-toolbar button')]
            .filter((b) => b.getBoundingClientRect().width > 0)
            .map((b) => ({
                key: b.dataset.actionKey || b.dataset.layer || b.className.split(' ').pop(),
                disabled: b.disabled, cursor: getComputedStyle(b).cursor,
            }));
    });
    assert.ok(rail.some((c) => c.key === 'undo' && c.disabled), 'Undo is disabled on a fresh panel');
    assert.ok(rail.every((c) => !['not-allowed', 'no-drop'].includes(c.cursor)),
        `no rail control uses an alarm cursor: ${JSON.stringify(rail)}`);

    // The gateway itself must never look unavailable.
    const trigger = rail.find((c) => c.key === 'hotswap-trigger');
    assert.deepEqual(trigger, { key: 'hotswap-trigger', disabled: false, cursor: 'pointer' });

    // Sweep the actual approach path the pointer travels.
    const cursors = await page.evaluate(() => {
        const panel = document.querySelectorAll('.stream-panel')[0];
        const railBox = panel.querySelector('.hotswap-toolbar').getBoundingClientRect();
        const trig = panel.querySelector('.hotswap-trigger').getBoundingClientRect();
        const seen = new Set();
        for (let dx = -70; dx <= 24; dx += 6) {
            const el = document.elementFromPoint(trig.left + dx + 2, railBox.top + railBox.height / 2);
            if (el) seen.add(getComputedStyle(el).cursor);
        }
        return [...seen];
    });
    assert.ok(!cursors.includes('not-allowed') && !cursors.includes('no-drop'),
        `approach path cursors: ${JSON.stringify(cursors)}`);

    // Dragging across the rail must not start a text selection or native drag —
    // a no-drop cursor is equally invisible to screenshots.
    const selectable = await page.evaluate(() => {
        const panel = document.querySelectorAll('.stream-panel')[0];
        return ['.hotswap-toolbar', '.hotswap-trigger', '.hotswap-position-btn', '.hotswap-mirror-btn']
            .map((sel) => getComputedStyle(panel.querySelector(sel)).userSelect);
    });
    assert.ok(selectable.every((value) => value === 'none'), `user-select: ${JSON.stringify(selectable)}`);
    await page.close();
});

test('··· opens Deep Cuts cleanly, without flicker, and stays panel-local', async () => {
    const page = await bootCanaryGrid();
    const before = await readCanaries(page, ['A', 'B', 'C']);
    await armContinuityProbe(page);

    const state = () => page.evaluate(() => [...document.querySelectorAll('.stream-panel')].slice(0, 3)
        .map((panel) => ({
            revealed: panel.classList.contains('chrome-revealed'),
            tray: panel.querySelector('.hotswap-overlay').classList.contains('open'),
        })));
    const openTray = (index) => page.evaluate((i) => {
        const panel = document.querySelectorAll('.stream-panel')[i];
        panel.querySelector('.hotswap-activation')
            .dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
        panel.querySelector('.hotswap-trigger').click();
    }, index);

    // Panel A, then panel B. Neither may disturb the other, nor panel C.
    await openTray(0);
    assert.deepEqual(await state(), [
        { revealed: true, tray: true }, { revealed: false, tray: false }, { revealed: false, tray: false },
    ]);
    await openTray(1);
    assert.deepEqual(await state(), [
        { revealed: true, tray: true }, { revealed: true, tray: true }, { revealed: false, tray: false },
    ], 'both panels hold their own Deep Cuts state');

    // Closing B leaves A alone.
    await page.evaluate(() => document.querySelectorAll('.stream-panel')[1]
        .querySelector('.hotswap-trigger').click());
    assert.deepEqual((await state())[0], { revealed: true, tray: true }, 'panel A is untouched');

    // Pointer moving from ··· into the tray must hold Chrome open, not flicker.
    const flips = await page.evaluate(async () => {
        const panel = document.querySelectorAll('.stream-panel')[0];
        let count = 0;
        const observer = new MutationObserver(() => { count += 1; });
        observer.observe(panel, { attributes: true, attributeFilter: ['class'] });
        const trigger = panel.querySelector('.hotswap-trigger');
        const overlay = panel.querySelector('.hotswap-overlay');
        for (let i = 0; i < 8; i += 1) {
            trigger.dispatchEvent(new PointerEvent('pointerleave', { bubbles: false, relatedTarget: overlay }));
            overlay.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
        observer.disconnect();
        return count;
    });
    assert.equal(flips, 0, 'moving between ··· and its tray causes no open/close oscillation');
    assert.equal((await state())[0].tray, true, 'and the tray is still open');

    // The gateway is fixed structural UI: responsive pressure never removes it.
    await page.setViewportSize({ width: 330, height: 700 });
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => {
        const button = document.querySelectorAll('.stream-panel')[0].querySelector('.hotswap-trigger');
        return button.getBoundingClientRect().width > 0 && !button.disabled;
    }), true, '··· survives a narrow panel');

    const probe = await readContinuityProbe(page);
    const after = await readCanaries(page, ['A', 'B', 'C']);
    assert.deepEqual(probe.loads, { A: 0, B: 0, C: 0 }, 'opening/closing Deep Cuts reloads nothing');
    assert.ok(probe.sameNodes && probe.sameParents, 'no iframe rebuilt or reparented');
    assert.ok(['A', 'B', 'C'].every((id) => after[id].startedAt === before[id].startedAt));
    await page.close();
});

test('one canonical registry feeds every configurable surface', async () => {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    await page.route(/^https?:\/\/(?!127\.0\.0\.1:4173).*/, (route) => route.fulfill({ status: 204, body: '' }));
    await page.addInitScript(() => {
        if (window === window.top) {
            localStorage.setItem('hotswap_top_shortcuts_enabled', 'true');
            localStorage.setItem('hotswap_top_shortcut_count', '2');
            localStorage.setItem('hotswap_top_shortcut_order', JSON.stringify(['toggle', 'folder']));
            localStorage.setItem('hotswap_quick_actions_enabled', 'true');
            localStorage.setItem('hotswap_quick_action_count', '2');
            localStorage.setItem('hotswap_quick_action_order', JSON.stringify(['folder', 'toggle']));
            localStorage.setItem('loop_matrix_urls', JSON.stringify(['/test/fixtures/canary.html?id=A']));
        }
    });
    await page.goto(`${ORIGIN}/index3.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelectorAll('.stream-panel iframe').length === 4);
    await revealChrome(page);
    await page.waitForTimeout(250);

    // The exact drift this consolidation removes: Edit URL and Assign Folder
    // were absent from both shortcut surfaces purely because they open a picker.
    assert.deepEqual(await page.evaluate(() =>
        [...document.querySelectorAll('.stream-panel')[0].querySelectorAll('.hotswap-top-shortcut')]
            .map((b) => b.dataset.actionKey)), ['toggle', 'folder']);
    assert.deepEqual(await page.evaluate(() =>
        [...document.querySelectorAll('.stream-panel')[0].querySelectorAll('.hotswap-runway-btn')]
            .map((b) => b.dataset.actionKey)), ['folder', 'toggle']);

    // A picker action invoked from another surface stays anchored there.
    await page.evaluate(() => document.querySelectorAll('.stream-panel')[0]
        .querySelector('.hotswap-top-shortcut[data-action-key="toggle"]').click());
    await page.waitForTimeout(150);
    assert.deepEqual(await page.evaluate(() => {
        const panel = document.querySelectorAll('.stream-panel')[0];
        return {
            tray: panel.querySelector('.hotswap-overlay').classList.contains('open'),
            urlRow: panel.querySelector('.hotswap-url-row').classList.contains('open'),
        };
    }), { tray: false, urlRow: true }, 'the picker is visible without opening Deep Cuts');

    // Structural ownership still excludes the Position-owned pair everywhere.
    const eligibility = await page.evaluate(async () => {
        const { getEligibleActions, SURFACES } = await import('./js/hotswap-chrome.js');
        const keys = (surface) => getEligibleActions(surface).map((a) => a.key);
        return { toolbar: keys(SURFACES.TOOLBAR), runway: keys(SURFACES.RUNWAY), deep: keys(SURFACES.DEEP_CUTS) };
    });
    ['toolbar', 'runway', 'deep'].forEach((surface) => {
        assert.ok(!eligibility[surface].includes('position'), `${surface} excludes Move to Position`);
        assert.ok(!eligibility[surface].includes('copyPosition'), `${surface} excludes Copy to Position`);
        assert.ok(eligibility[surface].includes('toggle') && eligibility[surface].includes('folder'));
    });
    assert.ok(!eligibility.toolbar.includes('undo'), 'the rail does not offer its own fixed Undo');
    assert.ok(eligibility.runway.includes('undo'), 'but the runway may — it does not already show it');
    assert.ok(!eligibility.deep.includes('undo'), 'Deep Cuts shares the configurable 10-action vocabulary');
    await page.close();
});

test('Settings presents two surfaces, with Deep Cuts subordinate to the Toolbar', async () => {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route(/^https?:\/\/(?!127\.0\.0\.1:4173).*/, (route) => route.fulfill({ status: 204, body: '' }));
    await page.goto(`${ORIGIN}/settings.html`, { waitUntil: 'networkidle' });

    // Two major surfaces at the top level; Deep Cuts is NOT a third peer.
    const surfaces = await page.evaluate(() =>
        [...document.querySelectorAll('.hotswap-surface > .hotswap-surface-header h3')].map((h) => h.textContent));
    assert.deepEqual(surfaces, ['Top Toolbar', 'Quick Action Shortcut Runway']);

    const toolbarChildren = await page.evaluate(() =>
        [...document.querySelectorAll('.hotswap-surface')][0]
            .querySelectorAll('.hotswap-subsection .hotswap-sub-header h4'));
    assert.equal(toolbarChildren.length ?? await page.evaluate(() =>
        [...document.querySelectorAll('.hotswap-surface')][0]
            .querySelectorAll('.hotswap-subsection .hotswap-sub-header h4').length), 2);
    assert.deepEqual(await page.evaluate(() =>
        [...[...document.querySelectorAll('.hotswap-surface')][0]
            .querySelectorAll('.hotswap-subsection .hotswap-sub-header h4')].map((h) => h.textContent)),
        ['Toolbar Shortcuts', '··· Deep Cuts'], 'both are children of Top Toolbar');

    // Deep Cuts and Toolbar Shortcuts live INSIDE the Top Toolbar surface.
    assert.equal(await page.evaluate(() =>
        document.getElementById('top-order-list').closest('.hotswap-surface')
            === document.querySelectorAll('.hotswap-surface')[0]), true);
    assert.equal(await page.evaluate(() =>
        document.getElementById('runway-order-list').closest('.hotswap-surface')
            === document.querySelectorAll('.hotswap-surface')[1]), true);

    // The structural controls are described as fixed, not offered as options.
    const toolbarCopy = await page.evaluate(() =>
        document.querySelectorAll('.hotswap-surface')[0].querySelector('.subtitle').textContent);
    ['Position', 'Undo', 'Redo', '···'].forEach((name) =>
        assert.ok(toolbarCopy.includes(name), `the fixed ${name} control is described`));
    assert.ok(/cannot be removed or reordered/.test(toolbarCopy));

    // ── Right-edge alignment grammar ─────────────────────────────────────────
    // Every Hotswap ON/OFF switch lands on ONE vertical axis, whatever its
    // nesting depth — achieved by shared layout, not per-section offsets.
    const switches = await page.evaluate(() =>
        [...document.querySelectorAll('.hotswap-panel .switch')]
            .map((el) => ({ right: Math.round(el.getBoundingClientRect().right) })));
    assert.ok(switches.length >= 2, `found ${switches.length} Hotswap switches`);
    const axis = switches[0].right;
    switches.forEach((entry, index) => {
        assert.ok(Math.abs(entry.right - axis) <= 1,
            `switch ${index} right edge ${entry.right} is off the shared axis ${axis}`);
    });
    assert.deepEqual(errors, []);
    await page.close();
});

test('responsive pressure never rewrites the saved Toolbar configuration', async () => {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.route(/^https?:\/\/(?!127\.0\.0\.1:4173).*/, (route) => route.fulfill({ status: 204, body: '' }));
    await page.addInitScript(() => {
        if (window === window.top) {
            localStorage.setItem('hotswap_top_shortcuts_enabled', 'true');
            localStorage.setItem('hotswap_top_count', '6');
            localStorage.setItem('hotswap_action_order', JSON.stringify([
                'toggle', 'folder', 'star', 'reload', 'shuffle', 'shuffleAll',
                'delete', 'kill', 'purge', 'launchpad',
            ]));
            localStorage.setItem('triple_screen_layout', '3col');
            localStorage.setItem('loop_matrix_urls', JSON.stringify([
                '/test/fixtures/canary.html?id=A', '/test/fixtures/canary.html?id=B',
                '/test/fixtures/canary.html?id=C',
            ]));
        }
    });
    await page.goto(`${ORIGIN}/index3.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelectorAll('.stream-panel iframe').length === 4);
    await revealChrome(page);
    await page.waitForTimeout(300);

    const savedOrder = await page.evaluate(() => localStorage.getItem('hotswap_action_order'));
    const configured = await page.evaluate(() =>
        document.querySelectorAll('.stream-panel')[0].querySelectorAll('.hotswap-top-shortcut').length);
    assert.equal(configured, 6, 'all six configured actions are rendered into the rail');

    const visible = () => page.evaluate(() =>
        [...document.querySelectorAll('.stream-panel')[0].querySelectorAll('.hotswap-top-shortcut')]
            .filter((b) => !b.hidden).length);
    const wide = await visible();

    await page.setViewportSize({ width: 330, height: 900 });
    await page.waitForTimeout(400);
    const narrow = await visible();
    assert.ok(narrow < wide, `narrow shows fewer (${narrow} < ${wide})`);

    // Structural controls outrank configurable ones under pressure.
    assert.deepEqual(await page.evaluate(() => {
        const panel = document.querySelectorAll('.stream-panel')[0];
        const rail = panel.querySelector('.hotswap-toolbar').getBoundingClientRect();
        const fits = (sel) => {
            const el = panel.querySelector(sel);
            const box = el.getBoundingClientRect();
            return box.width > 0 && box.right <= rail.right + 1;
        };
        return {
            position: fits('.hotswap-position-btn'),
            undo: fits('.hotswap-toolbar-actions .hotswap-mirror-btn[data-action-key="undo"]'),
            redo: fits('.hotswap-toolbar-actions .hotswap-mirror-btn[data-action-key="redo"]'),
            deepCuts: fits('.hotswap-trigger'),
        };
    }), { position: true, undo: true, redo: true, deepCuts: true });

    // Nothing was written back.
    assert.equal(await page.evaluate(() => localStorage.getItem('hotswap_top_count')), '6');
    assert.equal(await page.evaluate(() => localStorage.getItem('hotswap_action_order')), savedOrder);

    await page.setViewportSize({ width: 1400, height: 900 });
    await page.waitForTimeout(400);
    assert.equal(await visible(), wide, 'widening restores them');
    await page.close();
});

test('Part 1-2 Runway tracks website top and active Runway pickers own stable geometry', async () => {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    await page.route(/^https?:\/\/(?!127\.0\.0\.1:4173).*/, (route) => route.fulfill({ status: 204, body: '' }));
    const longUrl = `/test/fixtures/canary.html?id=${'tail-'.repeat(35)}END`;
    await page.addInitScript((url) => {
        if (window === window.top) {
            localStorage.setItem('loop_matrix_urls', JSON.stringify([url]));
            localStorage.setItem('hotswap_quick_actions_enabled', 'true');
            localStorage.setItem('hotswap_quick_action_count', '2');
            localStorage.setItem('hotswap_quick_action_order', JSON.stringify(['toggle', 'folder']));
        }
    }, longUrl);
    await page.goto(`${ORIGIN}/index3.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelector('.hotswap-runway-btn[data-action-key="toggle"]'));
    const initial = await chromeGeometry(page);
    const continuity = await page.evaluate(() => {
        const iframe = document.querySelector('.stream-panel iframe');
        window.__p12 = { iframe, parent: iframe.parentNode, src: iframe.getAttribute('src'), loads: 0 };
        iframe.addEventListener('load', () => { window.__p12.loads += 1; });
        return { width: iframe.getBoundingClientRect().width };
    });
    assert.equal(initial.runwayTop, Math.round(initial.toolbarHeightVar * 1.75));

    await revealChrome(page);
    await page.waitForTimeout(220);
    const revealed = await chromeGeometry(page);
    assert.equal(revealed.runwayTop, Math.round(revealed.toolbarHeightVar * 2.75));
    assert.equal(revealed.runwayTop - initial.runwayTop, revealed.toolbarHeightVar);
    assert.equal(await page.evaluate(() => document.querySelector('.stream-panel iframe').getBoundingClientRect().width), continuity.width,
        'Runway movement remains overlay-only');
    await retractChrome(page);
    await page.waitForTimeout(1100);
    assert.equal((await chromeGeometry(page)).runwayTop, initial.runwayTop, 'retract restores Runway geometry');

    const panel = page.locator('.stream-panel').first();
    const anchorBefore = await panel.locator('.hotswap-runway-btn[data-action-key="toggle"]').boundingBox();
    await panel.locator('.hotswap-runway-btn[data-action-key="toggle"]').click();
    await page.waitForTimeout(100);
    const edit = await page.evaluate(() => {
        const panel = document.querySelector('.stream-panel');
        const picker = panel.querySelector('.hotswap-url-row');
        const input = picker.querySelector('.hotswap-input');
        const p = picker.getBoundingClientRect();
        const box = panel.getBoundingClientRect();
        const websiteInset = parseFloat(getComputedStyle(panel).getPropertyValue('--hotswap-website-inset')) || 0;
        return { revealed: panel.classList.contains('chrome-revealed'), open: picker.classList.contains('open'),
            focused: document.activeElement === input, start: input.selectionStart, end: input.selectionEnd,
            length: input.value.length, scrollLeft: input.scrollLeft, width: p.width,
            inside: p.left >= box.left && p.right <= box.right + 1,
            websiteTopOffset: Math.round(p.top - box.top - websiteInset),
            rightInset: Math.round(box.right - p.right) };
    });
    assert.deepEqual({ revealed: edit.revealed, open: edit.open, focused: edit.focused },
        { revealed: false, open: true, focused: true });
    assert.equal(edit.start, edit.length); assert.equal(edit.end, edit.length);
    assert.ok(edit.scrollLeft > 0 && edit.width >= 280 && edit.inside);
    assert.deepEqual({ top: edit.websiteTopOffset, right: edit.rightInset }, { top: 8, right: 8 },
        'Runway Edit URL uses the canonical website-top-right utility dock');
    const anchorAfter = await panel.locator('.hotswap-runway-btn[data-action-key="toggle"]').boundingBox();
    assert.equal(Math.round(anchorAfter.y), Math.round(anchorBefore.y), 'invoking its picker does not move the Runway anchor');

    await page.evaluate(() => document.querySelector('.stream-panel').dispatchEvent(
        new PointerEvent('pointerleave', { bubbles: true })));
    await page.waitForTimeout(1200);
    assert.equal(await panel.locator('.hotswap-url-row').evaluate((row) => row.classList.contains('open')), true,
        '850ms autonomous retract yields to the active picker');
    await panel.locator('.hotswap-input').fill(`${longUrl}-typed`);
    await page.waitForTimeout(1000);
    assert.equal(await panel.locator('.hotswap-url-row').evaluate((row) => row.classList.contains('open')), true,
        'typing and pausing do not dismiss');
    await page.keyboard.press('Escape');
    assert.equal(await panel.locator('.hotswap-url-row').evaluate((row) => row.classList.contains('open')), false);

    await page.evaluate(async () => {
        const { setDatabaseStructure } = await import('./js/state.js');
        setDatabaseStructure(Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`Folder ${i + 1}`, [`https://folder-${i}.test`]])));
    });
    await panel.locator('.hotswap-runway-btn[data-action-key="folder"]').click();
    assert.deepEqual(await page.evaluate(() => ({
        revealed: document.querySelector('.stream-panel').classList.contains('chrome-revealed'),
        open: document.querySelector('.hotswap-folder-row').classList.contains('open'),
    })), { revealed: false, open: true });
    const folderGeometry = await page.evaluate(() => {
        const panel = document.querySelector('.stream-panel');
        const picker = panel.querySelector('.hotswap-folder-row').getBoundingClientRect();
        const box = panel.getBoundingClientRect();
        const websiteInset = parseFloat(getComputedStyle(panel).getPropertyValue('--hotswap-website-inset')) || 0;
        return { websiteTopOffset: Math.round(picker.top - box.top - websiteInset), rightInset: Math.round(box.right - picker.right),
            inside: picker.top >= box.top + 5 && picker.bottom <= box.bottom - 5 };
    });
    assert.deepEqual(folderGeometry, { websiteTopOffset: 8, rightInset: 8, inside: true },
        'Runway Assign Folder uses the same website-top-right utility dock');
    await page.evaluate(() => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    assert.equal(await panel.locator('.hotswap-folder-row').evaluate((row) => row.classList.contains('open')), false);
    assert.deepEqual(await page.evaluate(() => ({ same: window.__p12.iframe === document.querySelector('.stream-panel iframe'),
        parent: window.__p12.parent === document.querySelector('.stream-panel iframe').parentNode,
        src: window.__p12.src === document.querySelector('.stream-panel iframe').getAttribute('src'), loads: window.__p12.loads })),
        { same: true, parent: true, src: true, loads: 0 });
    await page.close();
});

test('Part 1-4 picker actions share one website-top-right dock and canonical click-away', async () => {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    await page.route(/^https?:\/\/(?!127\.0\.0\.1:4173).*/, (route) => route.fulfill({ status: 204, body: '' }));
    await page.addInitScript(() => {
        if (window === window.top) {
            localStorage.setItem('loop_matrix_urls', JSON.stringify(['/test/fixtures/canary.html?id=utility']));
            localStorage.setItem('hotswap_quick_actions_enabled', 'true');
            localStorage.setItem('hotswap_quick_action_count', '2');
            localStorage.setItem('hotswap_quick_action_order', JSON.stringify(['toggle', 'folder']));
        }
    });
    await page.goto(`${ORIGIN}/index3.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelector('.hotswap-runway-btn[data-action-key="toggle"]'));
    await page.evaluate(async () => {
        const { setDatabaseStructure } = await import('./js/state.js');
        setDatabaseStructure({ Alpha: ['/test/fixtures/canary.html?id=folder'] });
        const iframe = document.querySelector('.stream-panel iframe');
        window.__p14 = { iframe, parent: iframe.parentNode, src: iframe.getAttribute('src'), loads: 0 };
        iframe.addEventListener('load', () => { window.__p14.loads += 1; });
    });
    const panel = page.locator('.stream-panel').first();
    const geometry = (rowSelector) => page.evaluate((selector) => {
        const panel = document.querySelector('.stream-panel');
        const row = panel.querySelector(selector);
        const p = row.getBoundingClientRect();
        const box = panel.getBoundingClientRect();
        const websiteTop = parseFloat(getComputedStyle(panel).getPropertyValue('--hotswap-website-inset')) || 0;
        return { top: Math.round(p.top - box.top - websiteTop), right: Math.round(box.right - p.right),
            revealed: panel.classList.contains('chrome-revealed') };
    }, rowSelector);
    const dismissOutside = async () => page.evaluate(() => document.body.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true })));

    await revealChrome(page);
    await panel.locator('.hotswap-top-shortcut[data-action-key="toggle"]').click();
    await page.waitForTimeout(50);
    const topEdit = await geometry('.hotswap-url-row');
    await page.keyboard.press('Escape');
    await panel.locator('iframe').hover({ position: { x: 20, y: 80 } });
    await page.waitForFunction(() => !document.querySelector('.stream-panel').classList.contains('chrome-revealed'));
    await panel.locator('.hotswap-runway-btn[data-action-key="toggle"]').click();
    await page.waitForTimeout(50);
    const runwayEdit = await geometry('.hotswap-url-row');
    assert.equal(runwayEdit.revealed, false, 'Runway invocation leaves Top closed');
    await page.keyboard.press('Escape');
    await revealChrome(page);
    await page.evaluate(() => document.querySelector('.stream-panel .btn-hotswap-toggle').click());
    await page.waitForTimeout(50);
    const deepEdit = await geometry('.hotswap-url-row');
    assert.deepEqual([topEdit, runwayEdit, deepEdit].map(({ top, right }) => ({ top, right })),
        [{ top: 8, right: 12 }, { top: 8, right: 12 }, { top: 8, right: 12 }]);
    await dismissOutside();
    assert.equal(await panel.locator('.hotswap-url-row').evaluate((row) => row.classList.contains('open')), false,
        'ordinary GS3 click-away closes Edit URL');

    await panel.locator('iframe').hover({ position: { x: 20, y: 80 } });
    await page.waitForFunction(() => !document.querySelector('.stream-panel').classList.contains('chrome-revealed'));
    await panel.locator('.hotswap-runway-btn[data-action-key="folder"]').click();
    await page.waitForTimeout(50);
    const runwayFolder = await geometry('.hotswap-folder-row');
    await dismissOutside();
    await revealChrome(page);
    await page.evaluate(() => document.querySelector('.stream-panel .btn-hotswap-folder').click());
    await page.waitForTimeout(50);
    const deepFolder = await geometry('.hotswap-folder-row');
    await dismissOutside();
    await panel.locator('.hotswap-top-shortcut[data-action-key="folder"]').click();
    await page.waitForTimeout(50);
    const topFolder = await geometry('.hotswap-folder-row');
    assert.deepEqual([topFolder, runwayFolder, deepFolder].map(({ top, right }) => ({ top, right })),
        [{ top: 8, right: 12 }, { top: 8, right: 12 }, { top: 8, right: 12 }]);

    await page.evaluate(() => document.querySelector('.stream-panel iframe').focus());
    assert.equal(await panel.locator('.hotswap-folder-row').evaluate((row) => row.classList.contains('open')), false,
        'observable iframe focus closes through the picker pathway without an overlay');
    assert.equal(await panel.locator(':scope > .hotswap-click-catcher').count(), 0);
    assert.deepEqual(await page.evaluate(() => ({
        same: window.__p14.iframe === document.querySelector('.stream-panel iframe'),
        parent: window.__p14.parent === document.querySelector('.stream-panel iframe').parentNode,
        src: window.__p14.src === document.querySelector('.stream-panel iframe').getAttribute('src'),
        loads: window.__p14.loads,
    })), { same: true, parent: true, src: true, loads: 0 });
    await page.close();
});

// ─────────────────────────────────────────────────────────────────────────────
// Part 1-6B: utility dismissal consistency.
//
// WAS: the click-away boundary was `inChromeFamily` — the WHOLE Hotswap Chrome
// family — so clicking the Top Toolbar, Position, or Deep Cuts left an open
// utility open, and Assign Folder focused nothing so Escape only worked by
// accident. IS: the boundary is the utility itself plus its invoking control;
// any other GS3 Chrome closes it WITHOUT swallowing that control's own click,
// and Assign Folder owns focus on its own container so Escape is deterministic.
// ─────────────────────────────────────────────────────────────────────────────

test('an open utility is dismissed by ANY other GS3 control, without swallowing that control\'s own click', async () => {
    const page = await bootCanaryGrid();
    // Every Hotswap Chrome test in this file drives these controls via a raw
    // DOM call rather than Playwright's locator .click() (CSS opacity/pointer-
    // events transitions on this Chrome make its own actionability checks
    // unreliable). A plain .click() alone only fires 'click', never
    // 'pointerdown' — so the dismissal handler under test would never see it.
    // This dispatches both, in order, matching a real user gesture.
    const realClick = (selector) => page.evaluate((sel) => {
        const el = document.querySelector(sel);
        el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
        el.click();
    }, selector);

    // Edit URL open -> click Reload (a sibling Top Toolbar control). Before
    // the fix, inChromeFamily treated the whole toolbar as "inside", so this
    // left Edit URL open.
    await revealChrome(page);
    await realClick('.stream-panel .btn-hotswap-toggle');
    await page.waitForFunction(() => document.querySelector('.hotswap-url-row').classList.contains('open'));
    await realClick('.stream-panel .btn-hotswap-reload');
    assert.deepEqual(await page.evaluate(() => ({
        urlOpen: document.querySelector('.hotswap-url-row').classList.contains('open'),
        reloadFired: document.querySelector('.btn-hotswap-reload').classList.contains('spinning'),
    })), { urlOpen: false, reloadFired: true },
        'clicking a sibling Top Toolbar control closes Edit URL AND still performs its own action, in the same gesture');

    // Assign Folder open -> click the rail's own Position button. A
    // structurally different Top Toolbar control, also outside the utility.
    await revealChrome(page);
    await realClick('.stream-panel .btn-hotswap-folder');
    await page.waitForFunction(() => document.querySelector('.hotswap-folder-row').classList.contains('open'));
    await realClick('.stream-panel .hotswap-position-btn');
    assert.deepEqual(await page.evaluate(() => ({
        folderOpen: document.querySelector('.hotswap-folder-row').classList.contains('open'),
        positionMenuOpen: !document.querySelector('.hotswap-position-menu').hidden,
    })), { folderOpen: false, positionMenuOpen: true },
        'clicking the rail Position button closes Assign Folder AND still opens its own menu');
    await page.keyboard.press('Escape'); // close the position menu we just opened

    // Same-control toggle still closes cleanly in one click (not close, then
    // re-open on the same gesture) — the anchor exception exists for this.
    await revealChrome(page);
    await realClick('.stream-panel .btn-hotswap-toggle');
    await page.waitForFunction(() => document.querySelector('.hotswap-url-row').classList.contains('open'));
    await realClick('.stream-panel .btn-hotswap-toggle');
    assert.equal(await page.evaluate(() => document.querySelector('.hotswap-url-row').classList.contains('open')), false,
        'clicking the SAME control that opened it still toggles closed exactly once');

    // No preventDefault anywhere in the dismissal path — regression guard.
    assert.equal(await page.evaluate(() => {
        let prevented = null;
        const probe = (e) => { prevented = e.defaultPrevented; };
        document.addEventListener('pointerdown', probe, { capture: true });
        document.querySelector('.stream-panel .hotswap-position-btn')
            .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
        document.removeEventListener('pointerdown', probe, { capture: true });
        return prevented;
    }), false, 'the dismissal pointerdown handler never calls preventDefault');

    await page.close();
});

test('Assign Folder owns its own focus, so Escape closes it deterministically', async () => {
    const page = await bootCanaryGrid();
    await revealChrome(page);
    await page.evaluate(() => {
        const el = document.querySelector('.stream-panel .btn-hotswap-folder');
        el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
        el.click();
    });
    await page.waitForFunction(() => document.querySelector('.hotswap-folder-row').classList.contains('open'));
    // Focus is taken inside a requestAnimationFrame scheduled by the click
    // handler, one tick after the 'open' class itself lands.
    await page.waitForTimeout(50);

    const beforeEscape = await page.evaluate(() => ({
        panelOwnsFocus: document.querySelector('.stream-panel').contains(document.activeElement),
        focusIsFolderRow: document.activeElement === document.querySelector('.hotswap-folder-row'),
        scrollY: window.scrollY,
        src: document.querySelector('.stream-panel iframe').getAttribute('data-last-src'),
    }));
    assert.equal(beforeEscape.panelOwnsFocus, true, 'focus lands inside the panel on open, matching Edit URL');
    assert.equal(beforeEscape.focusIsFolderRow, true, 'the folder picker container itself owns focus');
    assert.equal(beforeEscape.scrollY, 0, 'taking focus does not scroll the page');

    // The direct regression test: before the fix, activeElement was BODY and
    // Escape never reached the panel's keydown handler.
    await page.keyboard.press('Escape');
    const afterEscape = await page.evaluate(() => ({
        folderOpen: document.querySelector('.hotswap-folder-row').classList.contains('open'),
        src: document.querySelector('.stream-panel iframe').getAttribute('data-last-src'),
    }));
    assert.equal(afterEscape.folderOpen, false, 'Escape closes Assign Folder now that it owns its own focus');
    assert.equal(afterEscape.src, beforeEscape.src, 'taking focus never auto-selects a folder or navigates the panel');

    await page.close();
});

test('Part 1-6C real cross-origin website clicks dismiss both utilities without swallowing the click', async () => {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    await page.addInitScript((crossOrigin) => {
        localStorage.setItem('loop_matrix_urls', JSON.stringify([`${crossOrigin}/test/fixtures/canary.html?id=click-away`]));
        localStorage.setItem('hotswap_quick_actions_enabled', 'true');
        localStorage.setItem('hotswap_quick_action_count', '2');
        localStorage.setItem('hotswap_quick_action_order', JSON.stringify(['toggle', 'folder']));
    }, CROSS_ORIGIN);
    await page.goto(`${ORIGIN}/index3.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelector('.hotswap-runway-btn[data-action-key="folder"]'));
    await page.evaluate(async () => {
        const { setDatabaseStructure } = await import('./js/state.js');
        setDatabaseStructure({ Alpha: ['/test/fixtures/canary.html?id=folder'] });
    });
    const panel = page.locator('.stream-panel').first();
    const frame = page.frames().find((candidate) => candidate !== page.mainFrame());
    assert.ok(frame, 'cross-origin website frame loaded');
    await frame.evaluate(() => {
        window.__websitePointerdowns = 0;
        window.__websiteDefaultPrevented = null;
        document.addEventListener('pointerdown', (event) => {
            window.__websitePointerdowns += 1;
            window.__websiteDefaultPrevented = event.defaultPrevented;
        });
    });
    const openFromRunway = async (actionKey, rowSelector) => {
        await page.evaluate((key) => document.querySelector(`.hotswap-runway-btn[data-action-key="${key}"]`).click(), actionKey);
        await page.waitForFunction((selector) => document.querySelector(selector).classList.contains('open'), rowSelector);
        await page.waitForTimeout(50); // utility focus requestAnimationFrame
    };
    const clickWebsite = async () => {
        const box = await panel.locator('iframe').boundingBox();
        assert.ok(box, 'website iframe has clickable geometry');
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    };

    await openFromRunway('folder', '.hotswap-folder-row');
    await clickWebsite();
    await page.waitForFunction(() => !document.querySelector('.hotswap-folder-row').classList.contains('open'));
    assert.deepEqual(await frame.evaluate(() => ({
        pointerdowns: window.__websitePointerdowns,
        defaultPrevented: window.__websiteDefaultPrevented,
    })), { pointerdowns: 1, defaultPrevented: false },
        'Assign Folder closes while the same cross-origin website click proceeds normally');

    await openFromRunway('toggle', '.hotswap-url-row');
    assert.equal(await panel.evaluate((el) => el.classList.contains('chrome-revealed')), false,
        'Runway invocation does not reveal Top Toolbar');
    await clickWebsite();
    await page.waitForFunction(() => !document.querySelector('.hotswap-url-row').classList.contains('open'));
    assert.deepEqual(await frame.evaluate(() => ({
        pointerdowns: window.__websitePointerdowns,
        defaultPrevented: window.__websiteDefaultPrevented,
    })), { pointerdowns: 2, defaultPrevented: false },
        'Edit URL closes while the same cross-origin website click proceeds normally');

    await page.close();
});

test('Part 1-2 Settings major cards collapse persistently and administrative UI moved once', async () => {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64');
    await page.addInitScript(() => {
        localStorage.setItem('git_sync_token', 'test-token');
        localStorage.setItem('git_sync_repo', 'owner/repo');
    });
    await page.route('https://api.github.com/**', async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (route.request().method() === 'PUT') return route.fulfill({ json: { content: { sha: 'new-sha' } } });
        if (path.endsWith('/contents/links-index.json')) return route.fulfill({ status: 404, body: '{}' });
        if (path.endsWith('/contents/links.json')) return route.fulfill({ json: { sha: 'sha', content: encode({ Alpha: ['https://a.test'] }) } });
        return route.fulfill({ status: 404, body: '{}' });
    });
    await page.goto(`${ORIGIN}/settings.html`, { waitUntil: 'networkidle' });
    const expected = ['github', 'ingest', 'hotswap', 'grid-layouts', 'folders', 'frame-heights', 'ghost', 'diagnostics', 'blacklist'];
    assert.deepEqual(await page.locator('#settings-screen > .config-card').evaluateAll((cards) => cards.map((c) => c.dataset.section)), expected);
    assert.equal(await page.locator('.config-card .section-toggle').count(), 9);
    assert.equal(await page.locator('.hotswap-surface .section-toggle, .hotswap-subsection .section-toggle').count(), 0);
    assert.ok((await page.locator('#ingest-folder-select option').allTextContents()).some((text) => text.includes('Alpha')));
    assert.equal(await page.locator('#file-dropzone').count(), 1);
    assert.equal(await page.locator('#blacklist-display').count(), 1);
    page.on('dialog', (dialog) => dialog.accept());
    await page.locator('#target-folder-input').fill('Imported');
    await page.locator('#manual-file-pick').setInputFiles({ name: 'links.txt', mimeType: 'text/plain', buffer: Buffer.from('https://imported.test/path') });
    await page.waitForFunction(async () => {
        const { getDatabaseStructure } = await import('./js/state.js');
        return getDatabaseStructure()?.Imported?.includes('https://imported.test/path');
    });
    await page.locator('#git-repo').fill('kept/value');
    await page.locator('[data-section="github"] .section-toggle').click();
    await page.locator('[data-section="hotswap"] .section-toggle').click();
    assert.equal(await page.locator('[data-section="github"] .section-toggle').getAttribute('aria-expanded'), 'false');
    assert.equal(await page.locator('[data-section="hotswap"] .section-body').isVisible(), false);
    await page.locator('[data-section="github"] .section-toggle').press('Enter');
    assert.equal(await page.locator('#git-repo').inputValue(), 'kept/value', 'form values survive collapse/expand');
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(await page.locator('[data-section="hotswap"] .section-toggle').getAttribute('aria-expanded'), 'false');
    assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem('settings_section_state'))), { hotswap: true });
    await page.locator('[data-section="hotswap"] .section-toggle').click();
    const rights = await page.locator('.hotswap-panel .switch').evaluateAll((switches) => switches.map((el) => el.getBoundingClientRect().right));
    rights.forEach((right) => assert.ok(Math.abs(right - rights[0]) <= 1));
    await page.locator('#blacklist-manual-input').fill('blocked.test');
    await page.locator('#btn-bl-add').click();
    assert.match(await page.locator('#blacklist-display').textContent(), /blocked\.test/);
    await page.locator('.bl-remove-btn').click();
    assert.doesNotMatch(await page.locator('#blacklist-display').textContent(), /blocked\.test/);
    await page.locator('#blacklist-manual-input').fill('clear-me.test');
    await page.locator('#btn-bl-add').click();
    await page.locator('#btn-bl-clear').click();
    assert.match(await page.locator('#blacklist-display').textContent(), /No domains blacklisted/);
    assert.equal(await page.request.get(`${ORIGIN}/index.html`).then((r) => r.text()).then((html) => html.includes('id="file-dropzone"') || html.includes('id="blacklist-display"')), false);
    await page.close();
});

test('RM-1 Settings Copy Diagnostics exposes a stale preset SHA boundary without mutation requests', async () => {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    const diagnosticMethods = [];
    await page.addInitScript(() => {
        localStorage.setItem('git_sync_token', `github_pat_${'x'.repeat(24)}`);
        localStorage.setItem('git_sync_repo', 'owner/repo');
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText: async (value) => { window.__diagnosticsCopied = value; } },
        });
    });
    await page.route('https://api.github.com/**', async (route) => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        if (path.endsWith('/contents/presets.json')) {
            diagnosticMethods.push(request.method());
            return route.fulfill({ json: { sha: 'b'.repeat(40) } });
        }
        if (path.endsWith('/contents/links-index.json') || path.endsWith('/contents/links.json')) {
            return route.fulfill({ status: 404, body: '{}' });
        }
        return route.fulfill({ status: 404, body: '{}' });
    });
    await page.goto(`${ORIGIN}/settings.html`, { waitUntil: 'networkidle' });
    await page.evaluate(async () => {
        const { setPresetsSha } = await import('./js/state.js');
        setPresetsSha('a'.repeat(40));
    });
    await page.locator('#btn-copy-diagnostics').click();
    await page.waitForFunction(() => document.getElementById('diagnostics-status').textContent === 'Diagnostics copied');
    const markdown = await page.evaluate(() => window.__diagnosticsCopied);
    assert.match(markdown, /RM-1 · snapshot schema 1/);
    assert.match(markdown, /WARN Preset Sync: in-memory presets SHA differs from observed remote SHA/);
    assert.match(markdown, /presets SHA in memory\s+aaaaaaaa/);
    assert.match(markdown, /remote presets SHA\s+bbbbbbbb/);
    assert.doesNotMatch(markdown, /github_pat_/);
    assert.deepEqual(diagnosticMethods, ['GET']);
    await page.close();
});

test('RM-1 Grid Copy Diagnostics observes the live Runtime without navigation or mutation', async () => {
    const page = await bootCanaryGrid();
    try {
        const diagnosticMethods = [];
        await page.evaluate(async () => {
            const { Store } = await import('./js/storage.js');
            const { setPresetsSha } = await import('./js/state.js');
            Store.set('gitToken', `github_pat_${'x'.repeat(24)}`);
            Store.set('gitRepo', 'owner/repo');
            setPresetsSha('a'.repeat(40));
            Object.defineProperty(navigator, 'clipboard', {
                configurable: true,
                value: { writeText: async (value) => { window.__diagnosticsCopied = value; } },
            });
        });
        await page.route('https://api.github.com/**', async (route) => {
            diagnosticMethods.push(route.request().method());
            await route.fulfill({ json: { sha: 'b'.repeat(40) } });
        });
        const before = await page.evaluate(async () => {
            const session = await import('./js/grid-session.js');
            const { getPresetsSha } = await import('./js/state.js');
            return {
                href: window.location.href,
                layout: session.getSessionLayout(),
                arrangement: session.getSessionArrangement(),
                panels: session.getSessionPanels(),
                history: session.getGridHistory(),
                presetsSha: getPresetsSha(),
                layer: document.querySelector('#master-layer-selector .hotswap-layer-btn.active')?.textContent || null,
                storage: Object.fromEntries(Array.from({ length: localStorage.length }, (_, index) => {
                    const key = localStorage.key(index);
                    return [key, localStorage.getItem(key)];
                })),
            };
        });
        await armContinuityProbe(page);

        await page.locator('#btn-toggle-master').click();
        await page.waitForTimeout(200);
        await page.locator('#btn-master-overflow').click();
        await page.locator('#btn-master-copy-diagnostics').click();
        await page.waitForFunction(() => document.getElementById('master-status').textContent === 'Diagnostics copied');

        const markdown = await page.evaluate(() => window.__diagnosticsCopied);
        const after = await page.evaluate(async () => {
            const session = await import('./js/grid-session.js');
            const { getPresetsSha } = await import('./js/state.js');
            return {
                href: window.location.href,
                layout: session.getSessionLayout(),
                arrangement: session.getSessionArrangement(),
                panels: session.getSessionPanels(),
                history: session.getGridHistory(),
                presetsSha: getPresetsSha(),
                layer: document.querySelector('#master-layer-selector .hotswap-layer-btn.active')?.textContent || null,
                storage: Object.fromEntries(Array.from({ length: localStorage.length }, (_, index) => {
                    const key = localStorage.key(index);
                    return [key, localStorage.getItem(key)];
                })),
            };
        });

        assert.deepEqual(after, before, 'Copy Diagnostics does not mutate Runtime Session, Layer, or persistence');
        assert.equal(after.href.includes('settings.html'), false, 'Copy Diagnostics does not navigate to Settings');
        assert.match(markdown, /executor Grid/);
        assert.match(markdown, /outer Grid layout lefttall/);
        assert.match(markdown, /P1  panel slot-1/);
        assert.match(markdown, /presets SHA in memory\s+aaaaaaaa/);
        assert.match(markdown, /remote presets SHA\s+bbbbbbbb/);
        assert.doesNotMatch(markdown, /github_pat_|\/test\/fixtures\/canary/);
        assert.deepEqual(diagnosticMethods, ['GET']);
        assert.deepEqual(await readContinuityProbe(page), {
            loads: { A: 0, B: 0, C: 0 }, sameNodes: true, sameParents: true,
        }, 'Copy Diagnostics does not reload or recreate live iframes');
    } finally { await page.close(); }
});

test('Part 1-3 right-side toolbar cluster and Settings trailing grammar stay structural', async () => {
    const runtime = await bootCanaryGrid();
    await revealChrome(runtime);
    await runtime.waitForTimeout(220);
    const toolbar = await runtime.evaluate(() => {
        const panel = document.querySelector('.stream-panel');
        const rail = panel.querySelector('.hotswap-toolbar').getBoundingClientRect();
        const position = panel.querySelector('.hotswap-position-btn').getBoundingClientRect();
        const firstAction = panel.querySelector('.hotswap-top-shortcut:not([hidden])').getBoundingClientRect();
        const undo = panel.querySelector('.hotswap-toolbar-actions [data-action-key="undo"]').getBoundingClientRect();
        const redo = panel.querySelector('.hotswap-toolbar-actions [data-action-key="redo"]').getBoundingClientRect();
        const deep = panel.querySelector('.hotswap-trigger').getBoundingClientRect();
        return { positionLeft: Math.round(position.left - rail.left), positionRight: position.right,
            actionLeft: firstAction.left, deepRightInset: Math.round(rail.right - deep.right),
            structuralOrder: undo.left < redo.left && redo.left < deep.left };
    });
    assert.ok(toolbar.positionLeft <= 12, 'Position remains isolated at the left edge');
    assert.ok(toolbar.actionLeft - toolbar.positionRight > 40, 'configurable actions join the right-side cluster');
    assert.ok(toolbar.deepRightInset <= 12 && toolbar.structuralOrder, 'Undo/Redo/··· remain fixed at the right');
    await runtime.close();

    const settings = await browser.newPage();
    await settings.goto(`${ORIGIN}/settings.html`, { waitUntil: 'load' });
    const switchGrammar = await settings.evaluate(() => {
        const switches = [...document.querySelectorAll('.hotswap-panel .switch')];
        return switches.map((control) => ({ right: control.getBoundingClientRect().right,
            parentRight: control.parentElement.getBoundingClientRect().right,
            clipped: control.getBoundingClientRect().right > control.parentElement.getBoundingClientRect().right }));
    });
    assert.ok(switchGrammar.length > 2);
    switchGrammar.forEach((entry) => {
        assert.ok(Math.abs(entry.right - switchGrammar[0].right) <= 1, 'all switches retain one global axis');
        assert.ok(entry.parentRight - entry.right >= 11 && entry.parentRight - entry.right <= 13, 'shared 12px trailing inset');
        assert.equal(entry.clipped, false);
    });
    const heading = await settings.evaluate(() => {
        const button = document.querySelector('[data-section="hotswap"] .section-toggle');
        const title = button.querySelector('.section-title').getBoundingClientRect();
        const caret = button.querySelector('.section-caret').getBoundingClientRect();
        const box = button.getBoundingClientRect();
        return { titleInset: Math.round(title.left - box.left), caretInset: Math.round(box.right - caret.right),
            width: box.width, expanded: button.getAttribute('aria-expanded') };
    });
    assert.ok(heading.titleInset <= 1 && heading.caretInset <= 1 && heading.width > 400);
    const toggle = settings.locator('[data-section="hotswap"] .section-toggle');
    await toggle.click({ position: { x: 200, y: 10 } });
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false', 'the whole heading row remains clickable');
    await toggle.press('Enter');
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true', 'keyboard activation remains intact');
    assert.equal(await settings.locator('.hotswap-surface .section-toggle, .hotswap-subsection .section-toggle').count(), 0);
    await settings.close();
});

// Layer identity fixtures isolate the outer Grid. The nested executor response is
// deterministic; declaration does not require the deferred confirmation handshake.
async function bootLayerGrid(panels, layout = 'lefttall') {
    const page = await browser.newPage();
    page.setDefaultTimeout(8000);
    await page.route(/^https?:\/\/(?!127\.0\.0\.1:4173).*/, (route) =>
        route.fulfill({ contentType: 'text/html', body: '<p>Ordinary third-party content</p>' }));
    await page.route('**/index3.html*', (route) => route.request().frame().parentFrame()
        ? route.fulfill({ contentType: 'text/html', body: '<p>Nested executor fixture</p>' })
        : route.continue());
    await page.addInitScript(({ panels, layout }) => {
        if (window !== window.top) return;
        localStorage.setItem('loop_matrix_urls', JSON.stringify(panels));
        localStorage.setItem('triple_screen_layout', layout);
    }, { panels, layout });
    await page.goto(`${ORIGIN}/index3.html?workspace=live`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelectorAll('.stream-panel').length === 4);
    return page;
}

async function readLayerTruth(page) {
    return page.evaluate(async () => {
        const session = await import('./js/grid-session.js');
        return {
            panels: session.getSessionPanels(),
            masterHidden: document.getElementById('master-layer-selector').hidden,
            masterDisplay: getComputedStyle(document.getElementById('master-layer-selector')).display,
            hidden: [...document.querySelectorAll('.stream-panel .hotswap-layer-selector')].map((el) => el.hidden),
        };
    });
}

test('Layer identity: ordinary third-party and same-origin content never exposes selectors', async () => {
    for (const urls of [
        ['https://third.test/gallery/', 'https://another.test/index3.html', 'https://third.test/videos/'],
        ['settings.html', '/test/fixtures/canary.html', 'some/dir/'],
    ]) {
        const page = await bootLayerGrid(urls);
        try {
            const truth = await readLayerTruth(page);
            assert.equal(truth.masterHidden, true);
            assert.equal(truth.masterDisplay, 'none');
            assert.ok(truth.hidden.every(Boolean));
        } finally { await page.close(); }
    }
});

test('Layer identity: typed Workspace survives boot, Copy, Save As, relaunch and removal', async () => {
    const workspace = { type: 'workspace', source: 2, options: { layer: 2, label: 'keep me' } };
    const page = await bootLayerGrid([workspace, 'https://third.test/B', 'https://third.test/C']);
    try {
        let truth = await readLayerTruth(page);
        assert.deepEqual(truth.panels[0], workspace);
        assert.equal(truth.masterHidden, false);
        assert.deepEqual(truth.hidden.slice(0, 3), [false, true, true]);
        assert.match(await page.locator('.stream-panel iframe').first().getAttribute('src'), /index3.html\?workspace=2$/);
        await page.evaluate(() => {
            const panel = document.querySelector('.stream-panel');
            panel.querySelector('.btn-hotswap-copy-position').click();
        });
        await page.evaluate(() => {
            const buttons = [...document.querySelector('.stream-panel').querySelectorAll('.hotswap-copy-row .hotswap-position-item')];
            const option = buttons.find((button) => button.textContent.trim() === 'Copy to Position 2');
            if (!option) throw new Error('Copy Position 2 missing');
            option.click();
        });
        truth = await readLayerTruth(page);
        assert.deepEqual(truth.panels[1], workspace);
        let remotePresets;
        await page.route('https://api.github.com/**', async (route) => {
            if (!route.request().url().includes('/contents/presets.json')) {
                await route.fulfill({ status: 404, body: '{}' });
            } else if (route.request().method() === 'PUT') {
                remotePresets = JSON.parse(Buffer.from(route.request().postDataJSON().content, 'base64').toString('utf8'));
                await route.fulfill({ json: { content: { sha: 'saved-layer-panels' } } });
            } else {
                await route.fulfill({ json: { sha: 'saved-layer-panels', content: Buffer.from(JSON.stringify(remotePresets)).toString('base64') } });
            }
        });
        await page.evaluate(async () => {
            const { Store } = await import('./js/storage.js');
            Store.set('gitToken', 'test-token');
            Store.set('gitRepo', 'owner/repo');
        });
        // Stage C: Save Session As is now a Layer-scoped routed action, and
        // slot 0's nested Runtime is the selector's default target the moment
        // it exists (same "L2 is the active default" rule Shuffle/Undo already
        // had). This test is about the OUTER session's own Save, so target L1
        // explicitly first — exactly what a human would click to save the
        // Runtime they are looking at rather than the nested one.
        await page.evaluate(() => document
            .querySelector('#master-layer-selector .hotswap-layer-btn[data-layer="L1"]').click());
        await page.evaluate(() => document.getElementById('btn-master-save').click());
        await Promise.all([
            page.waitForResponse((response) => response.request().method() === 'PUT' && response.url().includes('/contents/presets.json')),
            page.evaluate(() => [...document.querySelectorAll('.save-session-item')]
                .find((item) => item.textContent.includes('Preset 6')).click()),
        ]);
        const saved = await page.evaluate(async () => {
            const { getPresetsStructure } = await import('./js/state.js');
            return getPresetsStructure();
        });
        assert.deepEqual(saved.find((preset) => preset.id === 6).panels.slice(0, 2), [workspace, workspace]);
        assert.deepEqual(remotePresets.find((preset) => preset.id === 6).panels.slice(0, 2), [workspace, workspace]);
        await page.goto(`${ORIGIN}/index3.html?workspace=6`, { waitUntil: 'load' });
        await page.waitForFunction(() => document.querySelectorAll('.stream-panel').length === 4);
        assert.deepEqual((await readLayerTruth(page)).panels.slice(0, 2), [workspace, workspace]);
        await page.evaluate(() => document.querySelectorAll('.stream-panel')[0].querySelector('.btn-hotswap-kill').click());
        await page.waitForFunction(() => document.querySelectorAll('.stream-panel').length === 3);
        assert.equal((await readLayerTruth(page)).panels[0].type, 'url');
        assert.equal((await readLayerTruth(page)).panels[0].source, '');
    } finally { await page.close(); }
});

test('Layer identity: hidden slots never expose the Master selector', async () => {
    for (const nestedSlot of [2, 3]) {
        const panels = Array(4).fill('https://third.test/ordinary');
        panels[nestedSlot] = { type: 'workspace', source: 2, options: { layer: 2 } };
        const page = await bootLayerGrid(panels, 'vsplit');
        try {
            const truth = await readLayerTruth(page);
            assert.equal(truth.masterHidden, true);
            assert.equal(truth.masterDisplay, 'none');
            assert.deepEqual(truth.panels[nestedSlot], panels[nestedSlot]);
        } finally { await page.close(); }
    }
});

test('Layer identity: selectors agree across assignment, Position swap, replacement, Undo and Redo', async () => {
    const page = await bootLayerGrid(Array(3).fill('https://third.test/ordinary'));
    try {
        const assertTruth = async (nested) => {
            const truth = await readLayerTruth(page);
            assert.equal(truth.masterHidden, !nested);
            assert.equal(truth.hidden[0], !nested);
            assert.ok(truth.hidden.slice(1).every(Boolean));
        };
        await assertTruth(false);
        await assignPanelUrl(page, 0, 'index3.html?workspace=2');
        await assertTruth(true);
        const dispatched = await page.evaluate(() => {
            const targets = [];
            const frames = [...document.querySelectorAll('.stream-panel iframe')];
            frames[0].contentWindow.postMessage = (message) => targets.push({ index: 0, action: message.action });
            // DOM evidence deliberately contradicts both Panels. Session identity wins.
            frames[0].setAttribute('data-last-src', 'https://third.test/ordinary');
            frames[1].setAttribute('data-last-src', 'index3.html');
            document.getElementById('btn-master-shuffle').click();
            return targets;
        });
        assert.deepEqual(dispatched, [{ index: 0, action: 'shuffle' }]);
        await assertTruth(true);
        const before = (await readLayerTruth(page)).panels;
        await page.evaluate(() => {
            document.querySelector('.stream-panel .btn-hotswap-position').click();
            const option = [...document.querySelector('.stream-panel').querySelectorAll('.hotswap-position-row .hotswap-position-item')]
                .find((button) => button.textContent.trim() === 'Position 2');
            if (!option) throw new Error('Move Position 2 missing');
            option.click();
        });
        assert.deepEqual((await readLayerTruth(page)).panels, before);
        await assertTruth(true);
        await assignPanelUrl(page, 0, 'https://third.test/replaced');
        await assertTruth(false);
        await page.evaluate(() => document.getElementById('btn-master-undo').click());
        await assertTruth(true);
        await page.evaluate(() => {
            const panel = document.querySelector('.stream-panel');
            panel.querySelector('.hotswap-layer-btn[data-layer="L1"]').click();
            panel.querySelector('.btn-hotswap-redo').click();
        });
        await assertTruth(false);
    } finally { await page.close(); }
});

async function launchNestedGridWorkspace(page, workspace) {
    const frame = await frameForSlot(page, 0);
    await frame.locator('.workspace-tab').filter({ hasText: `Preset ${workspace}` }).click();
    await frame.locator('#btn-launch-grid').click();
    const expected = `index3.html?workspace=${workspace}`;
    await page.waitForFunction(async (source) => {
        const { getSessionPanels } = await import('./js/grid-session.js');
        return getSessionPanels()[0]?.source === source;
    }, expected);
    return expected;
}

test('nested Design-Time Grid launch hands intent to the parent Session', async () => {
    const page = await bootLayerGrid([
        'index.html',
        '/test/fixtures/canary.html?id=B',
        '/test/fixtures/canary.html?id=C',
    ]);
    try {
        const initial = await readLayerTruth(page);
        assert.equal(initial.panels[0].source, 'index.html');
        assert.equal(initial.masterHidden, true);

        // Actual hosted children may request only a supported semantic launch.
        const child = await frameForSlot(page, 0);
        await child.evaluate(() => {
            window.parent.postMessage({ source: 'gs3-runtime-launch', action: 'launchRuntime', kind: 'solo', workspace: '2' }, location.origin);
            window.parent.postMessage({ source: 'gs3-runtime-launch', action: 'launchRuntime', kind: 'grid', workspace: '../bad' }, location.origin);
        });
        const unrelatedChild = await frameForSlot(page, 1);
        await unrelatedChild.evaluate(() => window.parent.postMessage({
            source: 'gs3-runtime-launch', action: 'launchRuntime', kind: 'grid', workspace: '2',
        }, location.origin));
        await page.waitForTimeout(50);
        assert.equal((await readLayerTruth(page)).panels[0].source, 'index.html');
        await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', {
            origin: 'https://untrusted.test',
            source: window,
            data: { source: 'gs3-runtime-launch', action: 'launchRuntime', kind: 'grid', workspace: '2' },
        })));
        assert.equal((await readLayerTruth(page)).panels[0].source, 'index.html');

        const siblingsBefore = await readCanaries(page, ['B', 'C']);
        await armContinuityProbe(page);
        const first = await launchNestedGridWorkspace(page, 2);
        let truth = await readLayerTruth(page);
        assert.equal(truth.panels[0].source, first);
        assert.deepEqual(truth.panels[0].options.runtime, { layer: 2, kind: 'grid' });
        assert.equal(truth.masterHidden, false);
        assert.equal(truth.hidden[0], false);
        assert.equal(await page.locator('.stream-panel').first().locator('.hotswap-input').inputValue(), first);
        const siblingsAfter = await readCanaries(page, ['B', 'C']);
        const probe = await readContinuityProbe(page);
        assert.equal(probe.loads.B, 0);
        assert.equal(probe.loads.C, 0);
        assert.ok(['B', 'C'].every((id) => siblingsAfter[id].startedAt === siblingsBefore[id].startedAt));

        // A second selected Workspace proves the handoff carries child identity,
        // not a generic/default Workspace or a Position-derived identifier.
        await assignPanelUrl(page, 0, 'index.html');
        const second = await launchNestedGridWorkspace(page, 7);
        truth = await readLayerTruth(page);
        assert.equal(truth.panels[0].source, second);
        assert.deepEqual(truth.panels[0].options.runtime, { layer: 2, kind: 'grid' });

        const beforeMove = structuredClone(truth.panels[0]);
        await page.evaluate(() => {
            const panel = document.querySelector('.stream-panel');
            panel.querySelector('.btn-hotswap-position').click();
            const option = [...panel.querySelectorAll('.hotswap-position-row .hotswap-position-item')]
                .find((item) => item.textContent.trim() === 'Position 2');
            if (!option) throw new Error('Position 2 missing');
            option.click();
        });
        assert.deepEqual((await readLayerTruth(page)).panels[0], beforeMove);
    } finally { await page.close(); }
});

// B.2 test matrix — the nested launch handoff is independent of the Master
// [L2][L1] command-target selector, and Live Builder is a valid launch source
// alongside saved Workspaces. That selector governs Layer-scoped Runtime
// COMMANDS (Shuffle, Undo, Redo, Reload…) — never "which Panel may replace
// itself with a Runtime," which is a host-level, sender-identified request.
test('nested Design-Time Grid launch does not depend on the Master [L2][L1] selector, and Live Builder is a valid source', async () => {
    const page = await bootLayerGrid(['index.html', 'index.html', 'https://third.test/ordinary']);
    try {
        // Before any launch, nothing has declared Layer 2 yet — nested
        // Design-Time alone is never advertised as an active L2 target — so
        // the selector does not even exist for the user to choose from.
        assert.equal((await readLayerTruth(page)).masterHidden, true);

        // C — Live Builder (no workspace tab selected; the nested page's own
        // default) launches to the repo's canonical live identity.
        const child0 = await frameForSlot(page, 0);
        await child0.locator('#btn-launch-grid').click();
        await page.waitForFunction(async () => {
            const { getSessionPanels } = await import('./js/grid-session.js');
            return getSessionPanels()[0]?.source === 'index3.html?workspace=live';
        });
        let truth = await readLayerTruth(page);
        assert.equal(truth.panels[0].source, 'index3.html?workspace=live');
        assert.deepEqual(truth.panels[0].options.runtime, { layer: 2, kind: 'grid' });

        // F — activation boundary, now provable from the other side too: a
        // genuine Layer-2 Runtime exists, so the selector is now available.
        assert.equal(truth.masterHidden, false);

        // D/E — explicitly aim the Master selector at L1, the scope that has
        // no jurisdiction over this Panel's content at all, then launch a
        // SECOND, independent nested Design-Time Panel from a saved Workspace.
        await page.evaluate(() => document
            .querySelector('#master-layer-selector .hotswap-layer-btn[data-layer="L1"]').click());
        assert.equal(await page.evaluate(() => document
            .querySelector('#master-layer-selector .hotswap-layer-btn[data-layer="L1"]').classList.contains('active')), true);

        const child1 = await frameForSlot(page, 1);
        await child1.locator('.workspace-tab').filter({ hasText: 'Preset 3' }).click();
        await child1.locator('#btn-launch-grid').click();
        await page.waitForFunction(async () => {
            const { getSessionPanels } = await import('./js/grid-session.js');
            return getSessionPanels()[1]?.source === 'index3.html?workspace=3';
        });
        truth = await readLayerTruth(page);
        assert.equal(truth.panels[1].source, 'index3.html?workspace=3', 'launch succeeded while the selector read L1');
        assert.deepEqual(truth.panels[1].options.runtime, { layer: 2, kind: 'grid' });

        // The selector itself was never consulted or rewritten by the launch —
        // it is exactly as the user left it.
        assert.equal(await page.evaluate(() => document
            .querySelector('#master-layer-selector .hotswap-layer-btn[data-layer="L1"]').classList.contains('active')), true);

        // H — the ordinary third panel was never touched by either launch.
        assert.equal(truth.panels[2].source, 'https://third.test/ordinary');
    } finally { await page.close(); }
});

test('Stage B Master Redo reuses canonical history, including panel-scoped undo', async () => {
    const page = await bootLayerGrid(['https://third.test/A', 'https://third.test/B', 'https://third.test/C']);
    try {
        await assignPanelUrl(page, 0, 'https://third.test/first');
        await assignPanelUrl(page, 1, 'https://third.test/second');
        const before = await readLayerTruth(page);
        await clickPanelHistory(page, 1, 'undo');
        assert.equal((await readLayerTruth(page)).panels[1].source, 'https://third.test/B');
        await page.locator('#btn-toggle-master').click();
        await page.waitForTimeout(300);
        await page.locator('#btn-master-redo').click();
        await page.waitForTimeout(30);
        const restored = await readLayerTruth(page);
        assert.equal(restored.panels[1].source, 'https://third.test/second');
        const redoState = await page.evaluate(async () => {
            const session = await import('./js/grid-session.js');
            return { canRedo: session.canRedoGridSession(), history: session.getGridHistory() };
        });
        assert.equal(redoState.canRedo, false);
        assert.equal(restored.panels[0].source, before.panels[0].source);
    } finally { await page.close(); }
});

// BREADCRUMBS — this test's overflow-menu-open step is also the regression
// lock for a real click-target bug B.1 found and fixed: when the active
// layout is off the visible shortcuts, the gateway's icon becomes a nested
// <span> (the active layout's own mini-floorplan), so a genuine mouse click
// lands on that child, not the button. The outside-click dismissal used to
// compare `event.target !== gatewayBtn` by strict reference, which treated
// that click as "outside" and closed the menu on the same event it opened.
// Fixed to `!gatewayBtn.contains(event.target)` in triple-mode.js.
test('Stage B Grid layout shortcuts stay ordered, configurable, and complete', async () => {
    const page = await bootLayerGrid(['https://third.test/A', 'https://third.test/B', 'https://third.test/C']);
    try {
        await page.evaluate(async () => {
            const { setGridLayoutShortcutCount, setGridLayoutShortcutOrder } = await import('./js/hotswap-chrome.js');
            setGridLayoutShortcutCount(2);
            setGridLayoutShortcutOrder(['lefttall', '3col', '4grid', 'vsplit', 'unknown']);
        });
        await page.reload({ waitUntil: 'load' });
        await page.waitForFunction(() => document.querySelectorAll('#master-layout-shortcuts .layout-shortcut').length === 2);
        await page.locator('#btn-toggle-master').click();
        await page.waitForTimeout(300);
        assert.deepEqual(await page.locator('#master-layout-shortcuts .layout-shortcut').evaluateAll((buttons) => buttons.map((button) => button.dataset.layout)), ['lefttall', '3col']);
        await page.evaluate(() => document.getElementById('btn-layout-righttall').click());
        await page.waitForFunction(() => document.querySelector('#triple-layout').className.includes('layout-righttall'));
        assert.deepEqual(await page.locator('#master-layout-shortcuts .layout-shortcut').evaluateAll((buttons) => buttons.map((button) => button.dataset.layout)), ['lefttall', '3col']);
        await page.locator('#btn-master-layout-overflow').click();
        assert.equal(await page.locator('#master-layout-menu.open .layout-btn').count(), 8);
        assert.ok(await page.locator('#btn-master-layout-overflow.has-overflow-active').count());
        await page.locator('#btn-master-overflow').click();
        assert.equal(await page.locator('#master-layout-menu.open').count(), 0);
        assert.equal(await page.locator('#master-general-menu.open #btn-master-folder').count(), 1);
        assert.equal(await page.locator('.master-shell-content #btn-master-folder').count(), 0);
    } finally { await page.close(); }
});

test('B.1 Grid layout shortcuts extend to 1-4, stay readable floorplans, and the gateway stays glued to them', async () => {
    const page = await bootLayerGrid(['https://third.test/A', 'https://third.test/B', 'https://third.test/C']);
    try {
        // Count clamps to the new 1-4 range; default stays 2 (untouched here).
        const clamp = await page.evaluate(async () => {
            const { setGridLayoutShortcutCount, getGridLayoutShortcutCount, MAX_GRID_LAYOUT_SHORTCUTS } =
                await import('./js/hotswap-chrome.js');
            setGridLayoutShortcutCount(99);
            const clampedHigh = getGridLayoutShortcutCount();
            setGridLayoutShortcutCount(0);
            const clampedLow = getGridLayoutShortcutCount();
            return { clampedHigh, clampedLow, max: MAX_GRID_LAYOUT_SHORTCUTS };
        });
        assert.equal(clamp.max, 4);
        assert.equal(clamp.clampedHigh, 4);
        assert.equal(clamp.clampedLow, 1);

        await page.evaluate(async () => {
            const { setGridLayoutShortcutCount, setGridLayoutShortcutOrder } = await import('./js/hotswap-chrome.js');
            setGridLayoutShortcutCount(4);
            setGridLayoutShortcutOrder(['lefttall', '3col', 'vsplit', '4grid']);
        });
        await page.reload({ waitUntil: 'load' });
        await page.waitForFunction(() => document.querySelectorAll('#master-layout-shortcuts .layout-shortcut').length === 4);
        await page.locator('#btn-toggle-master').click();
        await page.waitForTimeout(300);

        // Exactly N (4) visible shortcuts, in the configured order, each a
        // readable mini-floorplan — the SAME li-<id> grammar the permanent
        // overflow buttons use, never the old abstract ▦/▤/▥ glyph.
        const shortcuts = await page.locator('#master-layout-shortcuts .layout-shortcut').evaluateAll(
            (buttons) => buttons.map((b) => ({
                layout: b.dataset.layout,
                iconClass: b.querySelector('.layout-icon')?.className || '',
                text: b.textContent.trim(),
            })));
        assert.deepEqual(shortcuts.map((s) => s.layout), ['lefttall', '3col', 'vsplit', '4grid']);
        shortcuts.forEach((s) => {
            assert.ok(s.iconClass.includes(`li-${s.layout}`), `${s.layout} carries its own floorplan class`);
            assert.equal(/[▦▤▥]/.test(s.text), false, `${s.layout} shortcut is not an abstract glyph`);
        });

        // The gateway is DOM-adjacent to the shortcuts group — part of the
        // layout cluster, not drifted toward Settings/Dock/general overflow —
        // and the whole cluster still sits in the right-anchored contextual
        // region, immediately before the reserved Dock padding.
        const domOrder = await page.evaluate(() => [...document.querySelector('.master-contextual').children]
            .map((el) => el.id || el.className));
        const shortcutsIndex = domOrder.indexOf('master-layout-shortcuts');
        assert.ok(shortcutsIndex >= 0);
        assert.equal(domOrder[shortcutsIndex + 1], 'btn-master-layout-overflow');
        assert.ok(await page.evaluate(() =>
            document.querySelector('.master-contextual') ===
            document.getElementById('btn-master-layout-overflow').closest('.master-contextual')));

        // All eight remain reachable through the gateway regardless of count.
        await page.locator('#btn-master-layout-overflow').click();
        assert.equal(await page.locator('#master-layout-menu.open .layout-btn').count(), 8);
    } finally { await page.close(); }
});

test('B.1 no Browser Gallery Hearts exist yet — the dynamic Dock contract is breadcrumbed, not implemented', async () => {
    const page = await bootLayerGrid(['https://third.test/A', 'https://third.test/B', 'https://third.test/C']);
    try {
        const heartTraces = await page.evaluate(() => [...document.querySelectorAll('*')]
            .filter((el) => /heart|favorite.?current|bg-gallery/i.test(el.id) || /heart|favorite.?current|bg-gallery/i.test(el.className))
            .map((el) => el.id || el.className));
        assert.deepEqual(heartTraces, []);
    } finally { await page.close(); }
});

/** Bounding rect for the visible stream-slot currently showing canary `id`. */
function readCanaryRect(page, id) {
    return page.evaluate((wantedId) => {
        const slot = [...document.querySelectorAll('.stream-slot')].find((candidate) => {
            const src = candidate.querySelector('iframe')?.getAttribute('data-last-src') || '';
            return src.includes(`id=${wantedId}`) && getComputedStyle(candidate).display !== 'none';
        });
        if (!slot) return null;
        const r = slot.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    }, id);
}

// Left Tall and Right Tall are a deliberate mirrored pair: both layouts bind
// grid-area `screen1` to their own tall cell and `screen2`/`screen3` to their
// own top-short/bottom-short cells (index3.html's CSS), and a layout switch
// always resets the session arrangement back to identity (slot 0 -> screen1,
// slot 1 -> screen2, slot 2 -> screen3). Those two facts already compose into
// exact visual-role continuity for the ordinary (unswapped) case with zero
// permutation logic of any kind — proven here rather than assumed.
test('Left Tall <-> Right Tall preserves visual role (tall / top-short / bottom-short) with zero reload', async () => {
    const page = await bootCanaryGrid(); // A, B, C canaries; boots into the default lefttall, identity arrangement
    try {
        // A carries Runtime-relevant metadata (a ROOT/folder assignment) so its
        // survival through the switch is provable, not merely plausible.
        await page.evaluate(async () => {
            const { updateGridSession, getSessionUrls } = await import('./js/grid-session.js');
            updateGridSession(getSessionUrls(), { 0: 'FolderA' });
        });
        const panelsBefore = await page.evaluate(async () => {
            const { getSessionPanels } = await import('./js/grid-session.js');
            return getSessionPanels();
        });

        const before = { A: await readCanaryRect(page, 'A'), B: await readCanaryRect(page, 'B'), C: await readCanaryRect(page, 'C') };
        assert.ok(before.A.h > before.B.h && before.A.h > before.C.h, 'sanity: A is the full-height tall cell');
        assert.ok(before.B.y < before.C.y, 'B (top-short) sits above C (bottom-short)');
        assert.ok(before.A.x < before.B.x, 'tall cell (A) is on the LEFT in Left Tall');

        await armContinuityProbe(page);
        await page.evaluate(() => document.getElementById('btn-toggle-master').click());
        await page.waitForTimeout(200);
        await page.evaluate(() => document.getElementById('btn-master-layout-overflow').click());
        await page.evaluate(() => document.getElementById('btn-layout-righttall').click());
        await page.waitForFunction(() => document.querySelector('#triple-layout').className.includes('layout-righttall'));
        await page.waitForTimeout(200);

        const after = { A: await readCanaryRect(page, 'A'), B: await readCanaryRect(page, 'B'), C: await readCanaryRect(page, 'C') };
        assert.equal(after.A.h, before.A.h, 'A stays the full-height tall cell');
        assert.equal(after.B.h, before.B.h, 'B stays a short cell, same height');
        assert.equal(after.C.h, before.C.h, 'C stays a short cell, same height');
        assert.ok(after.B.y < after.C.y, 'B stays ABOVE C — top-short/bottom-short order unchanged');
        assert.ok(after.A.x > after.B.x, 'the tall cell (still A) is now on the RIGHT — the geometry mirrored');
        assert.ok(after.B.x < after.A.x && after.C.x < after.A.x, 'B and C moved to the left side together');

        // Zero reload: same iframe nodes, same parents, no load fired — this is
        // a pure grid-area reassignment, exactly like an ordinary Position swap.
        const probe = readContinuityProbe(page);
        const { sameNodes, sameParents, loads } = await probe;
        assert.ok(sameNodes && sameParents);
        assert.ok(Object.values(loads).every((count) => count === 0));

        // Panel identity, Runtime metadata, and ROOT/folder assignment are
        // untouched by construction — setSessionLayout() only ever rewrites
        // _arrangement, never _panels.
        const panelsAfter = await page.evaluate(async () => {
            const { getSessionPanels } = await import('./js/grid-session.js');
            return getSessionPanels();
        });
        assert.deepEqual(panelsAfter, panelsBefore);

        // And the reverse direction holds symmetrically.
        await page.evaluate(() => document.getElementById('btn-master-layout-overflow').click());
        await page.evaluate(() => document.getElementById('btn-layout-lefttall').click());
        await page.waitForFunction(() => document.querySelector('#triple-layout').className.includes('layout-lefttall'));
        await page.waitForTimeout(200);
        const reverted = { A: await readCanaryRect(page, 'A'), B: await readCanaryRect(page, 'B'), C: await readCanaryRect(page, 'C') };
        assert.equal(reverted.A.h, before.A.h);
        assert.ok(reverted.A.x < reverted.B.x, 'back to Left Tall: the tall cell is on the left again');
        assert.ok(reverted.B.y < reverted.C.y);
    } finally { await page.close(); }
});

test('Top2 <-> Bottom2 preserves wide, left-short, and right-short roles with zero reload', async () => {
    const page = await bootCanaryGrid();
    try {
        // Establish Top2 through the ordinary layout control; its identity
        // arrangement gives A/B the two top-short roles and C the bottom-wide role.
        await page.evaluate(() => document.getElementById('btn-toggle-master').click());
        await page.waitForTimeout(100);
        await page.evaluate(() => document.getElementById('btn-master-layout-overflow').click());
        await page.evaluate(() => document.getElementById('btn-layout-top2').click());
        await page.waitForFunction(() => document.querySelector('#triple-layout').classList.contains('layout-top2'));
        const panelsBefore = await page.evaluate(async () => (await import('./js/grid-session.js')).getSessionPanels());
        const top = { A: await readCanaryRect(page, 'A'), B: await readCanaryRect(page, 'B'), C: await readCanaryRect(page, 'C') };
        assert.ok(top.C.w > top.A.w && top.C.w > top.B.w, 'C begins in Top2’s wide role');
        assert.ok(top.A.x < top.B.x, 'A begins in the left-short role');

        await armContinuityProbe(page);
        await page.evaluate(() => document.getElementById('btn-master-layout-overflow').click());
        await page.evaluate(() => document.getElementById('btn-layout-bottom2').click());
        await page.waitForFunction(() => document.querySelector('#triple-layout').classList.contains('layout-bottom2'));
        await page.waitForTimeout(100);
        const bottom = { A: await readCanaryRect(page, 'A'), B: await readCanaryRect(page, 'B'), C: await readCanaryRect(page, 'C') };
        assert.ok(bottom.C.w > bottom.A.w && bottom.C.w > bottom.B.w, 'C remains wide');
        assert.ok(bottom.A.x < bottom.B.x, 'A remains left-short and B remains right-short');
        assert.ok(bottom.C.y < bottom.A.y && bottom.C.y < bottom.B.y, 'the wide role mirrors from bottom to top');
        const probe = await readContinuityProbe(page);
        assert.ok(probe.sameNodes && probe.sameParents);
        assert.ok(Object.values(probe.loads).every((count) => count === 0));
        assert.deepEqual(await page.evaluate(async () => (await import('./js/grid-session.js')).getSessionPanels()), panelsBefore,
            'panel identity and metadata survive the presentation-only transition');

        await page.evaluate(() => document.getElementById('btn-master-layout-overflow').click());
        await page.evaluate(() => document.getElementById('btn-layout-top2').click());
        await page.waitForFunction(() => document.querySelector('#triple-layout').classList.contains('layout-top2'));
        const restored = { A: await readCanaryRect(page, 'A'), B: await readCanaryRect(page, 'B'), C: await readCanaryRect(page, 'C') };
        assert.ok(restored.C.w > restored.A.w && restored.C.w > restored.B.w, 'reverse keeps C wide');
        assert.ok(restored.A.x < restored.B.x, 'reverse keeps A left-short and B right-short');
        assert.ok(restored.C.y > restored.A.y && restored.C.y > restored.B.y, 'reverse restores the mirrored composition');
    } finally { await page.close(); }
});

test('L2 Master Undo and Redo mutate only the selected nested Runtime', async () => {
    const page = await bootCanaryGrid();
    try {
        await assignPanelUrl(page, 0, 'index3.html?workspace=live');
        const nested = await frameForSlot(page, 0);
        await nested.waitForFunction(() => document.querySelectorAll('.stream-panel iframe').length === 4);
        await nested.evaluate(() => {
            const panel = document.querySelectorAll('.stream-panel')[1];
            panel.querySelector('.btn-hotswap-toggle').click();
            panel.querySelector('.hotswap-input').value = '/test/fixtures/canary.html?id=NESTED';
            panel.querySelector('.hotswap-submit-btn').click();
        });
        await nested.waitForFunction(() => document.querySelectorAll('.stream-panel iframe')[1]
            .getAttribute('data-last-src').endsWith('id=NESTED'));
        await page.waitForFunction(() => document.querySelector('#master-layer-selector .hotswap-layer-btn[data-slot="0"]'));
        await page.evaluate(() => document.querySelector('#master-layer-selector .hotswap-layer-btn[data-slot="0"]').click());
        const outerBefore = await page.evaluate(async () => (await import('./js/grid-session.js')).getSessionPanels());

        await page.evaluate(() => document.getElementById('btn-master-undo').click());
        await nested.waitForFunction(() => document.querySelectorAll('.stream-panel iframe')[1]
            .getAttribute('data-last-src').endsWith('id=B'));
        assert.deepEqual(await page.evaluate(async () => (await import('./js/grid-session.js')).getSessionPanels()), outerBefore,
            'forwarded Undo leaves the outer Runtime unchanged');

        await page.evaluate(() => document.getElementById('btn-master-redo').click());
        await nested.waitForFunction(() => document.querySelectorAll('.stream-panel iframe')[1]
            .getAttribute('data-last-src').endsWith('id=NESTED'));
        assert.deepEqual(await page.evaluate(async () => (await import('./js/grid-session.js')).getSessionPanels()), outerBefore,
            'forwarded Redo also leaves the outer Runtime and its sibling panels unchanged');
    } finally { await page.close(); }
});

test('Stage B Settings exposes the canonical Grid layout collection and Solo keeps its own vocabulary', async () => {
    const settings = await browser.newPage();
    try {
        await settings.goto(`${ORIGIN}/settings.html`, { waitUntil: 'networkidle' });
        assert.equal(await settings.locator('#grid-layout-count-row .btn-slot-count').count(), 4);
        assert.equal(await settings.locator('#grid-layout-order-list .hotswap-toggle-row').count(), 8);
    } finally { await settings.close(); }
    const solo = await browser.newPage();
    try {
        await solo.goto(`${ORIGIN}/index2.html`, { waitUntil: 'networkidle' });
        assert.equal(await solo.locator('#orchestration-dock').count(), 1);
        assert.equal(await solo.locator('#btn-folder').count(), 1);
        assert.equal(await solo.locator('#btn-master-layout-overflow').count(), 0);
    } finally { await solo.close(); }
});

test('Bottom Runtime Shell Stage A keeps the Master outside closed and outside the measured Dock reserve', async () => {
    const intersects = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const readShell = (page) => page.evaluate(() => {
        const rect = (el) => {
            const { left, right, top, bottom, width, height } = el.getBoundingClientRect();
            return { left, right, top, bottom, width, height };
        };
        const dock = document.getElementById('orchestration-dock');
        const bar = document.getElementById('master-bar');
        return {
            dock: rect(dock),
            bar: rect(bar),
            reserve: Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gs3-dock-reserve')),
            content: rect(bar.querySelector('.master-shell-content')),
            controls: [...bar.querySelectorAll('.master-btn, #master-status')]
                .filter((el) => getComputedStyle(el).display !== 'none')
                .map(rect),
        };
    });

    for (const width of [1920, 1440, 1280, 1080, 880, 700, 560, 420]) {
        const page = await bootLayerGrid(['https://third.test/A', 'https://third.test/B', 'https://third.test/C'], '4grid');
        try {
            await page.setViewportSize({ width, height: 720 });
            await page.waitForTimeout(40);
            let shell = await readShell(page);
            assert.ok(shell.bar.top >= 720, `closed Master must be fully outside at ${width}px`);

            await page.locator('#btn-toggle-master').click();
            await page.waitForTimeout(300);
            shell = await readShell(page);
            assert.equal(shell.bar.bottom, 720, `open Master rests on viewport edge at ${width}px`);
            assert.ok(shell.controls.every((control) => !intersects(control, shell.dock)),
                `no Master content intersects the Dock at ${width}px`);
            if ([1280, 560, 420].includes(width)) {
                await page.locator('#btn-master-overflow').click();
                for (const buttonId of ['btn-master-folder', 'btn-master-save']) {
                    await page.locator(`#master-general-menu #${buttonId}`).click();
                    await page.waitForTimeout(20);
                    const dropup = await page.evaluate((id) => {
                        const menu = document.getElementById(id).getBoundingClientRect();
                        const master = document.getElementById('master-bar').getBoundingClientRect();
                        const dock = document.getElementById('orchestration-dock').getBoundingClientRect();
                        return {
                            aboveBar: menu.bottom <= master.top,
                            intersectsDock: menu.left < dock.right && menu.right > dock.left && menu.top < dock.bottom && menu.bottom > dock.top,
                        };
                    }, buttonId === 'btn-master-folder' ? 'master-folder-dropup' : 'master-save-dropup');
                    assert.deepEqual(dropup, { aboveBar: true, intersectsDock: false }, `${buttonId} stays above the full bar at ${width}px`);
                }
            }
        } finally { await page.close(); }
    }

    const page = await bootLayerGrid(['https://third.test/A', 'https://third.test/B', 'https://third.test/C'], '4grid');
    try {
        await page.setViewportSize({ width: 1280, height: 720 });
        await page.locator('#btn-toggle-master').click();
        await page.waitForTimeout(300);
        const before = await readShell(page);
        await page.evaluate(() => {
            const child = document.createElement('span');
            child.id = 'shell-wide-dock-fixture';
            child.style.cssText = 'display:block; width:200px; height:1px; flex:0 0 200px';
            document.getElementById('orchestration-dock').append(child);
        });
        await page.waitForTimeout(80);
        const expanded = await readShell(page);
        assert.ok(expanded.reserve >= before.reserve + 190, 'ResizeObserver expands the canonical Dock reserve');
        assert.ok(expanded.content.width <= before.content.width - 190, 'Master legal content width follows the reserve');
        assert.ok(expanded.controls.every((control) => !intersects(control, expanded.dock)), 'expanded Dock still has no Master overlap');
        await page.evaluate(() => document.getElementById('shell-wide-dock-fixture').remove());
        await page.waitForTimeout(80);
        const restored = await readShell(page);
        assert.ok(restored.reserve <= expanded.reserve - 190, 'reserve shrinks after Dock content is removed');
        assert.ok(restored.content.width >= expanded.content.width + 190, 'Master legal content grows with the restored reserve');

        await page.evaluate(() => { document.getElementById('master-status').textContent = 'status '.repeat(2000); });
        const longStatus = await page.evaluate(() => {
            const status = document.getElementById('master-status');
            const style = getComputedStyle(status);
            return { clipped: status.scrollWidth > status.clientWidth, position: style.position, overflow: style.overflow };
        });
        assert.deepEqual(longStatus, { clipped: true, position: 'static', overflow: 'hidden' });
        const withLongStatus = await readShell(page);
        assert.ok(withLongStatus.controls.every((control) => !intersects(control, withLongStatus.dock)), 'long status remains inside the legal shell region');

        await page.locator('#btn-master-overflow').click();
        await page.locator('#master-general-menu #btn-master-folder').click();
        await page.waitForTimeout(20);
        const folderDropup = await page.evaluate(() => {
            const dropup = document.getElementById('master-folder-dropup').getBoundingClientRect();
            const bar = document.getElementById('master-bar').getBoundingClientRect();
            const dock = document.getElementById('orchestration-dock').getBoundingClientRect();
            return { aboveBar: dropup.bottom <= bar.top, intersectsDock: dropup.left < dock.right && dropup.right > dock.left && dropup.top < dock.bottom && dropup.bottom > dock.top };
        });
        assert.deepEqual(folderDropup, { aboveBar: true, intersectsDock: false });

        const zScale = await page.evaluate(async () => {
            const nested = document.createElement('iframe');
            nested.src = 'index.html';
            document.body.append(nested);
            await new Promise((resolve) => nested.addEventListener('load', resolve, { once: true }));
            return {
                master: Number(getComputedStyle(document.getElementById('master-bar')).zIndex),
                dock: Number(getComputedStyle(document.getElementById('orchestration-dock')).zIndex),
                nestedControls: Number(getComputedStyle(nested.contentDocument.getElementById('controls')).zIndex),
            };
        });
        assert.deepEqual(zScale, { master: 29000, dock: 30000, nestedControls: 29000 });
    } finally { await page.close(); }
});

test('Stage 2.1 Settings Grid Layout Order rows render button shells, human titles, and no raw IDs', async () => {
    const page = await browser.newPage();
    try {
        await page.goto(`${ORIGIN}/settings.html`, { waitUntil: 'networkidle' });
        const rows = await page.locator('#grid-layout-order-list .hotswap-toggle-row').evaluateAll((elements) => {
            return elements.map((row) => {
                const handle = row.querySelector('.drag-handle');
                const shell = row.querySelector('.layout-btn-shell');
                const icon = shell?.querySelector('.layout-icon');
                const iconCells = icon ? [...icon.querySelectorAll('i')].length : 0;
                const title = row.querySelector('.layout-icon-title');
                return {
                    key: row.dataset.key,
                    hasHandle: Boolean(handle && handle.textContent.includes('☰')),
                    hasShell: Boolean(shell),
                    hasCanonicalIcon: Boolean(icon && iconCells >= 2),
                    titleText: title ? title.textContent.trim() : '',
                };
            });
        });

        assert.equal(rows.length, 8, 'all 8 canonical layouts must be represented in Settings');
        const rawIds = ['top2', 'bottom2', '3col', 'lefttall', 'righttall', 'vsplit', 'hsplit', '4grid'];
        for (const row of rows) {
            assert.ok(row.hasHandle, `row ${row.key} must have drag handle`);
            assert.ok(row.hasShell, `row ${row.key} must have button-shell wrapper`);
            assert.ok(row.hasCanonicalIcon, `row ${row.key} must contain canonical mini-floorplan markup`);
            assert.ok(row.titleText.length > 0, `row ${row.key} must have human-readable title`);
            assert.ok(!rawIds.includes(row.titleText), `raw layout ID ${row.key} must not be the user-facing title`);
        }
    } finally {
        await page.close();
    }
});

test('Stage 2.1 Settings section order: Toolbar Shortcuts < Quick Action Runway < Grid Layout Shortcuts', async () => {
    const page = await browser.newPage();
    try {
        await page.goto(`${ORIGIN}/settings.html`, { waitUntil: 'networkidle' });
        const sectionInfo = await page.evaluate(() => {
            const toolbarShortcuts = document.getElementById('top-shortcuts-config');
            const runway = document.getElementById('quick-actions-config');
            const gridLayouts = document.getElementById('grid-layout-shortcuts-config');
            const gridCards = document.querySelectorAll('[data-section="grid-layouts"]');
            const gridConfigs = document.querySelectorAll('#grid-layout-shortcuts-config');

            const toolbarBeforeRunway = Boolean(
                toolbarShortcuts.compareDocumentPosition(runway) & Node.DOCUMENT_POSITION_FOLLOWING
            );
            const runwayBeforeGridLayouts = Boolean(
                runway.compareDocumentPosition(gridLayouts) & Node.DOCUMENT_POSITION_FOLLOWING
            );

            return {
                toolbarBeforeRunway,
                runwayBeforeGridLayouts,
                gridCardCount: gridCards.length,
                gridConfigCount: gridConfigs.length,
            };
        });

        assert.ok(sectionInfo.toolbarBeforeRunway, 'Toolbar Shortcuts must precede Quick Action Runway in DOM order');
        assert.ok(sectionInfo.runwayBeforeGridLayouts, 'Quick Action Runway must precede Grid Layout Shortcuts in DOM order');
        assert.equal(sectionInfo.gridCardCount, 1, 'exactly one Grid Layout Shortcuts section card exists');
        assert.equal(sectionInfo.gridConfigCount, 1, 'exactly one Grid Layout Shortcuts config UI exists');
    } finally {
        await page.close();
    }
});

test('Stage 2.1 Grid Layout Shortcuts behavior survives: 1-4 count, default 2, drag order persists, all 8 layouts', async () => {
    const page = await browser.newPage();
    try {
        await page.goto(`${ORIGIN}/settings.html`, { waitUntil: 'networkidle' });
        // Verify default count is 2
        assert.equal(await page.locator('#grid-layout-count-echo').textContent(), '2');
        assert.ok(await page.locator('#grid-layout-count-row .btn-slot-count[data-count="2"]').evaluate((b) => b.classList.contains('active')));

        // Verify count buttons 1-4 exist and clicking them changes count & echoes
        for (const count of [1, 3, 4, 2]) {
            await page.locator(`#grid-layout-count-row .btn-slot-count[data-count="${count}"]`).click();
            assert.equal(await page.locator('#grid-layout-count-echo').textContent(), String(count));
            const stored = await page.evaluate(() => localStorage.getItem('grid_layout_slot_count'));
            assert.equal(stored, String(count));
            const outsideCount = await page.locator('#grid-layout-order-list .hotswap-toggle-row.outside-cutoff').count();
            assert.equal(outsideCount, 8 - count);
        }

        // Verify all 8 layouts represented
        const layoutKeys = await page.locator('#grid-layout-order-list .hotswap-toggle-row').evaluateAll((rows) => rows.map((r) => r.dataset.key));
        assert.equal(layoutKeys.length, 8);
        assert.ok(layoutKeys.includes('righttall') && layoutKeys.includes('lefttall') && layoutKeys.includes('3col'));

        // Verify order persistence via simulated reorder
        const reordered = ['righttall', '4grid', 'lefttall', '3col', 'vsplit', 'hsplit', 'top2', 'bottom2'];
        await page.evaluate((order) => {
            localStorage.setItem('grid_layout_slot_order', JSON.stringify(order));
        }, reordered);
        await page.reload({ waitUntil: 'networkidle' });
        const keysAfterReload = await page.locator('#grid-layout-order-list .hotswap-toggle-row').evaluateAll((rows) => rows.map((r) => r.dataset.key));
        assert.deepEqual(keysAfterReload, reordered, 'drag/saved order persists across reload');
    } finally {
        await page.close();
    }
});

test('Stage 2.1 GS3-owned scrollbars receive restrained dark track and gray thumb styling', async () => {
    const page = await browser.newPage();
    try {
        await page.goto(`${ORIGIN}/settings.html`, { waitUntil: 'networkidle' });
        const styling = await page.evaluate(() => {
            const cs = getComputedStyle(document.documentElement);
            const colorScheme = cs.colorScheme;
            const scrollbarColor = cs.scrollbarColor;

            const bl = document.getElementById('blacklist-display');
            const blCs = getComputedStyle(bl);

            return {
                colorScheme,
                scrollbarColor,
                blOverflowY: blCs.overflowY,
                blScrollbarColor: blCs.scrollbarColor,
            };
        });

        assert.equal(styling.colorScheme, 'dark', 'GS3 root specifies color-scheme: dark');
        assert.ok(
            styling.scrollbarColor.includes('rgb(102, 102, 102)') || styling.scrollbarColor.includes('#666'),
            `scrollbarColor thumb should be gray: ${styling.scrollbarColor}`
        );
        assert.ok(
            styling.scrollbarColor.includes('rgb(26, 26, 26)') || styling.scrollbarColor.includes('#1a1a1a'),
            `scrollbarColor track should be dark charcoal: ${styling.scrollbarColor}`
        );
    } finally {
        await page.close();
    }
});
