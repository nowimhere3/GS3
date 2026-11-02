import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const ORIGIN = 'http://127.0.0.1:4210';
const STUB = 'http://localhost:4210/test/fixtures/gallery-capability-stub.html'; // cross-origin to ORIGIN
const KEY = 'multi_heart_shortcuts';
let server, browser;
before(async () => {
    server = spawn(process.platform === 'win32' ? 'python' : 'python3',
        ['-m', 'http.server', '4210', '--bind', '127.0.0.1'], { stdio: 'ignore' });
    const deadline = Date.now() + 5000;
    while (true) {
        try { const r = await fetch(ORIGIN); await r.arrayBuffer(); if (r.ok) break; } catch {}
        if (Date.now() > deadline) throw new Error('test server unavailable');
        await new Promise(r => setTimeout(r, 50));
    }
    browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); server?.kill(); });

async function newContext() {
    const context = await browser.newContext();
    await context.route(/^https?:\/\/(?!127\.0\.0\.1:4210|localhost:4210).*/, r => r.fulfill({ status: 204, body: '' }));
    return context;
}

async function openRuntime(context, urls, preset) {
    const page = await context.newPage();
    page.setDefaultTimeout(6000);
    await page.addInitScript(({ list, preset, key }) => {
        if (window !== top) return;
        localStorage.setItem('loop_matrix_urls', JSON.stringify(list));
        localStorage.setItem('triple_screen_layout', '4grid'); // 4 physical Positions
        if (preset) localStorage.setItem(key, preset);
    }, { list: urls.map((u, i) => u ? STUB + u : '/test/fixtures/canary.html?id=plain' + i), preset, key: KEY });
    await page.goto(ORIGIN + '/index3.html?workspace=live', { waitUntil: 'networkidle' });
    await page.evaluate(async () => {
        window.gallery = await import('./js/gallery-favorite-bridge.js');
        window.launch = await import('./js/launch.js');
        window.panels = [...document.querySelectorAll('.stream-panel')];
        window.shortcutEvents = [];
        document.addEventListener(gallery.GALLERY_SHORTCUT_KEY, e => shortcutEvents.push({ code: e.detail.code, panel: e.detail.panel }));
    });
    return page;
}
const ready = (page, count) => page.waitForFunction(n => panels.slice(0, n).every(p => gallery.getGalleryFavoriteState(p)), count);
const frameFor = (page, id) => page.frames().find(f => f.url().includes('id=' + id));
const counts = page => Promise.all(['A', 'B', 'C', 'D'].map(id => frameFor(page, id).evaluate(() => commands.length)));
// 4grid Position order is TL, TR, BR, BL, so slot order is A, B, D, C: Gallery A/B/C/D sits in Position 1/2/3/4.
const four = ['?state=unfav&kf=1&id=A', '?state=unfav&kf=1&id=B', '?state=unfav&kf=1&id=D', '?state=unfav&kf=1&id=C'];
const heartText = page => page.evaluate(() => [...document.querySelectorAll('#master-hearts-body button')].map(b => b.textContent));
const settle = page => page.waitForTimeout(250);
const swap = page => page.evaluate(async () => {
    (await import('./js/grid-session.js')).setSessionArrangement(['screen3', 'screen2', 'screen1', 'screen4']);
});
/** Child fixture forwards key intent through its own sender helper. */
const forward = (page, id, code, generation) => frameFor(page, id).evaluate(([c, g]) => sendKey(c, g), [code, generation]);
const setPreset = async (context, preset) => {
    const settings = await context.newPage();
    await settings.goto(ORIGIN + '/settings.html', { waitUntil: 'networkidle' });
    await settings.locator(`[data-preset="${preset}"]`).click();
    await settings.close();
};

// ── Bridge acceptance ────────────────────────────────────────────────────────

