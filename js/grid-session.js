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
 *     arranged on screen. A 📍 Move to Position is a PRESENTATION change only
 *     — it never touches content. This distinction is what lets a move be a
 *     pure CSS grid-area reassignment (no iframe rebuild, no reload, live
 *     video/slideshow state fully preserved) while still being fully owned
 *     by the session and fully serializable by Save Session As.
 *
 *     _arrangement is slot-index -> grid-area name. positions.js turns that
 *     into the user-facing model: a POSITION is a fixed physical location, and
 *     "Position N" resolves to a fixed grid-area and from there to whichever
 *     panel currently renders as it. Panels move; Positions never do.
 *
 * It also owns the session's ACTION HISTORY — one canonical list backing both
 * master Undo and every panel's own ↩/↪. See the "History" section at the
 * bottom of this file.
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
import { getUrlPanelSource, normalizePanel, normalizePanelsArray } from './panels.js';
import { IDENTITY_ARRANGEMENT } from './positions.js';

let _sourceType = 'live'; // 'live' | 'preset'
let _sourceId = null;     // null for live, numeric preset id otherwise

// Content
let _panels = [];
let _folderMap = {};

// Presentation
let _arrangement = [...IDENTITY_ARRANGEMENT]; // slot-index -> grid-area name currently rendering there
let _layout = 'lefttall';

// ── Canonical action history ─────────────────────────────────────────────────
// ONE list, shared by master Undo and every panel's own Undo/Redo. See the
// "History" section at the bottom of this file for the full model.
const MAX_HISTORY = 50;
let _history = [];
let _actionSeq = 0;
let _undoSeq = 0;
let _pendingAction = null;

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
    const storedLayout = Store.has('tripleLayout') ? Store.get('tripleLayout') : null;

    if (workspaceId === 'live') {
        _sourceType = 'live';
        _sourceId = null;
        // Live Builder has no separate saved copy — its "template" IS
        // whatever's currently in the shared Store surface. We still only
        // ever READ it once here, at boot; nothing in this module writes
        // back to it afterward.
        _panels = normalizePanelsArray(Store.get('matrixUrls'));
        _folderMap = { ...(Store.get('folderMap') || {}) };
        _layout = storedLayout || defaultLayout;
    } else {
        _sourceType = 'preset';
        _sourceId = Number(workspaceId);
        const preset = getPresetById(_sourceId);
        _panels = getPresetPanels(preset); // transparently upconverts legacy `urls` data
        _folderMap = { ...(preset?.folderMap || {}) };
        _layout = preset?.layout || storedLayout || defaultLayout;
    }

    _arrangement = [...IDENTITY_ARRANGEMENT];
    _history = [];
    _actionSeq = 0;
    _undoSeq = 0;
    _pendingAction = null;

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
    _commitPendingAction();
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
    _commitPendingAction();
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
    // Positions are defined per-layout, and the arrangement has just been reset
    // to identity, so any recorded Position action now describes geometry that
    // no longer exists. Drop them from both the undo and redo pools rather than
    // let a later Undo replay a swap against a layout it was never made in.
    // Content actions are unaffected — a URL is a URL in any layout.
    _history.forEach((action) => {
        if (!action.arrangement) return;
        action.slots.forEach((slot) => { action.slotState[slot] = 'invalidated'; });
    });
    _pendingAction = null;
}

