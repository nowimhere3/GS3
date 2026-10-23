/**
 * presentation-url.js — Stream Loop Launchpad
 * ─────────────────────────────────────────────────────────────────────────────
 * assignedUrl -> provider presentation adapter -> EFFECTIVE iframe URL.
 *
 * The assigned URL is the content identity GS3 chose (links.json, Runtime
 * Session, history, presets, `data-last-src`). Some providers need a slightly
 * different URL to PRESENT that same content inside a sandboxed Panel. That
 * difference lives here, at the one moment an iframe `src` is set, and never
 * flows back into canonical state.
 *
 * Currently one rule:
 *
 *   cloudbate.com video page  /video/<numeric id>/…   -> add `play=true`
 *
 * Why: Cloudbate's player opens `<same url>?play=true` in a NEW WINDOW when Play
 * is pressed. Popout Shield (no `allow-popups` in the Panel sandbox) blocks that
 * window, which leaves the in-Panel player loading forever. Loading the `?play=true`
 * form directly shows a player that plays in place on one click.
 *
 * A second, separate capability lives here too — FILL_EMBED:
 *
 *   assignedUrl -> getFillPresentationUrl() -> provider-native embed/player URL | null
 *
 * It is used ONLY by the Fill Panel action (js/capability-bridge.js) to show a
 * temporary overlay; it never changes what the Panel is assigned. The transformations
 * are the ones proven in architecture-lab/fill-panel; xHamster is deliberately absent
 * (its embed is a teaser that opens another window, not a player).
 *
 * Pure and idempotent. Anything that is not a proven Cloudbate video page — other
 * providers, the Cloudbate home/search/category pages, relative or unparsable
 * strings — is returned UNCHANGED (same string).
 * ─────────────────────────────────────────────────────────────────────────────
 */

const CLOUDBATE_VIDEO_PATH = /^\/video\/\d+(?:\/|$)/;

/**
 * @param {string} url — the assigned URL
 * @returns {string} the URL to put on the iframe
 */
export function getPresentationUrl(url) {
    if (typeof url !== 'string' || url === '') return url;
    let u;
    try { u = new URL(url); } catch { return url; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return url;
    const host = u.hostname.toLowerCase();
    const isCloudbate = host === 'cloudbate.com' || host.endsWith('.cloudbate.com');
    if (isCloudbate && CLOUDBATE_VIDEO_PATH.test(u.pathname)) {
        u.searchParams.set('play', 'true');
        return u.toString();
    }
    return url;
}

// ── FILL_EMBED ────────────────────────────────────────────────────────────────

const ID = '[A-Za-z0-9_-]+';
const _hostOf = (u) => u.hostname.toLowerCase().replace(/^www\./, '');

// provider -> (URL object) => embed URL | null.  Hosts are matched exactly (after an
// optional `www.`), IDs are charset-checked before being placed in the output, and only
// the ID reaches the embed URL — the source query string and hash are discarded.
const FILL_EMBED_RULES = [
    // xvideos.com / xvideos.red / de.xvideos.com   /video.<id>/<slug>   or the legacy   /video<digits>/<slug>
    (u, h) => {
        if (h !== 'xvideos.com' && h !== 'xvideos.red' && h !== 'de.xvideos.com') return null;
        const m = u.pathname.match(new RegExp(`^/video\\.(${ID})(?:/|$)`)) || u.pathname.match(/^\/video(\d+)(?:\/|$)/);
        return m ? `https://www.xvideos.com/embedframe/${m[1]}` : null;
    },
    // xnxx.<tld> family (any subdomain)   /video-<id>/<slug>
    (u, h) => {
        if (!/(^|\.)xnxx\.[a-z]{2,}(\.[a-z]{2})?$/.test(h)) return null;
        const m = u.pathname.match(new RegExp(`^/video-(${ID})(?:/|$)`));
        return m ? `https://www.xnxx.com/embedframe/${m[1]}` : null;
    },
    // pornhub.com   /view_video.php?viewkey=<key>
    (u, h) => {
        if (h !== 'pornhub.com' || u.pathname !== '/view_video.php') return null;
        const k = u.searchParams.get('viewkey');
        return k && new RegExp(`^${ID}$`).test(k) ? `https://www.pornhub.com/embed/${k}` : null;
    },
    // spankbang.com   /<id>/video/<slug>
    (u, h) => {
        if (h !== 'spankbang.com') return null;
        const m = u.pathname.match(new RegExp(`^/(${ID})/video/`));
        return m ? `https://spankbang.com/${m[1]}/embed/` : null;
    },
    // eporner.com   /video-<id>/<slug>/   or   /hd-porn/<id>/<slug>/
    (u, h) => {
        if (h !== 'eporner.com') return null;
        const m = u.pathname.match(new RegExp(`^/video-(${ID})(?:/|$)`)) || u.pathname.match(new RegExp(`^/hd-porn/(${ID})(?:/|$)`));
        return m ? `https://www.eporner.com/embed/${m[1]}/` : null;
    },
    // porntrex.com   /video/<numeric id>/<slug>
    (u, h) => {
        if (h !== 'porntrex.com') return null;
        const m = u.pathname.match(/^\/video\/(\d+)(?:\/|$)/);
        return m ? `https://www.porntrex.com/embed/${m[1]}` : null;
    },
    // tnaflix.com / m.tnaflix.com / morigin.tnaflix.com   …/video<numeric id>
    (u, h) => {
        if (h !== 'tnaflix.com' && h !== 'm.tnaflix.com' && h !== 'morigin.tnaflix.com') return null;
        const m = u.pathname.match(/\/video(\d+)\/?$/);
        return m ? `https://player.tnaflix.com/video/${m[1]}` : null;
    },
    // wxx.wtf   /videos/<numeric id>/<slug>/   -> the site's own player-only embed (the page itself embeds it as an iframe)
    (u, h) => {
        if (h !== 'wxx.wtf') return null;
        const m = u.pathname.match(/^\/videos\/(\d+)(?:\/|$)/);
        return m ? `https://www.wxx.wtf/embed/${m[1]}` : null;
    },
];

/**
 * @param {string} url — the ASSIGNED (canonical) URL of a Panel
 * @returns {string|null} provider-native embed/player URL for Fill, or null when this
 *          URL is not a recognised video page of a supported provider.
 */
export function getFillPresentationUrl(url) {
    if (typeof url !== 'string' || url === '') return null;
    let u;
    try { u = new URL(url); } catch { return null; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const h = _hostOf(u);
    for (const rule of FILL_EMBED_RULES) {
        const out = rule(u, h);
        if (out) return out;
    }
    return null;
}
