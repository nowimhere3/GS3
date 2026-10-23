'use strict';
// Throwaway lab. No production imports, no persistent storage.
const SANDBOX = 'allow-same-origin allow-scripts allow-forms allow-popups';
const $ = (id) => document.getElementById(id);

// ── Probe 1: adapters ────────────────────────────────────────────────
// Each returns { provider, id, embeds:[{label,url}] } or null when unparseable.
function one(provider, id, url) { return { provider, id, embeds: [{ label: 'embed', url }] }; }
function adapt(raw) {
    let u; try { u = new URL(raw); } catch { return null; }
    const h = u.hostname.replace(/^www\./, ''), p = u.pathname;
    let m;
    if ((h === 'xvideos.red' || h === 'xvideos.com') && (m = p.match(/^\/video\.([^/]+)/))) {
        return { provider: h, id: m[1], embeds: h === 'xvideos.red'
            ? [{ label: 'xvideos.red embedframe', url: `https://www.xvideos.red/embedframe/${m[1]}` },
               { label: 'xvideos.com embedframe', url: `https://www.xvideos.com/embedframe/${m[1]}` }]
            : [{ label: 'xvideos.com embedframe', url: `https://www.xvideos.com/embedframe/${m[1]}` }] };
    }
    if (h === 'xnxx.com' && (m = p.match(/^\/video-([^/]+)/)))
        return one('xnxx.com', m[1], `https://www.xnxx.com/embedframe/${m[1]}`);
    if (h === 'pornhub.com' && p.startsWith('/view_video.php') && u.searchParams.get('viewkey'))
        return one('pornhub.com', u.searchParams.get('viewkey'), `https://www.pornhub.com/embed/${u.searchParams.get('viewkey')}`);
    if (h === 'xhamster.com' && (m = p.match(/^\/videos\/.*-(\d+)\/?$/)))
        return one('xhamster.com', m[1], `https://xhamster.com/embed/${m[1]}`);
    if (h === 'spankbang.com' && (m = p.match(/^\/([^/]+)\/video\//)))
        return one('spankbang.com', m[1], `https://spankbang.com/${m[1]}/embed/`);
    if (h === 'eporner.com' && (m = p.match(/^\/video-([^/]+)/)))
        return one('eporner.com', m[1], `https://www.eporner.com/embed/${m[1]}/`);
    if (h === 'porntrex.com' && (m = p.match(/^\/video\/(\d+)/)))
        return one('porntrex.com', m[1], `https://www.porntrex.com/embed/${m[1]}`);
    if (h === 'camwhoreshd.com' && (m = p.match(/^\/videos\/(\d+)/)))
        return one('camwhoreshd.com', m[1], `https://www.camwhoreshd.com/embed/${m[1]}`);
    if (h === 'tnaflix.com' && (m = p.match(/\/video(\d+)\/?$/)))
        return one('tnaflix.com', m[1], `https://player.tnaflix.com/video/${m[1]}`);
    if ((h === 'youtube.com' || h === 'm.youtube.com') && p === '/watch' && u.searchParams.get('v'))
        return one('youtube.com (control)', u.searchParams.get('v'), `https://www.youtube.com/embed/${u.searchParams.get('v')}`);
    return null;
}

// Representative real URLs picked from links.json (file itself untouched).
const SAMPLES = [
    'https://www.xvideos.red/video.iudovpf6236/destroying_nataly_gold_s_holes',
    'https://www.xvideos.red/video.oouublv7174/brutal_threesome_for_petite_latina_with_pigtails_stefany',
    'https://www.xvideos.com/video.hdktood31e6/ultra_rare_skinny_teen_anal_slut_gets_dominated',
    'https://www.xnxx.com/video-1164yzbf/petite_polly_petrova_gets_hardcore_pounding_in_the_pooter_in_first_dap',
    'https://www.pornhub.com/view_video.php?viewkey=ph5f400e89c6cde',
    'https://xhamster.com/videos/small-titted-babe-enjoys-a-rough-bbc-gangbang-3298012',
    'https://spankbang.com/1hh0h/video/erotic+feet+piper+perri+living+photos',
    'https://www.eporner.com/video-HmplBhciaIa/charlie-gangbang/',
    'https://www.porntrex.com/video/2322361/marica-shanti-gets-her-first-dvp-from-five-big-cocks',
    'https://www.camwhoreshd.com/videos/1892550/neli-elinek-armpits-4-0f973bf750cd54bd/',
    'https://www.tnaflix.com/babe-videos/%5BLT22%5D-neli_elinek-2022-03-14-07-52-21/video7460891',
    'https://www.youtube.com/watch?v=oqGnsP4wOf0',
];

const YN = ['', 'yes', 'no'];
const EMBED_FIELDS = [
    ['loads', 'LOADS', YN],
    ['correctVideo', 'CORRECT VIDEO', YN],
    ['plays', 'PLAYS', YN],
    ['fillsPanel', 'FILLS PANEL', YN],
    ['controls', 'CONTROLS WORK', YN],
    ['premium', 'LOGIN/PREMIUM WORKS', ['', 'yes', 'no', 'n/a']],
    ['sandbox', 'SURVIVES GS3 SANDBOX', YN],
];
const embedResults = [];

function makeFrame(src, w, h) {
    const box = document.createElement('div');
    box.className = 'box'; box.style.width = w + 'px'; box.style.height = h + 'px';
    const f = document.createElement('iframe');
    f.setAttribute('allow', 'autoplay; fullscreen');
    f.setAttribute('allowfullscreen', '');
    f.setAttribute('sandbox', SANDBOX);
    f.src = src; box.appendChild(f);
    return box;
}
function selectField(opts, onchange) {
    const s = document.createElement('select');
    opts.forEach((o) => s.add(new Option(o || '—', o)));
    s.onchange = () => onchange(s.value);
    return s;
}

function addCase(source) {
    const [w, h] = $('e-size').value.split('x').map(Number);
    const info = adapt(source);
    const el = document.createElement('div'); el.className = 'case';
    const meta = document.createElement('div'); meta.className = 'meta';
    meta.innerHTML = 'Source: <code></code><br>Provider: <b></b> · ID/key: <code></code>';
    const codes = meta.querySelectorAll('code');
    codes[0].textContent = source;
    meta.querySelector('b').textContent = info ? info.provider : 'UNRECOGNISED';
    codes[1].textContent = info ? info.id : '(cannot parse)';
    el.appendChild(meta);
    const srcHolder = document.createElement('div');
    const srcBtn = document.createElement('button'); srcBtn.textContent = 'Load Source';
    srcBtn.onclick = () => srcHolder.replaceChildren(makeFrame(source, w, h));
    el.append(srcBtn, srcHolder);
    if (!info) { el.append('No embed candidate: URL pattern not parseable.'); $('cases').appendChild(el); return; }
    for (const cand of info.embeds) {
        const rec = { source, provider: info.provider, id: info.id, candidate: cand.label, embedUrl: cand.url, size: `${w}x${h}`, answers: {}, notes: '' };
        embedResults.push(rec);
        const c = document.createElement('div'); c.className = 'cand';
        const line = document.createElement('div');
        line.innerHTML = `Embed (${cand.label}): <code></code> `;
        line.querySelector('code').textContent = cand.url;
        const holder = document.createElement('div'); holder.className = 'pair';
        const loadBtn = document.createElement('button'); loadBtn.textContent = 'Load Embed';
        loadBtn.onclick = () => holder.replaceChildren(makeFrame(cand.url, w, h));
        const both = document.createElement('button'); both.textContent = 'Load Source + Embed side-by-side';
        both.onclick = () => holder.replaceChildren(makeFrame(source, w, h), makeFrame(cand.url, w, h));
        line.append(loadBtn, both);
        const chk = document.createElement('div'); chk.className = 'chk';
        for (const [key, label, opts] of EMBED_FIELDS) {
            const lab = document.createElement('label');
            lab.append(label, selectField(opts, (v) => { rec.answers[key] = v; }));
            chk.appendChild(lab);
        }
        const notes = document.createElement('textarea'); notes.placeholder = 'Notes';
        notes.oninput = () => { rec.notes = notes.value; };
        c.append(line, holder, chk, notes); el.appendChild(c);
    }
    $('cases').appendChild(el);
}

async function copyText(text, statusEl) {
    try { await navigator.clipboard.writeText(text); statusEl.textContent = 'copied ✓'; }
    catch {
        const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t);
        t.select(); const ok = document.execCommand('copy'); t.remove();
        statusEl.textContent = ok ? 'copied ✓ (fallback)' : 'copy FAILED — see console';
        if (!ok) console.log(text);
    }
}
$('e-add').onclick = () => { const v = $('e-url').value.trim(); if (v) addCase(v); };
$('e-copy').onclick = () => copyText(JSON.stringify(embedResults, null, 2), $('e-status'));
SAMPLES.forEach(addCase);

// ── Probe 2: Framed Viewport ─────────────────────────────────────────
const panel = $('panel'), fr = $('f-iframe');
const SNAP_PROPS = ['transform', 'transformOrigin', 'left', 'top', 'width', 'height'];
let snapshot = null;        // original inline styles, taken before first frame
let framed = null;          // { rect, scale, tx, ty }
const memory = new Map();   // host|panelWidth -> rect (in-memory only)
const F_FIELDS = [
    ['correctFills', 'CORRECT VIDEO FILLS PANEL', YN],
    ['playbackContinued', 'PLAYBACK CONTINUED', YN],
    ['controlsClickable', 'CONTROLS CLICKABLE', YN],
    ['scrubber', 'SCRUBBER WORKS', YN],
    ['sharpness', 'SHARPNESS ACCEPTABLE', YN],
    ['drift', 'PAGE SCROLL DRIFT', ['', 'none', 'tolerable', 'bad']],
    ['stickyOverlays', 'STICKY OVERLAYS REMAIN', YN],
    ['exitRestores', 'EXIT RESTORES PAGE', YN],
    ['secondVideo', 'SECOND VIDEO SAME HOST', ['', 'frame still useful', 'requires re-frame', 'unusable']],
    ['overall', 'OVERALL', ['', 'good', 'promising', 'poor']],
];
const fAnswers = {};
F_FIELDS.forEach(([k, label, opts]) => {
    const l = document.createElement('label');
    l.append(label, selectField(opts, (v) => { fAnswers[k] = v; }));
    $('f-chk').appendChild(l);
});

const setStatus = (t) => { $('status').textContent = t; };
const panelSize = () => { const [w, h] = $('f-size').value.split('x').map(Number); return { w, h }; };
function applySize() { const { w, h } = panelSize(); panel.style.width = w + 'px'; panel.style.height = h + 'px'; }
$('f-size').onchange = () => { exitFrame(); applySize(); };
applySize();
const hostOf = () => { try { return new URL(fr.getAttribute('src')).host; } catch { return ''; } };
const memKey = () => `${hostOf()}|${panelSize().w}`;

$('f-load').onclick = () => {
    const v = $('f-url').value.trim(); if (!v) return;
    exitFrame(); snapshot = null;
    fr.src = v; setStatus('loaded (src is only ever changed by Load)');
};

function takeSnapshot() {
    if (snapshot) return;
    snapshot = {}; SNAP_PROPS.forEach((p) => { snapshot[p] = fr.style[p]; });
}
function restoreSnapshot() {
    if (!snapshot) return;
    SNAP_PROPS.forEach((p) => { fr.style[p] = snapshot[p]; });
}

// Pure geometry. rect is in un-transformed iframe (== panel) coordinates.
function computeFrame(rect, pw, ph) {
    const scale = Math.min(pw / rect.w, ph / rect.h);
    const tx = (pw - rect.w * scale) / 2 - rect.x * scale;
    const ty = (ph - rect.h * scale) / 2 - rect.y * scale;
    return { rect, scale, tx, ty };
}
function applyFrame(rect) {
    takeSnapshot();
    const { w, h } = panelSize();
    framed = computeFrame(rect, w, h);
    fr.style.transformOrigin = '0 0';
    fr.style.transform = `translate(${framed.tx}px, ${framed.ty}px) scale(${framed.scale})`;
    memory.set(memKey(), rect);
    $('f-info').textContent = `rect ${JSON.stringify(rect)} scale ${framed.scale.toFixed(3)} translate ${framed.tx.toFixed(1)},${framed.ty.toFixed(1)}`;
    setStatus('framed — iframe src untouched');
}
function exitFrame() {
    removeSelector();
    restoreSnapshot(); framed = null;
    $('f-info').textContent = ''; setStatus('exited — original presentation restored');
}

let overlay = null;
function removeSelector() { if (overlay) { overlay.remove(); overlay = null; } }
function beginSelect() {
    removeSelector();
    restoreSnapshot(); framed = null; // select on the untransformed page; no reload
    overlay = document.createElement('div'); overlay.className = 'sel';
    const r = document.createElement('div'); r.className = 'r'; r.hidden = true; overlay.appendChild(r);
    panel.appendChild(overlay);
    let sx = 0, sy = 0, drag = false;
    const pt = (e) => {
        const b = panel.getBoundingClientRect();
        return { x: Math.max(0, Math.min(b.width, e.clientX - b.left - panel.clientLeft)),
                 y: Math.max(0, Math.min(b.height, e.clientY - b.top - panel.clientTop)) };
    };
    overlay.onpointerdown = (e) => { drag = true; overlay.setPointerCapture(e.pointerId); ({ x: sx, y: sy } = pt(e)); r.hidden = false; };
    overlay.onpointermove = (e) => {
        if (!drag) return; const p = pt(e);
        Object.assign(r.style, { left: Math.min(sx, p.x) + 'px', top: Math.min(sy, p.y) + 'px',
            width: Math.abs(p.x - sx) + 'px', height: Math.abs(p.y - sy) + 'px' });
    };
    overlay.onpointerup = (e) => {
        if (!drag) return; drag = false; const p = pt(e);
        const rect = { x: Math.min(sx, p.x), y: Math.min(sy, p.y), w: Math.abs(p.x - sx), h: Math.abs(p.y - sy) };
        removeSelector();
        if (rect.w < 20 || rect.h < 20) { setStatus('selection too small — try again'); return; }
        applyFrame(rect);
    };
    setStatus('drag a rectangle around the main video…');
}
$('f-frame').onclick = beginSelect;
$('f-reframe').onclick = beginSelect;
$('f-exit').onclick = exitFrame;
$('f-reuse').onclick = () => {
    const rect = memory.get(memKey());
    if (!rect) { setStatus('no remembered frame for this host + panel width'); return; }
    restoreSnapshot(); applyFrame(rect);
};
$('f-copy').onclick = () => copyText(JSON.stringify({
    testedUrl: fr.getAttribute('src'), host: hostOf(), panel: panelSize(),
    selectedRect: framed?.rect ?? null, scale: framed?.scale ?? null,
    translation: framed ? { tx: framed.tx, ty: framed.ty } : null,
    checklist: fAnswers, notes: $('f-notes').value,
}, null, 2), $('f-cstatus'));
window.__lab = { adapt, computeFrame, embedResults, memory };
