// Supplementary read-only checks: (1) is the Top Toolbar folder mirror really hittable per Panel at common viewports?
// (2) folder with no routable URL / single URL equal to current: what does the Human see?
import { chromium } from 'playwright';
const ORIGIN = 'http://localhost:8080';
const browser = await chromium.launch({ headless: true });
for (const [w, h] of [[1280, 720], [1600, 900], [1920, 1080]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    await page.route(/^https?:\/\/(?!localhost:8080).*/, (r) => r.fulfill({ status: 204, body: '' }));
    await page.addInitScript(() => { if (window === window.top) localStorage.setItem('loop_matrix_urls', JSON.stringify(['/test/fixtures/canary.html?id=A', '/test/fixtures/canary.html?id=B', '/test/fixtures/canary.html?id=C'])); });
    await page.goto(`${ORIGIN}/index3.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelectorAll('.stream-panel iframe').length === 4);
    await page.waitForTimeout(300);
    const res = await page.evaluate(() => [...document.querySelectorAll('.stream-panel')].map((p) => {
        const m = p.querySelector('.hotswap-mirror-btn[data-action-key="folder"]'); if (!m) return { slot: p.dataset.slotIndex, mirror: 'none' };
        const r = m.getBoundingClientRect(); const vis = !!m.offsetParent && r.width > 0;
        const top = vis ? document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) : null;
        return { slot: p.dataset.slotIndex, visible: vis, hittable: vis ? (top === m || m.contains(top)) : null, coveredBy: vis && !(top === m || m.contains(top)) ? String(top?.className || top?.tagName).slice(0, 30) : null };
    }));
    console.log(`${w}x${h}`, JSON.stringify(res));
    if (w === 1600) {
        // (2) folder cases on slot 3 (dispatched click: hit-testing is covered above)
        await page.evaluate(async () => { const s = await import('./js/state.js'); s.setDatabaseStructure({ Empty: [], One: ['/test/fixtures/canary.html?id=A'], Alpha: ['/test/fixtures/canary.html?id=alpha1'] }); });
        for (const name of ['Empty', 'One']) {
            const r = await page.evaluate(async (name) => {
                const gs = await import('./js/grid-session.js'); const nav = await import('./js/panel-navigation.js');
                const panel = document.querySelector('.stream-panel[data-slot-index="0"]'); const f = panel.querySelector('iframe');
                const before = { folder: gs.getSessionFolderMap()[0] ?? null, src: f.getAttribute('data-last-src'), gen: nav.getPanelNavigationState(0).generation };
                panel.querySelector('.btn-hotswap-folder').click();
                [...panel.querySelectorAll('.hotswap-folder-item')].find((i) => i.textContent.startsWith(name)).click();
                await new Promise((r) => setTimeout(r, 400));
                return { before, after: { folder: gs.getSessionFolderMap()[0] ?? null, dom: f.getAttribute('data-source-folder'), src: f.getAttribute('data-last-src'), gen: nav.getPanelNavigationState(0).generation } };
            }, name);
            console.log(`folder "${name}" on slot 0:`, JSON.stringify(r));
        }
    }
    await page.close();
}
await browser.close();
