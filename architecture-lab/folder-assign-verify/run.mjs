// Live runtime verification (read-only): per-Panel Folder Assignment on the REAL index3.html.
// Fresh Chromium profile, real module graph served from the repo. Production files are NOT edited:
// log-only probes are injected into the *served response bytes* via page.route (in memory only).
// Run: node architecture-lab/folder-assign-verify/run.mjs   (needs python -m http.server 8080 at repo root)
import { chromium } from 'playwright';

const ORIGIN = 'http://localhost:8080';
const out = [];
const log = (...a) => { const s = a.join(' '); out.push(s); console.log(s); };

const PROBES = [
    ['/js/launch.js', "item.onclick = (ev) => {\n                ev.stopPropagation();",
        "item.onclick = (ev) => {\n                window.__probe?.('folderItem.onclick', folderName);\n                ev.stopPropagation();"],
    ['/js/launch.js', "const setIframeUrl = (newUrl, newFolder) => {",
        "const setIframeUrl = (newUrl, newFolder) => {\n        window.__probe?.('setIframeUrl', { index, newUrl, newFolder });"],
    ['/js/launch.js', "export function updateRenderedPanel(panel, { url, folder } = {}) {",
        "export function updateRenderedPanel(panel, { url, folder } = {}) {\n    window.__probe?.('updateRenderedPanel', { slot: panel?.dataset?.slotIndex, url, folder });"],
    ['/js/launch.js', "const folder = getSourceFolder();\n        if (!folder) { alert('No source folder tracked",
        "const folder = getSourceFolder();\n        window.__probe?.('shuffle.reads', { index, domFolder: folder });\n        if (!folder) { alert('No source folder tracked"],
    ['/js/triple-mode.js', "onPanelContentChanged: (idx, newUrl, newFolder) => {",
        "onPanelContentChanged: (idx, newUrl, newFolder) => {\n            window.__probe?.('onPanelContentChanged', { idx, newUrl, newFolder });"],
    ['/js/triple-mode.js', "function _renderPanels(urls, map, ctx, { skipUndoSnapshot = false } = {}) {",
        "function _renderPanels(urls, map, ctx, { skipUndoSnapshot = false } = {}) {\n    window.__probe?.('_renderPanels', { map });"],
    ['/js/panel-navigation.js', "export function beginPanelContent(slotIndex, url, expectedLoads = 1) {",
        "export function beginPanelContent(slotIndex, url, expectedLoads = 1) {\n    window.__probe?.('beginPanelContent', { slotIndex, url });"],
];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.setDefaultTimeout(6000);
const dialogs = []; page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); });
const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
await page.route(/^https?:\/\/(?!localhost:8080).*/, (r) => r.fulfill({ status: 204, body: '' }));
const applied = [];
await page.route(`${ORIGIN}/js/*.js**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    const resp = await route.fetch(); let body = (await resp.text()).split(String.fromCharCode(13)).join('');
    for (const [p, from, to] of PROBES) if (p === path && body.includes(from)) { body = body.replace(from, to); applied.push(`${path} :: ${from.slice(0, 40).replace(/\n/g, ' ')}`); }
    await route.fulfill({ response: resp, body, headers: { ...resp.headers(), 'cache-control': 'no-store' } });
});
await page.addInitScript(() => {
    if (window !== window.top) return;
    localStorage.setItem('loop_matrix_urls', JSON.stringify(['/test/fixtures/canary.html?id=A', '/test/fixtures/canary.html?id=B', '/test/fixtures/canary.html?id=C']));
    window.__probeLog = []; window.__t0 = performance.now();
    window.__probe = (name, data) => window.__probeLog.push({ t: Math.round(performance.now() - window.__t0), name, data });
});
await page.goto(`${ORIGIN}/index3.html`, { waitUntil: 'load' });
await page.waitForFunction(() => document.querySelectorAll('.stream-panel iframe').length === 4);
await page.waitForTimeout(300);
log('probes applied:', applied.length, '/', PROBES.length); applied.forEach((a) => log('  ', a));
log('GS3R0 harness absent:', await page.evaluate(() => typeof window.GS3R0 === 'undefined'));

// Database with two distinguishable folders (canary ids prefixed by folder), set exactly as the repo's own tests do.
const DB = { Alpha: [1, 2, 3, 4].map((n) => `/test/fixtures/canary.html?id=alpha${n}`), Beta: [1, 2, 3, 4].map((n) => `/test/fixtures/canary.html?id=beta${n}`) };
await page.evaluate(async (db) => { const s = await import('./js/state.js'); s.setDatabaseStructure(db); }, DB);

const snap = (slot) => page.evaluate(async (slot) => {
    const gs = await import('./js/grid-session.js'); const st = await import('./js/state.js'); const nav = await import('./js/panel-navigation.js');
    const panel = document.querySelector(`.stream-panel[data-slot-index="${slot}"]`); const f = panel.querySelector('iframe');
    let actual = null; try { actual = f.contentWindow.location.href.replace(location.origin, ''); } catch { actual = '(cross-origin)'; }
    return { session: gs.getSessionFolderMap()[slot] ?? null, stateJs: st.getUrlFolderMap()[slot] ?? null, dom: f.getAttribute('data-source-folder'),
        assigned: (f.getAttribute('data-last-src') || '').replace(/^.*id=/, 'id='), sessionUrl: String(gs.getSessionUrls()[slot] || '').replace(/^.*id=/, 'id='),
        loaded: String(actual).replace(/^.*id=/, 'id='), gen: nav.getPanelNavigationState(slot).generation };
}, slot);
const fmt = (s) => `session=${s.session} | state.js=${s.stateJs} | DOM=${s.dom} | assigned=${s.assigned} | sessionUrl=${s.sessionUrl} | loaded=${s.loaded} | gen=${s.gen}`;
const probes = (from) => page.evaluate((i) => window.__probeLog.slice(i).map((p) => `${p.name}${p.data ? ' ' + JSON.stringify(p.data).replace(/\/test\/fixtures\/canary.html\?/g, '') : ''}`), from);
const plen = () => page.evaluate(() => window.__probeLog.length);

async function openFolderViaTray(slot) {
    const panel = page.locator(`.stream-panel[data-slot-index="${slot}"]`);
    await panel.hover();
    const btn = panel.locator('.btn-hotswap-folder');
    let how = 'real click';
    try { await btn.click({ timeout: 2500 }); } catch (e) { how = 'REAL CLICK FAILED (' + e.message.split('\n')[0].slice(0, 90) + ') -> dispatched click()'; await btn.evaluate((b) => b.click()); }
    return how;
}
async function pickFolder(slot, name) {
    const item = page.locator(`.stream-panel[data-slot-index="${slot}"] .hotswap-folder-item`, { hasText: name }).first();
    const visible = await item.isVisible().catch(() => false);
    let how = 'real click';
    try { await item.click({ timeout: 2500 }); } catch (e) { how = 'REAL CLICK FAILED (' + e.message.split('\n')[0].slice(0, 90) + ')'; await item.evaluate((n) => n.click()); }
    return { visible, how };
}
async function assign(slot, name) {
    log(`\n--- slot ${slot}: assign ${name} (tray 📁) ---`);
    log('BEFORE ', fmt(await snap(slot)));
    const i = await plen();
    log('open picker:', await openFolderViaTray(slot));
    const r = await pickFolder(slot, name); log(`item visible=${r.visible}, ${r.how}`);
    await page.waitForTimeout(700);
    log('AFTER  ', fmt(await snap(slot)));
    log('calls  ', (await probes(i)).join('  ->  '));
}
async function shuffle(slot, expectFolder) {
    log(`--- slot ${slot}: panel 🎲 Shuffle (expect pool ${expectFolder}) ---`);
    const i = await plen(); const before = await snap(slot);
    const panel = page.locator(`.stream-panel[data-slot-index="${slot}"]`); await panel.hover();
    await panel.locator('.btn-hotswap-shuffle').click({ timeout: 2500 }).catch(async () => { await panel.locator('.btn-hotswap-shuffle').evaluate((b) => b.click()); });
    await page.waitForTimeout(700);
    const after = await snap(slot);
    log('AFTER  ', fmt(after));
    log('calls  ', (await probes(i)).join('  ->  '));
    const pool = after.assigned.startsWith('id=alpha') ? 'Alpha' : after.assigned.startsWith('id=beta') ? 'Beta' : 'other/unchanged';
    log(`SHUFFLE USED POOL: ${pool}  (assigned ${before.assigned} -> ${after.assigned})  dialogs=${JSON.stringify(dialogs.splice(0))}`);
}

for (const slot of [0, 1]) {
    await assign(slot, 'Alpha'); await shuffle(slot, 'Alpha');
    await assign(slot, 'Beta'); await shuffle(slot, 'Beta');
}

// Same picker through the Top Toolbar mirror / Deep Cuts, if a folder mirror exists.
log('\n--- toolbar/runway folder mirrors present ---');
log(JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.hotswap-mirror-btn[data-action-key="folder"]')].map((b) => ({ cls: b.className.replace('hotswap-mirror-btn ', ''), disabled: b.disabled, visible: !!(b.offsetParent) })))));

// ── Path 2: the Top Toolbar folder MIRROR with REAL mouse events (what the Human uses) ─────────────
async function viaMirror(slot, name) {
    log(`
--- slot ${slot}: assign ${name} via TOP TOOLBAR MIRROR (real mouse) ---`);
    log('BEFORE ', fmt(await snap(slot)));
    const i = await plen();
    const panel = page.locator(`.stream-panel[data-slot-index="${slot}"]`); await panel.hover();
    const mirror = panel.locator('.hotswap-mirror-btn[data-action-key="folder"]').first();
    const hit = async (loc) => loc.evaluate((el) => { const r = el.getBoundingClientRect(); const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return { rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], hittable: top === el || el.contains(top), topElement: top ? (top.className || top.tagName).toString().slice(0, 50) : null }; });
    log('mirror:', JSON.stringify(await hit(mirror)), 'disabled=' + await mirror.isDisabled());
    let how = 'real click'; try { await mirror.click({ timeout: 2500 }); } catch (e) { how = 'REAL CLICK FAILED: ' + e.message.split(String.fromCharCode(10))[0].slice(0, 100); await mirror.evaluate((b) => b.click()); }
    log('mirror click:', how);
    await page.waitForTimeout(300);
    const row = panel.locator('.hotswap-folder-row');
    log('folder row:', JSON.stringify(await row.evaluate((r) => { const cs = getComputedStyle(r); const b = r.getBoundingClientRect(); return { open: r.classList.contains('open'), display: cs.display, visibility: cs.visibility, opacity: cs.opacity, rect: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)], insideViewport: b.bottom > 0 && b.right > 0 && b.x < innerWidth && b.y < innerHeight, parent: r.parentElement?.className?.toString().slice(0, 40) }; })));
    await page.screenshot({ path: new URL('./mirror-picker.png', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1') });
    const item = row.locator('.hotswap-folder-item', { hasText: name }).first();
    log('item:', JSON.stringify(await hit(item)));
    let how2 = 'real click'; try { await item.click({ timeout: 2500 }); } catch (e) { how2 = 'REAL CLICK FAILED: ' + e.message.split(String.fromCharCode(10))[0].slice(0, 100); await item.evaluate((n) => n.click()); }
    log('item click:', how2);
    await page.waitForTimeout(700);
    log('AFTER  ', fmt(await snap(slot)));
    log('calls  ', (await probes(i)).join('  ->  '));
}
await viaMirror(2, 'Beta'); await shuffle(2, 'Beta');
await viaMirror(2, 'Alpha'); await shuffle(2, 'Alpha');

// E: does a rebuild erase it? master Shuffle reads getUrlFolderMap() and re-renders.
log('\n--- rebuild check: master Shuffle after assigning slot 0 = Beta, slot 1 = Beta ---');
const i2 = await plen();
await page.evaluate(() => document.getElementById('btn-master-shuffle').click());
await page.waitForTimeout(900);
for (const s of [0, 1]) log(`slot ${s}`, fmt(await snap(s)));
log('calls  ', (await probes(i2)).join('  ->  '));
log('\npage errors:', JSON.stringify(errors));
await browser.close();