test('bridge: SHORTCUT_KEY needs a live, capable, keyForward Panel with matching source/origin/generation/code; one event per accept', async () => {
    const context = await newContext();
    const page = await openRuntime(context, ['?auto=1&kf=1&id=A', '?auto=1&kf=1&id=B', '', ''], 'numbers');
    try {
        await page.waitForFunction(() => gallery.getGalleryFavoriteCapability(panels[0])?.features.includes('keyForward')
            && gallery.getGalleryFavoriteCapability(panels[1])?.features.includes('keyForward'));
        const send = (extra = {}, over = {}) => page.evaluate(({ extra, over }) => {
            const pick = over.source === 'other' ? panels[1].querySelector('iframe').contentWindow
                : over.source === 'window' ? window : panels[0].querySelector('iframe').contentWindow;
            return gallery.handleGalleryFavoriteMessage({
                source: pick, origin: over.origin || 'http://localhost:4210',
                data: { source: 'gs3-capability-bridge', version: 1, type: 'SHORTCUT_KEY', capability: 'GALLERY_FAVORITE',
                    generation: over.generation || gallery.getGalleryFavoriteCapability(panels[0]).generation, code: 'Digit1', ...extra },
            });
        }, { extra, over });
        const events = () => page.evaluate(() => shortcutEvents.length);

        // A. valid, K. exactly one canonical event carrying only {panel, code}.
        assert.equal(await send(), true);
        assert.equal(await events(), 1);
        assert.deepEqual(await page.evaluate(() => ({ code: shortcutEvents[0].code, isPanel0: shortcutEvents[0].panel === panels[0] })), { code: 'Digit1', isPanel0: true });
        for (const code of ['Digit2', 'Digit3', 'Digit4', 'KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyM', 'Comma', 'Period', 'Slash']) assert.equal(await send({ code }), true);
        assert.equal(await events(), 12);

        // D/F/G/I/J rejections never emit.
        assert.equal(await send({}, { generation: 'stale' }), false);
        assert.equal(await send({}, { source: 'window' }), false);                      // not a Panel iframe
        assert.equal(await send({}, { source: 'other' }), false);                       // other Panel's window + this generation
        assert.equal(await send({}, { origin: 'https://evil.example' }), false);
        assert.equal(await send({}, { origin: 'null' }), false);
        assert.equal(await send({ source: 'nope' }), false);
        assert.equal(await send({ version: 2 }), false);
        assert.equal(await send({ type: 'SHORTCUT' }), false);
        assert.equal(await send({ capability: 'FILL_PANEL' }), false);
        assert.equal(await send({ generation: 7 }), false);
        for (const code of ['Digit5', 'Digit0', 'KeyA', 'KeyB', 'Enter', 'Escape', '', 'digit1', 'Digit1 ', '1', 'z', 'Numpad1', '__proto__', 'constructor', 5, null, undefined, ['Digit1'], { code: 'Digit1' }]) {
            assert.equal(await send({ code }), false, 'code ' + JSON.stringify(code));
        }
        assert.equal(await events(), 12);

        // Sender Panel 1 with Panel 0's generation is refused, and the reverse.
        assert.equal(await send({}, { source: 'other', generation: await page.evaluate(() => gallery.getGalleryFavoriteCapability(panels[0]).generation) }), false);
        assert.equal(await events(), 12);

        // B. keyForward feature removal stops acceptance; restoring it resumes.
        await frameFor(page, 'A').evaluate(() => report(['favoriteCurrent']));
        await page.waitForFunction(() => !gallery.getGalleryFavoriteCapability(panels[0]).features.includes('keyForward'));
        assert.equal(await send(), false);
        await frameFor(page, 'A').evaluate(() => report(['favoriteCurrent', 'keyForward']));
        await page.waitForFunction(() => gallery.getGalleryFavoriteCapability(panels[0]).features.includes('keyForward'));
        assert.equal(await send(), true);
        assert.equal(await events(), 13);

        // E. reset: the old generation is refused, a fresh handshake re-enables.
        const old = await page.evaluate(() => gallery.getGalleryFavoriteCapability(panels[0]).generation);
        await page.evaluate(() => gallery.resetGalleryFavoriteCapability(panels[0], { acceptingReports: true }));
        assert.equal(await send({}, { generation: old }), false);
        await page.waitForFunction(() => gallery.getGalleryFavoriteCapability(panels[0]).capable);
        assert.equal(await send({}, { generation: old }), false);
        assert.equal(await send(), true);
        assert.equal(await events(), 14);

        // H. unregistered, then detached.
        const live = await page.evaluate(() => gallery.getGalleryFavoriteCapability(panels[0]).generation);
        await page.evaluate(() => gallery.unregisterGalleryFavoriteCapability(panels[0]));
        assert.equal(await send({}, { generation: live }), false);
        await page.evaluate(() => panels[1].remove());
        assert.equal(await page.evaluate(() => gallery.handleGalleryFavoriteMessage({
            source: window, origin: 'http://localhost:4210',
            data: { source: 'gs3-capability-bridge', version: 1, type: 'SHORTCUT_KEY', capability: 'GALLERY_FAVORITE', generation: 'x', code: 'Digit1' },
        })), false);
        assert.equal(await events(), 14);
    } finally { await context.close(); }
});

