/**
 * panels.js — Stream Loop Launchpad
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 4A — Panel Schema Migration.
 *
 * A Panel is the universal content container for a grid slot / screen slot.
 * Going forward, the app should reason in terms of Panel *types*, not URL
 * strings — a URL is just one kind of Panel, alongside Workspace (a nested
 * Layer 2 session), and future types (Collection, Plugin, Camera, Local
 * Media, etc.).
 *
 * Shape:
 *   {
 *     type:    'url' | 'workspace' | ...   — what kind of thing this panel is
 *     source:  string | number             — url-panel: the URL string
 *                                             workspace-panel: the preset id
 *     options: object                      - Panel-owned content metadata;
 *                                             runtime: { layer: 2, kind }
 *                                             declares a nested executor.
 *   }
 *
 * Backward compatibility: every existing preset/workspace already on disk
 * stores plain URL strings, not Panel objects. normalizePanel() treats a
 * plain string as shorthand for a url-type panel, so old data keeps working
 * everywhere with no explicit migration step — it's normalized transparently
 * on every read, and anything NEW gets written out in full Panel shape.
 *
 * This module owns the schema and normalization only. It does not know about
 * Store, GitHub sync, or Grid rendering — those stay in storage.js, sync.js,
 * and grid.js/launch.js respectively.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const PANEL_TYPES = Object.freeze({
    URL: 'url',
    WORKSPACE: 'workspace',
});

/** Build a URL-type panel. */
export function createUrlPanel(url = '') {
    return { type: PANEL_TYPES.URL, source: url, options: {} };
}

/**
 * Build a Workspace-type panel — a reference to a nested Layer 2 workspace
 * (a preset id, or 'live' for a nested Live Builder session).
 * @param {string|number} presetId
 * @param {object} [options] — e.g. { layer: 2 } — additional content metadata
 */
export function createWorkspacePanel(presetId, options = { layer: 2 }) {
    return { type: PANEL_TYPES.WORKSPACE, source: presetId, options: structuredClone(options) };
}

/** True if `value` already looks like a well-formed panel object. */
function _isPanelShaped(value) {
    return value !== null && typeof value === 'object' && typeof value.type === 'string' && 'source' in value;
}

/**
 * Normalize any historical or current representation of a single slot into a
 * proper Panel object. This is the ONE function everything should funnel
 * through before treating a slot's value as a Panel — never hand-check
 * `typeof x === 'string'` elsewhere in the app.
 *
 * Accepts:
 *   - a plain string (legacy shorthand)   → becomes a url-type panel
 *   - an already-shaped panel object      → returned as a safe copy
 *   - null/undefined                      → becomes an empty url-type panel
 */
export function normalizePanel(value) {
    if (_isPanelShaped(value)) {
        return { type: value.type, source: value.source, options: structuredClone(value.options || {}) };
    }
    if (typeof value === 'string') {
        return createUrlPanel(value);
    }
    return createUrlPanel('');
}

/** Normalize a whole array of slot values (legacy strings, panels, or a mix). */
export function normalizePanelsArray(arr) {
    return Array.isArray(arr) ? arr.map(normalizePanel) : [];
}

export function isUrlPanel(panel) {
    return panel?.type === PANEL_TYPES.URL;
}

export function isWorkspacePanel(panel) {
    return panel?.type === PANEL_TYPES.WORKSPACE;
}

/** True if this panel has nothing meaningful in it (used for empty-slot checks). */
export function isEmptyPanel(panel) {
    if (isUrlPanel(panel)) return !panel.source;
    if (isWorkspacePanel(panel)) return panel.source === null || panel.source === undefined;
    return true;
}

/**
 * Get the plain string a url-type panel represents — the legacy view used by
 * code that hasn't been made panel-aware yet (e.g. iframe.src assignment for
 * URL panels). Returns '' for any non-url panel type, so callers that expect
 * "just the URL string" degrade gracefully instead of throwing.
 * This projection is lossy: it may render compatibility state, never decide identity.
 */
export function getUrlPanelSource(panel) {
    return isUrlPanel(panel) ? (panel.source || '') : '';
}

/** Pure declaration helper. Design-Time candidates never declare a Runtime. */
export function markPanelRuntime(panel, entry) {
    const copy = normalizePanel(panel);
    delete copy.options.runtime;
    if (isUrlPanel(copy) && entry?.role === 'runtime') {
        copy.options.runtime = { layer: 2, kind: entry.kind };
    }
    return copy;
}

export function getPanelRuntimeLayer(panel) {
    return isWorkspacePanel(panel) || (isUrlPanel(panel) && panel.options?.runtime?.layer === 2) ? 2 : null;
}

/** Typed content rendering; the legacy URL projection deliberately stays lossy. */
export function getPanelRenderUrl(panel) {
    return isWorkspacePanel(panel)
        ? `index3.html?workspace=${encodeURIComponent(panel.source)}`
        : getUrlPanelSource(panel);
}
