import fs from 'node:fs';
const targets=[
    ['xhomealone-162980','https://xhomealone.com/embed/162980'],
    ['xhomealone-214910','https://xhomealone.com/embed/214910'],
    ['camwhoreshd-1892550','https://www.camwhoreshd.com/embed/1892550'],
    ['camwhoreshd-1946972','https://www.camwhoreshd.com/embed/1946972'],
    ['cumcams-check','https://cdn.cumcams.cc/p/cc/589ffbd/js/pages/check.js'],
    ['cumcams-player','https://cdn.cumcams.cc/p/cc/589ffbd/js/main-plyr.js'],
    ['cumcams-main','https://cdn.cumcams.cc/p/cc/589ffbd/main.js'],
    ['cumcams-tail','https://cdn.cumcams.cc/p/cc/589ffbd/js/core/main-tail.js'],
];
const results=await Promise.all(targets.map(async([name,url])=>{
    try{const r=await fetch(url,{signal:AbortSignal.timeout(15000)});const text=await r.text();fs.writeFileSync(`architecture-lab/fill-panel/bundle2-${name}.${name.startsWith('cumcams')?'js':'html'}`,text);return {name,url,final:r.url,status:r.status,bytes:text.length,frame:r.headers.get('x-frame-options'),clues:text.match(/.{0,60}(?:embed|iframe|\.m3u8|video_id|video_url|play_button|window\.open|location\.|\/api\/|\/player\/|\/play).{0,180}/gi)?.slice(0,14)};}catch(e){return{name,url,error:e.message};}
}));
fs.writeFileSync('architecture-lab/fill-panel/bundle2-endpoints.json',JSON.stringify(results,null,2));results.forEach(r=>console.log(JSON.stringify(r)));