test('bridge: favoriteCurrent / favoriteState without keyForward cannot inject shortcut intent (older Gallery builds keep working)', async () => {
    const context = await newContext();
    const page = await openRuntime(context, ['?auto=1&id=A', '?state=unfav&id=B', '', ''], 'numbers');
    try {
        await page.waitForFunction(() => gallery.isGalleryFavoriteCapable(panels[0]) && gallery.isGalleryFavoriteCapable(panels[1]));
        assert.deepEqual(await page.evaluate(() => gallery.getGalleryFavoriteCapability(panels[0]).features), ['favoriteCurrent']);
        await forward(page, 'A', 'Digit1');
        await forward(page, 'B', 'Digit1');
        await settle(page);
        assert.equal(await page.evaluate(() => shortcutEvents.length), 0);
        assert.deepEqual([await frameFor(page, 'A').evaluate(() => commands.length), await frameFor(page, 'B').evaluate(() => commands.length)], [0, 0]);
        // Normal action and state still work for them.
        assert.equal(await page.evaluate(() => gallery.getGalleryFavoriteState(panels[1]) !== null), true);
    } finally { await context.close(); }
});

// ── Preset routing, master authority, shared action ─────────────────────────

test('preset routing: Off ignores everything; numbers map Digit1-4 -> Positions 1-4; zxcv map KeyZ/X/C/V; other preset keys are ignored — Gallery never knows the preset', async () => {
    const context = await newContext();
    const page = await openRuntime(context, four);
    try {
        await ready(page, 4);
        const all = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'KeyZ', 'KeyX', 'KeyC', 'KeyV'];
        for (const code of all) await forward(page, 'B', code); // preset untouched = Off
        await settle(page);
        assert.deepEqual(await counts(page), [0, 0, 0, 0]);
        assert.equal(await page.evaluate(() => shortcutEvents.length), 8); // the bridge accepted them; the preset (GS3) decided

        await setPreset(context, 'numbers');
        for (const code of ['KeyZ', 'KeyX', 'KeyC', 'KeyV']) await forward(page, 'B', code);
        await settle(page);
        assert.deepEqual(await counts(page), [0, 0, 0, 0]);
        for (const [i, code] of ['Digit1', 'Digit2', 'Digit3', 'Digit4'].entries()) {
            await forward(page, 'B', code);
            await frameFor(page, 'ABCD'[i]).waitForFunction(() => commands.length === 1);
            assert.deepEqual(await counts(page), [0, 0, 0, 0].map((_, j) => (j <= i ? 1 : 0)), code);
        }

        await setPreset(context, 'zxcv');   // live change, no reload
        const before = await counts(page);
        for (const code of ['Digit1', 'Digit2', 'Digit3', 'Digit4']) await forward(page, 'B', code);
        await settle(page);
        assert.deepEqual(await counts(page), before);
        for (const [i, code] of ['KeyZ', 'KeyX', 'KeyC', 'KeyV'].entries()) {
            await forward(page, 'B', code);
            await frameFor(page, 'ABCD'[i]).waitForFunction(() => commands.length === 2);
        }
        assert.deepEqual(await counts(page), [2, 2, 2, 2]);

        // Native and forwarded paths follow the same live preset.
        await page.keyboard.press('1'); await settle(page);
        assert.deepEqual(await counts(page), [2, 2, 2, 2]);
        await page.keyboard.press('z');
        await frameFor(page, 'A').waitForFunction(() => commands.length === 3);
    } finally { await context.close(); }
});

