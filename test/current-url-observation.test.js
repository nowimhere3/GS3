import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const PORT = 4195;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const CANARY = `${ORIGIN}/test/fixtures/canary.html`;
let server;
let browser;

// The GS3 Live URL Reporter userscript lives in its own project. By default the
// end-to-end test runs this contract-faithful stand-in; point
// GS3_LIVE_URL_REPORTER at the real .user.js to prove against it instead.
const REPORTER_STAND_IN = `(() => {
    if (window.parent === window) return;
    const base = { source: 'gs3-capability-bridge', version: 1, capability: 'CURRENT_URL' };
    const documentId = crypto.getRandomValues(new Uint32Array(3)).join('-');
    let seq = 0;
    let last = null;
    const post = (message) => parent.postMessage({ ...base, ...message }, '*');
    const report = (force) => {
        const url = location.href;
        if (!force && url === last) return;
        last = url;
        seq += 1;
        post({ type: 'CURRENT_URL', url, at: Date.now(), documentId, seq });
    };
    for (const name of ['pushState', 'replaceState']) {
        const original = history[name];
        history[name] = function () { const result = original.apply(this, arguments); report(false); return result; };
    }
    addEventListener('popstate', () => report(false));
    addEventListener('hashchange', () => report(false));
    addEventListener('message', (event) => {
        const data = event.data;
        if (event.source !== parent || data?.source !== base.source || data.version !== 1
            || data.capability !== 'CURRENT_URL') return;
        if (data.type === 'QUERY_CAPABILITY') post({ type: 'CAPABILITY_PRESENT' });
        if (data.type === 'QUERY_CAPABILITY' || data.type === 'QUERY_CURRENT_URL') report(true);
    });
    post({ type: 'CAPABILITY_PRESENT' });
    report(true);
})();`;

function startServer(port) {
    const child = spawn(process.platform === 'win32' ? 'python' : 'python3',
        ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: process.cwd(), stdio: 'ignore' });
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
    browser = await chromium.launch({ headless: true });
});

after(async () => {
    await browser?.close();
    server?.kill();
});

async function bootGrid({ reporter = false } = {}) {
    const page = await browser.newPage();
    page.setDefaultTimeout(7000);
    page.__errors = [];
    page.on('pageerror', (error) => page.__errors.push(String(error)));
    await page.addInitScript(() => {
        if (window !== window.top) return;
        localStorage.clear();
        localStorage.setItem('loop_matrix_urls', JSON.stringify([
            '/test/fixtures/canary.html?id=A',
            '/test/fixtures/canary.html?id=P2',
            '/test/fixtures/canary.html?id=P3',
        ]));
    });
    // Every child records what GS3 sends it on the capability bridge.
    await page.addInitScript(() => {
        if (window === window.top) return;
        window.__bridgeInbox = [];
        addEventListener('message', (event) => {
            if (event.data?.source === 'gs3-capability-bridge') window.__bridgeInbox.push(event.data);
        });
    });
    if (reporter) {
        const path = process.env.GS3_LIVE_URL_REPORTER;
        await page.addInitScript({ content: path ? await readFile(path, 'utf8') : REPORTER_STAND_IN });
    }
    await page.goto(`${ORIGIN}/index3.html?workspace=live`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelectorAll('.stream-panel iframe').length === 4);
    await page.evaluate(async () => { window.__obs = await import('./js/current-url-observation.js'); });
    await waitFor(page, 0, (o) => o.accepting);
    await waitFor(page, 1, (o) => o.accepting);
    return page;
}

const panelSelector = (slot) => `.stream-panel[data-slot-index="${slot}"]`;

function observe(page, slot = 0) {
    return page.evaluate((selector) => window.__obs.getCurrentUrlObservation(document.querySelector(selector)),
        panelSelector(slot));
}

async function waitFor(page, slot, predicate) {
    const deadline = Date.now() + 5000;
    let last;
    while (Date.now() < deadline) {
        last = await page.evaluate((selector) => window.__obs
            ?.getCurrentUrlObservation(document.querySelector(selector)), panelSelector(slot));
        if (last && predicate(last)) return last;
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`observation never satisfied predicate: ${JSON.stringify(last)}`);
}

async function frameOf(page, slot = 0) {
    return (await page.locator(`${panelSelector(slot)} iframe`).elementHandle()).contentFrame();
}

