/**
 * current-url-observation.js — Stream Loop Launchpad
 * ─────────────────────────────────────────────────────────────────────────────
 * Ephemeral, panel-local observation of WHERE a live Panel document currently is.
 *
 *   assignedUrl         what GS3 intentionally loaded. `data-last-src`, Runtime
 *                       Session, Reload, Save. Never written here.
 *   observedCurrentUrl  where the Human has since browsed inside that content,
 *                       as reported by a cooperating child document
 *                       (GS3 Live URL Reporter userscript). null = nothing
 *                       observed beyond the landing page.
 *
 * Observation is a fact about one live document, not policy. It is never
 * persisted and never participates in Runtime Session, navigation history,
 * layout, Fill, or content identity.
 *
 * Why a sibling of capability-bridge.js rather than part of it: the Fill state
 * there is reset on every iframe load and owns overlays; observation follows a
 * different lifetime. They share only the wire envelope and panel lookup.
 *
 * ── Fencing ─────────────────────────────────────────────────────────────────
 * Panel identity is the reporting WindowProxy (`event.source`), never a URL.
 * That proxy survives navigation, so a late report from an OLD document arrives
 * through the same panel. It is fenced by the canonical content generation
 * (panel-navigation.js), not by any parallel counter:
 *
 *   - A GS3 assignment opens a new generation. Observation for the old one is
 *     void at once, and reports are refused until GS3's own loads for the new
 *     generation have come to rest (pendingLoads === 0 at an iframe load).
 *     If a reporter spoke while the gate was shut, GS3 then asks the settled
 *     document for its URL; a child that never spoke is never messaged.
 *   - Within a generation, a report from a document that has been superseded by
 *     another documentId is refused, and a document's `seq` only moves forward.
 *     A higher `seq` from an old document never outranks a new generation.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
    CAPABILITY_BRIDGE_SOURCE, CAPABILITY_BRIDGE_VERSION, findPanelForSourceWindow,
} from './capability-bridge.js';
import { getPanelNavigationState } from './panel-navigation.js';
import { getPresentationUrl } from './presentation-url.js';

export const CURRENT_URL_CAPABILITY = 'CURRENT_URL';
const MAX_URL_LENGTH = 8192;

// Slot index -> observation state for the panel currently built in that slot.
const _bySlot = new Map();
let _listenerInstalled = false;

function _slotKey(panel) {
    const value = Number(panel?.dataset?.slotIndex);
    return Number.isInteger(value) ? value : null;
}

function _stateForPanel(panel) {
    const key = _slotKey(panel);
    const state = key === null ? null : _bySlot.get(key);
    return state?.panel === panel ? state : null;
}

function _navigation(panel) {
    return getPanelNavigationState(_slotKey(panel));
}

function _freshState(panel, generation, retiredDocumentIds = new Set()) {
    return {
        panel,
        generation,
        accepting: false,
        capable: false,
        observedCurrentUrl: null,
        documentId: null,
        seq: 0,
        retiredDocumentIds,
        heardSinceLoad: false,   // any report from this panel's window since the last load
        heardWhileClosed: false, // ...that the gate refused, so the settled document must be asked
    };
}

function _absolute(url) {
    try { return new URL(url, document.baseURI).href; } catch { return null; }
}

function _assignedUrl(panel) {
    return panel?.querySelector?.('iframe')?.getAttribute('data-last-src') || null;
}

/**
 * The page GS3's assignment landed on is not drift. Exact URL equality against
 * what GS3 itself chose — the assigned URL, the presentation form actually put
 * on the iframe, and the navigation anchor (assignment corrected to a readable
 * same-origin redirect). Never a resemblance test.
 */
function _isLanding(panel, url, anchor) {
    const assigned = _assignedUrl(panel);
    const landing = [assigned, assigned && getPresentationUrl(assigned), anchor]
        .filter(Boolean).map(_absolute);
    return landing.includes(url);
}

function _isReportData(data) {
    return Boolean(data) && typeof data === 'object' && !Array.isArray(data)
        && data.source === CAPABILITY_BRIDGE_SOURCE
        && data.version === CAPABILITY_BRIDGE_VERSION
        && data.capability === CURRENT_URL_CAPABILITY;
}

function _isValidUrlReport(data) {
    if (typeof data.url !== 'string' || data.url.length > MAX_URL_LENGTH) return false;
    if (typeof data.documentId !== 'string' || data.documentId === '') return false;
    if (!Number.isSafeInteger(data.seq) || data.seq < 1) return false;
    try {
        const u = new URL(data.url);
        return (u.protocol === 'http:' || u.protocol === 'https:') && u.href === data.url;
    } catch {
        return false;
    }
}

