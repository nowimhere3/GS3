// Single-authorization longevity: ONE companion connection, repeated real activity through its loopback API.
// The Human counts Chrome "Allow remote debugging?" dialogs during this run (expected: 0 after the first Allow).
import fs from 'node:fs';
import { get, snap, line, sleep } from './ctl.mjs';
const MINUTES = Number(process.argv[2] || 4); const END = Date.now() + MINUTES * 60000;
const XV = 'a[href^="/video"], a[href*="xvideos.com/video"]', XN = 'a[href^="/video-"], a[href*="xnxx.com/video-"]', SB = 'a[href*="/video/"]';
const steps = [['browse', 0, XV], ['browse', 2, XN], ['browse', 1, SB], ['refresh', 2], ['browse', 2, XN], ['refresh', 0], ['browse', 0, XV], ['refresh', 1]];
const out = []; const log = (m) => { const l = `${new Date().toISOString().slice(11, 19)} ${m}`; out.push(l); console.log(l); };
let i = 0;
while (Date.now() < END) {
    const [cmd, slot, filter] = steps[i++ % steps.length];
    const r = cmd === 'browse' ? await get(`/api/browse?slot=${slot}&filter=${encodeURIComponent(filter)}`) : await get(`/api/refresh?slot=${slot}`);
    log(`${cmd} slot ${slot} -> ${JSON.stringify(r).slice(0, 90)}`);
    await sleep(6000);
    log('\n' + line(await snap()));
    await sleep(9000);
}
const lf = await get('/api/lifecycle');
log(`DONE. browserWebSockets=${lf.conn.browserWebSockets} childSessionsAttached=${lf.conn.sessionsAttached} detached=${lf.conn.sessionsDetached} stats=${JSON.stringify(lf.stats)}`);
fs.writeFileSync(new URL('./longevity.log', import.meta.url), out.join('\n'));
