// R0 Current-URL Bridge companion. Chrome (CDP) -> this process -> SSE on 127.0.0.1:8766 -> GS3 receiver.
// Provider-agnostic: no URL parsing beyond reporting what the browser says. No GS3 writes.
// Usage: node companion.mjs [--cdp http://127.0.0.1:9333] [--host-origin http://gs3.test] [--debug]
import http from 'node:http';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const CDP_HTTP = arg('--cdp', 'http://127.0.0.1:9333');
const HOST_ORIGIN = arg('--host-origin', 'http://gs3.test');
const CDP_WS = arg('--ws', null);              // direct browser endpoint (existing-Chrome / DevToolsActivePort mode)
const HOST_URL = arg('--host-url', null);      // exact host page url prefix (existing-Chrome mode)
const INJECT = arg('--inject', null);          // temporary page-side harness file
const PORT = 8766;
const DEBUG = process.argv.includes('--debug');
const dbg = (...a) => DEBUG && console.log('[bridge]', ...a);

// ── minimal CDP client (flattened sessions, Node's built-in WebSocket) ─────────
class Cdp {
    constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); this.handlers = []; }
    open() {
        return new Promise((res, rej) => {
            this.ws = new WebSocket(this.url);
            this.ws.onopen = res;
            this.ws.onerror = () => rej(new Error('cdp connect failed'));
            this.ws.onclose = () => { for (const p of this.pending.values()) p.rej(new Error('closed')); this.onclose?.(); };
            this.ws.onmessage = (e) => {
                const m = JSON.parse(e.data);
                if (m.id) {
                    const p = this.pending.get(m.id); this.pending.delete(m.id);
                    if (m.error) p?.rej(new Error(m.error.message)); else p?.res(m.result);
                } else for (const h of this.handlers) h(m);
            };
        });
    }
    send(method, params = {}, sessionId) {
        const id = ++this.id;
        return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params, sessionId })); });
    }
}

// ── state ─────────────────────────────────────────────────────────────────────
const sessions = new Map();     // sessionId -> { type, targetId }
const frameSession = new Map(); // frameId -> sessionId whose Page domain reports it
const frameSlot = new Map();    // frameId -> slot   (resolved from the owner <iframe> element)
const slots = new Map();        // slot -> { gen, fence:Set<loaderId>, lastLoader, frameId }
const latest = new Map();       // slot -> last observation (replayed to new SSE clients)
const clients = new Set();
const rollovers = new Map();    // slot -> number of generation rollovers seen (arrival-order stamp)
const stats = { emitted: 0, stale: 0, ignored: 0 };
const conn = { browserWebSockets: 0, openedAt: null, sessionsAttached: 0, sessionsDetached: 0 };   // authorization evidence
const lifecycle = [];            // timestamped connection/session events (correlate with Chrome dialogs)
const life = (ev, extra = '') => { lifecycle.push({ t: new Date().toISOString().slice(11, 23), ev, extra }); if (lifecycle.length > 400) lifecycle.shift(); };
let delayMs = 0;
let cdp; let hostSession = null; let hostMainFrameId = null;

const slotState = (s) => {
    if (!slots.has(s)) slots.set(s, { gen: 0, fence: new Set(), lastLoader: null, frameId: null });
    return slots.get(s);
};
const emit = (o) => {
    o.at = Date.now(); stats.emitted++; latest.set(o.slot, o);
    for (const c of clients) c.write(`data: ${JSON.stringify(o)}\n\n`);
    console.log(`[bridge] slot ${o.slot} gen ${o.gen} ${o.kind}: ${o.url}`);
};

// Frame <-> Panel correlation: the host-owned <iframe> element (data-gs3-slot), NOT frame.name / window.name.
async function resolveSlot(frameId) {
    if (frameSlot.has(frameId)) return frameSlot.get(frameId);
    try {
        const { backendNodeId } = await cdp.send('DOM.getFrameOwner', { frameId }, hostSession);
        const { node } = await cdp.send('DOM.describeNode', { backendNodeId }, hostSession);
        const a = node.attributes || [];
        const i = a.indexOf('data-gs3-slot');
        if (node.nodeName !== 'IFRAME' || i < 0) return null;   // slot 0 is valid: callers must compare to null
        const slot = Number(a[i + 1]);
        frameSlot.set(frameId, slot); slotState(slot).frameId = frameId;
        return slot;
    } catch (e) { dbg('owner lookup failed', frameId, e.message); return null; }
}

