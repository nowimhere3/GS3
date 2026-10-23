import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
const coverage = JSON.parse(fs.readFileSync('architecture-lab/fill-panel/provider-expansion-coverage.json', 'utf8'));
if (process.argv.includes('--wxx')) coverage.push({host:'wxx.wtf',specimens:Object.values(JSON.parse(fs.readFileSync('architecture-lab/fill-panel/wxx-specimens.json','utf8')))});
const executor = process.argv.includes('--executor');
const only = process.argv.find(x => x.startsWith('--only='))?.slice(7).split(',');
const port = process.env.GS3_RESEARCH_PORT || '4188';
const origin = `http://127.0.0.1:${port}`;
const server = spawn('python', ['-m', 'http.server', port, '--bind', '127.0.0.1'], { stdio: 'ignore', windowsHide: true });
const browser = await chromium.launch({ channel: 'chrome', headless: false });
const results = [];
const descendants = frame => [frame,...frame.childFrames().flatMap(descendants)];
const media = async frames => (await Promise.all([...new Set(frames.flatMap(descendants))].map(fr => fr.evaluate(() => [...document.querySelectorAll('video')].map(v => ({ paused: v.paused, time: v.currentTime, ready: v.readyState, muted: v.muted, volume: v.volume, width: v.videoWidth, audioTracks: v.webkitAudioDecodedByteCount, error: v.error?.code || null }))).catch(() => [])))).flat();
try {
    for (const c of coverage.filter(c => !only || only.includes(c.host))) for (const [i, url] of c.specimens.slice(0, 2).entries()) {
        const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
        const deadline = setTimeout(() => context.close().catch(() => {}), 90000);
        const page = await context.newPage();
        if (process.argv.includes('--extension-standin')) await context.route('**/*', async route => {
            if (route.request().resourceType() !== 'document' || route.request().url().startsWith(origin)) return route.continue();
            try { const response = await route.fetch(); const headers = {...response.headers()}; delete headers['x-frame-options']; delete headers['content-security-policy']; await route.fulfill({response,headers}); } catch { await route.continue().catch(() => {}); }
        });
        const row = { provider: c.host, specimen: i, canonical: url, popups: 0, requests: [], blocked: [] };
        context.on('page', p => { if (p !== page) row.popups++; });
        page.on('console', m => { if (/Blocked opening|Unsafe attempt|sandbox/i.test(m.text())) row.blocked.push(m.text().slice(0, 200)); });
        page.on('request', r => { if (/embed|\.m3u8|\.mp4|\/player\//i.test(r.url())) row.requests.push(r.url().split('?')[0]); });
        await page.addInitScript(u => { if (window === window.top) localStorage.setItem('loop_matrix_urls', JSON.stringify([u, '/test/fixtures/canary.html?id=B', '/test/fixtures/canary.html?id=C'])); }, url);
        try {
            await page.goto(origin + '/index3.html', { waitUntil: 'load', timeout: 30000 });
            await page.waitForTimeout(6500);
            const original = await page.locator('.stream-panel[data-slot-index="0"] > iframe').elementHandle();
            const originalFrame = await original.contentFrame();
            row.pageEvidence = await originalFrame.evaluate(() => ({ title: document.title, text: document.body.innerText.slice(0, 250), canonical: document.querySelector('link[rel="canonical"]')?.href, iframes: [...document.querySelectorAll('iframe')].map(f => f.src), embeds: document.documentElement.outerHTML.match(/https?:[^\s"'<>]+\/embed\/\d+/g), config: typeof flashvars === 'object' ? Object.fromEntries(Object.entries(flashvars).filter(([k]) => /^(video_id|autoplay|embed|hide_controlbar|player_width|player_height)$/.test(k))) : null })).catch(e => ({ error: e.message.split('\n')[0] }));
            row.underlyingBefore = await media([originalFrame, ...originalFrame.childFrames()]);
            if (process.argv.includes('--underlying-play')) {
                row.originalFrames=descendants(originalFrame).map(fr=>fr.url().split('?')[0]);
                for (const fr of descendants(originalFrame)) {
                    const target = fr.locator('video').first();
                    if (!await target.count()) continue;
                    await target.scrollIntoViewIfNeeded().catch(()=>{});
                    const box = await target.boundingBox().catch(() => null);
                    if (!box) continue;
                    for (let attempt=0;attempt<2;attempt++) {
                        await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
                        await page.waitForTimeout(2500);
                        if ((await media([fr])).some(v=>!v.paused&&v.time>1)) break;
                    }
                }
                row.underlyingBefore = await media([originalFrame,...originalFrame.childFrames()]);
            }
            const embed = c.host === 'spankbang.com' ? `https://spankbang.com/${new URL(url).pathname.split('/')[1]}/embed/` : `https://${['webpussi.com','wxx.wtf'].includes(c.host) ? 'www.' : ''}${c.host}/embed/${new URL(url).pathname.split('/')[2]}`;
            row.embed = embed;
            // Pre-adapter proof: mount a candidate in the real GS3 Panel with the current
            // executor's exact iframe attributes/geometry, without adding a production rule.
            await page.evaluate(async ([src, useExecutor]) => {
                const p = document.querySelector('.stream-panel[data-slot-index="0"]');
                window.__original = p.querySelector('iframe');
                window.__beforeFill = {src:window.__original.src, assigned:window.__original.getAttribute('data-last-src'), session:(await import('./js/grid-session.js')).getSessionUrls()[0]};
                if (useExecutor) { p.querySelector('.btn-hotswap-fill-panel').click(); return; }
                const f = document.createElement('iframe'); f.className = 'gs3-fill-embed';
                f.sandbox = 'allow-same-origin allow-scripts allow-forms'; f.allow = 'autoplay; fullscreen'; f.setAttribute('allowfullscreen', '');
                f.style.cssText = 'position:absolute;left:0;top:var(--hotswap-website-inset,0px);width:100%;height:calc(100% - var(--hotswap-website-inset,0px));border:0;background:#000;z-index:1;';
                f.src = src; p.appendChild(f);
            }, [embed, executor]);
            await page.waitForTimeout(9000);
            const handle = await page.locator('iframe.gs3-fill-embed').elementHandle();
            const frame = await handle.contentFrame();
            row.embedEvidence = await frame.evaluate(() => ({ title: document.title, text: document.body?.innerText.slice(0, 400), iframes: [...document.querySelectorAll('iframe')].map(f => f.src), links: [...document.querySelectorAll('a')].map(a => ({ text: a.innerText, href: a.href })), config: typeof flashvars === 'object' ? Object.fromEntries(Object.entries(flashvars).filter(([k]) => /^(video_id|autoplay|embed|hide_controlbar|player_width|player_height)$/.test(k))) : null })).catch(e => ({ error: e.message.split('\n')[0] }));
            fs.writeFileSync(`architecture-lab/fill-panel/embed-source-${c.host}-${i}.html`, await frame.content().catch(() => ''));
            const box = await handle.boundingBox();
            row.before = await media([frame, ...frame.childFrames()]);
            for (let click = 0; click < 2; click++) {
                await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
                await page.waitForTimeout(5000);
                row.after = await media([frame, ...frame.childFrames()]);
                if (row.after.some(v => !v.paused && v.time > 1)) break;
            }
            row.playing = row.after.some(v => !v.paused && v.time > 1 && v.ready >= 2);
            row.underlyingAfter = await media([originalFrame, ...originalFrame.childFrames()]);
            row.doubleAudio = row.playing && row.underlyingAfter.some(v => !v.paused && !v.muted && v.volume > 0 && v.audioTracks > 0) && row.after.some(v => !v.paused && !v.muted && v.volume > 0 && v.audioTracks > 0);
            if (row.playing) {
                await page.mouse.move(box.x + box.width / 2, box.y + box.height - 20);
                const pause = frame.locator('.fp-play').first();
                if (await pause.isVisible().catch(() => false)) {
                    await pause.click({timeout:3000}).catch(() => {});
                    await page.waitForTimeout(300);
                    row.controlsPause = (await media([frame,...frame.childFrames()])).some(v => v.paused);
                    await pause.click({timeout:3000}).catch(() => {});
                }
                const fullscreen = frame.locator('.fp-fullscreen').first();
                if (await fullscreen.isVisible().catch(() => false)) {
                    await fullscreen.click({timeout:3000}).catch(() => {});
                    row.fullscreen = await frame.evaluate(() => Boolean(document.fullscreenElement)).catch(() => false);
                    if (row.fullscreen) await page.keyboard.press('Escape');
                }
            }
            row.geometry = [];
            for (const size of [{ width:1600,height:900 },{ width:1200,height:700 },{ width:900,height:600 }]) {
                await page.setViewportSize(size);
                row.geometry.push({ size, elements: await frame.evaluate(() => [...document.querySelectorAll('video,footer,[class*="footer"],[id*="footer"],.control-bar,[class*="control"]')].map(e => {const r=e.getBoundingClientRect();return {tag:e.tagName,class:e.className,id:e.id,x:r.x,y:r.y,w:r.width,h:r.height,text:e.tagName==='VIDEO'?'':e.textContent.slice(0,100)};})).catch(() => []) });
            }
            row.restored = await page.evaluate(async useExecutor => {
                if (useExecutor) document.querySelector('.stream-panel[data-slot-index="0"] .btn-hotswap-fill-panel').click();
                else document.querySelector('.gs3-fill-embed').remove();
                return !document.querySelector('.gs3-fill-embed') && window.__original === document.querySelector('.stream-panel[data-slot-index="0"] > iframe') && window.__original.isConnected && window.__original.src === window.__beforeFill.src && (await import('./js/grid-session.js')).getSessionUrls()[0] === window.__beforeFill.session;
            }, executor);
            row.identity = await page.evaluate(() => window.__original.getAttribute('data-last-src'));
            row.focusStayed = page.url() === origin + '/index3.html';
        } catch (e) { row.error = e.message.split('\n')[0]; }
        results.push(row);
        fs.writeFileSync(`architecture-lab/fill-panel/provider-expansion-${executor ? 'executor' : 'browser'}${process.argv.includes('--extension-standin') ? '-extension' : ''}${only ? '-' + only.join('-') : ''}${process.argv.includes('--underlying-play') ? '-underlying' : ''}-results.json`, JSON.stringify(results, null, 2));
        console.log(JSON.stringify({ provider:row.provider,specimen:i,playing:row.playing,popups:row.popups,doubleAudio:row.doubleAudio,page:row.pageEvidence,embed:row.embedEvidence,after:row.after,error:row.error }));
        clearTimeout(deadline);
        await context.close();
    }
} finally { await browser.close(); server.kill(); }
