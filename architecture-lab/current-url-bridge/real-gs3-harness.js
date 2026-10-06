// R0.1 TEMPORARY harness for the REAL index3.html (injected by the companion via CDP; never saved to production).
// 1. Stamps each real Panel iframe with host-owned identity (data-gs3-slot) so the companion can correlate frames.
// 2. Mirrors GS3's REAL generation boundary: panel-navigation.js beginPanelContent() runs immediately BEFORE GS3
//    sets iframe.src, so a MutationObserver on the iframe's src attribute (a microtask, before any navigation
//    event) reads getPanelNavigationState(slot).generation and tells the bridge. Future production hook point =
//    inside beginPanelContent() itself.
// 3. Minimal in-memory receiver (EventSource) + status(). Writes nothing: no data-last-src, storage, session, presets.
(async () => {
    if (window.GS3R0) { try { window.GS3R0.destroy(); } catch {} }
    const nav = await import('/js/panel-navigation.js');
    const BRIDGE = 'http://127.0.0.1:8766';
    const observed = {};          // slot -> { url, gen, kind }
    const seenGen = {};           // slot -> last real generation mirrored to the bridge
    const log = [];
    let connected = false; let es = null; let destroyed = false;
    const observers = [];

    const panels = () => [...document.querySelectorAll('.stream-panel')].filter((p) => p.dataset.slotIndex !== undefined);
    const iframeOf = (p) => p.querySelector(':scope > iframe, iframe');
    const realGen = (slot) => nav.getPanelNavigationState(slot)?.generation ?? 0;

    function announce(slot) {
        const gen = realGen(slot);
        if (seenGen[slot] === gen) return;
        seenGen[slot] = gen;
        observed[slot] = null;
        try { window.gs3BridgeRollover?.(JSON.stringify({ slot, gen })); } catch {}   // optional; no companion => no-op
        log.push({ rollover: slot, gen });
    }
    function stamp() {
        for (const p of panels()) {
            const f = iframeOf(p); if (!f) continue;
            const slot = Number(p.dataset.slotIndex);
            if (f.getAttribute('data-gs3-slot') !== String(slot)) f.setAttribute('data-gs3-slot', String(slot));
            if (!f.__r0) {
                f.__r0 = true;
                const mo = new MutationObserver(() => announce(slot));
                mo.observe(f, { attributes: true, attributeFilter: ['src'] });
                observers.push(mo);
                seenGen[slot] = seenGen[slot] ?? realGen(slot);
            }
        }
    }
    stamp();
    const bodyMo = new MutationObserver(stamp);          // panels may be rebuilt by GS3
    bodyMo.observe(document.body, { childList: true, subtree: true });

    function accept(o) {
        const f = panels().map(iframeOf).find((x) => x?.getAttribute('data-gs3-slot') === String(o.slot));
        const assigned = f?.getAttribute('data-last-src') ?? null;
        if (o.gen !== realGen(o.slot)) { log.push({ dropped: 'generation', slot: o.slot, got: o.gen, real: realGen(o.slot), url: o.url }); return; }
        if (o.url === assigned) observed[o.slot] = null;
        else observed[o.slot] = { url: o.url, gen: o.gen, kind: o.kind };
        log.push({ accepted: o.slot, gen: o.gen, url: o.url, kind: o.kind });
    }
    function connect() {
        if (destroyed) return;
        es = new EventSource(BRIDGE + '/events');
        es.onopen = () => { connected = true; };
        es.onmessage = (e) => { try { accept(JSON.parse(e.data)); } catch {} };
        es.onerror = () => { connected = false; for (const s in observed) observed[s] = null; es.close(); setTimeout(connect, 700); };
    }
    connect();

    window.GS3R0 = {
        gens: () => Object.fromEntries(panels().map((p) => [Number(p.dataset.slotIndex), realGen(Number(p.dataset.slotIndex))])),
        status: () => ({
            bridgeConnected: connected,
            panels: panels().map((p) => {
                const f = iframeOf(p); const s = Number(p.dataset.slotIndex);
                return { slot: s, assigned: f?.getAttribute('data-last-src') ?? null, iframeSrcAttr: f?.getAttribute('src') ?? null,
                    gen: realGen(s), observedCurrentUrl: observed[s]?.url ?? null, observation: observed[s] ?? null };
            }),
            log: log.slice(-40),
        }),
        destroy() {
            destroyed = true; es?.close(); bodyMo.disconnect(); observers.forEach((m) => m.disconnect());
            document.querySelectorAll('iframe[data-gs3-slot]').forEach((f) => { f.removeAttribute('data-gs3-slot'); delete f.__r0; });
            delete window.GS3R0; delete window.GS3Lab;
        },
    };
    window.GS3Lab = { gens: window.GS3R0.gens };      // companion's attach-time generation sync reads this
    return 'GS3R0 installed';
})();
