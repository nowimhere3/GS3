// Stand-in for (a) GS3's assignment/generation bookkeeping and (b) the future js/current-url-bridge.js receiver.
// Receiver state is in-memory only. Observation never writes assigned/data-last-src.
(() => {
    const BRIDGE = 'http://127.0.0.1:8766';
    const assigned = {};   // slot -> assignedUrl   (what GS3 intentionally loaded)
    const gen = {};        // slot -> content generation
    const observed = {};   // slot -> { url, gen, kind, at } | null   (ephemeral)
    const log = [];        // dropped / accepted counters for tests
    let connected = false;
    const iframeOf = (s) => document.querySelector(`iframe[data-gs3-slot="${s}"]`);

    // Additive hook: only exists when a companion injected the binding. No companion => no-op.
    const announce = (slot) => { try { window.gs3BridgeRollover?.(JSON.stringify({ slot, gen: gen[slot] })); } catch {} };

    function begin(slot, url) {            // Shuffle / Assign / Refresh all go through here
        gen[slot] = (gen[slot] || 0) + 1;
        assigned[slot] = url;
        observed[slot] = null;
        const f = iframeOf(slot);
        f.setAttribute('data-gs3-gen', gen[slot]);
        announce(slot);                    // fence BEFORE navigating
        f.setAttribute('data-last-src', url);
        f.src = url;
        hud();
    }
    const GS3Lab = {
        assign: (slot, url) => begin(slot, url),
        shuffle: (slot, url) => begin(slot, url),
        refresh: (slot) => begin(slot, assigned[slot]),   // reload ASSIGNED, never current
        gens: () => ({ ...gen }),
        status: () => ({
            connected, log: log.slice(-60),
            panels: Object.fromEntries([1, 2].map((s) => [s, {
                assigned: assigned[s] || null, dataLastSrc: iframeOf(s).getAttribute('data-last-src'),
                gen: gen[s] || 0, observedCurrentUrl: observed[s]?.url ?? null, observation: observed[s] || null,
            }])),
        }),
    };
    window.GS3Lab = GS3Lab;

    function accept(o) {
        if (gen[o.slot] === undefined || o.gen !== gen[o.slot]) { log.push({ dropped: 'generation', o }); return; }
        if (o.url === assigned[o.slot]) { observed[o.slot] = null; log.push({ landing: o.slot }); }
        else observed[o.slot] = { url: o.url, gen: o.gen, kind: o.kind, at: o.at, source: 'browser observation' };
        log.push({ accepted: o.slot, url: o.url, gen: o.gen });
        hud();
    }
    function connect() {
        const es = new EventSource(BRIDGE + '/events');
        es.onopen = () => { connected = true; hud(); };
        es.onmessage = (e) => { try { accept(JSON.parse(e.data)); } catch {} };
        es.onerror = () => {                 // companion gone: observation unavailable -> null, GS3 unchanged
            connected = false; for (const s in observed) observed[s] = null; hud();
            es.close(); setTimeout(connect, 700);
        };
    }
    function hud() {
        document.getElementById('hud').textContent = `bridge: ${connected ? 'connected' : 'offline'}\n` +
            [1, 2].map((s) => `slot ${s} gen ${gen[s] || 0}\n  assigned: ${assigned[s] || '-'}\n  current : ${observed[s]?.url || '-'}`).join('\n');
    }
    connect(); hud();
})();
