// Graceful-degradation on the REAL GS3: bridge "absent" (SSE refused/closed, no new Chrome connection) -> real Refresh still works.
import { get, snap, line, sleep } from './ctl.mjs';
await get('/api/pause'); await sleep(2500);
console.log('BRIDGE PAUSED\n' + line(await snap()));
await get('/api/refresh?slot=1'); await sleep(300);
console.log('real Refresh slot 1 (immediately)\n' + line(await snap()));
await sleep(3500);
console.log('after load\n' + line(await snap()));
await get('/api/resume'); await sleep(2500);
console.log('BRIDGE RESUMED\n' + line(await snap()));
