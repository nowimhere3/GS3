/**
 * Ephemeral, panel-local capability bridge state.
 *
 * Capability reports are advisory presentation facts from the document that
 * currently owns a live iframe WindowProxy. They are never persisted and never
 * participate in Runtime Session, navigation, layout, or content identity.
 */

import { getFillPresentationUrl } from './presentation-url.js';

export const CAPABILITY_BRIDGE_SOURCE = 'gs3-capability-bridge';
export const CAPABILITY_BRIDGE_VERSION = 1;
export const FILL_PANEL_CAPABILITY = 'FILL_PANEL';
export const FILL_PANEL_ACK_TIMEOUT_MS = 1500;

// Slot index -> state for the panel currently registered in that live slot.
const _slotCapabilityState = new Map();
let _listenerInstalled = false;

function _slotKey(panel) {
    const value = Number(panel?.dataset?.slotIndex);
    return Number.isInteger(value) ? value : null;
}

function _stateForPanel(panel) {
    const key = _slotKey(panel);
    const state = key === null ? null : _slotCapabilityState.get(key);
    return state?.panel === panel ? state : null;
}

function _clearPending(state) {
    if (!state) return;
    clearTimeout(state.ackTimer);
    state.ackTimer = null;
    state.pendingActive = null;
}

// ── FILL_EMBED ───────────────────────────────────────────────────────────────
// A Panel whose ASSIGNED URL is a recognised video page of a supported provider can
// Fill without any cooperating document: GS3 overlays that provider's own embed/player
// on top of the untouched Panel iframe and removes the overlay on Exit. Nothing here
// writes assignedUrl, data-last-src, the Runtime Session, history or the iframe's src.
const EMBED_SANDBOX = 'allow-same-origin allow-scripts allow-forms'; // Popout Shield: no popups, no top navigation

function _embedUrl(panel) {
    const assigned = panel?.querySelector?.('iframe')?.getAttribute('data-last-src');
    return getFillPresentationUrl(assigned);
}

function _removeEmbed(state) {
    if (!state?.embedFrame) return false;
    state.embedFrame.remove();
    state.embedFrame = null;
    state.embedActive = false;
    return true;
}

function _showEmbed(panel, state, url) {
    const frame = document.createElement('iframe');
    frame.className = 'gs3-fill-embed';
    frame.allow = 'autoplay; fullscreen';
    frame.setAttribute('allowfullscreen', '');
    frame.sandbox = EMBED_SANDBOX;
    // Same box as the Panel's own iframe: below the revealed toolbar, above nothing of GS3's chrome.
    // (An iframe is a replaced element: `auto` width/height would fall back to 300x150, so size it explicitly.)
    frame.style.cssText = 'position:absolute;left:0;top:var(--hotswap-website-inset,0px);'
        + 'width:100%;height:calc(100% - var(--hotswap-website-inset,0px));border:0;background:#000;z-index:1;';
    frame.src = url;
    panel.appendChild(frame);
    state.embedFrame = frame;
    state.embedActive = true;
}

function _fillPanelButtons(panel) {
    return panel?.querySelectorAll?.(
        '.btn-hotswap-fill-panel, .hotswap-mirror-btn[data-action-key="fillPanel"]',
    ) || [];
}

function _render(panel, state) {
    const available = Boolean(state?.capable || _embedUrl(panel) || state?.embedActive);
    const active = Boolean((state?.capable && state.active) || state?.embedActive);
    _fillPanelButtons(panel).forEach((button) => {
        button.hidden = !available;
        // Semantic marker: responsive layout must never reveal this control.
        if (available) delete button.dataset.capabilityHidden;
        else button.dataset.capabilityHidden = 'true';
        button.textContent = active ? '✕' : '⛶';
        button.title = active ? 'Exit Fill Panel' : 'Fill Panel';
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
    });
    panel?.dispatchEvent?.(new CustomEvent('gs3:fill-capability-changed'));
}

function _isBridgeData(data) {
    return Boolean(data) && typeof data === 'object' && !Array.isArray(data)
        && data.source === CAPABILITY_BRIDGE_SOURCE
        && data.version === CAPABILITY_BRIDGE_VERSION
        && data.capability === FILL_PANEL_CAPABILITY;
}

export function findPanelForSourceWindow(sourceWindow) {
    if (!sourceWindow || typeof document === 'undefined') return null;
    for (const panel of document.querySelectorAll('.stream-panel')) {
        const iframe = panel.querySelector('iframe');
        if (iframe?.contentWindow === sourceWindow) return panel;
    }
    return null;
}

export function handleCapabilityBridgeMessage(event) {
    const data = event?.data;
    if (!_isBridgeData(data)) return false;
    if (!['CAPABILITY_PRESENT', 'FILL_PANEL_ACTIVE'].includes(data.type)) return false;
    if (data.type === 'FILL_PANEL_ACTIVE' && typeof data.active !== 'boolean') return false;

    const panel = findPanelForSourceWindow(event.source);
    if (!panel) return false;
    const state = _stateForPanel(panel);
    if (!state || !state.acceptingReports) return false;

    if (data.type === 'CAPABILITY_PRESENT') {
        state.capable = true;
    } else {
        // Active-state reports are meaningful only after this generation has
        // truthfully announced that the capability exists.
        if (!state.capable) return false;
        state.active = data.active;
        if (state.pendingActive === data.active) _clearPending(state);
    }
    _render(panel, state);
    return true;
}

