/**
 * Gallery discovery and favorite intent transport. No UI or persistence.
 * Children answer QUERY_CAPABILITY with CAPABILITY_PRESENT, echoing generation.
 * The opaque generation changes on assignment AND every iframe load, including
 * reloads whose WindowProxy survives. Unsolicited/unfenced reports are refused.
 */
import { MULTIHEART_SHORTCUT_CODES } from './multiheart-shortcuts.js';
import {
    CAPABILITY_BRIDGE_SOURCE, CAPABILITY_BRIDGE_VERSION, findPanelForSourceWindow,
} from './capability-bridge.js';

export const GALLERY_FAVORITE_CAPABILITY = 'GALLERY_FAVORITE';
export const GALLERY_CAPABILITY_CHANGED = 'gs3:gallery-favorite-capability-changed';
export const GALLERY_FAVORITE_STATE_CHANGED = 'gs3:gallery-favorite-state-changed';
/** Validated Gallery-forwarded key intent; detail {panel, code}. Panel is the trusted SOURCE, never the target. */
export const GALLERY_SHORTCUT_KEY = 'gs3:gallery-shortcut-key';
const MAX_MEDIA_KEY_LENGTH = 256;
const states = new WeakMap();
const pending = new WeakMap();
export const GALLERY_FAVORITE_TIMEOUT_MS = 1500;
const statuses = new Set(['favorited', 'already-favorite', 'no-media', 'unavailable']);
// A child may install its message listener AFTER the iframe `load` event (a module
// with top-level await, e.g. Gallery reading its preferences first). A single query
// sent on load is then silently lost, so discovery repeats, bounded, until the
// child answers or this generation is replaced.
export const GALLERY_QUERY_RETRY_DELAYS_MS = [150, 300, 600, 1200, 2400, 4800, 9600];
let requestSequence = 0;
let listening = false;

function stopQueryRetries(state) {
    if (!state) return;
    clearTimeout(state.queryTimer);
    state.queryTimer = null;
}

function scheduleQueryRetry(panel, state, attempt = 0) {
    if (attempt >= GALLERY_QUERY_RETRY_DELAYS_MS.length) return;
    state.queryTimer = setTimeout(() => {
        state.queryTimer = null;
        // Only the live, still-undiscovered generation keeps asking.
        if (states.get(panel) !== state || state.capable || !state.acceptingReports || !panel.isConnected) return;
        queryGalleryFavoriteCapability(panel);
        scheduleQueryRetry(panel, state, attempt + 1);
    }, GALLERY_QUERY_RETRY_DELAYS_MS[attempt]);
}

function complete(panel, status = 'unavailable') {
    const request = pending.get(panel);
    if (!request) return;
    pending.delete(panel);
    clearTimeout(request.timer);
    request.resolve({ status });
}

/** One bounded intent per live, explicitly feature-ready Panel. Never queued. */
export function requestGalleryFavoriteCurrent(panel) {
    const state = states.get(panel);
    if (!isGalleryFavoriteCapable(panel) || !state.acceptingReports
        || !state.features.includes('favoriteCurrent') || pending.has(panel)) {
        return Promise.resolve({ status: 'unavailable' });
    }
    return new Promise(resolve => {
        const requestId = state.generation + ':' + (++requestSequence);
        const request = { requestId, resolve, timer: null };
        pending.set(panel, request);
        request.timer = setTimeout(() => complete(panel), GALLERY_FAVORITE_TIMEOUT_MS);
        try {
            const child = panel.querySelector('iframe')?.contentWindow;
            if (!child) { complete(panel); return; }
            child.postMessage({
                source: CAPABILITY_BRIDGE_SOURCE, version: CAPABILITY_BRIDGE_VERSION,
                type: 'FAVORITE_CURRENT', capability: GALLERY_FAVORITE_CAPABILITY,
                generation: state.generation, requestId,
            }, state.origin);
        } catch { complete(panel); }
    });
}

function allowedOrigin(origin) {
    if (typeof origin !== 'string' || origin === 'null') return false;
    try {
        const url = new URL(origin);
        if (url.origin !== origin) return false;
        return origin === window.location.origin
            || origin === 'https://nowimhere3.github.io'
            || (url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname));
    } catch { return false; }
}

function notify(panel) {
    panel.dispatchEvent(new CustomEvent(GALLERY_CAPABILITY_CHANGED, { bubbles: true }));
}

function notifyState(panel) {
    panel.dispatchEvent(new CustomEvent(GALLERY_FAVORITE_STATE_CHANGED, { bubbles: true }));
}

/** Gallery owns favorite truth. This is its last accepted snapshot, nothing GS3 inferred. */
function parseFavoriteState(data) {
    if (typeof data.hasMedia !== 'boolean' || typeof data.isFavorite !== 'boolean') return null;
    if (data.hasMedia) {
        if (typeof data.mediaKey !== 'string' || data.mediaKey === ''
            || data.mediaKey.length > MAX_MEDIA_KEY_LENGTH) return null;
        return { hasMedia: true, mediaKey: data.mediaKey, isFavorite: data.isFavorite };
    }
    if (data.mediaKey !== null || data.isFavorite !== false) return null;
    return { hasMedia: false, mediaKey: null, isFavorite: false };
}

function dropFavoriteState(panel, state) {
    if (!state.favoriteState) return;
    state.favoriteState = null;
    notifyState(panel);
}

export function registerGalleryFavoriteCapability(panel) {
    if (!listening) {
        window.addEventListener('message', handleGalleryFavoriteMessage);
        listening = true;
    }
    return resetGalleryFavoriteCapability(panel, { acceptingReports: false });
}

