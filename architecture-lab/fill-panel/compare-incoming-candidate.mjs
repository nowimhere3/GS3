// Reconstruct the incoming (already uncommitted) candidate in an isolated lab
// directory. Never rewrites, checks out, or resets working-tree files.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const target='architecture-lab/fill-panel/incoming-candidate-smoke';
fs.mkdirSync(target,{recursive:true});
for(const name of ['js','css','userscripts'])if(fs.existsSync(name))fs.cpSync(name,path.join(target,name),{recursive:true});
for(const name of fs.readdirSync('.').filter(x=>x.endsWith('.html')||['package.json','links.json'].includes(x)))fs.copyFileSync(name,path.join(target,name));
fs.mkdirSync(path.join(target,'test'),{recursive:true});
fs.cpSync('test/fixtures',path.join(target,'test/fixtures'),{recursive:true});
fs.mkdirSync(path.join(target,'probe'),{recursive:true});
fs.copyFileSync('test/boot-smoke.test.js',path.join(target,'probe/boot-smoke.probe.mjs'));
let presentation=fs.readFileSync('js/presentation-url.js','utf8').replace(/\r\n/g,'\n');
presentation=presentation.replace(/const FILL_EMBED_RULES = \[\n[\s\S]*?(?=    \/\/ xvideos\.com)/,'const FILL_EMBED_RULES = [\n');
let capability=fs.readFileSync('js/capability-bridge.js','utf8').replace(/\r\n/g,'\n');
capability=capability.replace('    if (state.embedViewport) state.embedViewport.remove();\n    else state.embedFrame.remove();','    state.embedFrame.remove();').replace('    state.embedViewport = null;\n','');
capability=capability.replace(/    \/\/ SpankBang's published embed CSS[\s\S]*?(?=    state\.embedFrame = frame;)/,'    panel.appendChild(frame);\n');
const baseline=JSON.parse(fs.readFileSync('architecture-lab/fill-panel/provider-expansion-baseline.json','utf8'));
for(const [file,content] of [['js/presentation-url.js',presentation],['js/capability-bridge.js',capability]]) {
    const candidates=[content,content.replace(/\n/g,'\r\n')];
    const exact=candidates.find(s=>createHash('sha256').update(s).digest('hex')===baseline[file]);
    if(!exact)throw new Error('Incoming candidate reconstruction failed hash verification: '+file);
    fs.writeFileSync(path.join(target,file),exact);
    console.log(file+': incoming candidate hash verified');
}
