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
        document.querySelectorAll('.stream-panel')[1].querySelector('.btn-hotswap-undo').style.display), '');
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
    assert.match(geometry.runwayOffsetExpr, /calc\(.*2\.5\)/,
        'the safe-zone offset is authored proportionally, not as a magic pixel count');
    assert.equal(geometry.runwayTop, Math.round(geometry.toolbarHeightVar * 2.5),
        'and resolves to 2.5 toolbar heights below the top of the panel');
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

    // Three independently ordered collections.
    for (const listId of ['top-order-list', 'runway-order-list', 'hotswap-toggle-list']) {
        assert.ok(await page.locator(`#${listId} .hotswap-toggle-row`).count() > 0, listId);
        assert.equal(await page.evaluate((id) =>
            document.querySelector(`#${id} .hotswap-toggle-row`).draggable, listId), true);
    }
    assert.ok(await page.locator('#hotswap-toggle-list .hotswap-toggle-row').count()
        > await page.locator('#runway-order-list .hotswap-toggle-row').count(),
        'only Deep Cuts lists every action');
    // Only Deep Cuts owns visibility.
    assert.ok(await page.locator('#hotswap-toggle-list input[type="checkbox"]').count() > 0);
    assert.equal(await page.locator('#top-order-list input[type="checkbox"]').count(), 0);

    // Runway: 1-8 in two rows of four. Top Shortcuts: 1-6, its own ceiling.
    assert.deepEqual(await page.locator('#slot-count-row .btn-slot-count').allTextContents(),
        ['1', '2', '3', '4', '5', '6', '7', '8']);
    assert.deepEqual(await page.locator('#top-count-row .btn-slot-count').allTextContents(),
        ['1', '2', '3', '4', '5', '6']);
    assert.equal(await page.evaluate(() =>
        getComputedStyle(document.getElementById('slot-count-row')).gridTemplateColumns.split(' ').length), 4);

    // ON/OFF independent of count, for both collections.
    await setSwitch('quick-actions-enabled', true);
    await page.locator('#slot-count-row .btn-slot-count[data-count="6"]').click();
    await setSwitch('top-shortcuts-enabled', true);
    await page.locator('#top-count-row .btn-slot-count[data-count="5"]').click();
    assert.equal(await page.evaluate(() => localStorage.getItem('hotswap_quick_action_count')), '6');
    assert.equal(await page.evaluate(() => localStorage.getItem('hotswap_top_shortcut_count')), '5');
    await setSwitch('quick-actions-enabled', false);
    await setSwitch('top-shortcuts-enabled', false);
    assert.equal(await page.evaluate(() => localStorage.getItem('hotswap_quick_actions_enabled')), 'false');
    assert.equal(await page.evaluate(() => localStorage.getItem('hotswap_top_shortcuts_enabled')), 'false');
    assert.equal(await page.evaluate(() => localStorage.getItem('hotswap_quick_action_count')), '6',
        'switching a surface off keeps its configuration');
    assert.equal(await page.evaluate(() => localStorage.getItem('hotswap_top_shortcut_count')), '5');

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
            localStorage.setItem('hotswap_tray_order', JSON.stringify(['undo', 'redo', 'folder']));
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
    assert.deepEqual(trayOrder.slice(0, 3), ['undo', 'redo', 'folder'],
        'the tray renders in its own, independent configured order');

    // An action can appear in BOTH collections — they are presentation, not behavior.
    assert.equal(await page.evaluate(() => document.querySelectorAll('.stream-panel')[0]
        .querySelector('.btn-hotswap-undo').style.display), '');
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
            localStorage.setItem('hotswap_top_shortcut_order', JSON.stringify(
                ['star', 'shuffle', 'reload', 'shuffleAll', 'undo', 'redo']));
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
    assert.deepEqual(wide, ['star', 'shuffle', 'reload', 'shuffleAll', 'undo', 'redo'],
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
        // Scoped to the permanent history group: 'undo' is also configured as a
        // Top Shortcut in this test, and that copy is expected to drop.
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

    // Nothing else was lost with them.
    ['btn-hotswap-folder', 'btn-hotswap-star', 'btn-hotswap-reload', 'btn-hotswap-shuffle',
        'btn-hotswap-kill', 'btn-purge', 'btn-hotswap-launchpad', 'btn-hotswap-undo', 'btn-hotswap-redo']
        .forEach((name) => {
            assert.ok(tray.some((candidate) => candidate.includes(name)), `${name} is still in Deep Cuts`);
        });

    // And Settings no longer offers them either.
    const settings = await browser.newPage();
    await settings.route(/^https?:\/\/(?!127\.0\.0\.1:4173).*/, (route) => route.fulfill({ status: 204, body: '' }));
    await settings.goto(`${ORIGIN}/settings.html`, { waitUntil: 'networkidle' });
    const listed = await settings.evaluate(() =>
        [...document.querySelectorAll('#hotswap-toggle-list .hotswap-toggle-row')].map((row) => row.dataset.key));
    assert.ok(!listed.includes('position') && !listed.includes('copyPosition'));
    assert.ok(listed.includes('folder') && listed.includes('undo'));
    await settings.close();

    // But both remain reachable — through the button that owns them.
    await openPositionMenu(page);
    assert.deepEqual(await page.evaluate(() =>
        [...document.querySelectorAll('.stream-panel')[0]
            .querySelectorAll('.hotswap-position-group-title')].map((t) => t.textContent)),
        ['Swap Position', 'Copy To Position']);
    await page.close();
});

test('Shuffle All renders its two dice on one line inside the compact rail', async () => {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    await page.route(/^https?:\/\/(?!127\.0\.0\.1:4173).*/, (route) => route.fulfill({ status: 204, body: '' }));
    await page.addInitScript(() => {
        if (window === window.top) {
            localStorage.setItem('hotswap_top_shortcuts_enabled', 'true');
            localStorage.setItem('hotswap_top_shortcut_count', '2');
            localStorage.setItem('hotswap_top_shortcut_order', JSON.stringify(['shuffleAll', 'star']));
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

    // Behavior is untouched: the icon is a mirror, and clicking it dispatches
    // to the ONE canonical Shuffle All button rather than reimplementing it.
    const reachedCanonical = await page.evaluate(() => {
        const panel = document.querySelectorAll('.stream-panel')[0];
        const canonical = panel.querySelector('.btn-hotswap-shuffle-all');
        let hits = 0;
        canonical.addEventListener('click', () => { hits += 1; });
        panel.querySelector('.hotswap-top-shortcut[data-action-key="shuffleAll"]').click();
        return hits;
    });
    assert.equal(reachedCanonical, 1, 'the top shortcut invoked the canonical action exactly once');
    await page.close();
});