export function resetGalleryFavoriteCapability(panel, { acceptingReports = false } = {}) {
    const previous = states.get(panel);
    complete(panel);
    stopQueryRetries(previous);
    const state = {
        generation: [...crypto.getRandomValues(new Uint32Array(4))].map(n => n.toString(16).padStart(8, '0')).join(''),
        acceptingReports: Boolean(acceptingReports),
        capable: false,
        features: [],
        favoriteState: null, // generation-scoped: a new state object starts with no snapshot
    };
    states.set(panel, state);
    if (previous?.favoriteState) notifyState(panel);
    if (previous?.capable) notify(panel);
    if (state.acceptingReports) {
        queryGalleryFavoriteCapability(panel);
        scheduleQueryRetry(panel, state);
    }
    return state.generation;
}

export function unregisterGalleryFavoriteCapability(panel) {
    const previous = states.get(panel);
    complete(panel);
    stopQueryRetries(previous);
    states.delete(panel);
    if (previous?.favoriteState) notifyState(panel);
    if (previous?.capable) notify(panel);
}

export function queryGalleryFavoriteCapability(panel) {
    const state = states.get(panel);
    if (!state?.acceptingReports) return false;
    try {
        const child = panel.querySelector('iframe')?.contentWindow;
        if (!child) return false;
        // Discovery contains no command or content. Origin policy is enforced
        // on replies; '*' permits explicitly cooperative cross-origin children.
        child.postMessage({
            source: CAPABILITY_BRIDGE_SOURCE, version: CAPABILITY_BRIDGE_VERSION,
            type: 'QUERY_CAPABILITY', capability: GALLERY_FAVORITE_CAPABILITY,
            generation: state.generation,
        }, '*');
        return true;
    } catch { return false; }
}

export function handleGalleryFavoriteMessage(event) {
    const data = event?.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)
        || data.source !== CAPABILITY_BRIDGE_SOURCE || data.version !== CAPABILITY_BRIDGE_VERSION
        || !['CAPABILITY_PRESENT', 'FAVORITE_RESULT', 'CURRENT_FAVORITE_STATE', 'SHORTCUT_KEY'].includes(data.type)
        || data.capability !== GALLERY_FAVORITE_CAPABILITY
        || typeof data.generation !== 'string' || !allowedOrigin(event.origin)) return false;
    const panel = findPanelForSourceWindow(event.source);
    const state = panel && states.get(panel);
    if (!state?.acceptingReports || data.generation !== state.generation) return false;
    if (data.type === 'SHORTCUT_KEY') {
        // Key INTENT only. The bridge validates trust and emits; it never knows the preset or
        // a Position. keyForward must be explicitly advertised (favoriteCurrent is not enough).
        if (!state.capable || event.origin !== state.origin || !panel.isConnected
            || !state.features.includes('keyForward')
            || typeof data.code !== 'string' || !MULTIHEART_SHORTCUT_CODES.has(data.code)) return false;
        panel.dispatchEvent(new CustomEvent(GALLERY_SHORTCUT_KEY, { bubbles: true, detail: { panel, code: data.code } }));
        return true;
    }
    if (data.type === 'CURRENT_FAVORITE_STATE') {
        const next = parseFavoriteState(data);
        if (!next || !state.capable || event.origin !== state.origin
            || !state.features.includes('favoriteState')) return false;
        const prev = state.favoriteState;
        if (prev && prev.hasMedia === next.hasMedia && prev.mediaKey === next.mediaKey
            && prev.isFavorite === next.isFavorite) return true; // identical: no redundant event
        state.favoriteState = next;
        notifyState(panel);
        return true;
    }
    if (data.type === 'FAVORITE_RESULT') {
        const request = pending.get(panel);
        if (!state.capable || event.origin !== state.origin || !request
            || typeof data.requestId !== 'string' || data.requestId !== request.requestId
            || !statuses.has(data.status)) return false;
        complete(panel, data.status);
        return true;
    }
    if (!Array.isArray(data.features) || data.features.length > 32
        || !data.features.every(f => typeof f === 'string' && /^[a-zA-Z][a-zA-Z0-9]{0,63}$/.test(f))) return false;
    const features = [...new Set(data.features)].sort();
    state.origin = event.origin;
    if (!features.includes('favoriteCurrent')) complete(panel);
    if (!state.capable || JSON.stringify(features) !== JSON.stringify(state.features)) {
        state.capable = true;
        state.features = features;
        stopQueryRetries(state);
        if (!features.includes('favoriteState')) dropFavoriteState(panel, state);
        notify(panel);
    }
    return true;
}

/** Detached snapshots: callers cannot mutate bridge truth. null = unregistered. */
export function getGalleryFavoriteCapability(panel) {
    const state = states.get(panel);
    return state ? {
        generation: state.generation, acceptingReports: state.acceptingReports,
        capable: state.capable, features: [...state.features],
    } : null;
}

export function isGalleryFavoriteCapable(panel) {
    return Boolean(panel?.isConnected && states.get(panel)?.capable);
}

/**
 * Latest accepted CURRENT_FAVORITE_STATE for this live Panel generation, as a copy.
 * null = unknown (unregistered, no favoriteState feature, or nothing received yet).
 * Action results (FAVORITE_RESULT) never feed this; only Gallery's own snapshots do.
 */
export function getGalleryFavoriteState(panel) {
    const state = states.get(panel);
    if (!panel?.isConnected || !state?.capable || !state.favoriteState
        || !state.features.includes('favoriteState')) return null;
    return { generation: state.generation, ...state.favoriteState };
}