function report(url, documentId, seq, extra = {}) {
    return {
        source: 'gs3-capability-bridge', version: 1, type: 'CURRENT_URL', capability: 'CURRENT_URL',
        url, at: Date.now(), documentId, seq, ...extra,
    };
}

async function postFrom(frame, message) {
    await frame.evaluate((payload) => parent.postMessage(payload, '*'), message);
    await new Promise((resolve) => setTimeout(resolve, 40));
}

/** A GS3 assignment through the real Edit URL path (Runtime Session + iframe). */
async function assign(page, slot, url) {
    await page.evaluate(({ selector, url }) => {
        const input = document.querySelector(`${selector} .hotswap-input`);
        input.value = url;
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    }, { selector: panelSelector(slot), url });
}

async function snapshotCanonical(page) {
    return page.evaluate(async () => {
        const session = await import('./js/grid-session.js');
        return {
            storage: JSON.stringify(Object.fromEntries(Object.entries(localStorage).sort())),
            panels: JSON.stringify(session.getSessionPanels()),
            urls: [...session.getSessionUrls()],
        };
    });
}

test('assignedUrl and observedCurrentUrl stay separate across drift, reassignment, stale reports and Refresh', async () => {
    const page = await bootGrid();
    try {
        const frameA = await frameOf(page);
        // 1. Landing A is not drift.
        await postFrom(frameA, report(`${CANARY}?id=A`, 'docA', 1));
        let o = await observe(page);
        assert.equal(o.assignedUrl, '/test/fixtures/canary.html?id=A');
        assert.equal(o.observedCurrentUrl, null);
        assert.equal(o.documentId, 'docA');
        const generationA = o.generation;

        // 2-3. Drift A -> B -> C inside the same live document.
        await postFrom(frameA, report(`${CANARY}?id=B`, 'docA', 2));
        assert.equal((await observe(page)).observedCurrentUrl, `${CANARY}?id=B`);
        await postFrom(frameA, report(`${CANARY}?id=C`, 'docA', 3));
        o = await observe(page);
        assert.equal(o.observedCurrentUrl, `${CANARY}?id=C`);
        assert.equal(o.assignedUrl, '/test/fixtures/canary.html?id=A', 'observation never mutates the assignment');

        // 4-5. New GS3 assignment D: observation is void at once, and a late
        // report from the old document — even with a higher seq — is refused,
        // both before and after the new document loads.
        const staleBeforeLoad = await page.evaluate(({ selector, stale }) => {
            const panel = document.querySelector(selector);
            const oldWindow = panel.querySelector('iframe').contentWindow;
            const input = panel.querySelector('.hotswap-input');
            input.value = '/test/fixtures/canary.html?id=D';
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
            const accepted = window.__obs.handleCurrentUrlMessage({ data: stale, source: oldWindow });
            return { accepted, observation: window.__obs.getCurrentUrlObservation(panel) };
        }, { selector: panelSelector(0), stale: report(`${CANARY}?id=C`, 'docA', 99) });
        assert.equal(staleBeforeLoad.accepted, false);
        assert.equal(staleBeforeLoad.observation.assignedUrl, '/test/fixtures/canary.html?id=D');
        assert.equal(staleBeforeLoad.observation.observedCurrentUrl, null);
        assert.ok(staleBeforeLoad.observation.generation > generationA);

        await waitFor(page, 0, (x) => x.accepting && x.generation > generationA);
        const frameD = await frameOf(page);
        await postFrom(frameD, report(`${CANARY}?id=B`, 'docA', 100));
        o = await observe(page);
        assert.equal(o.observedCurrentUrl, null, 'retired old-generation document cannot contaminate D');
        assert.equal(o.documentId, null);

        // 6. Landing D is not drift.
        await postFrom(frameD, report(`${CANARY}?id=D`, 'docD', 1));
        o = await observe(page);
        assert.equal(o.observedCurrentUrl, null);
        assert.equal(o.documentId, 'docD');

        // 7. Drift D -> E.
        await postFrom(frameD, report(`${CANARY}?id=E`, 'docD', 2));
        o = await observe(page);
        assert.equal(o.observedCurrentUrl, `${CANARY}?id=E`);
        assert.equal(o.assignedUrl, '/test/fixtures/canary.html?id=D');

        // 9. Save / serialization still carry D, never E.
        const canonical = await snapshotCanonical(page);
        assert.equal(canonical.urls[0], '/test/fixtures/canary.html?id=D');
        assert.ok(canonical.panels.includes('id=D'));
        for (const surface of [canonical.storage, canonical.panels, JSON.stringify(canonical.urls)]) {
            assert.ok(!surface.includes('id=E'), 'observedCurrentUrl never reaches persisted or session state');
        }

        // 8. Refresh reloads the ASSIGNED URL and clears the observation.
        const generationD = o.generation;
        await page.locator(`${panelSelector(0)} .btn-hotswap-reload`).evaluate((button) => button.click());
        o = await observe(page);
        assert.equal(o.observedCurrentUrl, null);
        assert.equal(o.accepting, false);
        o = await waitFor(page, 0, (x) => x.accepting && x.generation > generationD);
        const reloaded = await frameOf(page);
        assert.equal(reloaded.url(), `${CANARY}?id=D`);
        assert.equal(o.assignedUrl, '/test/fixtures/canary.html?id=D');
        assert.equal(o.observedCurrentUrl, null);
        assert.deepEqual(page.__errors, []);
    } finally { await page.close(); }
});