// Panel frame = direct child of the host's main frame (nested descendants are not Panels).
const isPanelFrame = (frame, sid) => frame.parentId === hostMainFrameId || (sid !== hostSession && !frame.parentId);

const stampNow = () => Object.fromEntries(rollovers);
const predatesRollover = (stamp, slot) => !process.env.R0_NO_GUARD && stamp && (stamp[slot] || 0) !== (rollovers.get(slot) || 0);

async function onNavigated(frame, sid, kind = 'navigated', stamp = null) {
    frameSession.set(frame.id, sid);
    if (sid === hostSession && !frame.parentId) { hostMainFrameId = frame.id; return; }
    if (!isPanelFrame(frame, sid)) { stats.ignored++; dbg('ignored non-panel frame', frame.url, 'parent', frame.parentId, 'host', hostMainFrameId); return; }
    const slot = await resolveSlot(frame.id);
    if (slot === null) { stats.ignored++; dbg('ignored unresolved frame', frame.url); return; }
    const st = slotState(slot);
    if (predatesRollover(stamp, slot)) { stats.stale++; console.log(`[bridge] STALE(arrival) dropped slot ${slot} ${frame.url}`); return; }
    if (frame.loaderId && st.fence.has(frame.loaderId)) { stats.stale++; console.log(`[bridge] STALE dropped slot ${slot} ${frame.url}`); return; }
    if (frame.loaderId) st.lastLoader = frame.loaderId;
    if (frame.url === 'about:blank') return;   // GS3's own transitional load (Reload: about:blank -> assigned)
    emit({ slot, gen: st.gen, kind, url: frame.url + (frame.urlFragment || ''), loaderId: frame.loaderId });
}
async function onSameDoc(frameId, url, sid, stamp = null) {
    frameSession.set(frameId, sid);
    const slot = await resolveSlot(frameId);
    if (slot === null) { stats.ignored++; return; }
    const st = slotState(slot);
    if (predatesRollover(stamp, slot)) { stats.stale++; return; }
    if (st.lastLoader && st.fence.has(st.lastLoader)) { stats.stale++; return; }
    emit({ slot, gen: st.gen, kind: 'sameDocument', url, loaderId: st.lastLoader });
}

// GS3 announces a new content generation (Shuffle/Assign/Refresh) BEFORE navigating. Two guards:
//  1. arrival stamp: every CDP event is stamped with the per-slot rollover count when it ARRIVES; if a rollover
//     happened before it finishes processing it belongs to the old generation and is dropped.
//  2. loader fence: the last document we had seen for the slot is fenced, so late same-document/old-doc events
//     that arrive after the rollover (e.g. reordered across CDP sessions) cannot be stamped with the new generation.
// (The fence deliberately uses only what the bridge already saw - reading the browser's "current loader" here races
// with the new navigation committing and wrongly fenced the new landing document.)
async function onRollover({ slot, gen }) {
    life('generation-rollover', `slot ${slot} gen ${gen}`);
    const st = slotState(slot);
    rollovers.set(slot, (rollovers.get(slot) || 0) + 1);
    st.gen = gen; latest.delete(slot);
    st.fence = new Set(st.lastLoader && !process.env.R0_NO_GUARD ? [st.lastLoader] : []);
    st.lastLoader = null;
    dbg('rollover', slot, gen, 'fence', [...st.fence]);
}

// ── attachment: host page + recursive auto-attach (OOPIF) ─────────────────────
async function setupSession(sid, info) {
    sessions.set(sid, info);
    await cdp.send('Page.enable', {}, sid).catch(() => {});
    await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sid).catch(() => {});
    const r = await cdp.send('Page.getFrameTree', {}, sid).catch(() => null);
    if (!r) return;
    const { frameTree } = r;
    if (sid === hostSession) {
        hostMainFrameId = frameTree.frame.id;
        frameSession.set(hostMainFrameId, sid);
        for (const c of frameTree.childFrames || []) await onNavigated({ ...c.frame, parentId: hostMainFrameId }, sid, 'snapshot');
    } else {
        await onNavigated({ ...frameTree.frame }, sid, 'snapshot');
    }
}

