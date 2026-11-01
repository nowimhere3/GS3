/**
 * Host-only Gallery discovery. No commands, UI, URL detection or persistence.
 * Children answer QUERY_CAPABILITY with CAPABILITY_PRESENT, echoing generation.
 * The opaque generation changes on assignment AND every iframe load, including
 * reloads whose WindowProxy survives. Unsolicited/unfenced reports are refused.
 */
import {
    CAPABILITY_BRIDGE_SOURCE, CAPABILITY_BRIDGE_VERSION, findPanelForSourceWindow,
} from './capability-bridge.js';

export const GALLERY_FAVORITE_CAPABILITY = 'GALLERY_FAVORITE';
export const GALLERY_CAPABILITY_CHANGED = 'gs3:gallery-favorite-capability-changed';
const states = new WeakMap();
let listening = false;

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

export function registerGalleryFavoriteCapability(panel) {
    if (!listening) {
        window.addEventListener('message', handleGalleryFavoriteMessage);
        listening = true;
    }
    return resetGalleryFavoriteCapability(panel, { acceptingReports: false });
}

export function resetGalleryFavoriteCapability(panel, { acceptingReports = false } = {}) {
    const previous = states.get(panel);
    const state = {
        generation: [...crypto.getRandomValues(new Uint32Array(4))].map(n => n.toString(16).padStart(8, '0')).join(''),
        acceptingReports: Boolean(acceptingReports),
        capable: false,
        features: [],
    };
    states.set(panel, state);
    if (previous?.capable) notify(panel);
    if (state.acceptingReports) queryGalleryFavoriteCapability(panel);
    return state.generation;
}

export function unregisterGalleryFavoriteCapability(panel) {
    const previous = states.get(panel);
    states.delete(panel);
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
        || data.type !== 'CAPABILITY_PRESENT' || data.capability !== GALLERY_FAVORITE_CAPABILITY
        || typeof data.generation !== 'string' || !allowedOrigin(event.origin)
        || !Array.isArray(data.features) || data.features.length > 32
        || !data.features.every(f => typeof f === 'string' && /^[a-zA-Z][a-zA-Z0-9]{0,63}$/.test(f))) return false;
    const panel = findPanelForSourceWindow(event.source);
    const state = panel && states.get(panel);
    if (!state?.acceptingReports || data.generation !== state.generation) return false;
    const features = [...new Set(data.features)].sort();
    if (!state.capable || JSON.stringify(features) !== JSON.stringify(state.features)) {
        state.capable = true;
        state.features = features;
        notify(panel);
    }
    return true;
}

/** Detached snapshots: callers cannot mutate bridge truth. null = unregistered. */
export function getGalleryFavoriteCapability(panel) {
    const state = states.get(panel);
    return state ? { ...state, features: [...state.features] } : null;
}

export function isGalleryFavoriteCapable(panel) {
    return Boolean(panel?.isConnected && states.get(panel)?.capable);
}