// ── History ──────────────────────────────────────────────────────────────────
//
// ONE canonical action list backs master Undo AND every panel's own Undo/Redo.
// There is deliberately no second, panel-local stack: two stacks could drift
// apart and undo the same change twice.
//
// An action is:
//
//   { id, seq, type,
//     slots:         [ ...affected panel identities (slot indices) ],
//     before:        { panels: {slot: Panel}, folders: {slot: string|null} },
//     after:         { panels: {...},         folders: {...} },
//     arrangement:   null | { swap: [a, b] | null, before: [...], after: [...] },
//     atomic:        true only for arrangement (Position) actions — see below,
//     slotState:     { slot: 'applied' | 'undone' | 'invalidated' },
//     slotUndoneSeq: { slot: n } }
//
// Recording is a begin/commit pair. Every call site already followed the
// "checkpoint, then mutate" shape, so beginGridAction() captures the BEFORE
// snapshot and the very next content/arrangement mutation commits the action by
// diffing against it. An action that turns out to have changed nothing is never
// recorded at all.
//
// APPLIED-NESS IS PER SLOT, NOT PER ACTION
//   An action's identity is global, but a multi-panel CONTENT action is really a
//   bundle of independent per-panel effects that merely happened at the same
//   moment. Shuffle All is the clear case: it changed panel B's URL for reasons
//   that have nothing to do with what it did to panel A, so "undo the last
//   change to panel B" should give B its old URL back and leave A and C exactly
//   where they are. Applied-ness therefore lives on `slotState[slot]`, and a
//   partial undo is a first-class state rather than an accident.
//
//   `atomic` is the exception, and it is what keeps that from degenerating.
//   A Position swap is not a bundle of two independent effects — moving A to
//   B's place IS moving B to A's place; there is no coherent "half" of it. An
//   atomic action's slots always transition together, so it can only ever be
//   reversed as a whole, once, from either participant. `atomic` is set exactly
//   when the action carries an arrangement change; content actions never are.
//
// SELECTION
//   master Undo      most recent action with ANY slot still 'applied'; reverses
//                    every slot of it that is still applied, so it still undoes
//                    a whole Shuffle All as one session action — while skipping
//                    any portion a panel already reversed on its own
//   Panel Undo N     most recent action whose slotState[N] is 'applied'.
//                    Reverses N's portion only — or, if atomic, all of it
//   Panel Redo N     the action whose slotState[N] was undone most recently.
//                    Reapplies N's portion only — or, if atomic, all of it
//
// Because state lives on the action itself and not in a per-panel stack, a
// portion undone from a panel is instantly invisible to master Undo, and vice
// versa — nothing can be undone twice, and no already-restored panel gets
// restored again. A Position swap is ONE atomic action listing BOTH occupants,
// so undoing it from either panel reverses it once and it then disappears from
// the other panel's undo pool too.
//
// REDO INVALIDATION
//   Committing a new action invalidates every currently-'undone' SLOT whose
//   panel the new action touched. Standard history branching, scoped per panel:
//   once a panel's state has moved on, a stale Redo for that panel can never
//   resurrect itself over the newer value, while the same action's portions on
//   untouched panels stay redoable. Invalidating any slot of an atomic action
//   invalidates all of it, since it cannot be partially redone. Changing layout
//   invalidates every Position action, since Positions are layout-scoped.
//
// RESTORATION IS SURGICAL
//   Undo/Redo only ever writes the slots the action itself recorded, and each
//   returned descriptor names exactly which slots changed URL, which changed
//   folder, and whether the arrangement moved — so the UI can reload precisely
//   the one iframe involved and leave every other live document alone.
//
//   Arrangement is restored by re-applying the recorded SWAP to the CURRENT
//   arrangement rather than by restoring a snapshot of the whole array. For the
//   most recent action the two are identical; for an older one, inverse
//   composition is what keeps a newer, still-applied swap from being silently
//   discarded. The arrangement stays a valid permutation either way.

function _snapshotState() {
    return {
        panels: _panels.map((panel) => ({ ...panel })),
        folderMap: { ..._folderMap },
        arrangement: [..._arrangement],
    };
}

/**
 * Open a recording window: the NEXT content or arrangement mutation becomes one
 * undoable action. `type` is descriptive metadata for diagnostics ('url',
 * 'folder', 'position', 'copy', 'shuffle', ...) — selection never depends on it.
 */
export function beginGridAction(type = 'change') {
    _pendingAction = { type, before: _snapshotState() };
}

/**
 * Historical name for beginGridAction() — every existing call site already
 * means "a change is about to happen here", which is exactly the begin marker.
 */
export function pushGridSessionCheckpoint() {
    beginGridAction('change');
}

function _diffArrangement(before, after) {
    const length = Math.max(before.length, after.length);
    const changed = [];
    for (let index = 0; index < length; index += 1) {
        if (before[index] !== after[index]) changed.push(index);
    }
    if (changed.length === 0) return null;
    // A Position move is always a 2-cycle. Anything else falls back to a plain
    // snapshot restore rather than pretending it can be inverse-composed.
    const isSwap = changed.length === 2
        && before[changed[0]] === after[changed[1]]
        && before[changed[1]] === after[changed[0]];
    return {
        swap: isSwap ? [changed[0], changed[1]] : null,
        changed,
        before: [...before],
        after: [...after],
    };
}

