/**
 * GS3 Fill Lab — temporary, local-only live harness for the REAL index3.html Grid.
 * Inject from DevTools:
 *   const s=document.createElement('script');
 *   s.src='/architecture-lab/fill-panel/gs3-live-harness.js?'+Date.now();
 *   document.head.appendChild(s);
 * Remove with GS3FillLab.destroy() or by refreshing the page.
 *
 * Presentation-only. Never touches iframe.src, data-last-src, Runtime Session,
 * panel history or Undo/Redo. Two experimental modes per .stream-panel:
 *   Pinned — the real .post-iframe is pinned to layout viewport V and cropped to R.
 *   Embed  — a lab-owned embed iframe overlays the untouched real iframe.
 */
(() => {
    'use strict';
    const TAG = '[GS3 Fill Lab]';
    if (window.GS3FillLab) {
        console.log(`${TAG} already installed — destroying the old instance and reinstalling.`);
        try { window.GS3FillLab.destroy(); } catch (e) { console.warn(TAG, e); }
    }

    const V_DEFAULT = { w: 1920, h: 1080 };
    const PINNED_CHECKS = [
        'calibration succeeded', 'Fill aligned player', 'real GS3 horizontal resize worked',
        'real GS3 vertical resize worked', 'real GS3 junction resize worked', 'wide Position worked',
        'narrow Position worked', 'tall Position worked', 'controls clickable', 'stream continued',
        'Exit restored normal page', 'Back to Followed Cams still worked',
        'same R worked on second room', 'same R worked on third room', 'same R worked on fourth room',
    ];
    const EMBED_CHECKS = [
        'adapter produced correct embed', 'embed loaded', 'correct video', 'fills real Position',
        'real GS3 resizing works', 'controls work', 'Exit removes embed',
        'original source page preserved', 're-enter Embed works',
    ];

    // ── Embed adapters (parsing copied from lab.js, xvideos + xnxx only) ─────
    function adaptEmbed(raw) {
        let u; try { u = new URL(raw); } catch { return null; }
        const h = u.hostname.replace(/^www\./, '');
        let m;
        if ((h === 'xvideos.com' || h === 'xvideos.red') && (m = u.pathname.match(/^\/video\.([^/]+)/))) {
            const com = `https://www.xvideos.com/embedframe/${m[1]}`;
            const red = `https://www.xvideos.red/embedframe/${m[1]}`;
            return { provider: h, id: m[1], embeds: h === 'xvideos.red' ? [red, com] : [com] };
        }
        // XNXX family: xnxx.<tld> (optionally a second-level like .co.uk) under any subdomain (www, es, www3 ...).
        // A video page is identified structurally by /video-<opaque id>; slug, query and fragment are ignored.
        // The validated embed host stays www.xnxx.com.
        if (/(^|\.)xnxx\.[a-z]{2,}(\.[a-z]{2})?$/.test(h) && (m = u.pathname.match(/^\/video-([^/]+)/))) {
            return { provider: 'xnxx', id: m[1], embeds: [`https://www.xnxx.com/embedframe/${m[1]}`] };
        }
        return null;
    }

    // ── Geometry (same math as pinned-viewport.html) ─────────────────────────
    function computeFill(P, R) {
        const scale = Math.min(P.w / R.w, P.h / R.h);
        return { scale, tx: (P.w - R.w * scale) / 2 - R.x * scale, ty: (P.h - R.h * scale) / 2 - R.y * scale };
    }
    const computeFit = (P, V) => computeFill(P, { x: 0, y: 0, w: V.w, h: V.h });

    // ── Shared state ─────────────────────────────────────────────────────────
    const states = new Map();           // panel element -> per-panel state
    let sharedR = null;                 // { V:{w,h}, R:{x,y,w,h} } shared across panels when V matches
    const globalResults = { multiplePanels: '', notes: '' };
    let mo = null;
    let rescanQueued = false;
    let widget = null;
    let styleEl = null;
    let destroyed = false;

    const iframeOf = (panel) => panel.querySelector(':scope > .post-iframe') || panel.querySelector('.post-iframe');
    const slotOf = (panel) => panel.dataset?.slotIndex ?? null;
    const say = (panelState, msg) => {
        panelState.msgEl.textContent = msg;
        console.log(`${TAG} slot ${slotOf(panelState.panel)}: ${msg}`);
    };

    function injectStyle() {
        styleEl = document.createElement('style');
        styleEl.id = 'gs3fl-style';
        styleEl.textContent = `
            .gs3fl-bar { position:absolute; left:6px; bottom:6px; z-index:10010; font:11px/1.3 monospace; color:#fff;
                background:rgba(120,0,160,.92); border:2px dashed #ff0; padding:3px 5px; max-width:calc(100% - 12px);
                display:flex; flex-wrap:wrap; gap:3px; align-items:center; box-sizing:border-box; }
            .gs3fl-bar button { font:11px monospace; padding:1px 5px; cursor:pointer; }
            .gs3fl-bar .gs3fl-msg { flex-basis:100%; color:#ff0; }
            .gs3fl-panelpop { position:absolute; left:6px; bottom:52px; z-index:10011; background:#111e; color:#eee;
                border:2px dashed #ff0; padding:6px; font:11px/1.35 monospace; max-height:60%; overflow:auto; }
            .gs3fl-panelpop label { display:block; white-space:nowrap; }
            .gs3fl-panelpop h4 { margin:4px 0 2px; color:#ff0; font-size:11px; }
            .gs3fl-cal { position:absolute; inset:0; z-index:10009; cursor:crosshair; background:rgba(0,120,255,.15); }
            .gs3fl-cal .sel { position:absolute; border:2px solid #ff0; background:rgba(255,255,0,.15); pointer-events:none; }
            .gs3fl-cal .hint { position:absolute; left:6px; top:6px; background:#000c; color:#ff0; padding:2px 6px; font:11px monospace; pointer-events:none; }
            .gs3fl-embed { position:absolute; inset:0; width:100%; height:100%; border:0; z-index:1; background:#000; }
            #gs3fl-widget { position:fixed; right:8px; top:8px; z-index:2147483000; background:rgba(120,0,160,.95); color:#fff;
                border:2px dashed #ff0; padding:5px 7px; font:11px/1.4 monospace; }
            #gs3fl-widget button, #gs3fl-widget select, #gs3fl-widget input { font:11px monospace; }
        `;
        document.head.appendChild(styleEl);
    }

    // ── Per-panel state ──────────────────────────────────────────────────────
    function attach(panel) {
        if (states.has(panel)) {
            const s = states.get(panel);
            if (!s.bar.isConnected) panel.appendChild(s.bar); // GS3 rebuilt panel children
            return;
        }
        if (getComputedStyle(panel).position === 'static') {
            panel.dataset.gs3flPos = '1';
            panel.style.position = 'relative';
        }
        const st = {
            panel, mode: 'normal', snapshot: null, iframe: null, V: { ...V_DEFAULT }, R: null,
            embedFrame: null, calOverlay: null, lastP: { w: 0, h: 0 }, ro: null,
            embedUrl: null, embedSource: null,
            pinnedChecks: {}, embedChecks: {}, pinnedNotes: '', embedNotes: '', doubleAudio: '', popover: null,
        };
        const bar = document.createElement('div');
        bar.className = 'gs3fl-bar';
        bar.innerHTML = `<b>🧪 Fill Lab</b>
            <button data-a="pinned" title="Pin iframe to V and crop to R">Pinned</button>
            <button data-a="embed" title="Overlay embed player (shift-click: alternate embed)">Embed</button>
            <button data-a="cal">Calibrate</button>
            <button data-a="exit">Exit</button>
            <button data-a="checks">📋</button>
            <span class="gs3fl-msg"></span>`;
        st.bar = bar;
        st.msgEl = bar.querySelector('.gs3fl-msg');
        // Never let clicks/drags on the lab bar reach GS3 chrome handlers.
        ['pointerdown', 'mousedown', 'click'].forEach((t) => bar.addEventListener(t, (e) => e.stopPropagation()));
        bar.addEventListener('click', (e) => {
            const a = e.target?.dataset?.a;
            if (a) actions[a](st, e);
        });
        panel.appendChild(bar);
        st.ro = new ResizeObserver(() => {
            const p = panelSize(panel);
            if (p.w === st.lastP.w && p.h === st.lastP.h) return;
            if (st.mode === 'pinned' || st.mode === 'calibrating') render(st, 'resize');
        });
        st.ro.observe(panel);
        states.set(panel, st);
    }

    const panelSize = (panel) => ({ w: panel.clientWidth, h: panel.clientHeight });

    // ── Pinned mode ──────────────────────────────────────────────────────────
    function pinIframe(st) {
        const iframe = iframeOf(st.panel);
        if (!iframe) return false;
        if (st.snapshot === null) { st.snapshot = { style: iframe.getAttribute('style') }; st.iframe = iframe; }
        iframe.style.flex = 'none';           // leave the flex flow; production CSS is untouched
        iframe.style.position = 'absolute';
        iframe.style.left = '0';
        iframe.style.top = '0';
        iframe.style.width = st.V.w + 'px';
        iframe.style.height = st.V.h + 'px';
        iframe.style.maxWidth = 'none';
        iframe.style.minHeight = '0';
        iframe.style.transformOrigin = '0 0';
        return true;
    }
    function restoreIframe(st) {
        if (st.snapshot !== null && st.iframe) {
            if (st.snapshot.style === null) st.iframe.removeAttribute('style');
            else st.iframe.setAttribute('style', st.snapshot.style);
        }
        st.snapshot = null;
        st.iframe = null;
    }
    // V/R never change here — only scale/tx/ty follow the real panel size.
    function render(st, reason) {
        if (!st.iframe || !st.iframe.isConnected || st.iframe !== iframeOf(st.panel)) {
            // GS3 replaced the iframe underneath us: drop state, do not touch the new one.
            st.snapshot = null; st.iframe = null; st.mode = 'normal';
            return;
        }
        const P = panelSize(st.panel);
        st.lastP = P;
        const t = st.mode === 'pinned' ? computeFill(P, st.R) : computeFit(P, st.V);
        st.iframe.style.transform = `translate(${t.tx}px, ${t.ty}px) scale(${t.scale})`;
        if (st.mode === 'pinned') {
            console.log(`${TAG} slot ${slotOf(st.panel)} ${reason}`, JSON.stringify({
                V: st.V, R: st.R, panel: P, scale: +t.scale.toFixed(4), tx: +t.tx.toFixed(1), ty: +t.ty.toFixed(1),
            }));
        }
    }
    function usableR(st) {
        if (st.R) return st.R;
        if (sharedR && sharedR.V.w === st.V.w && sharedR.V.h === st.V.h) { st.R = { ...sharedR.R }; return st.R; }
        return null;
    }

    function calibrate(st) {
        exit(st);
        if (!pinIframe(st)) { say(st, 'no .post-iframe in this panel'); return; }
        st.mode = 'calibrating';
        render(st, 'calibrate-fit');
        const ov = document.createElement('div');
        ov.className = 'gs3fl-cal';
        ov.innerHTML = '<div class="hint">Drag around the player, release to save R</div>';
        st.panel.appendChild(ov);
        st.calOverlay = ov;
        const fit = computeFit(panelSize(st.panel), st.V);
        const toV = (e) => {
            const b = ov.getBoundingClientRect();
            return { x: (e.clientX - b.left - fit.tx) / fit.scale, y: (e.clientY - b.top - fit.ty) / fit.scale };
        };
        let a = null, sel = null;
        ov.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            a = toV(e); sel = document.createElement('div'); sel.className = 'sel'; ov.appendChild(sel);
            ov.setPointerCapture(e.pointerId);
        });
        ov.addEventListener('pointermove', (e) => {
            if (!a) return;
            const b = toV(e);
            sel.style.cssText = `left:${Math.min(a.x, b.x) * fit.scale + fit.tx}px;top:${Math.min(a.y, b.y) * fit.scale + fit.ty}px;`
                + `width:${Math.abs(a.x - b.x) * fit.scale}px;height:${Math.abs(a.y - b.y) * fit.scale}px`;
        });
        ov.addEventListener('pointerup', (e) => {
            if (!a) return;
            const b = toV(e);
            const R = { x: Math.max(0, Math.min(a.x, b.x)), y: Math.max(0, Math.min(a.y, b.y)),
                        w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
            R.w = Math.min(R.w, st.V.w - R.x); R.h = Math.min(R.h, st.V.h - R.y);
            exit(st); // removes overlay, restores NORMAL
            if (R.w < 20 || R.h < 20) { say(st, 'calibration ignored (too small)'); return; }
            st.R = R;
            sharedR = { V: { ...st.V }, R: { ...R } };
            for (const other of states.values()) if (other !== st) other.R = null; // re-adopt shared R on demand
            const r = Object.fromEntries(Object.entries(R).map(([k, v]) => [k, Math.round(v)]));
            say(st, `R saved (shared) ${JSON.stringify(r)}`);
        });
    }

    function fillPinned(st) {
        exit(st);
        const R = usableR(st);
        if (!R) { say(st, 'calibrate a Chaturbate player first'); return; }
        if (!pinIframe(st)) { say(st, 'no .post-iframe in this panel'); return; }
        st.mode = 'pinned';
        render(st, 'fill');
        say(st, 'PINNED fill active');
    }

    // ── Embed mode ───────────────────────────────────────────────────────────
    function fillEmbed(st, alt) {
        exit(st);
        const iframe = iframeOf(st.panel);
        const src = iframe?.getAttribute('data-last-src');
        if (!src) { say(st, 'Embed refused: no data-last-src on this iframe'); return; }
        console.log(`${TAG} Embed source:\n${src}`);
        const adapted = adaptEmbed(src);
        if (!adapted) {
            console.log(`${TAG} Unsupported embed source:\n${src}`);
            say(st, 'Embed refused: unsupported source URL (exact source logged to console)');
            return;
        }
        const url = adapted.embeds[alt && adapted.embeds.length > 1 ? 1 : 0];
        const f = document.createElement('iframe');
        f.className = 'gs3fl-embed';
        f.allow = 'autoplay; fullscreen';
        f.setAttribute('sandbox', 'allow-same-origin allow-scripts allow-forms allow-popups');
        f.setAttribute('allowfullscreen', '');
        f.src = url;
        st.panel.appendChild(f);
        st.embedFrame = f; st.embedUrl = url; st.embedSource = src; st.mode = 'embed';
        say(st, `EMBED overlay: ${url}`);
    }

    function exit(st) {
        if (st.calOverlay) { st.calOverlay.remove(); st.calOverlay = null; }
        if (st.embedFrame) { st.embedFrame.remove(); st.embedFrame = null; }
        if (st.snapshot !== null) restoreIframe(st);
        const was = st.mode;
        st.mode = 'normal';
        if (was !== 'normal') say(st, `exit ${was} -> NORMAL (R kept)`);
    }

    // ── Checklist popover ────────────────────────────────────────────────────
    function toggleChecks(st) {
        if (st.popover) { st.popover.remove(); st.popover = null; return; }
        const pop = document.createElement('div');
        pop.className = 'gs3fl-panelpop';
        ['pointerdown', 'mousedown', 'click'].forEach((t) => pop.addEventListener(t, (e) => e.stopPropagation()));
        const group = (title, items, store) => {
            const h = document.createElement('h4'); h.textContent = title; pop.appendChild(h);
            for (const item of items) {
                const l = document.createElement('label');
                const cb = document.createElement('input');
                cb.type = 'checkbox'; cb.checked = !!store[item];
                cb.onchange = () => { store[item] = cb.checked; };
                l.append(cb, ' ' + item); pop.appendChild(l);
            }
        };
        group('PINNED (Chaturbate)', PINNED_CHECKS, st.pinnedChecks);
        group('EMBED (XVideos)', EMBED_CHECKS, st.embedChecks);
        const da = document.createElement('label');
        da.innerHTML = 'double audio: <select><option value="">?</option><option>yes</option><option>no</option></select>';
        da.querySelector('select').value = st.doubleAudio;
        da.querySelector('select').onchange = (e) => { st.doubleAudio = e.target.value; };
        pop.appendChild(da);
        const note = document.createElement('input');
        note.placeholder = 'notes'; note.value = st.pinnedNotes; note.style.width = '95%';
        note.oninput = () => { st.pinnedNotes = note.value; };
        pop.appendChild(note);
        st.panel.appendChild(pop);
        st.popover = pop;
    }

    const actions = {
        pinned: (st) => fillPinned(st),
        embed: (st, e) => fillEmbed(st, e.shiftKey),
        cal: (st) => calibrate(st),
        exit: (st) => exit(st),
        checks: (st) => toggleChecks(st),
    };

    // ── Discovery ────────────────────────────────────────────────────────────
    function rescan() {
        rescanQueued = false;
        if (destroyed) return;
        for (const [panel, st] of [...states]) {
            if (!panel.isConnected) { exit(st); st.ro.disconnect(); st.bar.remove(); states.delete(panel); }
        }
        document.querySelectorAll('.stream-panel').forEach(attach);
    }
    const queueRescan = () => { if (!rescanQueued) { rescanQueued = true; requestAnimationFrame(rescan); } };

    // ── Global widget, results, cleanup ──────────────────────────────────────
    function results() {
        return {
            lab: 'gs3-live-harness', at: new Date().toISOString(), V: V_DEFAULT, sharedR: sharedR ? sharedR.R : null,
            multiplePanels: globalResults.multiplePanels, notes: globalResults.notes,
            panels: [...states.values()].map((st) => ({
                slot: slotOf(st.panel), mode: st.mode, V: st.V, R: st.R,
                dataLastSrc: iframeOf(st.panel)?.getAttribute('data-last-src') || null,
                embed: { source: st.embedSource, embedUrl: st.embedUrl, checks: st.embedChecks, doubleAudio: st.doubleAudio },
                pinned: { checks: st.pinnedChecks, notes: st.pinnedNotes },
            })),
        };
    }
    async function copyResults() {
        const text = JSON.stringify(results(), null, 2);
        try { await navigator.clipboard.writeText(text); console.log(`${TAG} results copied`); }
        catch { console.log(`${TAG} clipboard blocked; results:\n${text}`); window.prompt('Copy results:', text); }
        return text;
    }
    function status() {
        return [...states.values()].map((st) => ({
            slot: slotOf(st.panel), mode: st.mode, R: st.R, iframeStyle: iframeOf(st.panel)?.getAttribute('style') || '',
            embedOverlay: !!st.embedFrame, dataLastSrc: iframeOf(st.panel)?.getAttribute('data-last-src') || null,
        }));
    }
    function buildWidget() {
        widget = document.createElement('div');
        widget.id = 'gs3fl-widget';
        widget.innerHTML = `<b>🧪 GS3 Fill Lab</b>
            <button data-g="copy">Copy Results</button> <button data-g="destroy">Destroy</button><br>
            multiple panels: <select data-g="multi"><option value="">?</option><option>good</option><option>degraded</option><option>failed</option></select>
            <input data-g="notes" placeholder="global notes" style="width:140px">`;
        widget.addEventListener('click', (e) => {
            if (e.target.dataset.g === 'copy') copyResults();
            if (e.target.dataset.g === 'destroy') api.destroy();
        });
        widget.querySelector('[data-g=multi]').onchange = (e) => { globalResults.multiplePanels = e.target.value; };
        widget.querySelector('[data-g=notes]').oninput = (e) => { globalResults.notes = e.target.value; };
        document.body.appendChild(widget);
    }
    function destroy() {
        destroyed = true;
        mo?.disconnect();
        for (const [panel, st] of states) {
            exit(st);
            st.ro.disconnect();
            st.popover?.remove();
            st.bar.remove();
            if (panel.dataset.gs3flPos) { panel.style.removeProperty('position'); delete panel.dataset.gs3flPos; }
        }
        states.clear();
        widget?.remove();
        styleEl?.remove();
        delete window.GS3FillLab;
        console.log(`${TAG} HARNESS DESTROYED`);
    }

    const api = { destroy, status, copyResults, results, _computeFill: computeFill };
    window.GS3FillLab = api;
    injectStyle();
    buildWidget();
    rescan();
    mo = new MutationObserver(queueRescan);
    mo.observe(document.body, { childList: true, subtree: true });
    console.log(`${TAG} HARNESS ACTIVE — ${states.size} panel(s) found`);
})();