async function attachHost(targetId) {
    hostSession = 'pending';
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    hostSession = sessionId;
    await cdp.send('DOM.enable', {}, sessionId);
    await cdp.send('DOM.getDocument', { depth: 0 }, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Runtime.addBinding', { name: 'gs3BridgeRollover' }, sessionId);
    if (INJECT) {
        const src = (await import('node:fs')).readFileSync(INJECT, 'utf8');
        const ir = await cdp.send('Runtime.evaluate', { expression: src, awaitPromise: true, returnByValue: true }, sessionId);
        console.log('[bridge] inject:', ir.exceptionDetails ? JSON.stringify(ir.exceptionDetails.exception?.description || ir.exceptionDetails.text) : ir.result.value);
    }
    const r = await cdp.send('Runtime.evaluate', { expression: 'JSON.stringify(window.GS3Lab&&GS3Lab.gens())', returnByValue: true }, sessionId);
    const gens = r.result.value ? JSON.parse(r.result.value) : {};
    for (const [s, g] of Object.entries(gens)) slotState(Number(s)).gen = g;
    await setupSession(sessionId, { type: 'page', targetId });
    console.log(`[bridge] attached to host page ${targetId}; gens`, JSON.stringify(gens));
}

function onEvent(m) {
    const sid = m.sessionId; const p = m.params || {};
    switch (m.method) {
        case 'Target.attachedToTarget': {
            const t = p.targetInfo;
            conn.sessionsAttached++; life('child-session-attached', `${t.type} ${t.url.slice(0, 50)}`);
            dbg('attached', p.sessionId, t.type, t.url);
            if (t.type === 'iframe') setupSession(p.sessionId, { type: 'iframe', targetId: t.targetId });
            else cdp.send('Runtime.runIfWaitingForDebugger', {}, p.sessionId).catch(() => {});
            break;
        }
        case 'Target.detachedFromTarget': conn.sessionsDetached++; life('child-session-detached'); sessions.delete(p.sessionId); break;
        case 'Page.frameNavigated': { const stamp = stampNow(); setTimeout(() => onNavigated(p.frame, sid, 'navigated', stamp), delayMs); break; }
        case 'Page.navigatedWithinDocument': { const stamp = stampNow(); setTimeout(() => onSameDoc(p.frameId, p.url, sid, stamp), delayMs); break; }
        case 'Runtime.bindingCalled': if (p.name === 'gs3BridgeRollover') onRollover(JSON.parse(p.payload)); break;
        case 'Target.targetInfoChanged':
        case 'Target.targetCreated':
            if (!hostSession && p.targetInfo.type === 'page' && p.targetInfo.url.startsWith(HOST_URL || HOST_ORIGIN)) {
                attachHost(p.targetInfo.targetId).catch((e) => console.log('attach failed', e.message));
            }
            break;
        default:
    }
}

// ── SSE / state / diagnostic API (loopback only). Helpers talk HERE, never to Chrome. ──────────
let bridgePaused = false;       // lab-only: simulate "bridge absent" from GS3's perspective WITHOUT a new Chrome connection
const hostEval = async (expression) => {
    const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, hostSession);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
};
const sessionOfSlot = (slot) => { const fid = slotState(slot).frameId; const sid = fid && frameSession.get(fid); return sid && sid !== hostSession && sessions.has(sid) ? sid : null; };
const clip = (u) => (u ? u.replace(/^https?:\/\//, '').slice(0, 70) : null);

async function api(path, q) {
    switch (path) {
        case '/api/snap': return JSON.parse(await hostEval('JSON.stringify(window.GS3R0.status())'));
        case '/api/panels': return [...slots].map(([slot, v]) => ({ slot, gen: v.gen, frameId: v.frameId?.slice(0, 6), via: sessionOfSlot(slot) ? 'OOPIF iframe target (child session)' : 'host page frame tree' }));
        case '/api/refresh': {   // the REAL GS3 Refresh control
            const slot = Number(q.get('slot'));
            await hostEval(`document.querySelector('.stream-panel[data-slot-index="${slot}"] .btn-hotswap-reload').click()`);
            return { clicked: 'btn-hotswap-reload', slot };
        }
        case '/api/browse': {    // click a real in-page link inside the Panel's provider iframe (child session of the ONE connection)
            const slot = Number(q.get('slot')); const filter = q.get('filter') || 'a[href*="video"]';
            const sid = sessionOfSlot(slot);
            if (!sid) return { error: 'panel is not an OOPIF child session' };
            const expr = `(() => { const here = location.href.split('#')[0];
              const as = [...document.querySelectorAll(${JSON.stringify(filter)})].filter((a) => a.href && a.target !== '_blank' && a.href.split('#')[0] !== here && a.offsetParent && new URL(a.href).hostname === location.hostname);
              const a = as[Math.min(2, as.length - 1)]; if (!a) return JSON.stringify({ none: as.length });
              const href = a.href; a.click(); return JSON.stringify({ clicked: href, candidates: as.length }); })()`;
            const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true }, sid);
            return r.result.value ? JSON.parse(r.result.value) : { error: r.exceptionDetails?.text };
        }
        case '/api/pause': bridgePaused = true; for (const c of clients) c.end(); clients.clear(); return { paused: true };
        case '/api/resume': bridgePaused = false; return { paused: false };
        case '/api/lifecycle': return { conn, stats, lifecycle };
        default: return null;
    }
}

