import fs from 'node:fs';
import { chromium } from 'playwright';
const browser = await chromium.launch({channel:'chrome',headless:false});
const results = [];
try {
    const page = await browser.newPage();
    for (const id of process.argv.slice(2).length ? process.argv.slice(2) : ['1hh0h','8wvhb']) {
        const url = `https://spankbang.com/${id}/embed/`;
        const row = {url};
        try {
            await page.goto(url,{waitUntil:'domcontentloaded',timeout:25000});
            await page.waitForTimeout(7000);
            row.observation = await page.evaluate(() => ({title:document.title,text:document.body.innerText.slice(0,800), scripts:[...document.scripts].map(s=>s.src).filter(Boolean),links:[...document.querySelectorAll('a')].map(a=>({text:a.innerText,href:a.href})), videos:document.querySelectorAll('video').length,iframes:[...document.querySelectorAll('iframe')].map(f=>f.src)}));
            fs.writeFileSync(`architecture-lab/fill-panel/spankbang-top-embed-${id}.html`,await page.content());
            row.sizes = [];
            for (const size of [{width:800,height:450},{width:640,height:360},{width:480,height:270}]) {
                await page.setViewportSize(size);
                row.sizes.push({size,boxes:await page.evaluate(() => [...document.querySelectorAll('video,footer,[class*="footer"],[id*="footer"],a')].map(e=>{const r=e.getBoundingClientRect();return {tag:e.tagName,class:e.className,id:e.id,text:e.tagName==='VIDEO'?'':e.innerText.slice(0,80),x:r.x,y:r.y,w:r.width,h:r.height};}))});
            }
        } catch(e) {row.error=e.message.split('\n')[0];}
        results.push(row);console.log(JSON.stringify(row));
    }
    fs.writeFileSync(`architecture-lab/fill-panel/spankbang-clean-research${process.argv.slice(2).length ? '-additional' : ''}-results.json`,JSON.stringify(results,null,2));
} finally {await browser.close();}