export function ensureCapabilityBridge() {
    if (!_listenerInstalled && typeof window !== 'undefined') {
        window.addEventListener('message', handleCapabilityBridgeMessage);
        _listenerInstalled = true;
    }
}

export function registerFillPanelCapability(panel) {
    ensureCapabilityBridge();
    const key = _slotKey(panel);
    if (key === null) return null;
    const previous = _slotCapabilityState.get(key);
    _clearPending(previous);
    _removeEmbed(previous);
    const state = {
        panel,
        generation: (previous?.generation || 0) + 1,
        capable: false,
        active: false,
        acceptingReports: false,
        pendingActive: null,
        ackTimer: null,
        embedFrame: null,
        embedActive: false,
    };
    _slotCapabilityState.set(key, state);
    _render(panel, state);
    return state.generation;
}

export function resetFillPanelCapability(panel, { acceptingReports = true } = {}) {
    const key = _slotKey(panel);
    if (key === null) return null;
    const previous = _stateForPanel(panel);
    _clearPending(previous);
    _removeEmbed(previous); // new content or reload: any Fill overlay belonged to the old content
    const state = {
        panel,
        generation: (previous?.generation || 0) + 1,
        capable: false,
        active: false,
        acceptingReports: Boolean(acceptingReports),
        pendingActive: null,
        ackTimer: null,
        embedFrame: null,
        embedActive: false,
    };
    _slotCapabilityState.set(key, state);
    _render(panel, state);
    return state.generation;
}

export function unregisterFillPanelCapability(panel) {
    const key = _slotKey(panel);
    const state = _stateForPanel(panel);
    if (key === null || !state) return false;
    _clearPending(state);
    _removeEmbed(state);
    _slotCapabilityState.delete(key);
    return true;
}

/**
 * The assigned URL changed after the capability state was reset (launch.js sets
 * `data-last-src` right after resetting): re-derive whether Fill is available.
 */
export function refreshFillPanelPresentation(panel) {
    const state = _stateForPanel(panel);
    if (state) _render(panel, state);
}

/** Leave embed Fill without touching anything else (used when the Panel navigates by history). */
export function exitFillEmbed(panel) {
    const state = _stateForPanel(panel);
    if (!state || !_removeEmbed(state)) return false;
    _render(panel, state);
    return true;
}

function _postToPanel(panel, type) {
    const iframe = panel?.querySelector?.('iframe');
    if (!iframe?.contentWindow) return false;
    iframe.contentWindow.postMessage({
        source: CAPABILITY_BRIDGE_SOURCE,
        version: CAPABILITY_BRIDGE_VERSION,
        type,
        capability: FILL_PANEL_CAPABILITY,
    }, '*');
    return true;
}

export function queryFillPanelCapability(panel) {
    try { return _postToPanel(panel, 'QUERY_CAPABILITY'); }
    catch { return false; }
}

export function requestFillPanelToggle(panel) {
    const state = _stateForPanel(panel);
    if (!state) return false;
    // FILL_EMBED lane: provider-native player for a recognised assigned URL. Exits first if active.
    if (state.embedActive) { _removeEmbed(state); _render(panel, state); return true; }
    const embedUrl = state.active ? null : _embedUrl(panel); // a live document-level Fill keeps its own toggle
    if (embedUrl) { _showEmbed(panel, state, embedUrl); _render(panel, state); return true; }
    if (!state.capable) return false;
    const expectedActive = !state.active;
    const type = expectedActive ? 'FILL_PANEL' : 'EXIT_FILL_PANEL';
    try {
        if (!_postToPanel(panel, type)) return false;
    } catch {
        return false;
    }

    _clearPending(state);
    state.pendingActive = expectedActive;
    const generation = state.generation;
    state.ackTimer = setTimeout(() => {
        const current = _stateForPanel(panel);
        if (current !== state || current.generation !== generation
            || current.pendingActive !== expectedActive) return;
        _clearPending(current);
        console.warn(`[Capability Bridge] ${type} was not acknowledged within ${FILL_PANEL_ACK_TIMEOUT_MS}ms.`);
    }, FILL_PANEL_ACK_TIMEOUT_MS);
    return true;
}

/** Read-only diagnostics/test projection. */
export function getFillPanelCapabilityState(panel) {
    const state = _stateForPanel(panel);
    return state ? {
        generation: state.generation,
        capable: state.capable,
        active: state.active,
        acceptingReports: state.acceptingReports,
        pendingActive: state.pendingActive,
        embedAvailable: Boolean(_embedUrl(panel)),
        embedActive: Boolean(state.embedActive),
    } : null;
}
