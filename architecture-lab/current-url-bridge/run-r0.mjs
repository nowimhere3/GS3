// R0 runner: real installed Chrome (non-default profile, --remote-debugging-port) + companion + fixture sites.
// Run: node architecture-lab/current-url-bridge/run-r0.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startFixture } from './fixture-server.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP = 'http://127.0.0.1:9333';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = []; const notes = {};
const check = (id, name, pass, evidence) => { results.push({ id, name, pass: !!pass, evidence }); console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${name} :: ${JSON.stringify(evidence)}`); };
async function until(fn, ms = 6000, label = '') {
    const t0 = Date.now();
    for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timeout ' + label); await sleep(50); }
}

const fixture = await startFixture();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'gs3-r0-'));
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9333', `--user-data-dir=${profile}`,
    '--host-resolver-rules=MAP *.test 127.0.0.1:8765', '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
await until(async () => { try { return (await fetch(CDP + '/json/version')).ok; } catch { return false; } }, 15000, 'chrome');
const ver = await (await fetch(CDP + '/json/version')).json();
notes.chrome = ver.Browser; notes.profile = 'temp non-default --user-data-dir';
console.log('Chrome', ver.Browser);

let comp = null; let compLog = '';
function startCompanion() {
    compLog = '';
    comp = spawn(process.execPath, [path.join(dir, 'companion.mjs'), '--cdp', CDP, '--debug'], { stdio: ['ignore', 'pipe', 'pipe'] });
    comp.stdout.on('data', (d) => { compLog += d; });
    comp.stderr.on('data', (d) => { compLog += d; });
    return until(() => compLog.includes('READY') || compLog.includes('cannot reach'), 10000, 'companion');
}

const browser = await chromium.connectOverCDP(CDP);
const ctx = browser.contexts()[0];
const page = await ctx.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://gs3.test/');
await startCompanion();
const st = () => page.evaluate(() => window.GS3Lab.status());
const bridge = (p = '') => fetch('http://127.0.0.1:8766' + p).then((r) => r.json());
const fr = (s) => page.frameLocator(`iframe[data-gs3-slot="${s}"]`);
const frameUrl = (s) => page.locator(`iframe[data-gs3-slot="${s}"]`).elementHandle().then((h) => h.contentFrame()).then((f) => f?.url());
await until(async () => (await st()).connected, 5000, 'receiver connect');

const A1 = 'http://a.test/search/deepthroat?top';
const A2 = 'http://b.test/';
await page.evaluate(([a, b]) => { GS3Lab.assign(1, a); GS3Lab.assign(2, b); }, [A1, A2]);
await until(async () => (await frameUrl(1)) === A1 && (await frameUrl(2)) === A2, 8000, 'initial load');
await sleep(500);
let s = await st();
check('0', 'landing at assigned is not a wander (Observed null)', s.panels[1].observedCurrentUrl === null && s.panels[2].observedCurrentUrl === null, { gen: [s.panels[1].gen, s.panels[2].gen] });

// 1 + 2: A -> B -> C in slot 1 (same-site, then cross-site)
await fr(1).locator('#to-video').click();
const B1 = 'http://a.test/video-zz81k2/another_slug?x=1';
await until(async () => (await st()).panels[1].observedCurrentUrl === B1, 5000, 'A->B');
s = await st();
check('1', 'cross-origin navigation A->B observed', true, { assigned: s.panels[1].assigned, current: s.panels[1].observedCurrentUrl, gen: s.panels[1].gen });
const gen1 = s.panels[1].gen;
await fr(1).locator('#to-b').click();
await until(async () => (await st()).panels[1].observedCurrentUrl === 'http://b.test/', 5000, 'B->C');
s = await st();
check('2', 'second navigation B->C (cross-site, process swap) updates Current', true, { current: s.panels[1].observedCurrentUrl });
check('4', 'assignedUrl / data-last-src untouched by browsing', s.panels[1].assigned === A1 && s.panels[1].dataLastSrc === A1 && s.panels[1].gen === gen1, { assigned: s.panels[1].assigned, dataLastSrc: s.panels[1].dataLastSrc, gen: s.panels[1].gen });

// 3: correct panel
check('3a', 'Panel 2 unaffected by Panel 1 navigation', s.panels[2].observedCurrentUrl === null, { slot2: s.panels[2].observedCurrentUrl });
await fr(2).locator('#to-search').click();
const S2 = 'http://b.test/search/deepthroat?top';
await until(async () => (await st()).panels[2].observedCurrentUrl?.startsWith('http://b.test/search/'), 5000, 'slot2 nav');
s = await st();
check('3b', 'Panel 2 navigation does not touch Panel 1', s.panels[1].observedCurrentUrl === 'http://b.test/' && s.panels[2].observedCurrentUrl.startsWith('http://b.test/search/'), { slot1: s.panels[1].observedCurrentUrl, slot2: s.panels[2].observedCurrentUrl });

// 8: OOPIF
const bs = await bridge('/state');
const oopif = bs.sessions.filter((x) => x === 'iframe').length;
check('8', 'cross-origin children are OOPIF targets and were captured', oopif >= 1, { iframeSessions: oopif, sessions: bs.sessions });

// provider independence incl. an "unknown" site (c.test has no adapter, no regex anywhere in the path)
await page.evaluate(() => GS3Lab.assign(2, 'http://c.test/whatever/path?q=1'));
await until(async () => (await frameUrl(2)) === 'http://c.test/whatever/path?q=1', 5000, 'c load');
await fr(2).locator('#to-home').click();
await until(async () => (await st()).panels[2].observedCurrentUrl === 'http://c.test/', 5000, 'c nav');
check('7', 'provider independence: a.test, b.test, c.test all observed by the same mechanism', true, { hosts: ['a.test', 'b.test', 'c.test'], current: (await st()).panels[2].observedCurrentUrl });

// optional: same-document navigation
await page.evaluate(() => GS3Lab.assign(2, 'http://a.test/spa'));
await until(async () => (await frameUrl(2)) === 'http://a.test/spa', 5000, 'spa load');
await fr(2).locator('#push').click();
await until(async () => (await st()).panels[2].observedCurrentUrl === 'http://a.test/spa/pushed', 4000, 'pushState');
const pushed = (await st()).panels[2].observation.kind;
await fr(2).locator('#hash').click();
await until(async () => (await st()).panels[2].observedCurrentUrl === 'http://a.test/spa/pushed#route2' || (await st()).panels[2].observedCurrentUrl === 'http://a.test/spa#route2', 4000, 'hash');
check('B1', 'bonus: pushState + hash change observed (same-document)', true, { kind: pushed, current: (await st()).panels[2].observedCurrentUrl });

// spoofed window.name must not change attribution
await page.evaluate(() => GS3Lab.assign(1, 'http://a.test/hijack'));
await until(async () => (await frameUrl(1)) === 'http://a.test/hijack', 5000, 'hijack load');
const before2 = (await st()).panels[2].observedCurrentUrl;
await fr(1).locator('#to-video').click();
await until(async () => (await st()).panels[1].observedCurrentUrl === 'http://a.test/video-hj1/x', 4000, 'hijack nav');
s = await st();
check('M', 'child window.name = "gs3-panel-slot-2" does not mis-attribute (mapping uses host-owned iframe element)', s.panels[2].observedCurrentUrl === before2 && s.panels[1].observedCurrentUrl === 'http://a.test/video-hj1/x', { slot1: s.panels[1].observedCurrentUrl, slot2: s.panels[2].observedCurrentUrl });

// 5: refresh returns to assigned, Current clears
const genBefore = s.panels[1].gen; const assigned1 = s.panels[1].assigned;
await page.evaluate(() => GS3Lab.refresh(1));
const right = (await st()).panels[1];
await until(async () => (await frameUrl(1)) === assigned1, 5000, 'refresh load');
await sleep(500);
s = await st();
check('5', 'Refresh reloads Assigned, clears Current, advances generation', right.observedCurrentUrl === null && s.panels[1].observedCurrentUrl === null && s.panels[1].gen === genBefore + 1 && s.panels[1].dataLastSrc === assigned1, { iframeUrl: await frameUrl(1), currentRightAfter: right.observedCurrentUrl, currentAfterLoad: s.panels[1].observedCurrentUrl, gen: `${genBefore}->${s.panels[1].gen}` });

// 6: generation safety with a slow event
await fetch('http://127.0.0.1:8766/debug/delay?ms=2000');
await fr(1).locator('#to-video').click();                       // A -> B commits fast, its event is delayed 2s
await sleep(250);
await page.evaluate(() => GS3Lab.shuffle(1, 'http://c.test/shuffled'));  // new assignment before the old event is processed
await until(async () => (await frameUrl(1)) === 'http://c.test/shuffled', 5000, 'shuffle load');
await sleep(3200);                                              // let delayed events drain
await fetch('http://127.0.0.1:8766/debug/delay?ms=0');
s = await st(); const bs2 = await bridge('/state');
const newGen = s.panels[1].gen;   // the old document's URL must never be accepted under the new generation, even transiently
const contaminated = s.panels[1].observedCurrentUrl !== null || s.log.some((e) => e.accepted === 1 && e.gen === newGen && /video-hj1/.test(e.url));
if (process.env.DUMP) console.log(compLog.split(String.fromCharCode(10)).filter((l) => /STALE|rollover|slot 1/.test(l)).slice(-15).join(String.fromCharCode(10)));
check('6', 'slow event for old generation does not contaminate new generation', !contaminated && bs2.stats.stale >= 1, { currentAfter: s.panels[1].observedCurrentUrl, staleDropped: bs2.stats.stale, recvDrops: s.log.filter((e) => e.dropped).length });

// 9: disconnect safety
comp.kill();
await until(async () => !(await st()).connected, 5000, 'receiver sees disconnect');
s = await st();
const offlineNull = s.panels[1].observedCurrentUrl === null && s.panels[2].observedCurrentUrl === null;
await page.evaluate(() => GS3Lab.shuffle(1, 'http://b.test/search/offline'));
await until(async () => (await frameUrl(1)) === 'http://b.test/search/offline', 5000, 'offline shuffle');
await page.evaluate(() => GS3Lab.refresh(1));
await sleep(400);
const okLoad = (await frameUrl(1)) === 'http://b.test/search/offline';
check('9', 'companion killed: GS3 Shuffle/Refresh still work, Current = null', offlineNull && okLoad && errors.length === 0, { receiverConnected: s.connected, shuffleAndRefreshWorked: okLoad, pageErrors: errors });

// recovery: browse while companion is down, restart, snapshot restores Current
await fr(1).locator('#to-video').click();
await sleep(300);
const browsedUrl = await frameUrl(1);
await startCompanion();
await until(async () => (await st()).connected && (await st()).panels[1].observedCurrentUrl === browsedUrl, 8000, 'recovery');
check('R', 'companion restart re-attaches and recovers Current (snapshot) without GS3 changes', true, { current: (await st()).panels[1].observedCurrentUrl, gen: (await st()).panels[1].gen });

// 10: DevTools coexistence — a second raw CDP client attached to host page + auto-attach (what the F12 frontend does).
// (Playwright is also a concurrent client for the whole run.)
const ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((r) => { ws.onopen = r; });
let mid = 0; const waiters = new Map(); let evCount = 0;
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m.result); } else evCount++; };
const send = (method, params = {}, sessionId) => new Promise((r) => { const id = ++mid; waiters.set(id, r); ws.send(JSON.stringify({ id, method, params, sessionId })); });
const { targetInfos } = await send('Target.getTargets');
const hostT = targetInfos.find((t) => t.url.startsWith('http://gs3.test'));
const { sessionId: dsid } = await send('Target.attachToTarget', { targetId: hostT.targetId, flatten: true });
for (const d of ['Page', 'Runtime', 'Network', 'DOM', 'Log']) await send(d + '.enable', {}, dsid);
await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, dsid);
await sleep(300);
await fr(2).locator('#to-home').click().catch(async () => { await page.evaluate(() => GS3Lab.assign(2, 'http://b.test/')); });
await page.evaluate(() => GS3Lab.assign(2, 'http://b.test/'));
await until(async () => (await frameUrl(2)) === 'http://b.test/', 5000, 'dt assign');
await fr(2).locator('#to-search').click();
await until(async () => (await st()).panels[2].observedCurrentUrl === S2, 5000, 'observation while devtools attached');
check('10', 'extra DevTools-style CDP client attached: bridge keeps observing (no forced disconnect)', (await st()).connected && evCount > 0, { devtoolsClientEvents: evCount, bridgeConnected: (await st()).connected, note: 'simulated F12 client; real headed F12 not exercised' });
ws.close();

// teardown
comp.kill(); await browser.close().catch(() => {}); chrome.kill(); fixture.close();
await sleep(500); try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify({ notes, results, pageErrors: errors }, null, 2));
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
