import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
for (const [w, h] of [[1280, 720], [1600, 900], [1920, 1080]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    await page.route(/^https?:\/\/(?!localhost:8080).*/, (r) => r.fulfill({ status: 204, body: '' }));
    await page.addInitScript(() => { if (window === window.top) localStorage.setItem('loop_matrix_urls', JSON.stringify(['/test/fixtures/canary.html?id=A', '/test/fixtures/canary.html?id=B', '/test/fixtures/canary.html?id=C'])); });
    await page.goto('http://localhost:8080/index3.html', { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelectorAll('.stream-panel iframe').length === 4);
    await page.waitForTimeout(300);
    const out = [];
    for (let s = 0; s < 3; s++) {
        const panel = page.locator(`.stream-panel[data-slot-index="${s}"]`); await panel.hover(); await page.waitForTimeout(250);
        out.push(await panel.evaluate((p) => { const m = p.querySelector('.hotswap-mirror-btn[data-action-key="folder"]'); if (!m) return 'no mirror';
            const r = m.getBoundingClientRect(); if (!m.offsetParent || !r.width) return 'not visible';
            const t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
            return (t === m || m.contains(t)) ? 'hittable' : 'COVERED by ' + String(t?.className || t?.tagName).slice(0, 30); }));
    }
    console.log(`${w}x${h}`, JSON.stringify(out));
    await page.close();
}
await browser.close();
