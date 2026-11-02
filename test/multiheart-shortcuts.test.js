import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import {
    resolveMultiHeartShortcutCode, normalizeMultiHeartShortcutPreset, MULTIHEART_SHORTCUT_PRESETS,
} from '../js/multiheart-shortcuts.js';

const ORIGIN = 'http://127.0.0.1:4209';
const STUB = 'http://localhost:4209/test/fixtures/gallery-capability-stub.html'; // cross-origin to ORIGIN
const KEY = 'multi_heart_shortcuts';
let server, browser;
before(async () => {
    server = spawn(process.platform === 'win32' ? 'python' : 'python3',
        ['-m', 'http.server', '4209', '--bind', '127.0.0.1'], { stdio: 'ignore' });
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
    await context.route(/^https?:\/\/(?!127\.0\.0\.1:4209|localhost:4209).*/, r => r.fulfill({ status: 204, body: '' }));
    return context;
}

/** urls: stub query strings for slots 0.. ('' = plain canary). preset: stored value or undefined (= untouched default). */
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
    });
    return page;
}
const ready = (page, count) => page.waitForFunction(n => panels.slice(0, n).every(p => gallery.getGalleryFavoriteState(p)), count);
const frameFor = (page, id) => page.frames().find(f => f.url().includes('id=' + id));
const commandCounts = (page, ids) => Promise.all(ids.map(id => frameFor(page, id).evaluate(() => commands.length)));
// 4grid Position order is TL, TR, BR, BL (positions.js), so slot order is A, B, D, C and
// Gallery id A/B/C/D sits in physical Position 1/2/3/4 at identity.
const four = ['?state=unfav&id=A', '?state=unfav&id=B', '?state=unfav&id=D', '?state=unfav&id=C'];
const heartText = page => page.evaluate(() => [...document.querySelectorAll('#master-hearts-body button')].map(b => b.textContent));
const status = page => page.locator('#master-status').textContent();
const swap = page => page.evaluate(async () => {
    (await import('./js/grid-session.js')).setSessionArrangement(['screen3', 'screen2', 'screen1', 'screen4']);
});
const snapshot = page => page.evaluate(async () => {
    const s = await import('./js/grid-session.js');
    const ls = Object.fromEntries(Object.entries(localStorage).filter(([k]) => k !== 'multi_heart_shortcuts'));
    return JSON.stringify({ ls, history: s.getGridHistory().length, urls: s.getSessionUrls(), layout: s.getSessionLayout() });
});
const settle = page => page.waitForTimeout(250);

// ── Pure engine ──────────────────────────────────────────────────────────────

test('preset table: exactly Off / 1 2 3 4 / Z X C V / M , . /, physical codes, unknown values are Off', () => {
    assert.deepEqual(Object.keys(MULTIHEART_SHORTCUT_PRESETS), ['off', 'numbers', 'zxcv', 'mpunct']);
    assert.deepEqual(MULTIHEART_SHORTCUT_PRESETS.mpunct.keys, ['KeyM', 'Comma', 'Period', 'Slash']);
    assert.equal(MULTIHEART_SHORTCUT_PRESETS.mpunct.label, 'M , . /');
    assert.deepEqual(MULTIHEART_SHORTCUT_PRESETS.numbers.keys, ['Digit1', 'Digit2', 'Digit3', 'Digit4']);
    assert.deepEqual(MULTIHEART_SHORTCUT_PRESETS.zxcv.keys, ['KeyZ', 'KeyX', 'KeyC', 'KeyV']);
    for (const bad of [undefined, null, '', 'NUMBERS', 'custom', 7, '__proto__', 'constructor']) {
        assert.equal(normalizeMultiHeartShortcutPreset(bad), 'off');
    }
    assert.equal(resolveMultiHeartShortcutCode('Digit3', 'off'), null);
    assert.equal(resolveMultiHeartShortcutCode('Digit3', 'bogus'), null);
    assert.equal(resolveMultiHeartShortcutCode('Digit3', 'numbers'), 3);
    assert.equal(resolveMultiHeartShortcutCode('KeyV', 'zxcv'), 4);
    assert.equal(resolveMultiHeartShortcutCode('KeyV', 'numbers'), null);
    ['KeyM', 'Comma', 'Period', 'Slash'].forEach((code, i) => {
        assert.equal(resolveMultiHeartShortcutCode(code, 'mpunct'), i + 1);
        for (const other of ['numbers', 'zxcv', 'off']) assert.equal(resolveMultiHeartShortcutCode(code, other), null);
    });
    for (const code of ['Digit1', 'Digit4', 'KeyZ', 'KeyV']) assert.equal(resolveMultiHeartShortcutCode(code, 'mpunct'), null);
});

