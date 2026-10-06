import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {getFillPresentationUrl} from '../../js/presentation-url.js';
const root='architecture-lab/fill-panel';
const hosts=['xhomealone.com','cumcams.cc','camwhoreshd.com'];
const db=JSON.parse(fs.readFileSync('links.json','utf8'));
const strings=Object.values(db).flat().filter(s=>typeof s==='string');
const coverage=hosts.map(host=>{
    const urls=strings.filter(s=>{try{const h=new URL(s).hostname;return h===host||h.endsWith('.'+host);}catch{return false;}});
    const video=urls.filter(s=>host==='cumcams.cc'?/^\/video\/[1-9]\d*(?:\/play)?\/?$/.test(new URL(s).pathname):/^\/videos\/[1-9]\d*\/[^/]+\/?$/.test(new URL(s).pathname));
    const covered=video.filter(s=>getFillPresentationUrl(s)!==null).length;
    return {host,total:urls.length,unique:new Set(urls).size,videoCount:video.length,nonVideoCount:urls.length-video.length,adapterCoveredVideoCount:covered,videoCoveragePercent:video.length?100*covered/video.length:0,hostnames:[...new Set(urls.map(s=>new URL(s).hostname))],shapes:[...new Set(urls.map(s=>new URL(s).pathname.replace(/\/\d+(?=\/|$)/g,'/<ID>').split('/').slice(0,4).join('/')))],specimens:[...new Set(video)].slice(0,3),nonVideo:urls.filter(s=>!video.includes(s))};
});
if(!fs.existsSync(`${root}/bundle2-baseline.json`)){
    const files=['links.json','presets.json','js/presentation-url.js','js/capability-bridge.js','js/launch.js','test/fill-embed.test.js','test/fill-visibility.test.js','test/settings-boot.test.js','test/fill-provider-expansion.test.js','Docs ANCHOR/009-AUTOMATIONS.md'];
    fs.writeFileSync(`${root}/bundle2-baseline.json`,JSON.stringify(Object.fromEntries(files.map(f=>[f,createHash('sha256').update(fs.readFileSync(f)).digest('hex')])),null,2));
}
fs.writeFileSync(`${root}/bundle2-coverage.json`,JSON.stringify(coverage,null,2));
console.log(JSON.stringify(coverage,null,2));
if(process.argv.includes('--fetch'))await Promise.all(coverage.map(async c=>{
    for(const [i,url] of c.specimens.slice(0,2).entries()){
        try{const response=await fetch(url,{signal:AbortSignal.timeout(20000)});const html=await response.text();fs.writeFileSync(`${root}/bundle2-source-${c.host}-${i}.html`,html);console.log(JSON.stringify({provider:c.host,i,status:response.status,final:response.url,bytes:html.length,headers:{frame:response.headers.get('x-frame-options'),csp:response.headers.get('content-security-policy')},clues:html.match(/.{0,70}(?:iframe|embed|video_id|video_url|player_url|canonical|<video|\.m3u8|\.mp4).{0,200}/gi)?.slice(0,16)}));}catch(e){console.log(JSON.stringify({provider:c.host,i,error:e.message}));}
    }
}));