export function handleCurrentUrlMessage(event) {
    const data = event?.data;
    if (!_isReportData(data)) return false;
    if (data.type !== 'CAPABILITY_PRESENT' && data.type !== 'CURRENT_URL') return false;
    if (data.type === 'CURRENT_URL' && !_isValidUrlReport(data)) return false;

    const panel = findPanelForSourceWindow(event.source);
    const state = _stateForPanel(panel);
    if (!state) return false;
    const navigation = _navigation(panel);
    state.heardSinceLoad = true;
    // Closed gate, or a GS3 assignment since it opened: refuse, but remember a
    // reporter is present so the settled document is queried at its load.
    if (!state.accepting || state.generation !== navigation.generation) {
        state.heardWhileClosed = true;
        return false;
    }

    if (data.type === 'CAPABILITY_PRESENT') {
        state.capable = true;
        return true;
    }

    if (state.retiredDocumentIds.has(data.documentId)) return false;
    if (data.documentId === state.documentId && data.seq <= state.seq) return false;
    if (state.documentId && data.documentId !== state.documentId) {
        state.retiredDocumentIds.add(state.documentId);
    }
    state.documentId = data.documentId;
    state.seq = data.seq;
    state.observedCurrentUrl = _isLanding(panel, data.url, navigation.anchor) ? null : data.url;
    return true;
}

export function ensureCurrentUrlObservation() {
    if (!_listenerInstalled && typeof window !== 'undefined') {
        window.addEventListener('message', handleCurrentUrlMessage);
        _listenerInstalled = true;
    }
}

/** A panel was built: observation starts closed until its first load settles. */
export function registerCurrentUrlObservation(panel) {
    ensureCurrentUrlObservation();
    const key = _slotKey(panel);
    if (key === null) return;
    _bySlot.set(key, _freshState(panel, _navigation(panel).generation));
}

/**
 * The panel iframe fired `load` — call after notePanelLoad(), so the pending
 * count already reflects this load. Reports are accepted only once GS3's own
 * loads for the current generation are done. A reporter speaks at
 * document-start, before `load`: if the gate refused it, the settled document
 * is asked for its URL. A child that never spoke is never messaged, so panels
 * without a reporter see no new traffic at all.
 */
export function noteCurrentUrlPanelLoad(panel) {
    const key = _slotKey(panel);
    let state = _stateForPanel(panel);
    if (!state) return;
    const navigation = _navigation(panel);
    const { heardSinceLoad, heardWhileClosed } = state;
    if (state.generation !== navigation.generation) {
        if (state.documentId) state.retiredDocumentIds.add(state.documentId);
        state = _freshState(panel, navigation.generation, state.retiredDocumentIds);
        _bySlot.set(key, state);
    } else if (!heardSinceLoad) {
        // Browsing replaced the document and the new one said nothing:
        // the previous document's observation no longer describes the Panel.
        state.capable = false;
        state.observedCurrentUrl = null;
    }
    state.heardSinceLoad = false;
    state.heardWhileClosed = false;
    state.accepting = navigation.pendingLoads === 0;
    if (!state.accepting || !heardWhileClosed) return; // still settling (⟳ Reload's about:blank), or no reporter

    try {
        panel.querySelector('iframe')?.contentWindow?.postMessage({
            source: CAPABILITY_BRIDGE_SOURCE,
            version: CAPABILITY_BRIDGE_VERSION,
            type: 'QUERY_CAPABILITY',
            capability: CURRENT_URL_CAPABILITY,
        }, '*');
    } catch {
        // A child that cannot be messaged simply never reports.
    }
}

/** Read-only diagnostics/test projection. Never a source of truth for policy. */
export function getCurrentUrlObservation(panel) {
    const slot = _slotKey(panel);
    const state = _stateForPanel(panel);
    if (!state) return null;
    const generation = _navigation(panel).generation;
    const current = state.generation === generation;
    return {
        slot,
        assignedUrl: _assignedUrl(panel),
        observedCurrentUrl: current ? state.observedCurrentUrl : null,
        generation,
        documentId: current ? state.documentId : null,
        seq: current ? state.seq : 0,
        capable: current && state.capable,
        accepting: current && state.accepting,
    };
}

/** Every live panel in this document, for DevTools field testing. */
export function getCurrentUrlObservations() {
    if (typeof document === 'undefined') return [];
    return [...document.querySelectorAll('.stream-panel')]
        .map(getCurrentUrlObservation)
        .filter(Boolean);
}