test('master authority: the SENDER is trust only; the code picks the Position at receipt time (no key->Slot cache), ineligible Positions send nothing', async () => {
    const context = await newContext();
    const page = await openRuntime(context, four, 'numbers');
    try {
        await ready(page, 4);
        // Sender in Position 4 (D) forwards Digit2 -> Position 2 (B), never D.
        await forward(page, 'D', 'Digit2');
        await frameFor(page, 'B').waitForFunction(() => commands.length === 1);
        assert.deepEqual(await counts(page), [0, 1, 0, 0]);
        // Sender in Position 1 (A) forwards Digit1 -> its own Position by the code, not by being the sender.
        await forward(page, 'C', 'Digit1');
        await frameFor(page, 'A').waitForFunction(() => commands.length === 1);
        assert.deepEqual(await counts(page), [1, 1, 0, 0]);

        // Same code, new arrangement: Position 1 now holds D (Position 4 holds A).
        await swap(page);
        await forward(page, 'B', 'Digit1');
        await frameFor(page, 'D').waitForFunction(() => commands.length === 1);
        assert.deepEqual(await counts(page), [1, 1, 0, 1]);
        await forward(page, 'B', 'Digit4');
        await frameFor(page, 'A').waitForFunction(() => commands.length === 2);
        assert.deepEqual(await counts(page), [2, 1, 0, 1]);
    } finally { await context.close(); }
    const context2 = await newContext();
    const page2 = await openRuntime(context2, ['?state=unfav&kf=1&id=A', '', '', ''], 'zxcv');
    try {
        await ready(page2, 1);
        await frameFor(page2, 'A').evaluate(() => sendKey('KeyX')); // Position 2 holds a plain Panel
        await page2.waitForFunction(() => document.querySelector('#master-status').textContent === 'No Gallery favorite action in Position 2');
        await frameFor(page2, 'A').evaluate(() => sendKey('KeyV')); // Position 4: plain Panel too
        await page2.waitForFunction(() => document.querySelector('#master-status').textContent === 'No Gallery favorite action in Position 4');
        await settle(page2);
        assert.equal(await frameFor(page2, 'A').evaluate(() => commands.length), 0);
    } finally { await context2.close(); }
});

test('shared action: forwarded key uses _favoriteAtPosition (shared busy, independent Positions, idempotent) and never writes hearts itself', async () => {
    const context = await newContext();
    const page = await openRuntime(context, ['?state=unfav&kf=1&id=A', '?state=fav&kf=1&id=B', '', ''], 'numbers');
    try {
        await ready(page, 2);
        assert.deepEqual(await heartText(page), ['♡1', '♥2']);
        for (const id of ['A', 'B']) await frameFor(page, id).evaluate(() => { window.holdResults = true; });
        await forward(page, 'B', 'Digit1');
        await frameFor(page, 'A').waitForFunction(() => commands.length === 1);
        await forward(page, 'B', 'Digit1');           // pending: suppressed
        await forward(page, 'A', 'Digit1');
        await forward(page, 'A', 'Digit2');           // independent
        await frameFor(page, 'B').waitForFunction(() => commands.length === 1);
        await settle(page);
        assert.deepEqual([await frameFor(page, 'A').evaluate(() => commands.length), await frameFor(page, 'B').evaluate(() => commands.length)], [1, 1]);

        await frameFor(page, 'A').evaluate(() => reply(commands[0], 'favorited'));
        await frameFor(page, 'B').evaluate(() => reply(commands[0], 'already-favorite'));
        await page.waitForFunction(() => !document.querySelector('#master-hearts-body [aria-busy="true"]'));
        assert.deepEqual(await heartText(page), ['♡1', '♥2']);   // acknowledgement is not truth
        await frameFor(page, 'A').evaluate(() => publishState({ isFavorite: true }));
        await page.waitForFunction(() => document.querySelector('#master-hearts-body [data-position="1"]').textContent === '♥1');
        assert.deepEqual(await heartText(page), ['♥1', '♥2']);   // Gallery state event controls the glyph
        // Idempotent again after release.
        await frameFor(page, 'B').evaluate(() => { window.holdResults = false; });
        await forward(page, 'A', 'Digit2');
        await frameFor(page, 'B').waitForFunction(() => commands.length === 2);
        await settle(page);
        assert.deepEqual(await heartText(page), ['♥1', '♥2']);
    } finally { await context.close(); }
});

