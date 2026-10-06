// R0.1 control client. Talks ONLY to the already-authorized companion on 127.0.0.1:8766.
// It never opens a connection to Chrome (every extra browser-level WebSocket = another Human "Allow remote debugging?").
const B = 'http://127.0.0.1:8766';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const get = async (p) => (await fetch(B + p)).json();
const t = (u) => (u ? u.replace(/^https?:\/\//, '').slice(0, 64) : null);
export const line = (o) => `${o.bridgeConnected ? 'bridge=connected' : 'bridge=OFFLINE'}\n` + o.panels.map((p) => `  [${p.slot}] g${p.gen} A=${t(p.assigned)} | C=${t(p.observedCurrentUrl)} | src=${p.iframeSrcAttr === 'about:blank' ? 'about:blank' : 'assigned'}`).join('\n');
export const snap = async () => get('/api/snap');
if (process.argv[1] && process.argv[1].endsWith('ctl.mjs')) {
    const [cmd, a, b] = process.argv.slice(2);
    if (cmd === 'snap') console.log(line(await snap()));
    else if (cmd === 'panels') console.log(JSON.stringify(await get('/api/panels'), null, 1));
    else if (cmd === 'browse') console.log(JSON.stringify(await get(`/api/browse?slot=${a}&filter=${encodeURIComponent(b || 'a[href*="video"]')}`)).slice(0, 160));
    else if (cmd === 'refresh') console.log(JSON.stringify(await get(`/api/refresh?slot=${a}`)));
    else if (cmd === 'pause' || cmd === 'resume') console.log(JSON.stringify(await get('/api/' + cmd)));
    else if (cmd === 'life') { const o = await get('/api/lifecycle'); console.log(JSON.stringify(o.conn), JSON.stringify(o.stats)); console.log(o.lifecycle.slice(-(Number(a) || 25)).map((e) => `${e.t} ${e.ev} ${e.extra}`).join('\n')); }
    else console.log('usage: ctl.mjs snap|panels|browse <slot> [css]|refresh <slot>|pause|resume|life [n]');
}