function _commitPendingAction() {
    const pending = _pendingAction;
    _pendingAction = null;
    if (!pending) return null;

    const { before } = pending;
    const beforePanels = {};
    const afterPanels = {};
    const beforeFolders = {};
    const afterFolders = {};
    const contentSlots = [];

    const length = Math.max(before.panels.length, _panels.length);
    for (let index = 0; index < length; index += 1) {
        const beforeUrl = getUrlPanelSource(before.panels[index]);
        const afterUrl = getUrlPanelSource(_panels[index]);
        const beforeFolder = before.folderMap[index] ?? null;
        const afterFolder = _folderMap[index] ?? null;
        if (beforeUrl === afterUrl && beforeFolder === afterFolder) continue;
        contentSlots.push(index);
        beforePanels[index] = normalizePanel(before.panels[index]);
        afterPanels[index] = normalizePanel(_panels[index]);
        beforeFolders[index] = beforeFolder;
        afterFolders[index] = afterFolder;
    }

    const arrangement = _diffArrangement(before.arrangement, _arrangement);
    if (contentSlots.length === 0 && !arrangement) return null; // nothing happened

    const slots = [...new Set([...contentSlots, ...(arrangement?.changed || [])])].sort((a, b) => a - b);

    // Redo invalidation — these panels' state has moved on. Scoped to the slots
    // the new action actually touched, so an older action stays redoable on the
    // panels it affected that this one didn't. An atomic action cannot be
    // partially redone, so invalidating any of its slots invalidates all of it.
    _history.forEach((action) => {
        const stale = action.slots.filter((slot) => slots.includes(slot) && action.slotState[slot] === 'undone');
        if (stale.length === 0) return;
        const doomed = action.atomic ? action.slots : stale;
        doomed.forEach((slot) => { action.slotState[slot] = 'invalidated'; });
    });

    _actionSeq += 1;
    const action = {
        id: `action-${_actionSeq}`,
        seq: _actionSeq,
        type: pending.type,
        slots,
        before: { panels: beforePanels, folders: beforeFolders },
        after: { panels: afterPanels, folders: afterFolders },
        arrangement,
        // Only a Position change is indivisible. A multi-panel CONTENT action is
        // a bundle of per-panel effects each panel may reverse on its own.
        atomic: Boolean(arrangement),
        slotState: Object.fromEntries(slots.map((slot) => [slot, 'applied'])),
        slotUndoneSeq: Object.fromEntries(slots.map((slot) => [slot, 0])),
    };
    _history.push(action);
    if (_history.length > MAX_HISTORY) _history.shift();
    return action;
}

/**
 * Write one side of an action back into the session, surgically — for `slots`
 * only, which for a partial (per-panel) restoration is a single slot. Every
 * other panel's content is left exactly as it is.
 */
function _applyActionSide(action, side, slots) {
    const changedUrlIndices = [];
    const changedFolderIndices = [];

    slots.forEach((index) => {
        const panel = action[side].panels[index];
        if (panel !== undefined) {
            while (_panels.length <= index) _panels.push(normalizePanel(''));
            if (getUrlPanelSource(_panels[index]) !== getUrlPanelSource(panel)) changedUrlIndices.push(index);
            _panels[index] = normalizePanel(panel);
        }
        const folder = action[side].folders[index];
        if (folder !== undefined) {
            if ((_folderMap[index] ?? null) !== folder) changedFolderIndices.push(index);
            if (folder === null) delete _folderMap[index];
            else _folderMap[index] = folder;
        }
    });

    let arrangementChanged = false;
    if (action.arrangement) {
        if (action.arrangement.swap) {
            const [a, b] = action.arrangement.swap;
            const held = _arrangement[a];
            _arrangement[a] = _arrangement[b];
            _arrangement[b] = held;
            arrangementChanged = true;
        } else {
            const next = [...action.arrangement[side]];
            arrangementChanged = next.some((area, index) => area !== _arrangement[index]);
            _arrangement = next;
        }
    }

    return {
        actionId: action.id,
        actionType: action.type,
        urls: _panels.map(getUrlPanelSource),
        folderMap: { ..._folderMap },
        arrangement: [..._arrangement],
        changedUrlIndices,
        changedFolderIndices,
        arrangementChanged,
    };
}

