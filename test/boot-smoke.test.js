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
    const child = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], {
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
function moveCanaryToPosition(page, canaryId, position) {
    return page.evaluate(([id, target]) => {
        const panel = [...document.querySelectorAll('.stream-panel')].find((candidate) =>
            (candidate.querySelector('iframe')?.getAttribute('data-last-src') || '').endsWith(`id=${id}`));
        if (!panel) throw new Error(`no panel is showing canary ${id}`);
        panel.querySelector('.btn-hotswap-position').click();
        const item = [...panel.querySelectorAll('.hotswap-position-row .hotswap-position-item:not(.current)')]
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
        panel.querySelector('.btn-hotswap-position').click();
        return [...panel.querySelectorAll('.hotswap-position-item')].map((item) => ({
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

test('Copy to Position copies the URL to the destination only, undoably', async () => {
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
    }), { 0: 'FolderA', 2: 'FolderC' }, 'copy means URL only — no folder or other metadata is cloned');

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

test('Quick Action mirrors of ↩/↪ track real availability instead of sitting there dead', async () => {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    await page.route(/^https?:\/\/(?!127\.0\.0\.1:4173).*/, (route) => route.fulfill({ status: 204, body: '' }));
    await page.addInitScript(() => {
        if (window === window.top) {
            localStorage.setItem('hotswap_quick_action_slots', JSON.stringify(['undo', 'redo']));
            localStorage.setItem('loop_matrix_urls', JSON.stringify([
                '/test/fixtures/canary.html?id=A',
                '/test/fixtures/canary.html?id=B',
                '/test/fixtures/canary.html?id=C',
            ]));
        }
    });
    await page.goto(`${ORIGIN}/index3.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelectorAll('.stream-panel iframe').length === 4);

    const mirrors = (slotIndex) => page.evaluate((index) =>
        [...document.querySelectorAll('.stream-panel')[index].querySelectorAll('.hotswap-shortcut-btn')]
            .map((button) => ({ key: button.dataset.actionKey, enabled: !button.disabled })), slotIndex);

    // An action assigned to a Quick Action slot leaves the tray, as always.
    assert.equal(await page.evaluate(() =>
        document.querySelectorAll('.stream-panel')[1].querySelector('.btn-hotswap-undo').style.display), 'none');
    assert.deepEqual(await mirrors(1), [{ key: 'undo', enabled: false }, { key: 'redo', enabled: false }]);

    await page.evaluate(() => {
        const panel = document.querySelectorAll('.stream-panel')[1];
        panel.querySelector('.btn-hotswap-toggle').click();
        panel.querySelector('.hotswap-input').value = '/test/fixtures/canary.html?id=D';
        panel.querySelector('.hotswap-submit-btn').click();
    });
    await page.waitForLoadState('networkidle');
    assert.deepEqual(await mirrors(1), [{ key: 'undo', enabled: true }, { key: 'redo', enabled: false }]);
    assert.deepEqual(await mirrors(0), [{ key: 'undo', enabled: false }, { key: 'redo', enabled: false }],
        'availability is per panel, not global');

    // The mirror really drives the action, and its own state follows.
    await page.evaluate(() => document.querySelectorAll('.stream-panel')[1]
        .querySelector('.hotswap-shortcut-btn[data-action-key="undo"]').click());
    await page.waitForFunction(() =>
        document.querySelectorAll('.stream-panel iframe')[1].getAttribute('data-last-src').endsWith('id=B'));
    assert.deepEqual(await mirrors(1), [{ key: 'undo', enabled: false }, { key: 'redo', enabled: true }]);
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
            localStorage.setItem('hotswap_quick_action_slots', JSON.stringify(['undo', 'redo']));
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
            shortcuts: panel.querySelectorAll('.hotswap-shortcut-btn').length,
        };
    });
    assert.deepEqual(state, { hidden: ['none', 'none', 'none', 'none'], shortcuts: 0 });
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
