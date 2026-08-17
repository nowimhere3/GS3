/**
 * grid-session.js — Stream Loop Launchpad
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 4B/4D — Grid Working-Copy Architecture + Runtime Session Ownership.
 *
 * The single authoritative source of truth for everything currently
 * displayed in index3.html. Runtime UI (triple-mode.js, launch.js's panel
 * overlays) should never hold its own copy of "what's on screen" — every
 * action mutates this module, then the UI re-renders FROM it.
 *
 * Two deliberately separate kinds of state:
 *   - CONTENT  (_panels, _folderMap) — what each slot actually contains.
 *     Slot identity never changes here; index 0 is always index 0.
 *   - PRESENTATION (_arrangement, _layout) — how that content is currently
 *     arranged on screen. A 🖥 position swap is a PRESENTATION change only —
 *     it never touches content. This distinction is what lets a swap be a
 *     pure CSS grid-area reassignment (no iframe rebuild, no reload, live
 *     video/slideshow state fully preserved) while still being fully owned
 *     by the session and fully serializable by Save Session As.
 *
 * Nothing here ever writes to Store's shared matrixUrls/folderMap/lockState
 * keys, and nothing here ever writes to presets.json — the ONLY way this
 * session's state reaches a saved preset is "💾 Save Session As...", which
 * reads getSessionUrls()/getSessionFolderMap()/getSessionLayout() and hands
 * them to presets.js directly.
 *
 * Source workspace detection: index.html's "🧩 Launch Grid" button encodes
 * exactly which workspace was active AT CLICK TIME into the URL
 * (?workspace=<id>), so this module never needs to guess or re-read Store at
 * its own boot. Falls back to 'live' if the param is missing.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Store } from './storage.js';
import { getPresetById, getPresetPanels } from './presets.js';
import { getUrlPanelSource, normalizePanelsArray } from './panels.js';
import { createUndoStack } from './undo-stack.js';

const IDENTITY_ARRANGEMENT = ['screen1', 'screen2', 'screen3', 'screen4'];

let _sourceType = 'live'; // 'live' | 'preset'
let _sourceId = null;     // null for live, numeric preset id otherwise

// Content
let _panels = [];
let _folderMap = {};

// Presentation
let _arrangement = [...IDENTITY_ARRANGEMENT]; // slot-index -> grid-area name currently rendering there
let _layout = 'lefttall';

const _undoStack = createUndoStack(50);

function _readSourceWorkspaceIdFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get('workspace') || 'live';
}

/**
 * Load the working copy from whichever workspace the URL says this session
 * was launched from. Call this once at boot, before the first render.
 * @param {string} defaultLayout — used when the source has no saved layout
 *        of its own (Live Builder, or a preset saved before layout tracking
 *        existed) — the constant itself stays owned by triple-mode.js rather
 *        than being duplicated here.
 * @returns {{ urls: string[], folderMap: object, layout: string }}
 */
export function initGridSession(defaultLayout = 'lefttall') {
    const workspaceId = _readSourceWorkspaceIdFromUrl();

    if (workspaceId === 'live') {
        _sourceType = 'live';
        _sourceId = null;
        // Live Builder has no separate saved copy — its "template" IS
        // whatever's currently in the shared Store surface. We still only
        // ever READ it once here, at boot; nothing in this module writes
        // back to it afterward.
        _panels = normalizePanelsArray(Store.get('matrixUrls'));
        _folderMap = { ...(Store.get('folderMap') || {}) };
        _layout = Store.get('tripleLayout') || defaultLayout;
    } else {
        _sourceType = 'preset';
        _sourceId = Number(workspaceId);
        const preset = getPresetById(_sourceId);
        _panels = getPresetPanels(preset); // transparently upconverts legacy `urls` data
        _folderMap = { ...(preset?.folderMap || {}) };
        _layout = preset?.layout || Store.get('tripleLayout') || defaultLayout;
    }

    _arrangement = [...IDENTITY_ARRANGEMENT];
    _undoStack.clear();

    return { urls: _panels.map(getUrlPanelSource), folderMap: { ..._folderMap }, layout: _layout };
}