// ── Settings ─────────────────────────────────────────────────────────────────

test('Settings: MultiHeart Shortcuts sits under Grid Layout Shortcuts, four exact choices, default Off, persists, canonical Store', async () => {
    const context = await newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(6000);
    try {
        await page.goto(ORIGIN + '/settings.html', { waitUntil: 'networkidle' });
        const card = page.locator('[data-section="multiheart-shortcuts"]');
        assert.match(await card.locator('.section-title').textContent(), /MultiHeart Shortcuts/);
        assert.equal(await card.evaluate(n => n.previousElementSibling?.dataset.section), 'grid-layouts'); // immediately below
        assert.equal(await card.evaluate(n => !!n.closest('[data-section="ghost"]')), false);          // not under Ghost Mode
        const buttons = card.locator('[role="radio"]');
        assert.deepEqual(await buttons.allTextContents(), ['Off', '1 2 3 4', 'Z X C V', 'M , . /']);
        assert.deepEqual(await buttons.evaluateAll(n => n.map(b => b.dataset.preset)), ['off', 'numbers', 'zxcv', 'mpunct']);
        assert.deepEqual(await buttons.evaluateAll(n => n.map(b => b.getAttribute('aria-checked'))), ['true', 'false', 'false', 'false']); // default Off
        assert.equal(await page.evaluate(k => localStorage.getItem(k), KEY), null); // nothing written by merely visiting

        const before = await page.evaluate(k => JSON.stringify(Object.entries(localStorage).filter(([n]) => n !== k && n !== 'settings_section_state')), KEY);
        await buttons.nth(2).click();
        assert.equal(await page.evaluate(k => localStorage.getItem(k), KEY), 'zxcv');
        assert.equal(await page.evaluate(k => JSON.stringify(Object.entries(localStorage).filter(([n]) => n !== k && n !== 'settings_section_state')), KEY), before);
        await page.reload({ waitUntil: 'networkidle' });
        assert.deepEqual(await page.locator('[data-section="multiheart-shortcuts"] [role="radio"]').evaluateAll(n => n.map(b => b.getAttribute('aria-checked'))), ['false', 'false', 'true', 'false']);
        await page.locator('[data-section="multiheart-shortcuts"] [role="radio"]').nth(3).click();
        assert.equal(await page.evaluate(k => localStorage.getItem(k), KEY), 'mpunct');
        await page.reload({ waitUntil: 'networkidle' });
        assert.deepEqual(await page.locator('[data-section="multiheart-shortcuts"] [role="radio"]').evaluateAll(n => n.map(b => b.getAttribute('aria-checked'))), ['false', 'false', 'false', 'true']);
        await page.locator('[data-section="multiheart-shortcuts"] [role="radio"]').nth(1).click();
        assert.equal(await page.evaluate(k => localStorage.getItem(k), KEY), 'numbers');
        await page.locator('[data-section="multiheart-shortcuts"] [role="radio"]').nth(0).click();
        assert.equal(await page.evaluate(k => localStorage.getItem(k), KEY), 'off');
    } finally { await context.close(); }

    const storage = await readFile('js/storage.js', 'utf8');
    assert.match(storage, /multiHeartShortcuts:\s+'multi_heart_shortcuts'/);
    assert.match(storage, /\[KEYS\.multiHeartShortcuts\]: 'off'/);
    const settings = await readFile('js/settings.js', 'utf8');
    assert.match(settings, /Store\.set\('multiHeartShortcuts'/);
    assert.doesNotMatch(settings.slice(settings.indexOf('function _initMultiHeartShortcuts'), settings.indexOf('function _initGhostMode')), /localStorage/);
});

// ── Numbers preset ───────────────────────────────────────────────────────────

test('Numbers preset: 1-4 hit physical Positions 1-4, swap retargets the same key at press time, collapsed surfaces still work', async () => {
    const context = await newContext();
    const page = await openRuntime(context, four, 'numbers');
    try {
        await ready(page, 4);
        // Both heart surfaces stay collapsed/closed: shortcuts act on Runtime truth.
        assert.equal(await page.locator('#master-hearts-body').isVisible(), false);
        assert.equal(await page.locator('#floating-hearts').isVisible(), false);
        const before = await snapshot(page);

        for (const [i, key] of ['1', '2', '3', '4'].entries()) {
            await page.keyboard.press(key);
            await frameFor(page, 'ABCD'[i]).waitForFunction(() => commands.length === 1);
            const counts = await commandCounts(page, ['A', 'B', 'C', 'D']);
            assert.deepEqual(counts, counts.map((_, j) => (j <= i ? 1 : 0)), 'key ' + key);
        }
        await settle(page);

        // The arrangement swap puts Panel D in Position 1 and Panel A in Position 4: the same
        // keys must now reach D and A (resolved at press time, no cached Slot/Panel).
        await swap(page);
        await page.keyboard.press('1');
        await frameFor(page, 'D').waitForFunction(() => commands.length === 2);
        assert.deepEqual(await commandCounts(page, ['A', 'B', 'C', 'D']), [1, 1, 1, 2]);
        await page.keyboard.press('4');
        await frameFor(page, 'A').waitForFunction(() => commands.length === 2);
        assert.deepEqual(await commandCounts(page, ['A', 'B', 'C', 'D']), [2, 1, 1, 2]);

        assert.equal(await snapshot(page), before); // no history/session/layout/storage change
    } finally { await context.close(); }
});

test('ineligible Position: empty/non-Gallery/older Gallery sends nothing and says so; Off does nothing; Settings change applies live', async () => {
    const context = await newContext();
    const page = await openRuntime(context, ['?state=unfav&id=A', '', '?id=OLD', ''], 'numbers'); // OLD: no handshake params -> no capability
    try {
        await ready(page, 1);
        await page.keyboard.press('2'); // non-Gallery Panel
        await page.waitForFunction(() => document.querySelector('#master-status').textContent === 'No Gallery favorite action in Position 2');
        await page.keyboard.press('4'); // Gallery without favoriteCurrent (slot 2 = Position 4)
        await page.waitForFunction(() => document.querySelector('#master-status').textContent === 'No Gallery favorite action in Position 4');
        await page.keyboard.press('3'); // empty/plain Panel
        await page.waitForFunction(() => document.querySelector('#master-status').textContent === 'No Gallery favorite action in Position 3');
        await settle(page);
        assert.deepEqual(await commandCounts(page, ['A', 'OLD']), [0, 0]);
        await page.keyboard.press('1');
        await frameFor(page, 'A').waitForFunction(() => commands.length === 1); // eligible one does go through

        // Change the preset from the Settings page (separate document, same Store key) — no Runtime reload.
        const settings = await context.newPage();
        await settings.goto(ORIGIN + '/settings.html', { waitUntil: 'networkidle' });
        await settings.locator('[data-preset="off"]').click();
        await page.keyboard.press('1');
        await page.keyboard.press('z');
        await settle(page);
        assert.equal(await frameFor(page, 'A').evaluate(() => commands.length), 1); // Off: no activation
        await settings.locator('[data-preset="zxcv"]').click();
        await page.keyboard.press('1');
        await settle(page);
        assert.equal(await frameFor(page, 'A').evaluate(() => commands.length), 1); // old preset no longer fires
        await page.keyboard.press('z');
        await frameFor(page, 'A').waitForFunction(() => commands.length === 2);
    } finally { await context.close(); }
});

test('default is Off: nothing stored, no key activates, numbers and letters stay unclaimed', async () => {
    const context = await newContext();
    const page = await openRuntime(context, four); // preset untouched
    try {
        await ready(page, 4);
        assert.equal(await page.evaluate(k => localStorage.getItem(k), KEY), null);
        for (const key of ['1', '2', '3', '4', 'z', 'x', 'c', 'v']) await page.keyboard.press(key);
        await settle(page);
        assert.deepEqual(await commandCounts(page, ['A', 'B', 'C', 'D']), [0, 0, 0, 0]);
        // Off must not consume keys either.
        await page.evaluate(() => { window.__prevented = []; document.addEventListener('keydown', e => { if (e.code !== 'ControlLeft') window.__prevented.push(e.defaultPrevented); }, false); });
        await page.keyboard.press('1');
        assert.deepEqual(await page.evaluate(() => window.__prevented), [false]);
    } finally { await context.close(); }
});

// ── ZXCV preset + modifiers ──────────────────────────────────────────────────

test('ZXCV preset: Z/X/C/V hit Positions 1-4; Ctrl/Meta/Alt/Shift variants are left alone', async () => {
    const context = await newContext();
    const page = await openRuntime(context, four, 'zxcv');
    try {
        await ready(page, 4);
        for (const mod of ['Control', 'Meta', 'Alt', 'Shift']) {
            for (const letter of ['z', 'x', 'c', 'v']) await page.keyboard.press(`${mod}+${letter}`);
        }
        await settle(page);
        assert.deepEqual(await commandCounts(page, ['A', 'B', 'C', 'D']), [0, 0, 0, 0]);
        // Modified keys are not consumed (Ctrl+Z etc. keep their native meaning).
        await page.evaluate(() => { window.__prevented = []; document.addEventListener('keydown', e => { if (e.code !== 'ControlLeft') window.__prevented.push(e.defaultPrevented); }, false); });
        await page.keyboard.press('Control+z');
        assert.deepEqual(await page.evaluate(() => window.__prevented), [false]);

        for (const [i, key] of ['z', 'x', 'c', 'v'].entries()) {
            await page.keyboard.press(key);
            await frameFor(page, 'ABCD'[i]).waitForFunction(() => commands.length === 1);
        }
        assert.deepEqual(await commandCounts(page, ['A', 'B', 'C', 'D']), [1, 1, 1, 1]);
        await page.keyboard.press('Digit1'); // numbers are not part of this preset
        await settle(page);
        assert.deepEqual(await commandCounts(page, ['A', 'B', 'C', 'D']), [1, 1, 1, 1]);
    } finally { await context.close(); }
});

// ── Safety ───────────────────────────────────────────────────────────────────

test('typing in input / textarea / select / contenteditable / textbox never triggers; key repeat fires once', async () => {
    const context = await newContext();
    const page = await openRuntime(context, four, 'zxcv');
    try {
        await ready(page, 4);
        await page.evaluate(() => {
            const host = document.createElement('div');
            host.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;background:#fff';
            host.innerHTML = '<input id="t-input"><textarea id="t-area"></textarea><select id="t-select"><option>a</option></select>'
                + '<div id="t-ce" contenteditable="true">x</div><div id="t-ce-child" contenteditable="true"><b id="t-ce-b" tabindex="0">y</b></div>'
                + '<div id="t-role" role="textbox" tabindex="0"></div>';
            document.body.append(host);
        });
        for (const id of ['t-input', 't-area', 't-select', 't-ce', 't-ce-b', 't-role']) {
            await page.locator('#' + id).focus();
            for (const key of ['z', 'x', 'c', 'v']) await page.keyboard.press(key);
        }
        await settle(page);
        assert.deepEqual(await commandCounts(page, ['A', 'B', 'C', 'D']), [0, 0, 0, 0]);
        assert.equal(await page.locator('#t-input').inputValue(), 'zxcv'); // the keys were typed, not swallowed

        // Plain parent focus after typing again works.
        await page.evaluate(() => document.activeElement.blur());
        await page.keyboard.press('z');
        await frameFor(page, 'A').waitForFunction(() => commands.length === 1);

        // One physical press = one attempt: held key (repeat=true) after Gallery already replied.
        await page.keyboard.down('x');
        await page.keyboard.down('x');
        await page.keyboard.down('x');
        await page.keyboard.up('x');
        await frameFor(page, 'B').waitForFunction(() => commands.length >= 1);
        await settle(page);
        assert.equal(await frameFor(page, 'B').evaluate(() => commands.length), 1);
    } finally { await context.close(); }
});

test('shared action semantics: pending Panel is not double-fired, other Positions stay actionable, results never set hearts, already-favorite stays favorited', async () => {
    const context = await newContext();
    const page = await openRuntime(context, ['?state=unfav&id=A', '?state=fav&id=B', '', ''], 'numbers');
    try {
        await ready(page, 2);
        assert.deepEqual(await heartText(page), ['♡1', '♥2']);
        const before = await snapshot(page);
        for (const id of ['A', 'B']) await frameFor(page, id).evaluate(() => { window.holdResults = true; });

        await page.keyboard.press('1');
        await frameFor(page, 'A').waitForFunction(() => commands.length === 1);
        await page.keyboard.press('1'); // still pending
        await page.keyboard.press('1');
        await page.keyboard.press('2'); // independent
        await frameFor(page, 'B').waitForFunction(() => commands.length === 1);
        await settle(page);
        assert.deepEqual(await commandCounts(page, ['A', 'B']), [1, 1]);

        // Replies alone do not change visual truth.
        await frameFor(page, 'A').evaluate(() => reply(commands[0], 'favorited'));
        await frameFor(page, 'B').evaluate(() => reply(commands[0], 'already-favorite'));
        await page.waitForFunction(() => !document.querySelector('#master-hearts-body [aria-busy="true"]'));
        assert.deepEqual(await heartText(page), ['♡1', '♥2']);

        // Gallery publishes truth -> hearts change. Already-favorite never toggled B off.
        await frameFor(page, 'A').evaluate(() => publishState({ isFavorite: true }));
        await page.waitForFunction(() => document.querySelector('#master-hearts-body [data-position="1"]').textContent === '♥1');
        assert.deepEqual(await heartText(page), ['♥1', '♥2']);
        // Pending released: the same key is actionable again (idempotent positive action).
        await frameFor(page, 'B').evaluate(() => { window.holdResults = false; });
        await page.keyboard.press('2');
        await frameFor(page, 'B').waitForFunction(() => commands.length === 2);
        await settle(page);
        assert.deepEqual(await heartText(page), ['♥1', '♥2']);
        assert.equal(await snapshot(page), before);
    } finally { await context.close(); }
});

test('engine architecture: one master listener, none in heart surfaces, routes through _favoriteAtPosition with no key→Slot/Panel cache', async () => {
    const source = await readFile('js/triple-mode.js', 'utf8');
    const listeners = source.match(/addEventListener\(\s*'keydown'/g) || [];
    assert.equal(listeners.length, 1);
    const engine = source.slice(source.indexOf('function _activateMultiHeartShortcutCode'), source.indexOf('async function _favoriteAtPosition'));
    assert.match(engine, /_favoriteAtPosition\(position\)/);
    assert.match(engine, /_heartPanel\(position\)/);       // resolved at press time
    assert.doesNotMatch(engine, /postMessage|requestGalleryFavoriteCurrent|new Map|new WeakMap|stopPropagation/);
    const hearts = source.slice(source.indexOf('function _syncHeartButtons'), source.indexOf('function _renderHearts'))
        + source.slice(source.indexOf('function _installFloatingHearts'), source.indexOf('function _activateMultiHeartShortcutCode'));
    assert.doesNotMatch(hearts, /keydown|keyup|onkeydown/);
});

// ── Focus boundaries ─────────────────────────────────────────────────────────

test('focus seam: parent-focused and toolbar-focused keys reach the engine; iframe-focused keys do NOT reach the GS3 parent (S9B boundary)', async () => {
    const context = await newContext();
    const page = await openRuntime(context, four, 'numbers');
    try {
        await ready(page, 4);
        await page.evaluate(() => {
            window.__parentKeys = [];
            document.addEventListener('keydown', e => window.__parentKeys.push(e.code), true); // capture: sees everything the parent gets
        });

        // A. parent shell focus
        assert.equal(await page.evaluate(() => document.activeElement === document.body), true);
        await page.keyboard.press('1');
        await frameFor(page, 'A').waitForFunction(() => commands.length === 1);

        // B. a GS3 toolbar control focused
        await page.locator('#btn-toggle-master').click();
        assert.equal(await page.evaluate(() => document.activeElement?.id), 'btn-toggle-master');
        await page.keyboard.press('2');
        await frameFor(page, 'B').waitForFunction(() => commands.length === 1);

        // C. real focus inside a cross-origin Gallery iframe (genuine browser keystroke, no parent dispatch)
        const parentKeysBefore = await page.evaluate(() => window.__parentKeys.length);
        await page.evaluate(() => panels[3].querySelector('iframe').focus());
        const child = frameFor(page, 'C');
        await child.evaluate(() => {
            window.__childKeys = [];
            addEventListener('keydown', e => window.__childKeys.push(e.code));
            document.body.tabIndex = 0; document.body.focus();
        });
        assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'IFRAME');
        await page.keyboard.press('3');
        await settle(page);
        assert.deepEqual(await child.evaluate(() => window.__childKeys), ['Digit3']);          // the child got it
        assert.equal(await page.evaluate(() => window.__parentKeys.length), parentKeysBefore); // the parent did not
        assert.deepEqual(await commandCounts(page, ['A', 'B', 'C', 'D']), [1, 1, 0, 0]);       // so no favorite happened
    } finally { await context.close(); }
});

test('M , . / preset (native): M , . / hit Positions 1-4; modifiers/other-preset keys do nothing and are not consumed; repeat and editables stay safe', async () => {
    const context = await newContext();
    const page = await openRuntime(context, four, 'mpunct');
    try {
        await ready(page, 4);
        await page.evaluate(() => { window.__prevented = []; document.addEventListener('keydown', e => { if (!/^(Control|Meta|Alt|Shift)/.test(e.code)) window.__prevented.push([e.code, e.defaultPrevented]); }, false); });
        for (const mod of ['Control', 'Meta', 'Alt', 'Shift']) {
            for (const key of ['m', ',', '.', '/']) await page.keyboard.press(`${mod}+${key}`);
        }
        for (const key of ['1', 'z', 'x']) await page.keyboard.press(key); // other presets' keys
        await settle(page);
        assert.deepEqual(await commandCounts(page, ['A', 'B', 'C', 'D']), [0, 0, 0, 0]);
        assert.ok((await page.evaluate(() => __prevented)).every(([, prevented]) => prevented === false)); // not consumed
        await page.evaluate(() => { window.__prevented.length = 0; });
        for (const [i, key] of ['m', ',', '.', '/'].entries()) {
            await page.keyboard.press(key);
            await frameFor(page, 'ABCD'[i]).waitForFunction(() => commands.length === 1);
        }
        assert.deepEqual(await commandCounts(page, ['A', 'B', 'C', 'D']), [1, 1, 1, 1]);
        assert.deepEqual((await page.evaluate(() => __prevented)).map(([, p]) => p), [true, true, true, true]); // matched keys consumed

        await page.keyboard.down('m'); await page.keyboard.down('m'); await page.keyboard.down('m'); await page.keyboard.up('m');
        await settle(page);
        assert.equal(await frameFor(page, 'A').evaluate(() => commands.length), 2); // one press, repeats ignored

        await page.evaluate(() => { const i = document.createElement('input'); i.id = 'ti'; i.style.cssText = 'position:fixed;z-index:99999'; document.body.append(i); });
        await page.locator('#ti').focus();
        for (const key of ['m', ',', '.', '/']) await page.keyboard.press(key);
        await settle(page);
        assert.equal(await page.locator('#ti').inputValue(), 'm,./');
        assert.deepEqual(await commandCounts(page, ['A', 'B', 'C', 'D']), [2, 1, 1, 1]);

        // Live preset changes without reload.
        const settings = await context.newPage();
        await settings.goto(ORIGIN + '/settings.html', { waitUntil: 'networkidle' });
        await page.evaluate(() => document.activeElement.blur());
        await settings.locator('[data-preset="numbers"]').click();
        await page.keyboard.press('m'); await settle(page);
        assert.equal(await frameFor(page, 'A').evaluate(() => commands.length), 2);
        await page.keyboard.press('1');
        await frameFor(page, 'A').waitForFunction(() => commands.length === 3);
        await settings.locator('[data-preset="mpunct"]').click();
        await page.keyboard.press('1'); await settle(page);
        assert.equal(await frameFor(page, 'A').evaluate(() => commands.length), 3);
        await page.keyboard.press('m');
        await frameFor(page, 'A').waitForFunction(() => commands.length === 4);
        await settings.locator('[data-preset="zxcv"]').click();
        await page.keyboard.press('m'); await settle(page);
        assert.equal(await frameFor(page, 'A').evaluate(() => commands.length), 4);
        await page.keyboard.press('z');
        await frameFor(page, 'A').waitForFunction(() => commands.length === 5);
        await settings.locator('[data-preset="mpunct"]').click();
        await settings.locator('[data-preset="off"]').click();
        for (const key of ['m', ',', '.', '/', 'z', '1']) await page.keyboard.press(key);
        await settle(page);
        assert.deepEqual(await commandCounts(page, ['A', 'B', 'C', 'D']), [5, 1, 1, 1]);
    } finally { await context.close(); }
});
