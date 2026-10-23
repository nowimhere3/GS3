import fs from 'node:fs';
import { createHash } from 'node:crypto';
const hosts = ['xcamladyx.com', 'stream-leak.com', 'webpussi.com', 'spankbang.com'];
const db = JSON.parse(fs.readFileSync('links.json', 'utf8'));
const strings = Object.values(db).flat().filter(x => typeof x === 'string');
const coverage = hosts.map(host => {
    const urls = strings.filter(s => { try { const h = new URL(s).hostname; return h === host || h.endsWith('.' + host); } catch { return false; } });
    const video = urls.filter(s => /^\/videos?\/\d+\//.test(new URL(s).pathname) || (host === 'spankbang.com' && /^\/[^/]+\/video\//.test(new URL(s).pathname)));
    return { host, total: urls.length, unique: new Set(urls).size, videoCount: video.length, nonVideoCount: urls.length - video.length, hostnames: [...new Set(urls.map(s => new URL(s).hostname))], specimens: video.slice(0, 3), shapes: [...new Set(urls.map(s => new URL(s).pathname.replace(/\d+/g, '<digits>').split('/').slice(0, 3).join('/')))] };
});
if (!fs.existsSync('architecture-lab/fill-panel/provider-expansion-baseline.json')) {
    const files = ['links.json','js/presentation-url.js','js/capability-bridge.js','js/launch.js','test/fill-embed.test.js','test/fill-visibility.test.js','test/settings-boot.test.js'];
    fs.writeFileSync('architecture-lab/fill-panel/provider-expansion-baseline.json', JSON.stringify(Object.fromEntries(files.map(f => [f, createHash('sha256').update(fs.readFileSync(f)).digest('hex')])), null, 2));
}
fs.writeFileSync('architecture-lab/fill-panel/provider-expansion-coverage.json', JSON.stringify(coverage, null, 2));
console.log(JSON.stringify(coverage, null, 2));
if (process.argv.includes('--fetch')) {
    const targets = coverage.flatMap(c => c.specimens.slice(0, 2));
    for (const [i, url] of targets.entries()) {
        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
            const html = await response.text();
            fs.writeFileSync(`architecture-lab/fill-panel/provider-source-${i}.html`, html);
            console.log(JSON.stringify({ url, final: response.url, status: response.status, bytes: html.length, clues: html.match(/.{0,100}(?:embed|iframe|video_id|kt_player|video_url|player_url|footer).{0,200}/gi)?.slice(0, 20) }));
        } catch (e) { console.log(JSON.stringify({ url, error: e.message })); }
    }
}