/**
 * What this session is a working copy of. This is exactly the context
 * "💾 Save Session As..." dropup needs to default/highlight against
 * ("you launched this from Preset 2").
 */
export function getSourceWorkspaceInfo() {
    return { type: _sourceType, id: _sourceId };
}

/**
 * Called after a successful "💾 Save Session As... → Preset N" — the running
 * session's identity updates to that target, same as "Save As" in a normal
 * document editor.
 */
export function setSessionSource(presetId) {
    _sourceType = 'preset';
    _sourceId = Number(presetId);
}

// ── Content ──────────────────────────────────────────────────────────────────

export function getSessionUrls() {
    return _panels.map(getUrlPanelSource);
}

export function getSessionFolderMap() {
    return { ..._folderMap };
}

/**
 * Update the session's CONTENT (what each slot contains). Every content-
 * changing action — Shuffle, Shuffle All, manual URL entry, folder
 * reassignment, panel removal — should route through this. Does NOT push an
 * undo checkpoint by itself — update and "is this worth an undo point" are
 * independent decisions now (see pushGridSessionCheckpoint). Never writes to
 * Store or presets.json — purely in-memory.
 */
export function updateGridSession(urls, folderMap) {
    _panels = normalizePanelsArray(urls);
    _folderMap = { ...(folderMap || {}) };
}

/**
 * Same as updateGridSession() but for the very first (boot) render only,
 * where _buildTripleSet() fills in empty slots with fresh random picks, so
 * what's actually displayed can differ slightly from what initGridSession()
 * originally loaded. Kept as a distinct name so call sites are explicit
 * about why they're bypassing the undo-checkpoint question entirely (there's
 * nothing to undo back to before the page has even finished its first
 * render) rather than it being an accident of argument order.
 */
export function setGridSessionSilently(urls, folderMap) {
    _panels = normalizePanelsArray(urls);
    _folderMap = { ...(folderMap || {}) };
}

// ── Presentation ─────────────────────────────────────────────────────────────

/** slot-index -> grid-area name currently rendering there. A 🖥 position swap
 * only ever changes this — content (urls/folderMap) is untouched, which is
 * what keeps swaps a pure CSS change with zero iframe rebuild/reload. */
export function getSessionArrangement() {
    return [..._arrangement];
}

export function setSessionArrangement(arrangement) {
    _arrangement = [...arrangement];
}

export function getSessionLayout() {
    return _layout;
}

/**
 * Change the current orientation. Resets the arrangement back to identity —
 * a swap made sense for the PREVIOUS orientation's slot geometry, not
 * necessarily the new one, matching the precedent already established for
 * per-orientation border-drag sizing.
 */
export function setSessionLayout(layoutName) {
    _layout = layoutName;
    _arrangement = [...IDENTITY_ARRANGEMENT];
}

// ── Undo ─────────────────────────────────────────────────────────────────────
// Deliberately decoupled from updateGridSession()/setSessionArrangement() —
// "did the session change" and "is this worth an undo point" are separate
// questions now. Snapshots capture content + arrangement together (what the
// user was actually looking at), not layout — switching orientation already
// resets arrangement on its own, and undo isn't expected to flip the screen
// shape back.

export function pushGridSessionCheckpoint() {
    _undoStack.push({
        panels: _panels.map((p) => ({ ...p })),
        folderMap: { ..._folderMap },
        arrangement: [..._arrangement],
    });
}

export function canUndoGridSession() {
    return _undoStack.canPop();
}

/** Restore the previous checkpoint. Returns null if there's nothing to undo. */
export function undoGridSession() {
    const snapshot = _undoStack.pop();
    if (!snapshot) return null;

    _panels = snapshot.panels;
    _folderMap = snapshot.folderMap;
    _arrangement = snapshot.arrangement;

    return {
        urls: _panels.map(getUrlPanelSource),
        folderMap: { ..._folderMap },
        arrangement: [..._arrangement],
    };
}