test('within one generation a superseded document and a regressing seq are refused', async () => {
    const page = await bootGrid();
    try {
        const frame = await frameOf(page);
        await postFrom(frame, report(`${CANARY}?id=X1`, 'docX', 5));
        await postFrom(frame, report(`${CANARY}?id=X0`, 'docX', 4));
        assert.equal((await observe(page)).observedCurrentUrl, `${CANARY}?id=X1`, 'seq only moves forward');
        await postFrom(frame, report(`${CANARY}?id=X1`, 'docX', 5));
        assert.equal((await observe(page)).seq, 5);

        await postFrom(frame, report(`${CANARY}?id=Y1`, 'docY', 1));
        await postFrom(frame, report(`${CANARY}?id=X9`, 'docX', 50));
        const o = await observe(page);
        assert.equal(o.observedCurrentUrl, `${CANARY}?id=Y1`, 'a higher seq from a superseded document never wins');
        assert.equal(o.documentId, 'docY');
    } finally { await page.close(); }
});

test('panel observations are isolated by reporting window, and Fill state is untouched', async () => {
    const page = await bootGrid();
    try {
        const fillBefore = await page.evaluate(async () => {
            const capability = await import('./js/capability-bridge.js');
            return [0, 1].map((slot) => capability.getFillPanelCapabilityState(
                document.querySelector(`.stream-panel[data-slot-index="${slot}"]`)));
        });
        await postFrom(await frameOf(page, 0), report(`${CANARY}?id=panel1-drift`, 'p1', 1));
        assert.equal((await observe(page, 0)).observedCurrentUrl, `${CANARY}?id=panel1-drift`);
        assert.equal((await observe(page, 1)).observedCurrentUrl, null);

        // Panel 2 reporting Panel 1's assigned URL is drift for Panel 2, not a landing for Panel 1.
        await postFrom(await frameOf(page, 1), report(`${CANARY}?id=A`, 'p2', 1));
        assert.equal((await observe(page, 1)).observedCurrentUrl, `${CANARY}?id=A`);
        assert.equal((await observe(page, 0)).observedCurrentUrl, `${CANARY}?id=panel1-drift`);
        assert.equal((await observe(page, 0)).documentId, 'p1');

        const fillAfter = await page.evaluate(async () => {
            const capability = await import('./js/capability-bridge.js');
            return [0, 1].map((slot) => capability.getFillPanelCapabilityState(
                document.querySelector(`.stream-panel[data-slot-index="${slot}"]`)));
        });
        assert.deepEqual(fillAfter, fillBefore);
    } finally { await page.close(); }
});