http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    res.setHeader('access-control-allow-origin', '*');
    if (u.pathname === '/events') {
        if (bridgePaused) { res.writeHead(503).end(); return; }
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        res.write(': hi\n\n'); clients.add(res); req.on('close', () => clients.delete(res));
        for (const o of latest.values()) res.write(`data: ${JSON.stringify(o)}\n\n`);
    } else if (u.pathname === '/debug/delay') {
        delayMs = Number(u.searchParams.get('ms') || 0); res.end(String(delayMs));
    } else if (u.pathname === '/state') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ stats, conn, delayMs, sessions: [...sessions.values()].map((s) => s.type), slots: [...slots].map(([k, v]) => ({ slot: k, gen: v.gen })) }));
    } else if (u.pathname.startsWith('/api/')) {
        res.setHeader('content-type', 'application/json');
        try { const out = await api(u.pathname, u.searchParams); res.writeHead(out === null ? 404 : 200).end(JSON.stringify(out)); }
        catch (e) { res.writeHead(500).end(JSON.stringify({ error: e.message })); }
    } else res.writeHead(404).end();
}).listen(PORT, '127.0.0.1');

// ── boot ──────────────────────────────────────────────────────────────────────
try {
    let wsUrl = CDP_WS;
    if (!wsUrl) {
        const v = await (await fetch(CDP_HTTP + '/json/version')).json();
        console.log(`[bridge] Chrome: ${v.Browser}`);
        wsUrl = v.webSocketDebuggerUrl;
    }
    cdp = new Cdp(wsUrl);
    const t0 = Date.now();
    conn.browserWebSockets++; life('browser-websocket-opening (the ONLY one this process will ever open)');
    await cdp.open();
    conn.openedAt = new Date().toISOString(); life('browser-websocket-open', `${Date.now() - t0} ms (includes any Human authorization wait)`);
    console.log(`[bridge] ONE browser-level connection open after ${Date.now() - t0} ms`);
    cdp.onclose = () => { console.log('[bridge] browser connection closed - exiting; NEVER reconnecting (a new connection = a new Human authorization)'); process.exit(0); };
    cdp.handlers.push(onEvent);
    // Existing-Chrome mode: no Target discovery stream (keeps other tabs out of the bridge); one getTargets, host only.
    if (!CDP_WS) await cdp.send('Target.setDiscoverTargets', { discover: true });
    const { targetInfos } = await cdp.send('Target.getTargets');
    const host = targetInfos.find((t) => t.type === 'page' && t.url.startsWith(HOST_URL || HOST_ORIGIN));
    if (host && !hostSession) await attachHost(host.targetId);
    else if (!host) console.log('[bridge] host page not found');
    console.log('[bridge] READY');
} catch (e) { console.log('[bridge] cannot reach Chrome:', e.message); process.exit(1); }
