// Fill Panel RUNTIME visibility on the real index3.html: configured (Top + Runway + Deep Cuts) vs supported (FILL_EMBED).
// Run: node architecture-lab/fill-panel/verify-fill-visibility.mjs   (needs python -m http.server 8080 at the repo root)
import { chromium } from 'playwright';
const O = 'http://localhost:8080';
const ORDER = ['toggle', 'folder', 'star', 'shuffle', 'shuffleAll', 'fillPanel', 'reload', 'launchpad', 'delete', 'kill', 'purge'];
const XV = 'https://www.xvideos.com/video.ufplmdf83c4/rough_use_of_a_bad_girl_s_holes_sofa_weber';
const XNXX = 'https://www.xnxx.com/video-1164yzbf/petite_polly_petrova_gets_hardcore_pounding_in_the_pooter_in_first_dap';
const XH = 'https://xhamster.com/videos/some-slug-3298012';
const UNSUP = 'https://example.com/some/page';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = []; page.on('pageerror', (e) => errors.push(String(e).slice(0, 140)));
await page.route(/^https?:\/\/(?!localhost:8080).*/, (r) => r.fulfill({ status: 204, body: '<html></html>', contentType: 'text/html' }));
await page.addInitScript(([order, xv]) => {
    if (window !== window.top) return;
    const set = (k, v) => localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
    set('hotswap_action_order', order); set('hotswap_top_count', '8');
    set('hotswap_quick_actions_enabled', 'true'); set('hotswap_quick_action_count', '8'); set('hotswap_quick_action_order', order);
    set('loop_matrix_urls', [xv, '/test/fixtures/canary.html?id=B', '/test/fixtures/canary.html?id=C']);
    // timeline of every write to the Fill projections' `hidden` / data-capability-hidden, from panel construction on
    window.__fillTimeline = []; const t0 = performance.now();
    const rec = (el, why) => { const kind = el.classList.contains('btn-hotswap-fill-panel') ? 'canonical' : el.closest('.hotswap-runway') ? 'runway' : el.closest('.hotswap-top-shortcuts') ? 'top' : 'mirror?';
        const slot = el.closest('.stream-panel')?.dataset.slotIndex ?? '-'; if (slot !== '0' && slot !== '-') return;
        window.__fillTimeline.push(`${Math.round(performance.now() - t0)}ms ${kind} ${why} hidden=${el.hidden} capHidden=${el.dataset.capabilityHidden ?? '-'}`); };
    new MutationObserver((ms) => { for (const m of ms) {
        if (m.type === 'attributes' && m.target.matches?.('.btn-hotswap-fill-panel,[data-action-key="fillPanel"]')) rec(m.target, 'attr:' + m.attributeName);
        for (const n of m.addedNodes) if (n.nodeType === 1) n.querySelectorAll?.('.btn-hotswap-fill-panel,[data-action-key="fillPanel"]').forEach((e) => rec(e, 'added')), n.matches?.('.btn-hotswap-fill-panel,[data-action-key="fillPanel"]') && rec(n, 'added'); } })
        .observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'data-capability-hidden'] });
}, [ORDER, XV]);
await page.goto(`${O}/index3.html`, { waitUntil: 'load' });
await page.waitForFunction(() => document.querySelectorAll('.stream-panel iframe').length === 4);
await page.waitForTimeout(1200);

const project = () => page.evaluate(async () => {
    const cb = await import('./js/capability-bridge.js'); const pu = await import('./js/presentation-url.js');
    const p = document.querySelector('.stream-panel[data-slot-index="0"]');
    const f = p.querySelector(':scope > iframe:not(.gs3-fill-embed)');
    const vis = (el) => !el ? 'absent' : (el.hidden || getComputedStyle(el).display === 'none') ? 'HIDDEN' : 'visible';
    const row = (el) => el ? { exists: true, hidden: el.hidden, capHidden: el.dataset.capabilityHidden ?? null, display: getComputedStyle(el).display, inlineDisplay: el.style.display, title: el.title, text: el.textContent, state: vis(el) } : { exists: false, state: 'absent' };
    const assigned = f.getAttribute('data-last-src');
    return { assigned: assigned.replace('https://', '').slice(0, 44), adapter: pu.getFillPresentationUrl(assigned),
        canonical: row(p.querySelector('.hotswap-overlay .btn-hotswap-fill-panel')), top: row(p.querySelector('.hotswap-top-shortcuts [data-action-key="fillPanel"]')), runway: row(p.querySelector('.hotswap-runway [data-action-key="fillPanel"]')),
        topOrder: [...p.querySelectorAll('.hotswap-top-shortcuts > button')].map((b) => (b.dataset.actionKey || '?') + (b.hidden ? '(h)' : '')).join(','),
        runwayOrder: [...p.querySelectorAll('.hotswap-runway > button')].map((b) => (b.dataset.actionKey || '?') + (b.hidden ? '(h)' : '')).join(','),
        state: cb.getFillPanelCapabilityState(p) };
});
const short = (r) => `adapter=${r.adapter ? 'embed' : 'null'} | canonical=${r.canonical.state} top=${r.top.state} runway=${r.runway.state} | capable=${r.state.capable} embedAvailable=${r.state.embedAvailable}`;
console.log('BOOT (xvideos video assigned), toolbar not yet revealed:'); let r = await project(); console.log(' ', short(r)); console.log('  top order:', r.topOrder); console.log('  runway order:', r.runwayOrder);
console.log('  hidden-writes timeline (panel 0):'); (await page.evaluate(() => window.__fillTimeline)).forEach((l) => console.log('    ' + l));
// E: reveal the toolbar (hover)
await page.locator('.stream-panel[data-slot-index="0"]').hover(); await page.waitForTimeout(700);
r = await project(); console.log('AFTER TOOLBAR REVEAL:', short(r)); console.log('  top order:', r.topOrder);
console.log('  canonical row:', JSON.stringify(r.canonical)); console.log('  top row:', JSON.stringify(r.top)); console.log('  runway row:', JSON.stringify(r.runway));

// transitions in ONE live Panel, no reload of the Runtime
const assign = (u) => page.evaluate(async (u) => { const p = document.querySelector('.stream-panel[data-slot-index="0"]'); p.querySelector('.btn-hotswap-toggle').click(); const i = p.querySelector('.hotswap-input'); i.value = u; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await new Promise((r) => setTimeout(r, 500)); }, u);
const results = {};
for (const [name, url] of [['xHamster', XH], ['XVideos', XV], ['Unsupported', UNSUP], ['XNXX', XNXX]]) {
    await assign(url); await page.locator('.stream-panel[data-slot-index="0"]').hover(); await page.waitForTimeout(500);
    r = await project(); results[name] = r; console.log(`ASSIGN ${name.padEnd(11)}:`, short(r));
}
console.log('page errors:', JSON.stringify(errors));
await browser.close();
