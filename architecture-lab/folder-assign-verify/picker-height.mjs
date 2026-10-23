import { chromium } from 'playwright';
const ORIGIN = 'http://localhost:8080';
const browser = await chromium.launch({ headless: true });
async function measure(label, strip, vp) {
    const page = await browser.newPage({ viewport: vp });
    await page.route(/^https?:\/\/(?!localhost:8080).*/, (r) => r.fulfill({ status: 204, body: '' }));
    if (strip) await page.route(`${ORIGIN}/index3.html`, async (r) => { const resp = await r.fetch(); let b = await resp.text(); b = b.replace(/.*\.hotswap-folder-row \{ max-height: min\(256px[^\n]*\n/, ''); await r.fulfill({ response: resp, body: b }); });
    await page.addInitScript(() => { if (window === window.top) localStorage.setItem('loop_matrix_urls', JSON.stringify(['/test/fixtures/canary.html?id=A', '/test/fixtures/canary.html?id=B', '/test/fixtures/canary.html?id=C'])); });
    await page.goto(`${ORIGIN}/index3.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelectorAll('.stream-panel iframe').length === 4);
    await page.evaluate(async () => { const s = await import('./js/state.js'); s.setDatabaseStructure(Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`Folder ${i + 1}`, [`/test/fixtures/canary.html?id=f${i + 1}`]]))); });
    const out = {};
    // entry points: tray 📁, top-shortcut mirror, runway mirror (mirrors delegate to the same canonical onclick)
    for (const [entry, sel] of [['tray', '.btn-hotswap-folder'], ['topShortcut', '.hotswap-top-shortcut[data-action-key="folder"]'], ['runway', '.hotswap-runway-btn[data-action-key="folder"]']]) {
        out[entry] = await page.evaluate(async (sel) => {
            const panel = document.querySelector('.stream-panel[data-slot-index="0"]');
            const btn = panel.querySelector(sel); if (!btn) return 'no such control';
            btn.click(); await new Promise((r) => setTimeout(r, 250));
            const row = panel.querySelector('.hotswap-folder-row'); const it = row.querySelector('.hotswap-folder-item');
            const rb = row.getBoundingClientRect(), pb = panel.getBoundingClientRect(), ib = it.getBoundingClientRect(), cs = getComputedStyle(it);
            const res = { open: row.classList.contains('open'), height: Math.round(rb.height), width: Math.round(rb.width), itemH: Math.round(ib.height * 10) / 10, itemFont: cs.fontSize, itemPad: cs.padding, gap: getComputedStyle(row).gap,
                scrollable: row.scrollHeight > row.clientHeight, insidePanel: rb.top >= pb.top - 0.5 && rb.bottom <= pb.bottom + 0.5, panelH: Math.round(pb.height), visibleRows: Math.round(row.clientHeight / (ib.height + 4)) };
            row.scrollTop = 200; res.scrolledTo = row.scrollTop;
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            await new Promise((r) => setTimeout(r, 150)); res.closedByEscape = !row.classList.contains('open');
            return res;
        }, sel);
    }
    // selection + outside click behaviour (tray)
    out.select = await page.evaluate(async () => {
        const gs = await import('./js/grid-session.js'); const panel = document.querySelector('.stream-panel[data-slot-index="0"]');
        panel.querySelector('.btn-hotswap-folder').click(); await new Promise((r) => setTimeout(r, 200));
        [...panel.querySelectorAll('.hotswap-folder-item')].find((i) => i.textContent.startsWith('Folder 7')).click(); await new Promise((r) => setTimeout(r, 400));
        const f = panel.querySelector('iframe');
        return { session: gs.getSessionFolderMap()[0], dom: f.getAttribute('data-source-folder'), assigned: f.getAttribute('data-last-src').replace(/^.*id=/, ''), pickerClosed: !panel.querySelector('.hotswap-folder-row').classList.contains('open') };
    });
    console.log(`\n[${label}] viewport ${vp.width}x${vp.height}\n`, JSON.stringify(out, null, 1));
    await page.close();
}
await measure('BEFORE (rule stripped in memory)', true, { width: 1600, height: 900 });
await measure('AFTER (repo state)', false, { width: 1600, height: 900 });
await measure('AFTER, short viewport', false, { width: 1280, height: 420 });
await browser.close();
