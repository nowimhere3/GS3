import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
const root='architecture-lab/fill-panel/';
const only=process.argv.find(s=>s.startsWith('--only='))?.slice(7);
const nested=process.argv.includes('--nested');
const nativeHeaders=process.argv.includes('--native-headers');
const port=4191, origin=`http://127.0.0.1:${port}`;
const server=spawn('python',['-m','http.server',String(port),'--bind','127.0.0.1'],{stdio:'ignore',windowsHide:true});
const browser=await chromium.launch({channel:'chrome',headless:false});
const rows=[];
const bounded=(p,ms=4000)=>Promise.race([p,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Bounded observation timed out')),ms))]);
const descendants=f=>[f,...f.childFrames().flatMap(descendants)];
const contentFrames=f=>descendants(f).filter(fr=>{try{return ['xhomealone.com','cumcams.cc','www.camwhoreshd.com','www.camwhores.lol'].includes(new URL(fr.url()).hostname);}catch{return false;}});
const media=async f=>(await Promise.all(contentFrames(f).map(fr=>bounded(fr.evaluate(()=>[...document.querySelectorAll('video')].map(v=>({frame:location.href,paused:v.paused,time:v.currentTime,ready:v.readyState,muted:v.muted,volume:v.volume,width:v.videoWidth,audioBytes:v.webkitAudioDecodedByteCount,error:v.error?.code||null}))),2500).catch(()=>[])))).flat();
const evidence=async f=>bounded(f.evaluate(()=>({title:document.title,text:document.body?.innerText.slice(0,300),iframes:[...document.querySelectorAll('iframe')].map(e=>e.src),videos:document.querySelectorAll('video').length,play:!!document.querySelector('#play_button'),links:[...document.querySelectorAll('a')].filter(a=>/embed|player|tv/i.test(a.href+' '+a.textContent)).map(a=>({text:a.textContent.slice(0,50),href:a.href}))}))).catch(e=>({error:e.message}));
async function play(f,page){
  const attempts=[];
  for(const fr of contentFrames(f)){
    const gate=fr.locator('.age__btn');
    if(await gate.isVisible().catch(()=>false)){
      const attempt={frame:fr.url(),selector:'.age__btn'};attempts.push(attempt);
      try{await gate.click({timeout:3500});attempt.clicked=true;}catch(e){attempt.error=e.message.slice(0,1400);}
      await page.waitForTimeout(500);
    }
    for(const selector of ['#play_button','.fp-ui','.plyr__control--overlaid','video']){
      const el=fr.locator(selector).first();
      if(!await el.isVisible().catch(()=>false))continue;
      const attempt={frame:fr.url(),selector};attempts.push(attempt);
      try{await el.click({timeout:3500});attempt.clicked=true;}catch(e){attempt.error=e.message.slice(0,1400);}
      await page.waitForTimeout(2500);
      if((await media(f)).some(v=>!v.paused&&v.time>1))return attempts;
    }
  }
  return attempts;
}
try{
 await new Promise(r=>setTimeout(r,700));
 for(const c of JSON.parse(fs.readFileSync(root+'bundle2-coverage.json','utf8')).filter(c=>!only||c.host===only))for(const[i,canonical]of c.specimens.slice(0,2).entries()){
  const context=await browser.newContext({viewport:{width:1500,height:900}});
  const page=await context.newPage();page.setDefaultTimeout(4000);
  const id=new URL(canonical).pathname.split('/')[2];
  const candidate=c.host==='cumcams.cc'?canonical:c.host==='camwhoreshd.com'&&nested?`https://www.camwhores.lol/embed/${i===0?'16296779':'16330489'}`:`https://${c.host==='camwhoreshd.com'?'www.':''}${c.host}/embed/${id}`;
  const row={host:c.host,specimen:i,canonical,candidate,labOnlyResolver:true,extensionStandin:!nativeHeaders,popups:0,blocked:[],requests:[],apiResponses:[]};
  context.on('page',p=>{if(p!==page)row.popups++;});
  page.on('console',m=>{if(/sandbox|Blocked opening|Unsafe attempt/i.test(m.text()))row.blocked.push(m.text().slice(0,220));});
  page.on('request',r=>{if(/embed|\.mp4|\.m3u8|api\/video|\/tv/i.test(r.url()))row.requests.push(r.url().split('?')[0]);});
  page.on('response',async r=>{if(/\/api\/video\/\d+\?/.test(r.url()))row.apiResponses.push({url:r.url().split('?')[0],status:r.status(),text:await bounded(r.text(),5000).then(s=>s.slice(0,600)).catch(e=>e.message)});});
  // Research-only exact specimen mapping, served into this isolated browser. The
  // actual Fill executor and production files remain unchanged.
  await context.route(origin+'/js/presentation-url.js',route=>route.fulfill({contentType:'text/javascript',body:fs.readFileSync('js/presentation-url.js','utf8').replace('export function getFillPresentationUrl(url) {',`export function getFillPresentationUrl(url) { if (url === ${JSON.stringify(canonical)}) return ${JSON.stringify(candidate)};`)}));
  // Stand-in for the Human's Ignore X-Frame Headers extension. Sandbox is intact.
  if(!nativeHeaders)await context.route('**/*',async route=>{
   if(route.request().resourceType()!=='document'||route.request().url().startsWith(origin))return route.fallback();
   try{const response=await route.fetch({timeout:15000});const headers={...response.headers()};delete headers['x-frame-options'];delete headers['content-security-policy'];await route.fulfill({response,headers});}catch{await route.continue().catch(()=>{});}
  });
  await page.addInitScript(u=>{if(window===window.top)localStorage.setItem('loop_matrix_urls',JSON.stringify([u,'/test/fixtures/canary.html?id=B','/test/fixtures/canary.html?id=C']));},canonical);
  try{
   await page.goto(origin+'/index3.html',{waitUntil:'domcontentloaded',timeout:15000});
   await page.waitForTimeout(6000);
   const original=await page.locator('.stream-panel[data-slot-index="0"] > iframe').elementHandle();
   const normal=await original.contentFrame();
   row.normal=await evidence(normal);row.frames=descendants(normal).map(f=>f.url());
   row.underlyingAutoplay=await media(normal);
   row.normalPlayAttempts=await play(normal,page);row.underlyingBeforeFill=await media(normal);
   row.normalAfterClick=await evidence(normal);
   row.executorBefore=await bounded(page.evaluate(async()=>{
    const p=document.querySelector('.stream-panel[data-slot-index="0"]');window.__original=p.querySelector('iframe');
    window.__before={src:window.__original.src,identity:window.__original.getAttribute('data-last-src'),session:(await import('./js/grid-session.js')).getSessionUrls()[0]};
    const b=p.querySelector('.btn-hotswap-fill-panel');window.__fillVisible=!b.hidden;
    const diagnostics={...window.__before,capability:(await import('./js/capability-bridge.js')).getFillPanelCapabilityState(p),mapped:(await import('./js/presentation-url.js')).getFillPresentationUrl(window.__before.identity)};
    b.click();diagnostics.immediateOverlays=p.querySelectorAll('.gs3-fill-embed').length;return diagnostics;
   }));
   await page.waitForTimeout(6000);
   const handle=await page.locator('iframe.gs3-fill-embed').elementHandle();
   if(!handle)throw new Error('Actual executor Fill iframe was not present after the wait');
   const fill=await handle.contentFrame();row.embed=await evidence(fill);row.fillFrames=descendants(fill).map(f=>f.url());
   row.beforePlay=await media(fill);row.fillPlayAttempts=await play(fill,page);await page.waitForTimeout(3500);row.afterPlay=await media(fill);
   row.playing=row.afterPlay.some(v=>!v.paused&&v.time>1&&v.ready>=2);
   row.audio=row.afterPlay.some(v=>!v.paused&&!v.muted&&v.volume>0&&v.audioBytes>0);
   row.underlyingDuring=await media(normal);
   row.doubleAudio=row.audio&&row.underlyingDuring.some(v=>!v.paused&&!v.muted&&v.volume>0&&v.audioBytes>0);
   row.controls=[];
   if(row.playing)for(const fr of contentFrames(fill)){
    const pause=fr.locator('.fp-play,[data-plyr="play"]').first();
    if(await pause.isVisible().catch(()=>false)){
      await pause.click({timeout:2500}).catch(()=>{});await page.waitForTimeout(300);
      const paused=(await media(fill)).some(v=>v.paused);await pause.click({timeout:2500}).catch(()=>{});
      row.controls.push({frame:fr.url(),pauseWorked:paused});
    }
    const full=fr.locator('.fp-fullscreen,[data-plyr="fullscreen"]').first();
    if(await full.isVisible().catch(()=>false)){
      await full.click({timeout:2500}).catch(()=>{});row.fullscreen=await bounded(fr.evaluate(()=>!!document.fullscreenElement)).catch(()=>false);
      if(row.fullscreen)await page.keyboard.press('Escape');
    }
   }
   row.geometry=[];
   for(const size of [{width:1200,height:700},{width:900,height:600}]){await page.setViewportSize(size);row.geometry.push({size,box:await handle.boundingBox()});}
   row.exit=await bounded(page.evaluate(async()=>{
    document.querySelector('.stream-panel[data-slot-index="0"] .btn-hotswap-fill-panel').click();
    return{noOverlay:!document.querySelector('.gs3-fill-embed'),sameFrame:window.__original===document.querySelector('.stream-panel[data-slot-index="0"] > iframe'),sameSrc:window.__original.src===window.__before.src,sameIdentity:window.__original.getAttribute('data-last-src')===window.__before.identity,sameSession:(await import('./js/grid-session.js')).getSessionUrls()[0]===window.__before.session,shield:window.__original.getAttribute('sandbox'),fillVisible:window.__fillVisible};
   }));
   row.topStayed=page.url()===origin+'/index3.html';
  }catch(e){row.error=e.message.split('\n')[0];}
  rows.push(row);fs.writeFileSync(root+`bundle2-browser-${only||'all'}${nested?'-nested':''}${nativeHeaders?'-native':''}.json`,JSON.stringify(rows,null,2));
  console.log(JSON.stringify({host:row.host,specimen:i,playing:row.playing,audio:row.audio,embed:row.embed,executorBefore:row.executorBefore,afterPlay:row.afterPlay,exit:row.exit,popups:row.popups,error:row.error}));await bounded(context.close(),10000).catch(()=>{});
 }
}finally{await bounded(browser.close(),10000).catch(()=>{});server.kill();}
process.exit(0);