test('malformed, foreign and non-panel messages are ignored', async () => {
    const page = await bootGrid();
    try {
        const frame = await frameOf(page);
        await postFrom(frame, report(`${CANARY}?id=baseline`, 'good', 1));
        const before = await observe(page);
        for (const bad of [
            null,
            'CURRENT_URL',
            [report(`${CANARY}?id=bad`, 'good', 2)],
            report(`${CANARY}?id=bad`, 'good', 2, { source: 'other' }),
            report(`${CANARY}?id=bad`, 'good', 2, { version: 2 }),
            report(`${CANARY}?id=bad`, 'good', 2, { capability: 'FILL_PANEL' }),
            report(`${CANARY}?id=bad`, 'good', 2, { type: 'NAVIGATE' }),
            report(`${CANARY}?id=bad`, 'good', 2, { type: 'SET_ASSIGNED_URL' }),
            report(42, 'good', 2),
            report('javascript:alert(1)', 'good', 2),
            report('not a url', 'good', 2),
            report(`${CANARY}?id=bad`, '', 2),
            report(`${CANARY}?id=bad`, 'good', 0),
            report(`${CANARY}?id=bad`, 'good', 2.5),
            report(`${CANARY}?id=bad`, 'good', '3'),
            report(`${CANARY}?id=${'x'.repeat(9000)}`, 'good', 2),
        ]) await postFrom(frame, bad);
        assert.deepEqual(await observe(page), before);

        await page.evaluate(() => {
            const outsider = document.createElement('iframe');
            outsider.id = 'outsider';
            outsider.src = '/test/fixtures/canary.html?id=outsider';
            document.body.append(outsider);
        });
        await page.locator('#outsider').waitFor();
        await page.waitForFunction(() => document.querySelector('#outsider').contentDocument?.readyState === 'complete');
        const outsider = await (await page.locator('#outsider').elementHandle()).contentFrame();
        await postFrom(outsider, report(`${CANARY}?id=outsider-drift`, 'good', 3));
        assert.deepEqual(await observe(page), before);
        assert.deepEqual(page.__errors, []);
    } finally { await page.close(); }
});

test('without any reporter GS3 runs normally and observation stays null', async () => {
    const page = await bootGrid();
    try {
        const all = await page.evaluate(() => window.__obs.getCurrentUrlObservations());
        assert.equal(all.length, 4);
        for (const o of all) {
            assert.equal(o.observedCurrentUrl, null);
            assert.equal(o.capable, false);
        }
        const generation = (await observe(page, 1)).generation;
        await assign(page, 1, '/test/fixtures/canary.html?id=Q');
        const o = await waitFor(page, 1, (x) => x.accepting && x.generation > generation);
        assert.equal(o.assignedUrl, '/test/fixtures/canary.html?id=Q');
        assert.equal(o.observedCurrentUrl, null);
        const child = await frameOf(page, 1);
        assert.equal(child.url(), `${CANARY}?id=Q`);
        await new Promise((resolve) => setTimeout(resolve, 100));
        assert.deepEqual(await child.evaluate(() => window.__bridgeInbox), [],
            'a child without a reporter is never messaged');
        assert.deepEqual(page.__errors, []);
    } finally { await page.close(); }
});

test('end to end: live reporter drift A -> B -> C is observed while assignedUrl stays A', async () => {
    const page = await bootGrid({ reporter: true });
    try {
        // Reports sent at document-start precede the settling load and are
        // refused; GS3 then queries the settled document, which answers.
        let o = await waitFor(page, 0, (x) => x.capable && x.documentId);
        assert.equal(o.observedCurrentUrl, null, 'landing page is not drift');
        assert.equal(o.assignedUrl, '/test/fixtures/canary.html?id=A');
        const documentId = o.documentId;

        const frame = await frameOf(page);
        assert.deepEqual(await frame.evaluate(() => window.__bridgeInbox), [{
            source: 'gs3-capability-bridge', version: 1, type: 'QUERY_CAPABILITY', capability: 'CURRENT_URL',
        }], 'exactly one read-only query, sent to the settled document');
        await frame.evaluate(() => history.pushState({}, '', '?id=B'));
        o = await waitFor(page, 0, (x) => x.observedCurrentUrl === `${CANARY}?id=B`);
        await frame.evaluate(() => history.pushState({}, '', '?id=C'));
        o = await waitFor(page, 0, (x) => x.observedCurrentUrl === `${CANARY}?id=C`);
        assert.equal(o.assignedUrl, '/test/fixtures/canary.html?id=A');
        assert.equal(o.documentId, documentId);

        // Full-document navigation inside the Panel: a new document reports itself.
        await frame.evaluate(() => { location.href = '/test/fixtures/canary.html?id=F'; });
        o = await waitFor(page, 0, (x) => x.observedCurrentUrl === `${CANARY}?id=F` && x.documentId !== documentId);
        assert.equal(o.assignedUrl, '/test/fixtures/canary.html?id=A');
        assert.equal((await snapshotCanonical(page)).urls[0], '/test/fixtures/canary.html?id=A');
        assert.deepEqual(page.__errors, []);
    } finally { await page.close(); }
});