/**
 * Which of `action`'s slots this request actually reverses/reapplies.
 * An atomic action always moves as a whole. A per-panel request on a content
 * action moves that panel only; a master request moves every portion of it that
 * is still in `from` state, so master Undo still reverses a whole Shuffle All
 * while skipping any panel that already reversed its own portion.
 */
function _targetSlots(action, slotIndex, from) {
    const candidates = action.atomic || slotIndex === null ? action.slots : [slotIndex];
    return candidates.filter((slot) => action.slotState[slot] === from);
}

function _undoAction(action, slotIndex = null) {
    if (!action) return null;
    const slots = _targetSlots(action, slotIndex, 'applied');
    if (slots.length === 0) return null;
    const restored = _applyActionSide(action, 'before', slots);
    _undoSeq += 1;
    slots.forEach((slot) => {
        action.slotState[slot] = 'undone';
        action.slotUndoneSeq[slot] = _undoSeq;
    });
    return restored;
}

function _redoAction(action, slotIndex = null) {
    if (!action) return null;
    const slots = _targetSlots(action, slotIndex, 'undone');
    if (slots.length === 0) return null;
    const restored = _applyActionSide(action, 'after', slots);
    slots.forEach((slot) => {
        action.slotState[slot] = 'applied';
        action.slotUndoneSeq[slot] = 0;
    });
    return restored;
}

/** Whether any portion of this action is still live. */
function _hasSlotIn(action, state) {
    return action.slots.some((slot) => action.slotState[slot] === state);
}

/**
 * Action-level summary, derived from the per-slot states: 'applied' while any
 * portion is still applied, 'undone' once none are but some can still be
 * redone, 'invalidated' when nothing is left. Reporting and diagnostics only —
 * selection always works from the per-slot states.
 */
function _actionState(action) {
    if (_hasSlotIn(action, 'applied')) return 'applied';
    if (_hasSlotIn(action, 'undone')) return 'undone';
    return 'invalidated';
}

function _findMasterUndoable() {
    for (let index = _history.length - 1; index >= 0; index -= 1) {
        if (_hasSlotIn(_history[index], 'applied')) return _history[index];
    }
    return null;
}

function _findPanelUndoable(slotIndex) {
    for (let index = _history.length - 1; index >= 0; index -= 1) {
        const action = _history[index];
        if (action.slotState[slotIndex] === 'applied') return action;
    }
    return null;
}

function _findPanelRedoable(slotIndex) {
    let best = null;
    _history.forEach((action) => {
        if (action.slotState[slotIndex] !== 'undone') return;
        if (!best || action.slotUndoneSeq[slotIndex] > best.slotUndoneSeq[slotIndex]) best = action;
    });
    return best;
}

// ── Master Undo ──────────────────────────────────────────────────────────────

export function canUndoGridSession() {
    return _findMasterUndoable() !== null;
}

/** Undo the most recent still-applied action. Returns null if there is none. */
export function undoGridSession() {
    return _undoAction(_findMasterUndoable());
}

// ── Panel Undo / Redo ────────────────────────────────────────────────────────
// "Undo the most recent undoable action that affected THIS panel" — not the
// most recent thing that happened anywhere in the Runtime.

export function canUndoPanelHistory(slotIndex) {
    return _findPanelUndoable(slotIndex) !== null;
}

export function canRedoPanelHistory(slotIndex) {
    return _findPanelRedoable(slotIndex) !== null;
}

export function undoPanelHistory(slotIndex) {
    return _undoAction(_findPanelUndoable(slotIndex), slotIndex);
}

export function redoPanelHistory(slotIndex) {
    return _redoAction(_findPanelRedoable(slotIndex), slotIndex);
}

/** Read-only projection of the canonical history — diagnostics and tests. */
export function getGridHistory() {
    return _history.map((action) => ({
        id: action.id,
        seq: action.seq,
        type: action.type,
        slots: [...action.slots],
        state: _actionState(action),
        slotState: { ...action.slotState },
        atomic: action.atomic,
        isPosition: Boolean(action.arrangement),
    }));
}
