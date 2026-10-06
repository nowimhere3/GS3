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