test('shared engine: one preset table, one activation path, no synthetic KeyboardEvent, no raw message listener or action code in the consumer', async () => {
    const triple = await readFile('js/triple-mode.js', 'utf8');
    const bridge = await readFile('js/gallery-favorite-bridge.js', 'utf8');
    assert.equal((bridge.match(/addEventListener\('message'/g) || []).length, 1);          // L. no duplicate protocol listener
    assert.doesNotMatch(triple, /'SHORTCUT_KEY'/);                                         // the host UI never parses the wire protocol
    assert.doesNotMatch(triple, /new KeyboardEvent|dispatchEvent\(\s*new KeyboardEvent/);   // AE
    const native = triple.slice(triple.indexOf('function _onMultiHeartKeydown'), triple.indexOf('function _onForwardedShortcutKey'));
    const forwarded = triple.slice(triple.indexOf('function _onForwardedShortcutKey'), triple.indexOf('async function _favoriteAtPosition'));
    assert.match(native, /_activateMultiHeartShortcutCode\(event\.code/);                  // AC
    assert.match(forwarded, /_activateMultiHeartShortcutCode\(event\.detail\.code\)/);
    assert.doesNotMatch(forwarded, /postMessage|requestGalleryFavoriteCurrent|Store\.|_favoriteAtPosition|new Map|new WeakMap/); // AJ AK
    const activate = triple.slice(triple.indexOf('function _activateMultiHeartShortcutCode'), triple.indexOf('function _onMultiHeartKeydown'));
    assert.match(activate, /resolveMultiHeartShortcutCode\(code/);
    assert.match(activate, /_heartPanel\(position\)/);                                     // resolved at receipt time
    assert.match(activate, /_favoriteAtPosition\(position\)/);                             // AI
    assert.doesNotMatch(activate, /postMessage|requestGalleryFavoriteCurrent|new Map|new WeakMap/);
    assert.equal((triple.match(/addEventListener\(\s*GALLERY_SHORTCUT_KEY/g) || []).length, 1);
    // AD. the key table lives in exactly one module.
    const holders = [];
    for (const file of await readdir('js')) {
        if (file.endsWith('.js') && /Digit1|KeyZ/.test(await readFile('js/' + file, 'utf8'))) holders.push(file);
    }
    assert.deepEqual(holders, ['multiheart-shortcuts.js']);
});

// ── End to end ───────────────────────────────────────────────────────────────

test('end to end: handshake with keyForward, Numbers -> Digit1 hits Position 1; live ZXCV ignores Digit1, KeyZ hits Position 1; swap retargets; stale generation refused', async () => {
    const context = await newContext();
    const page = await openRuntime(context, four, 'numbers');
    try {
        await ready(page, 4);
        assert.deepEqual(await page.evaluate(() => gallery.getGalleryFavoriteCapability(panels[0]).features), ['favoriteCurrent', 'favoriteState', 'keyForward']);

        await forward(page, 'C', 'Digit1');
        await frameFor(page, 'A').waitForFunction(() => commands.length === 1);
        await settle(page);
        assert.deepEqual(await counts(page), [1, 0, 0, 0]);   // exactly one request

        await forward(page, 'C', 'Digit1', 'stale-generation'); // stale generation
        await settle(page);
        assert.deepEqual(await counts(page), [1, 0, 0, 0]);

        await setPreset(context, 'zxcv');
        await forward(page, 'C', 'Digit1');
        await settle(page);
        assert.deepEqual(await counts(page), [1, 0, 0, 0]);   // no action
        await forward(page, 'C', 'KeyZ');
        await frameFor(page, 'A').waitForFunction(() => commands.length === 2);
        assert.deepEqual(await counts(page), [2, 0, 0, 0]);

        await swap(page);                                     // Position 1 is now D
        await forward(page, 'C', 'KeyZ');
        await frameFor(page, 'D').waitForFunction(() => commands.length === 1);
        assert.deepEqual(await counts(page), [2, 0, 0, 1]);

        // A reloaded Gallery has a new generation: the old one is refused.
        const old = await page.evaluate(() => gallery.getGalleryFavoriteCapability(panels[1]).generation);
        await page.evaluate(() => gallery.resetGalleryFavoriteCapability(panels[1], { acceptingReports: true }));
        await forward(page, 'B', 'KeyX', old);
        await settle(page);
        assert.equal(await frameFor(page, 'B').evaluate(() => commands.length), 0);
    } finally { await context.close(); }
});

test('end to end with real keystrokes: focus inside a Gallery iframe, its own keydown listener forwards, GS3 targets by the key (not the focused iframe); no double fire', async () => {
    const context = await newContext();
    const page = await openRuntime(context, four, 'numbers');
    try {
        await ready(page, 4);
        await page.evaluate(() => {
            window.__parentKeys = [];
            document.addEventListener('keydown', e => window.__parentKeys.push(e.code), true);
        });
        // Focus inside Position 4's Gallery (id D) — a genuine browser focus, then genuine keystrokes.
        await page.evaluate(() => panels[2].querySelector('iframe').focus());
        await frameFor(page, 'D').evaluate(() => { document.body.tabIndex = 0; document.body.focus(); });
        assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'IFRAME');

        await page.keyboard.press('1');                       // Numbers: Position 1 = Gallery A
        await frameFor(page, 'A').waitForFunction(() => commands.length === 1);
        await settle(page);
        assert.deepEqual(await counts(page), [1, 0, 0, 0]);   // exactly one; not the focused D
        assert.deepEqual(await page.evaluate(() => __parentKeys), []); // parent never saw the native key: no second path

        await page.keyboard.press('4');
        await frameFor(page, 'D').waitForFunction(() => commands.length === 1);
        await page.keyboard.press('z');                       // not this preset's key
        await page.keyboard.press('Control+1');               // child-side filter
        await page.keyboard.down('2'); await page.keyboard.down('2'); await page.keyboard.up('2'); // repeat filtered child-side
        await frameFor(page, 'B').waitForFunction(() => commands.length === 1);
        await settle(page);
        assert.deepEqual(await counts(page), [1, 1, 0, 1]);

        // Back to the parent shell: native keys still work and the two paths don't both fire.
        await page.evaluate(() => { document.activeElement.blur(); window.focus(); });
        await page.locator('#btn-toggle-master').focus();
        await page.keyboard.press('3');
        await frameFor(page, 'C').waitForFunction(() => commands.length === 1);
        await settle(page);
        assert.deepEqual(await counts(page), [1, 1, 1, 1]);
    } finally { await context.close(); }
});

test('M , . / preset (forwarded): KeyM/Comma/Period/Slash hit Positions 1-4 by the code, sender is trust only, swap retargets, other presets and Off ignore them', async () => {
    const context = await newContext();
    const page = await openRuntime(context, four, 'mpunct');
    try {
        await ready(page, 4);
        const codes = ['KeyM', 'Comma', 'Period', 'Slash'];
        for (const [i, code] of codes.entries()) {
            await forward(page, 'D', code); // sender is always the Position 4 Gallery
            await frameFor(page, 'ABCD'[i]).waitForFunction(() => commands.length === 1);
        }
        assert.deepEqual(await counts(page), [1, 1, 1, 1]);
        for (const code of ['Digit1', 'Digit2', 'KeyZ', 'KeyX']) await forward(page, 'B', code); // other presets' codes
        await settle(page);
        assert.deepEqual(await counts(page), [1, 1, 1, 1]);

        await forward(page, 'D', 'KeyM');   // sender at Position 4 -> Position 1 (A), never D
        await frameFor(page, 'A').waitForFunction(() => commands.length === 2);
        assert.deepEqual(await counts(page), [2, 1, 1, 1]);

        await swap(page);                   // Position 1 now D, Position 4 now A
        await forward(page, 'B', 'KeyM');
        await frameFor(page, 'D').waitForFunction(() => commands.length === 2);
        await forward(page, 'B', 'Slash');
        await frameFor(page, 'A').waitForFunction(() => commands.length === 3);
        assert.deepEqual(await counts(page), [3, 1, 1, 2]);

        await forward(page, 'B', 'KeyM', 'stale-generation'); // stale generation refused
        await settle(page);
        assert.deepEqual(await counts(page), [3, 1, 1, 2]);

        await setPreset(context, 'numbers');
        for (const code of codes) await forward(page, 'B', code);
        await setPreset(context, 'zxcv');
        for (const code of codes) await forward(page, 'B', code);
        await setPreset(context, 'off');
        for (const code of codes) await forward(page, 'B', code);
        await settle(page);
        assert.deepEqual(await counts(page), [3, 1, 1, 2]);
    } finally { await context.close(); }
});

test('M , . / real keystrokes: focused Gallery iframe forwards m , . /; focus in Position 4 still targets Position 1; swap retargets; Off stops; no parent double-fire', async () => {
    const context = await newContext();
    const page = await openRuntime(context, four, 'mpunct');
    try {
        await ready(page, 4);
        await page.evaluate(() => { window.__parentKeys = []; document.addEventListener('keydown', e => window.__parentKeys.push(e.code), true); });
        const focusGallery = async (index, id) => {
            await page.evaluate(i => panels[i].querySelector('iframe').focus(), index);
            await frameFor(page, id).evaluate(() => { document.body.tabIndex = 0; document.body.focus(); });
            assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'IFRAME');
        };
        await focusGallery(0, 'A');           // focus inside Position 1's Gallery
        for (const [i, key] of ['m', ',', '.', '/'].entries()) {
            await page.keyboard.press(key);
            await frameFor(page, 'ABCD'[i]).waitForFunction(() => commands.length === 1);
            await settle(page);
            assert.deepEqual(await counts(page), [0, 0, 0, 0].map((_, j) => (j <= i ? 1 : 0)), key);
        }
        await focusGallery(2, 'D');           // slot 2 = Position 4's Gallery
        await page.keyboard.press('m');
        await frameFor(page, 'A').waitForFunction(() => commands.length === 2);
        await settle(page);
        assert.deepEqual(await counts(page), [2, 1, 1, 1]);      // Position 1, not the focused D

        await swap(page);
        await focusGallery(2, 'D');
        await page.keyboard.press('m');
        await frameFor(page, 'D').waitForFunction(() => commands.length === 2);   // NEW occupant of Position 1
        await settle(page);
        assert.deepEqual(await counts(page), [2, 1, 1, 2]);

        await setPreset(context, 'off');
        await page.keyboard.press('m');
        await settle(page);
        assert.deepEqual(await counts(page), [2, 1, 1, 2]);
        assert.deepEqual(await page.evaluate(() => __parentKeys), []); // parent never saw the iframe's native keys
    } finally { await context.close(); }
});
