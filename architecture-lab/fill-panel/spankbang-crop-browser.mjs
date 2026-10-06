import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
const origin='http://127.0.0.1:4193';
const server=spawn('python',['-m','http.server','4193','--bind','127.0.0.1'],{stdio:'ignore',windowsHide:true});
const browser=await chromium.launch({channel:'chrome',headless:false});
const results=[];
try {
    for(const [id,slug] of [['1hh0h','erotic+feet+piper+perri+living+photos'],['5dew5','zelda']]) {
        const context=await browser.newContext({viewport:{width:1600,height:900}});
        const deadline=setTimeout(()=>context.close().catch(()=>{}),75000);
        const page=await context.newPage();
        const canonical=`https://spankbang.com/${id}/video/${slug}`;
        const row={id,canonical,popups:0};
        context.on('page',p=>{if(p!==page)row.popups++;});
        try {
            const embedUrl=`https://spankbang.com/${id}/embed/`;
            const response=await page.goto(embedUrl,{waitUntil:'domcontentloaded',timeout:20000});
            await page.waitForTimeout(4000);
            row.warmTitle=await page.title();
            // Use the successful provider response unchanged, except for frame
            // headers, as a lab stand-in for the Human's existing extension.
            // Player scripts, stream API and media still come from live provider servers.
            const body=await response.body();
            const headers={...response.headers()};delete headers['x-frame-options'];delete headers['content-security-policy'];
            row.documentTransport='cached live provider response; frame-header extension stand-in';
            await context.route(embedUrl,route=>route.fulfill({status:response.status(),headers,body}));
            await page.addInitScript(url=>{if(window===window.top)localStorage.setItem('loop_matrix_urls',JSON.stringify([url,'/test/fixtures/canary.html?id=B','/test/fixtures/canary.html?id=C']));},canonical);
            await page.goto(origin+'/index3.html',{waitUntil:'load',timeout:20000}).catch(()=>{});
            await page.waitForFunction(()=>document.querySelectorAll('.stream-panel > iframe').length===4);
            await page.waitForTimeout(4000);
            row.before=await page.evaluate(async()=>{const p=document.querySelector('.stream-panel[data-slot-index="0"]');window.__original=p.querySelector('iframe');const cb=await import('./js/capability-bridge.js');return {url:window.__original.getAttribute('data-last-src'),state:cb.getFillPanelCapabilityState(p)};});
            row.started=await page.evaluate(async()=>{const p=document.querySelector('.stream-panel[data-slot-index="0"]');p.querySelector('.btn-hotswap-fill-panel').click();return {overlays:p.querySelectorAll('.gs3-fill-embed').length,state:(await import('./js/capability-bridge.js')).getFillPanelCapabilityState(p)};});
            await page.waitForTimeout(8000);
            row.afterWait=await page.evaluate(()=>({overlays:document.querySelectorAll('.gs3-fill-embed').length}));
            const iframe=await page.locator('iframe.gs3-fill-embed').elementHandle();
            const frame=await iframe.contentFrame();
            row.embedTitle=await frame.title();
            const video=frame.locator('video').first();
            row.hasVideo=Boolean(await video.count());
            if(row.hasVideo) {
                const box=await video.boundingBox();
                await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
                await page.waitForTimeout(4500);
                row.media=await video.evaluate(v=>({time:v.currentTime,paused:v.paused,ready:v.readyState,muted:v.muted,volume:v.volume,audioDecoded:v.webkitAudioDecodedByteCount}));
                await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
                row.pause=await video.evaluate(v=>v.paused);
                await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
                row.geometry=[];
                for(const size of [{width:1600,height:900},{width:1200,height:700},{width:900,height:600}]) {
                    await page.setViewportSize(size);
                    const clip=await page.locator('.gs3-fill-viewport').boundingBox();
                    const fbox=await iframe.boundingBox();
                    const vbox=await video.boundingBox();
                    const promo=await frame.locator('.promo').boundingBox();
                    row.geometry.push({size,clip,iframe:fbox,video:vbox,promo,footerClipped:promo.y>=clip.y+clip.height-1,playerFits:Math.abs(vbox.height-clip.height)<2});
                }
                const b=await video.boundingBox();
                await page.mouse.move(b.x+b.width-20,b.y+b.height-20);
                await page.mouse.click(b.x+b.width-20,b.y+b.height-20);
                row.fullscreen=await frame.evaluate(()=>Boolean(document.fullscreenElement));
                if(row.fullscreen)await page.keyboard.press('Escape');
            }
            await page.evaluate(()=>document.querySelector('.stream-panel[data-slot-index="0"] .btn-hotswap-fill-panel').click());
            row.exit=await page.evaluate(()=>({same:window.__original===document.querySelector('.stream-panel[data-slot-index="0"] > iframe'),assigned:window.__original.getAttribute('data-last-src'),overlays:document.querySelectorAll('.gs3-fill-embed,.gs3-fill-viewport').length}));
        } catch(e){row.error=e.message.split('\n')[0];}
        clearTimeout(deadline);
        results.push(row);console.log(JSON.stringify(row));
        fs.writeFileSync('architecture-lab/fill-panel/spankbang-crop-browser-results.json',JSON.stringify(results,null,2));
        await context.close();
    }
}finally{await browser.close();server.kill();}
