import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const PORT = 4193;
const CROSS_PORT = 4194;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const CROSS_ORIGIN = `http://127.0.0.1:${CROSS_PORT}`;
let server;
let crossServer;
let browser;
const USER_SCRIPT_PATH = fileURLToPath(new URL('../userscripts/gs3-fill-panel.user.js', import.meta.url));

function startServer(port) {
    const child = spawn(process.platform === 'win32' ? 'python' : 'python3',
        ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], {
            cwd: process.cwd(), stdio: 'ignore',
        });
    return new Promise((resolve, reject) => {
        child.once('error', reject);
        const deadline = Date.now() + 5000;
        const probe = async () => {
            try {
                const response = await fetch(`http://127.0.0.1:${port}`);
                await response.arrayBuffer();
                if (response.ok) return resolve(child);
            } catch {}
            if (Date.now() >= deadline) return reject(new Error(`server ${port} did not start`));
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

async function bootGrid(firstUrl = '/test/fixtures/canary.html?id=A') {
    const page = await browser.newPage();
    page.setDefaultTimeout(7000);
    await page.addInitScript(({ firstUrl }) => {
        if (window !== window.top) return;
        localStorage.clear();
        localStorage.setItem('loop_matrix_urls', JSON.stringify([
            firstUrl,
            '/test/fixtures/canary.html?id=B',
            '/test/fixtures/canary.html?id=C',
        ]));
        localStorage.setItem('hotswap_action_order', JSON.stringify(['fillPanel']));
        localStorage.setItem('hotswap_top_count', '1');
        localStorage.setItem('hotswap_quick_actions_enabled', 'true');
        localStorage.setItem('hotswap_quick_action_count', '1');
        localStorage.setItem('hotswap_quick_action_order', JSON.stringify(['fillPanel']));
    }, { firstUrl });
    await page.goto(`${ORIGIN}/index3.html?workspace=live`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelectorAll('.stream-panel iframe').length === 4);
    await page.waitForTimeout(150);
    return page;
}

function bridge(type, extra = {}) {
    return {
        source: 'gs3-capability-bridge', version: 1, type,
        capability: 'FILL_PANEL', ...extra,
    };
}

async function firstPanel(page) {
    return page.locator('.stream-panel[data-slot-index="0"]').first();
}

async function postFromFrame(frame, message) {
    await frame.evaluate((payload) => parent.postMessage(payload, '*'), message);
}

test('Fill Panel remains hidden without a valid capability report and malformed/non-panel senders fail closed', async () => {
    const page = await bootGrid();
    try {
        const panel = await firstPanel(page);
        const controls = panel.locator('.btn-hotswap-fill-panel, .hotswap-mirror-btn[data-action-key="fillPanel"]');
        assert.equal(await controls.count(), 3, 'canonical, Top, and Runway controls derive from one action');
        assert.deepEqual(await controls.evaluateAll((nodes) => nodes.map((node) => node.hidden)), [true, true, true]);

        const frame = page.frames().find((candidate) => candidate.url().includes('id=A'));
        for (const malformed of [
            null,
            { ...bridge('CAPABILITY_PRESENT'), source: 'other' },
            { ...bridge('CAPABILITY_PRESENT'), version: 2 },
            { ...bridge('OTHER') },
            bridge('FILL_PANEL_ACTIVE', { active: 'yes' }),
        ]) await postFromFrame(frame, malformed);

        await page.evaluate(() => {
            const outsider = document.createElement('iframe');
            outsider.id = 'non-panel-sender';
            outsider.src = '/test/fixtures/canary.html?id=outsider';
            document.body.append(outsider);
        });
        await page.locator('#non-panel-sender').waitFor();
        await page.waitForTimeout(80);
        const outsider = page.frames().find((candidate) => candidate.url().includes('id=outsider'));
        await postFromFrame(outsider, bridge('CAPABILITY_PRESENT'));
        await page.waitForTimeout(30);
        assert.ok((await controls.evaluateAll((nodes) => nodes.map((node) => node.hidden))).every(Boolean));
    } finally { await page.close(); }
});

test('cross-origin live sender reveals one canonical action; Top and Runway delegate to it and wait for acknowledgment', async () => {
    const page = await bootGrid(`${CROSS_ORIGIN}/test/fixtures/canary.html?cross=A`);
    const warnings = [];
    page.on('console', (message) => { if (message.type() === 'warning') warnings.push(message.text()); });
    try {
        const panel = await firstPanel(page);
        const iframe = panel.locator('iframe');
        const frame = page.frames().find((candidate) => candidate.url().includes('cross=A'));
        await frame.evaluate(() => {
            window.__fillCommands = [];
            addEventListener('message', (event) => {
                if (event.data?.source === 'gs3-capability-bridge') window.__fillCommands.push(event.data);
            });
        });

        await postFromFrame(frame, bridge('CAPABILITY_PRESENT'));
        await page.waitForFunction(() => {
            const panel = [...document.querySelectorAll('.stream-panel')]
                .find((node) => node.querySelector('iframe')?.getAttribute('data-last-src')?.includes('cross=A'));
            return panel && [...panel.querySelectorAll('[data-action-key="fillPanel"], .btn-hotswap-fill-panel')]
                .every((button) => !button.hidden);
        });

        const canonical = panel.locator('.btn-hotswap-fill-panel');
        const top = panel.locator('.hotswap-top-shortcut[data-action-key="fillPanel"]');
        const runway = panel.locator('.hotswap-runway-btn[data-action-key="fillPanel"]');
        for (const control of [canonical, top, runway]) {
            assert.equal(await control.textContent(), '⛶');
            assert.equal(await control.getAttribute('title'), 'Fill Panel');
        }

        const before = await iframe.evaluate((node) => {
            window.__fillIframe = node;
            window.__fillParent = node.parentElement;
            window.__fillLoads = 0;
            node.addEventListener('load', () => { window.__fillLoads += 1; });
            return { src: node.src };
        });
        await top.evaluate((button) => button.click());
        await page.waitForTimeout(30);
        assert.equal((await frame.evaluate(() => window.__fillCommands.at(-1))).type, 'FILL_PANEL');
        assert.equal(await canonical.textContent(), '⛶', 'parent never fakes active state');

        await postFromFrame(frame, bridge('FILL_PANEL_ACTIVE', { active: true }));
        await page.waitForFunction(() => document.querySelector('.btn-hotswap-fill-panel')?.classList.contains('active'));
        for (const control of [canonical, top, runway]) {
            assert.equal(await control.textContent(), '✕');
            assert.equal(await control.getAttribute('title'), 'Exit Fill Panel');
            assert.equal(await control.getAttribute('aria-pressed'), 'true');
        }

        await runway.evaluate((button) => button.click());
        await page.waitForTimeout(30);
        assert.equal((await frame.evaluate(() => window.__fillCommands.at(-1))).type, 'EXIT_FILL_PANEL');
        assert.equal(await canonical.textContent(), '✕', 'exit also waits for child confirmation');
        await postFromFrame(frame, bridge('FILL_PANEL_ACTIVE', { active: false }));
        await page.waitForFunction(() => document.querySelector('.btn-hotswap-fill-panel')?.textContent === '⛶');

        const continuity = await iframe.evaluate((node) => ({
            sameNode: node === window.__fillIframe,
            sameParent: node.parentElement === window.__fillParent,
            loads: window.__fillLoads,
            src: node.src,
        }));
        assert.deepEqual(continuity, { sameNode: true, sameParent: true, loads: 0, src: before.src });

        await top.evaluate((button) => button.click());
        await page.waitForTimeout(1600);
        assert.equal(await canonical.textContent(), '⛶');
        assert.ok(warnings.some((message) => message.includes('was not acknowledged within 1500ms')));
    } finally { await page.close(); }
});

test('capability reports change only ephemeral presentation state', async () => {
    const page = await bootGrid();
    try {
        const panel = await firstPanel(page);
        const frame = page.frames().find((candidate) => candidate.url().includes('id=A'));
        const before = await page.evaluate(async () => {
            const session = await import('./js/grid-session.js');
            const navigation = await import('./js/panel-navigation.js');
            return {
                storage: Object.fromEntries(Object.entries(localStorage).sort()),
                panels: structuredClone(session.getSessionPanels()),
                urls: [...session.getSessionUrls()],
                folders: { ...session.getSessionFolderMap() },
                arrangement: [...session.getSessionArrangement()],
                navigation: navigation.getPanelNavigationState(0),
            };
        });
        await postFromFrame(frame, bridge('CAPABILITY_PRESENT'));
        await postFromFrame(frame, bridge('FILL_PANEL_ACTIVE', { active: true }));
        await page.waitForTimeout(30);
        const after = await page.evaluate(async () => {
            const session = await import('./js/grid-session.js');
            const navigation = await import('./js/panel-navigation.js');
            return {
                storage: Object.fromEntries(Object.entries(localStorage).sort()),
                panels: structuredClone(session.getSessionPanels()),
                urls: [...session.getSessionUrls()],
                folders: { ...session.getSessionFolderMap() },
                arrangement: [...session.getSessionArrangement()],
                navigation: navigation.getPanelNavigationState(0),
            };
        });
        assert.deepEqual(after, before);
        assert.equal(await panel.locator('.btn-hotswap-fill-panel').textContent(), '✕');
    } finally { await page.close(); }
});

test('new assignments and iframe loads reset capability and reject queued old-generation reports', async () => {
    const page = await bootGrid();
    try {
        const panel = await firstPanel(page);
        const frame = page.frames().find((candidate) => candidate.url().includes('id=A'));
        await postFromFrame(frame, bridge('CAPABILITY_PRESENT'));
        await postFromFrame(frame, bridge('FILL_PANEL_ACTIVE', { active: true }));
        await page.waitForTimeout(30);

        const assignment = await panel.evaluate(async (node, message) => {
            const iframe = node.querySelector('iframe');
            const oldWindow = iframe.contentWindow;
            const launch = await import('./js/launch.js');
            const capability = await import('./js/capability-bridge.js');
            const before = capability.getFillPanelCapabilityState(node);
            launch.updateRenderedPanel(node, { url: '/test/fixtures/canary.html?id=NEW' });
            const after = capability.getFillPanelCapabilityState(node);
            const staleAccepted = capability.handleCapabilityBridgeMessage({ data: message, source: oldWindow });
            return { before, after, staleAccepted, hidden: node.querySelector('.btn-hotswap-fill-panel').hidden };
        }, bridge('CAPABILITY_PRESENT'));
        assert.equal(assignment.before.active, true);
        assert.equal(assignment.after.capable, false);
        assert.equal(assignment.after.active, false);
        assert.equal(assignment.after.acceptingReports, false);
        assert.equal(assignment.staleAccepted, false);
        assert.equal(assignment.hidden, true);

        await page.waitForFunction(() => document.querySelector('.stream-panel iframe[data-last-src*="id=NEW"]')?.contentWindow);
        await page.waitForTimeout(100);
        const afterLoad = await panel.evaluate(async (node) => {
            const capability = await import('./js/capability-bridge.js');
            return capability.getFillPanelCapabilityState(node);
        });
        assert.equal(afterLoad.acceptingReports, true);
        assert.ok(afterLoad.generation > assignment.after.generation);

        const newFrame = page.frames().find((candidate) => candidate.url().includes('id=NEW'));
        await postFromFrame(newFrame, bridge('CAPABILITY_PRESENT'));
        await page.waitForFunction(() => !document.querySelector('.stream-panel iframe[data-last-src*="id=NEW"]')
            .closest('.stream-panel').querySelector('.btn-hotswap-fill-panel').hidden);
        await panel.locator('iframe').evaluate((iframe) => iframe.dispatchEvent(new Event('load')));
        assert.equal(await panel.locator('.btn-hotswap-fill-panel').evaluate((button) => button.hidden), true);
    } finally { await page.close(); }
});

test('nested outer container stays absent while its leaf panel owns Fill Panel locally', async () => {
    const page = await bootGrid();
    try {
        const outerPanel = await firstPanel(page);
        const outerFrame = page.frames().find((candidate) => candidate.url().includes('id=A'));
        await outerFrame.evaluate(async () => {
            const panel = document.createElement('div');
            panel.className = 'stream-panel';
            panel.dataset.slotIndex = '77';
            panel.innerHTML = '<button class="btn-hotswap-fill-panel" hidden>⛶</button><iframe src="/test/fixtures/canary.html?id=leaf"></iframe>';
            document.body.append(panel);
            await new Promise((resolve) => panel.querySelector('iframe').addEventListener('load', resolve, { once: true }));
            const capability = await import('/js/capability-bridge.js');
            capability.registerFillPanelCapability(panel);
            capability.resetFillPanelCapability(panel, { acceptingReports: true });
        });
        const leaf = page.frames().find((candidate) => candidate.url().includes('id=leaf'));
        await postFromFrame(leaf, bridge('CAPABILITY_PRESENT'));
        await page.waitForTimeout(40);
        assert.equal(await outerPanel.locator('.btn-hotswap-fill-panel').evaluate((button) => button.hidden), true);
        assert.equal(await outerFrame.evaluate(() => document.querySelector('.stream-panel[data-slot-index="77"] .btn-hotswap-fill-panel').hidden), false);
    } finally { await page.close(); }
});

test('Settings reconciles fillPanel through the existing canonical ordering machinery', async () => {
    const page = await browser.newPage();
    try {
        await page.goto(`${ORIGIN}/settings.html`, { waitUntil: 'networkidle' });
        const rows = await page.evaluate(() => ({
            top: [...document.querySelectorAll('#top-order-list .hotswap-toggle-row')].map((row) => row.dataset.key),
            runway: [...document.querySelectorAll('#runway-order-list .hotswap-toggle-row')].map((row) => row.dataset.key),
        }));
        assert.equal(rows.top.filter((key) => key === 'fillPanel').length, 1);
        assert.equal(rows.runway.filter((key) => key === 'fillPanel').length, 1);
    } finally { await page.close(); }
});

test('userscript detects dynamic HTML5 video, honors bridge commands and Shift+F, and restores presentation', async () => {
    const source = await readFile(new URL('../userscripts/gs3-fill-panel.user.js', import.meta.url), 'utf8');
    assert.match(source, /new MutationObserver\(scheduleInspection\)/);
    assert.doesNotMatch(source, /setInterval\(/);
    assert.doesNotMatch(source, /createElement\(['"]button['"]\)/, 'framed execution creates no standalone floating button');

    const page = await browser.newPage();
    try {
        await page.goto(`${ORIGIN}/test/fixtures/canary.html?id=userscript`, { waitUntil: 'load' });
        await page.evaluate(() => {
            const player = document.createElement('div');
            player.id = 'player';
            player.style.cssText = 'width:320px;height:180px';
            player.innerHTML = '<video></video>';
            document.body.append(player);
            window.scrollTo(0, 0);
        });
        await page.addScriptTag({ path: USER_SCRIPT_PATH });
        await page.waitForTimeout(180);
        await page.keyboard.press('Shift+F');
        assert.equal(await page.locator('#player').evaluate((node) => node.classList.contains('gs3-panel-fill-active')), true);
        assert.equal(await page.locator('html').evaluate((node) => node.classList.contains('gs3-fill-document-active')), true);
        await page.keyboard.press('Shift+F');
        assert.equal(await page.locator('#player').evaluate((node) => node.classList.contains('gs3-panel-fill-active')), false);
        assert.equal(await page.locator('html').evaluate((node) => node.classList.contains('gs3-fill-document-active')), false);
    } finally { await page.close(); }
});

test('existing Hotswap registry remains intact and Fill Panel is one non-routed action', async () => {
    const page = await browser.newPage();
    try {
        await page.goto(`${ORIGIN}/index.html`, { waitUntil: 'load' });
        const result = await page.evaluate(async () => {
            const launch = await import('./js/launch.js');
            const fill = launch.HOTSWAP_ACTIONS.filter((action) => action.key === 'fillPanel');
            return {
                fill,
                oldKeys: ['toggle', 'folder', 'star', 'reload', 'shuffle', 'shuffleAll', 'delete', 'kill', 'purge', 'launchpad', 'undo', 'redo']
                    .every((key) => launch.HOTSWAP_ACTIONS.some((action) => action.key === key)),
                layerRouted: launch.LAYER_SCOPED_ACTIONS.has('fillPanel'),
                masterRouted: launch.MASTER_LAYER_ACTIONS.has('fillPanel'),
            };
        });
        assert.deepEqual(result.fill, [{ key: 'fillPanel', emoji: '⛶', title: 'Fill Panel', className: 'btn-hotswap-fill-panel' }]);
        assert.equal(result.oldKeys, true);
        assert.equal(result.layerRouted, false);
        assert.equal(result.masterRouted, false);
    } finally { await page.close(); }
});
