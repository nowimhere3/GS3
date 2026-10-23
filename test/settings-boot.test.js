import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

// settings.html imports HOTSWAP_ACTIONS from js/launch.js, so ANY failure while that module graph
// evaluates (syntax error, missing export, bad import path…) silently prevents settings.js from running
// and leaves "Connect & Fetch Database" inert. These tests keep that class of regression loud.

const PORT = 4175;
const ORIGIN = `http://127.0.0.1:${PORT}`;
let server;
let browser;

function startServer() {
    const child = spawn(process.platform === 'win32' ? 'python' : 'python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], {
        cwd: process.cwd(), stdio: 'ignore',
    });
    return new Promise((resolve, reject) => {
        child.once('error', reject);
        const deadline = Date.now() + 5000;
        const probe = async () => {
            try {
                const response = await fetch(ORIGIN);
                await response.arrayBuffer();
                if (response.ok) return resolve(child);
            } catch {}
            if (Date.now() >= deadline) return reject(new Error('HTTP test server did not start'));
            setTimeout(probe, 50);
        };
        probe();
    });
}

before(async () => { server = await startServer(); browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); server?.kill(); });

async function openSettings({ github } = {}) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    const dialogs = [];
    page.on('pageerror', (error) => errors.push(`uncaught: ${error.message}`));
    page.on('console', (message) => {
        if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) errors.push(`console.error: ${message.text()}`);
    });
    page.on('dialog', async (dialog) => { dialogs.push(dialog.message()); await dialog.dismiss(); });
    await context.route(/^https?:\/\/(?!127\.0\.0\.1:4175).*/, (route) => {
        const url = route.request().url();
        if (github && url.startsWith('https://api.github.com/')) return github(route, url);
        return route.fulfill({ status: 204, body: '' });
    });
    await page.goto(`${ORIGIN}/settings.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(200);
    return { page, context, errors, dialogs };
}

test('settings.html boots its whole module graph (incl. launch.js -> capability-bridge.js -> presentation-url.js) without errors', async () => {
    const { page, context, errors } = await openSettings();
    assert.deepEqual(errors, []);
    await context.close();
});

test('Connect & Fetch Database has a live handler and answers a missing-credentials click', async () => {
    const { page, context, dialogs } = await openSettings();
    assert.equal(await page.evaluate(() => typeof document.getElementById('btn-connect-git')?.onclick), 'function');
    await page.fill('#git-token', '');
    await page.fill('#git-repo', '');
    await page.click('#btn-connect-git');
    await page.waitForTimeout(300);
    assert.deepEqual(dialogs, ['Please populate both Token and Repository target strings.']);
    await context.close();
});

test('Connect & Fetch Database reports success and failure visibly (mocked GitHub, fake token)', async () => {
    const links = Buffer.from(JSON.stringify({ Alpha: ['https://a.example/1'] }), 'utf8').toString('base64');
    const ok = await openSettings({
        github: (route, url) => {
            if (url.endsWith('/links-index.json')) return route.fulfill({ status: 404, body: '{}' });
            if (url.endsWith('/links.json')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sha: 's', content: links }) });
            return route.fulfill({ status: 404, body: '{}' });
        },
    });
    await ok.page.fill('#git-token', 'FAKE_TOKEN_FOR_TEST');
    await ok.page.fill('#git-repo', 'owner/repo');
    await ok.page.click('#btn-connect-git');
    await ok.page.waitForTimeout(600);
    assert.deepEqual(ok.dialogs, ['Database synchronized successfully! Directory pools populated.']);
    await ok.context.close();

    const bad = await openSettings({ github: (route) => route.fulfill({ status: 401, contentType: 'application/json', body: '{"message":"Bad credentials"}' }) });
    await bad.page.fill('#git-token', 'FAKE_TOKEN_FOR_TEST');
    await bad.page.fill('#git-repo', 'owner/repo');
    await bad.page.click('#btn-connect-git');
    await bad.page.waitForTimeout(600);
    assert.equal(bad.dialogs.length, 1);
    assert.match(bad.dialogs[0], /^Sync Error: /);
    await bad.context.close();
});

test('Hotswap Settings renders the HOTSWAP_ACTIONS registry, including Fill Panel', async () => {
    const { page, context } = await openSettings();
    const result = await page.evaluate(async () => {
        const { HOTSWAP_ACTIONS } = await import('./js/launch.js');
        const rows = [...document.querySelectorAll('.hotswap-toggle-row')].map((row) => row.textContent.replace(/\s+/g, ' ').trim());
        return { keys: HOTSWAP_ACTIONS.map((action) => action.key), rows };
    });
    assert.ok(result.keys.includes('fillPanel'), 'fillPanel is in the action registry');
    assert.ok(result.rows.length >= result.keys.length, 'one settings row per action (at least)');
    assert.ok(result.rows.some((text) => /Fill Panel/.test(text)), 'Fill Panel appears in the Settings action lists');
    await context.close();
});
