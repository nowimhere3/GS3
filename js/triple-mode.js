import { Store } from './storage.js';
import {
    State,
    getDatabaseStructure,
    setDatabaseStructure,
    setTargetUrls,
    setUrlFolderMap,
    getUrlFolderMap,
} from './state.js';
import { initBlacklist } from './blacklist.js';
import { fetchDatabaseSilently, pushDatabaseToRemote } from './sync.js';
import { loadPresetsSilently, getPresets, getPresetSummary, saveWorkspaceToPreset } from './presets.js';
import { populateBookmarkFolderSelect } from './folders.js';
import { buildStreamPanel } from './launch.js';
import {
    initGridSession, updateGridSession, setGridSessionSilently, getSessionUrls,
    getSessionFolderMap, getSourceWorkspaceInfo, setSessionSource,
    canUndoGridSession, undoGridSession,
    getSessionArrangement, setSessionArrangement, setSessionLayout,
    pushGridSessionCheckpoint,
} from './grid-session.js';

const SLOT_IDS = ['screen-1-slot', 'screen-2-slot', 'screen-3-slot', 'screen-4-slot'];
const LAYOUT_IDS = ['top2', 'bottom2', '3col', 'lefttall', 'righttall', 'vsplit', 'hsplit', '4grid'];
const DEFAULT_LAYOUT = 'lefttall';

// Describes each layout's grid tracks (content vs resizer) and where its
// draggable handle(s) sit. Shared by the resizer-injection and drag-math code
// below so there's one definition per layout instead of separate cases.
const LAYOUT_GRID_CONFIG = {
    top2:      { columns: ['content', 'resizer', 'content'], rows: ['content', 'resizer', 'content'],
                 resizers: [{ area: 'vres', axis: 'col', beforeIdx: 0, afterIdx: 2 },
                            { area: 'hres', axis: 'row', beforeIdx: 0, afterIdx: 2 }] },
    bottom2:   { columns: ['content', 'resizer', 'content'], rows: ['content', 'resizer', 'content'],
                 resizers: [{ area: 'vres', axis: 'col', beforeIdx: 0, afterIdx: 2 },
                            { area: 'hres', axis: 'row', beforeIdx: 0, afterIdx: 2 }] },
    '3col':    { columns: ['content', 'resizer', 'content', 'resizer', 'content'], rows: ['content'],
                 resizers: [{ area: 'vres1', axis: 'col', beforeIdx: 0, afterIdx: 2 },
                            { area: 'vres2', axis: 'col', beforeIdx: 2, afterIdx: 4 }] },
    lefttall:  { columns: ['content', 'resizer', 'content'], rows: ['content', 'resizer', 'content'],
                 resizers: [{ area: 'vres', axis: 'col', beforeIdx: 0, afterIdx: 2 },
                            { area: 'hres', axis: 'row', beforeIdx: 0, afterIdx: 2 }] },
    righttall: { columns: ['content', 'resizer', 'content'], rows: ['content', 'resizer', 'content'],
                 resizers: [{ area: 'vres', axis: 'col', beforeIdx: 0, afterIdx: 2 },
                            { area: 'hres', axis: 'row', beforeIdx: 0, afterIdx: 2 }] },
    vsplit:    { columns: ['content', 'resizer', 'content'], rows: ['content'],
                 resizers: [{ area: 'vres', axis: 'col', beforeIdx: 0, afterIdx: 2 }] },
    hsplit:    { columns: ['content'], rows: ['content', 'resizer', 'content'],
                 resizers: [{ area: 'hres', axis: 'row', beforeIdx: 0, afterIdx: 2 }] },
    // 4-way grid needs TWO row-resizer handles (left half / right half of the
    // horizontal divider) since the vertical divider splits it in two, but
    // both reference the same row tracks — so dragging either one moves the
    // whole horizontal line, same as a single continuous "+" divider.
    '4grid':   { columns: ['content', 'resizer', 'content'], rows: ['content', 'resizer', 'content'],
                 resizers: [{ area: 'vres',  axis: 'col', beforeIdx: 0, afterIdx: 2 },
                            { area: 'hresL', axis: 'row', beforeIdx: 0, afterIdx: 2 },
                            { area: 'hresR', axis: 'row', beforeIdx: 0, afterIdx: 2 }] },
};

const MIN_TRACK_SIZE = 80; // px-equivalent floor so a dragged panel can't collapse to nothing

// Clockwise visual order of slot-indices (0=screen1, 1=screen2, 2=screen3,
// 3=screen4) for each layout, always starting from the top-left-most panel.
// Drives the 🖥 position-swap dropdown in each panel's hotswap overlay, and
// — since it only ever lists the slots a layout actually uses — also defines
// which slots are visible for that layout.
const LAYOUT_POSITION_ORDER = {
    top2:      [0, 1, 2],
    bottom2:   [0, 2, 1],
    '3col':    [0, 1, 2],
    lefttall:  [0, 1, 2],
    righttall: [1, 0, 2],
    vsplit:    [0, 1],
    hsplit:    [0, 1],
    '4grid':   [0, 1, 3, 2], // TL, TR, BR, BL
};

// Session-only memory of custom drag positions, keyed by layout name. Never
// written to Store — a fresh visit to this page (including navigating back to
// index.html and returning) starts with none of this, by design.
const _customLayoutSizes = {};
let _currentLayout = DEFAULT_LAYOUT;
let _dragOverlayEl = null;

let _activeFolder = '';

const GRID_TRACE = '[Grid boot trace]';
function _traceGrid(stage, details) {
    console.groupCollapsed(`${GRID_TRACE} ${stage}`);
    Object.entries(details).forEach(([key, value]) => {
        // JSON snapshots keep DevTools from displaying a later-mutated object.
        const snapshot = JSON.parse(JSON.stringify(value ?? null));
        console.log(key, snapshot);
    });
    console.groupEnd();
}

function _pickRandom(arr) {
    if (!Array.isArray(arr) || arr.length === 0) return null;
    return arr[Math.floor(Math.random() * arr.length)];
}

function _pickFromFolder(db, folderName) {
    if (!db || !folderName || !Array.isArray(db[folderName]) || db[folderName].length === 0) return null;
    return _pickRandom(db[folderName]);
}

function _pickFromAnyFolder(db) {
    if (!db) return { url: null, folder: null };
    const folders = Object.keys(db).filter((folder) => Array.isArray(db[folder]) && db[folder].length > 0);
    const folder = _pickRandom(folders);
    if (!folder) return { url: null, folder: null };
    return { url: _pickRandom(db[folder]), folder };
}

function _inferFolderForUrl(db, url) {
    if (!db || !url) return null;
    const folder = Object.keys(db).find((name) => Array.isArray(db[name]) && db[name].includes(url));
    return folder || null;
}

function _buildTripleSet(db, preferredFolder = '') {
    const stored = getSessionUrls();
    const urls = Array.isArray(stored) ? stored.slice(0, SLOT_IDS.length) : [];
    const map = {};

    while (urls.length < SLOT_IDS.length) urls.push('');

    if (db && preferredFolder && db[preferredFolder]?.length) {
        for (let i = 0; i < SLOT_IDS.length; i += 1) {
            urls[i] = _pickFromFolder(db, preferredFolder) || urls[i] || 'https://example.com';
            map[i] = preferredFolder;
        }
        return { urls, map };
    }

    for (let i = 0; i < SLOT_IDS.length; i += 1) {
        if (urls[i]) continue;
        const pick = _pickFromAnyFolder(db);
        urls[i] = pick.url || 'https://example.com';
        if (pick.folder) map[i] = pick.folder;
    }

    for (let i = 0; i < SLOT_IDS.length; i += 1) {
        if (!map[i]) {
            const inferred = _inferFolderForUrl(db, urls[i]);
            if (inferred) map[i] = inferred;
        }
    }

    return { urls, map };
}

/**
 * 🎲 Shuffle — reshuffle every slot independently, each pulling a fresh random
 * URL from the folder it's CURRENTLY assigned to (per getUrlFolderMap()), same
 * as index.html's per-row assignment. A slot with no assigned folder falls
 * back to a random pick so it never dead-ends.
 */
function _reshuffleOwnFolders(db) {
    const currentMap = getUrlFolderMap();
    const urls = [];
    const map = {};

    for (let i = 0; i < SLOT_IDS.length; i += 1) {
        const folder = currentMap[i];
        const pickedUrl = folder ? _pickFromFolder(db, folder) : null;

        if (pickedUrl) {
            urls[i] = pickedUrl;
            map[i] = folder;
        } else {
            const pick = _pickFromAnyFolder(db);
            urls[i] = pick.url || 'https://example.com';
            if (pick.folder) map[i] = pick.folder;
        }
    }

    return { urls, map };
}

/**
 * 🎲🎲 Shuffle All — ignore each slot's assigned folder entirely; every slot
 * gets a brand new random folder + link, independently of the others.
 */
function _reshuffleRandomFolders(db) {
    const urls = [];
    const map = {};

    for (let i = 0; i < SLOT_IDS.length; i += 1) {
        const pick = _pickFromAnyFolder(db);
        urls[i] = pick.url || 'https://example.com';
        if (pick.folder) map[i] = pick.folder;
    }

    return { urls, map };
}

function _bindBookmarkModal() {
    const modalEl = document.getElementById('bookmark-modal');
    const cancelBtn = document.getElementById('btn-bm-cancel');
    const saveBtn = document.getElementById('btn-bm-save');

    const closeModal = () => modalEl.classList.remove('open');

    cancelBtn.onclick = closeModal;
    modalEl.onclick = (e) => {
        if (e.target === modalEl) closeModal();
    };

    saveBtn.onclick = async () => {
        const selectedFolder = document.getElementById('bm-folder-select').value;
        const newFolder = document.getElementById('bm-new-folder-input').value.trim().replace(/[^a-zA-Z0-9_\- ]/g, '');
        const targetFolder = newFolder || selectedFolder;
        const targetUrl = State.get('bookmarkTargetUrl');

        if (!targetFolder) {
            alert('Please choose an existing folder or enter a new folder name.');
            return;
        }
        if (!targetUrl) {
            closeModal();
            return;
        }

        const db = getDatabaseStructure() || {};
        if (!db[targetFolder]) db[targetFolder] = [];
        if (!db[targetFolder].includes(targetUrl)) {
            db[targetFolder].push(targetUrl);
            setDatabaseStructure(db);
            await pushDatabaseToRemote(`Bookmarked 1 link into playlist: ${targetFolder}`);
        }

        const starBtn = State.get('bookmarkStarBtn');
        if (starBtn) {
            starBtn.classList.add('saved');
            starBtn.textContent = '★';
        }

        closeModal();
    };
}

function _openBookmarkModal(url, starBtn) {
    const db = getDatabaseStructure();
    if (!db) {
        alert('Connect your GitHub database first to use the playlist feature.');
        return;
    }

    State.set('bookmarkTargetUrl', url);
    State.set('bookmarkStarBtn', starBtn);

    document.getElementById('bm-url-preview').textContent = url;
    document.getElementById('bm-new-folder-input').value = '';
    populateBookmarkFolderSelect();

    const modalEl = document.getElementById('bookmark-modal');
    modalEl.classList.add('open');
    document.getElementById('bm-new-folder-input').focus();
}

function _ensureDragOverlay() {
    if (_dragOverlayEl) return _dragOverlayEl;
    _dragOverlayEl = document.createElement('div');
    _dragOverlayEl.id = 'resizer-drag-overlay';
    document.body.appendChild(_dragOverlayEl);
    return _dragOverlayEl;
}

function _clearResizers(tripleLayoutEl) {
    tripleLayoutEl.querySelectorAll('.resizer').forEach((el) => el.remove());
}

/**
 * Handles a single drag gesture on one resizer handle. Reads the CURRENT
 * computed track sizes (so it naturally picks up wherever a previous drag —
 * or the layout's default — left things), adjusts only the two tracks
 * adjacent to this handle, and writes the result back as an inline style
 * override (never to Store). On release, saves the result into the
 * in-memory per-layout cache so switching orientations and back restores it.
 */
function _startResizeDrag(e, resizerEl, axis, beforeIdx, afterIdx, trackTypes, tripleLayoutEl) {
    e.preventDefault();
    const propName = axis === 'col' ? 'gridTemplateColumns' : 'gridTemplateRows';
    const computed = getComputedStyle(tripleLayoutEl)[propName].split(' ').map(parseFloat);
    const startBefore = computed[beforeIdx];
    const startAfter  = computed[afterIdx];
    const startPos = axis === 'col' ? e.clientX : e.clientY;

    const overlay = _ensureDragOverlay();
    overlay.style.cursor = axis === 'col' ? 'col-resize' : 'row-resize';
    overlay.classList.add('active');
    resizerEl.classList.add('active');

    const onMove = (moveEvt) => {
        const pos = axis === 'col' ? moveEvt.clientX : moveEvt.clientY;
        const delta = pos - startPos;
        let newBefore = startBefore + delta;
        let newAfter  = startAfter - delta;

        if (newBefore < MIN_TRACK_SIZE) { newAfter -= (MIN_TRACK_SIZE - newBefore); newBefore = MIN_TRACK_SIZE; }
        if (newAfter  < MIN_TRACK_SIZE) { newBefore -= (MIN_TRACK_SIZE - newAfter); newAfter = MIN_TRACK_SIZE; }
        newBefore = Math.max(newBefore, 1);
        newAfter  = Math.max(newAfter, 1);

        computed[beforeIdx] = newBefore;
        computed[afterIdx]  = newAfter;

        const rebuilt = computed.map((val, i) => (trackTypes[i] === 'resizer' ? '6px' : `${val}fr`));
        tripleLayoutEl.style[propName] = rebuilt.join(' ');
    };

    const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        overlay.classList.remove('active');
        resizerEl.classList.remove('active');

        // Remember this layout's custom sizing for the rest of the session
        if (!_customLayoutSizes[_currentLayout]) _customLayoutSizes[_currentLayout] = {};
        _customLayoutSizes[_currentLayout][propName] = tripleLayoutEl.style[propName];
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
}

/** Build the draggable handle(s) for whichever layout is currently active. */
function _injectResizers(layoutName, tripleLayoutEl) {
    _clearResizers(tripleLayoutEl);
    const config = LAYOUT_GRID_CONFIG[layoutName];
    if (!config) return;

    config.resizers.forEach(({ area, axis, beforeIdx, afterIdx }) => {
        const trackTypes = axis === 'col' ? config.columns : config.rows;
        const el = document.createElement('div');
        el.className = `resizer resizer-${axis === 'col' ? 'v' : 'h'}`;
        el.style.gridArea = area;
        el.addEventListener('mousedown', (e) => _startResizeDrag(e, el, axis, beforeIdx, afterIdx, trackTypes, tripleLayoutEl));
        tripleLayoutEl.appendChild(el);
    });
}

// The slot-index -> grid-area arrangement now lives in grid-session.js
// (getSessionArrangement/setSessionArrangement), so it's owned by the runtime
// session and travels into Save Session As, rather than being a local that the
// UI privately owns. This file only reads/writes it through the session.

/**
 * Swap what's showing in two screen slots — driven by the 🖥 button in each
 * panel's hotswap overlay. This NEVER touches the panel/iframe DOM or its
 * src — it only swaps which grid-area name the two slot *containers*
 * currently render as (via inline style, overriding their default CSS). The
 * panel stays in its original, untouched parent the whole time, so whatever
 * is playing live inside (video, slideshow, etc.) keeps running exactly like
 * it does when switching orientations — because this is the same kind of
 * change: pure CSS, zero DOM manipulation of the iframe itself.
 *
 * A swap is PRESENTATION only: it mutates the session's arrangement, never its
 * content. URLs and folder assignments stay bound to their slot-index, not to
 * the visual position — so this deliberately does NOT swap the folder map (a
 * later "own folder" Shuffle acts on the slot's own assignment, matching how
 * URLs stay put). The arrangement is owned by the runtime session
 * (grid-session.js), and a swap is checkpoint-worthy so undo can restore it.
 */
function _swapSlotContents(slotIndexA, slotIndexB) {
    const slotAEl = document.getElementById(SLOT_IDS[slotIndexA]);
    const slotBEl = document.getElementById(SLOT_IDS[slotIndexB]);
    if (!slotAEl || !slotBEl) return;

    pushGridSessionCheckpoint();

    const arrangement = getSessionArrangement();
    const tmpArea = arrangement[slotIndexA];
    arrangement[slotIndexA] = arrangement[slotIndexB];
    arrangement[slotIndexB] = tmpArea;
    setSessionArrangement(arrangement);

    slotAEl.style.gridArea = arrangement[slotIndexA];
    slotBEl.style.gridArea = arrangement[slotIndexB];
}

/**
 * Switch the visual arrangement of the 3 screen slots. This only ever touches
 * the CSS class on #triple-layout — the panels/iframes themselves are never
 * rebuilt or moved, since each slot's grid-area (screen1/screen2/screen3) is
 * fixed in CSS regardless of which layout is active. Also restores any custom
 * border-drag sizing this layout had earlier in the session, or falls back to
 * the layout's clean default if it hasn't been customized yet.
 */
function _applyLayout(layoutName, tripleLayoutEl, layoutBtns) {
    const safeName = LAYOUT_IDS.includes(layoutName) ? layoutName : DEFAULT_LAYOUT;
    _currentLayout = safeName;

    LAYOUT_IDS.forEach((name) => tripleLayoutEl.classList.remove(`layout-${name}`));
    tripleLayoutEl.classList.add(`layout-${safeName}`);

    const saved = _customLayoutSizes[safeName];
    tripleLayoutEl.style.gridTemplateColumns = saved?.gridTemplateColumns || '';
    tripleLayoutEl.style.gridTemplateRows    = saved?.gridTemplateRows    || '';

    _injectResizers(safeName, tripleLayoutEl);

    // A swap made via 🖥 was specific to the previous arrangement — reset it on
    // any orientation change so slots don't carry a stale swap into a layout it
    // was never set up for. setSessionLayout() records the new orientation on
    // the session AND resets its arrangement to identity in one call; the slot
    // elements' own inline grid-area is cleared just below, so DOM and session
    // agree. (Store.set('tripleLayout') below is a separate concern: the global
    // default orientation for brand-new sessions, not this session's own truth.)
    setSessionLayout(safeName);

    // Show only the slots this layout actually uses (2-screen splits only use
    // 2 of the 4 slots, 3-screen layouts use 3, only the 4-way grid uses all 4).
    const activeSlots = LAYOUT_POSITION_ORDER[safeName] || [0, 1, 2];
    SLOT_IDS.forEach((id, i) => {
        const slotEl = document.getElementById(id);
        if (!slotEl) return;
        slotEl.style.gridArea = '';
        slotEl.style.display = activeSlots.includes(i) ? '' : 'none';
    });

    Object.entries(layoutBtns).forEach(([name, btn]) => {
        btn.classList.toggle('active', name === safeName);
    });

    Store.set('tripleLayout', safeName);
    _traceGrid('shared Store write', {
        key: 'tripleLayout',
        value: safeName,
        note: 'Layout preference only; not workspace URLs or folder assignments.',
    });
}

/** Keep the master-bar Undo button's enabled/disabled state in sync with
 * whether there's actually anything left in THIS session's undo stack. Called
 * from _renderPanels() itself so every render path (initial load, Shuffle,
 * Shuffle All, folder selection, undo) keeps it correct automatically —
 * previously this was only refreshed at boot and after undo() itself, so it
 * stayed permanently disabled after the first Shuffle even though there was
 * something to undo. */
function _updateGridUndoButtonState() {
    const btn = document.getElementById('btn-master-undo');
    if (btn) btn.disabled = !canUndoGridSession();
}

function _renderPanels(urls, map, ctx, { skipUndoSnapshot = false } = {}) {
    _traceGrid('render request', {
        source: getSourceWorkspaceInfo(),
        skipUndoSnapshot,
        requestedUrls: urls,
        requestedFolderMap: map,
        sessionUrlsBefore: getSessionUrls(),
        sessionFolderMapBefore: getSessionFolderMap(),
        persistedUrlsBefore: Store.get('matrixUrls'),
        persistedFolderMapBefore: Store.get('folderMap'),
        note: 'This function must not write matrixUrls or folderMap to Store.',
    });

    // Phase 4B: this used to call Store.set('matrixUrls', urls) here, which
    // silently overwrote whatever workspace was active on index.html on
    // every single render (initial load, every Shuffle, every folder
    // reassignment) — that's the bug this phase fixes. Now this only ever
    // touches the isolated in-memory working copy; nothing here can leak
    // back into a saved preset or Live Builder unless the user explicitly
    // uses 💾 Save Session As... later.
    //
    // skipUndoSnapshot=true is only for the very first (boot) render, where
    // initGridSession() has already set the session's starting data — there
    // being nothing meaningful to undo back to yet, this just re-syncs
    // state.js's compatibility view without pushing a spurious undo point.
    if (skipUndoSnapshot) {
        setGridSessionSilently(urls, map);
    } else {
        // updateGridSession() no longer pushes undo on its own, so the master-bar
        // actions that re-render through here (Shuffle, Shuffle All, folder
        // select) take an explicit checkpoint first — mirroring the old coupled
        // behavior exactly, just made explicit. Per-panel actions never reach
        // this path: launch.js pushes its own checkpoint before setIframeUrl ->
        // onPanelContentChanged, so there's no double checkpoint.
        pushGridSessionCheckpoint();
        updateGridSession(urls, map);
    }
    // These calls update index3.html's own state.js module instance only.
    // They do not persist to Store and cannot share object identity with index.html.
    setTargetUrls(urls);
    setUrlFolderMap(map);

    _traceGrid('render state applied', {
        sessionUrlsAfter: getSessionUrls(),
        sessionFolderMapAfter: getSessionFolderMap(),
        persistedUrlsAfter: Store.get('matrixUrls'),
        persistedFolderMapAfter: Store.get('folderMap'),
        note: 'Persisted values above should match their pre-render values.',
    });

    SLOT_IDS.forEach((id, index) => {
        const slot = document.getElementById(id);
        // Clean existing content but keep label
        const existing = slot.querySelector('.stream-panel');
        if (existing) existing.remove();

        const panel = buildStreamPanel(
            urls[index] || 'https://example.com',
            index,
            'stream-panel triple-fill', // Using your specific CSS class from index3.html
            '100%',
            ctx
        );

        slot.appendChild(panel);
    });

    const visibleSlots = (LAYOUT_POSITION_ORDER[_currentLayout] || [0, 1, 2]).length;
    const active = urls.slice(0, visibleSlots).filter(Boolean).length;
    ctx.statusEl.textContent = `${active} streams`;

    _updateGridUndoButtonState();
}

/** Build the 🌐 Folder dropup list (matches .dropup-item / .dropup-count CSS in index3.html) */
function _renderFolderDropup(folderDropupEl, ctx) {
    const db = getDatabaseStructure();
    folderDropupEl.innerHTML = '';

    const anyItem = document.createElement('div');
    anyItem.className = 'dropup-item' + (_activeFolder ? '' : ' selected');
    anyItem.textContent = 'Any Folder (global random)';
    anyItem.onclick = () => {
        _activeFolder = '';
        folderDropupEl.classList.remove('open');
        const set = _reshuffleRandomFolders(getDatabaseStructure());
        _renderPanels(set.urls, set.map, ctx);
    };
    folderDropupEl.appendChild(anyItem);

    if (!db) return;

    Object.keys(db).forEach((folderName) => {
        const item = document.createElement('div');
        item.className = 'dropup-item' + (_activeFolder === folderName ? ' selected' : '');
        const label = document.createElement('span');
        label.textContent = folderName;
        const count = document.createElement('span');
        count.className = 'dropup-count';
        count.textContent = db[folderName].length;
        item.append(label, count);
        item.onclick = () => {
            _activeFolder = folderName;
            folderDropupEl.classList.remove('open');
            const set = _buildTripleSet(getDatabaseStructure(), _activeFolder);
            _renderPanels(set.urls, set.map, ctx);
        };
        folderDropupEl.appendChild(item);
    });
}

/**
 * Build the 💾 Save Session As... dropup — one row per preset, each showing
 * enough context (rows/streams, or "Empty", plus when it was last saved) to
 * avoid overwriting the wrong one by accident. The preset this session is
 * currently saved-as (if any) is visually marked as current.
 */
function _renderSaveSessionDropup(dropupEl, statusEl) {
    dropupEl.innerHTML = '';
    const source = getSourceWorkspaceInfo();

    getPresets().forEach((preset) => {
        const summary = getPresetSummary(preset);
        const isCurrent = source.type === 'preset' && Number(source.id) === Number(preset.id);

        const item = document.createElement('div');
        item.className = 'save-session-item' + (isCurrent ? ' current' : '');
        item.innerHTML = `
            <div class="save-session-item-main">
                <span>📁 ${preset.name}</span>
                ${isCurrent ? '<span class="save-session-current-badge">current</span>' : ''}
            </div>
            <div class="save-session-item-meta">${summary.isEmpty ? 'Empty' : `${summary.rowsLabel} · ${summary.streamsLabel}`}</div>
            <div class="save-session-item-saved">${summary.savedLabel}</div>
        `;
        item.onclick = () => {
            dropupEl.classList.remove('open');
            _handleSaveSessionAs(preset.id, statusEl);
        };
        dropupEl.appendChild(item);
    });
}

/**
 * The ONLY path anything from a running Grid session reaches a saved
 * preset. Reads the session's own in-memory working copy (never Store,
 * never the shared editing surface) and hands it to presets.js directly.
 * lockState is reset for the target — a Grid session has no lock-state
 * concept of its own to contribute, and carrying over the target preset's
 * OLD lockState (indexed against whatever it used to contain) wouldn't
 * meaningfully correspond to this session's content anyway.
 */
async function _handleSaveSessionAs(presetId, statusEl) {
    const urls = getSessionUrls();
    const folderMap = getSessionFolderMap();

    if (statusEl) statusEl.textContent = 'Saving…';

    const { updated, synced } = await saveWorkspaceToPreset(presetId, {
        panels: urls, // presets.js normalizes plain URL strings into url-type panels
        folderMap,
        lockState: {},
    });

    setSessionSource(presetId);

    if (statusEl) {
        statusEl.textContent = synced ? `Saved to ${updated.name}` : `Saved locally — sync pending`;
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    Store.warmCache();
    initBlacklist();

    // NOTE: this page's master-bar markup has no git-token / git-repo / connect
    // inputs — those live on index.html. Credentials are already in Store by
    // the time this page loads, so we just read the database directly.
    const statusEl        = document.getElementById('master-status');
    const toggleMasterBtn = document.getElementById('btn-toggle-master');
    const masterBarEl     = document.getElementById('master-bar');
    const closeMasterBtn  = document.getElementById('btn-master-close');
    const folderBtn       = document.getElementById('btn-master-folder');
    const folderDropupEl  = document.getElementById('master-folder-dropup');
    const shuffleBtn      = document.getElementById('btn-master-shuffle');
    const shuffleAllBtn   = document.getElementById('btn-master-shuffle-all');
    const undoBtn         = document.getElementById('btn-master-undo');
    const saveSessionBtn  = document.getElementById('btn-master-save');
    const saveDropupEl    = document.getElementById('master-save-dropup');
    const tripleLayoutEl  = document.getElementById('triple-layout');
    const layoutBtns = {
        top2:      document.getElementById('btn-layout-top2'),
        bottom2:   document.getElementById('btn-layout-bottom2'),
        '3col':    document.getElementById('btn-layout-3col'),
        lefttall:  document.getElementById('btn-layout-lefttall'),
        righttall: document.getElementById('btn-layout-righttall'),
        vsplit:    document.getElementById('btn-layout-vsplit'),
        hsplit:    document.getElementById('btn-layout-hsplit'),
        '4grid':   document.getElementById('btn-layout-4grid'),
    };

    _bindBookmarkModal();

    const ctx = {
        feedContainerEl: document.getElementById('triple-layout'),
        dirDropdownEl: null,
        statusEl,
        openBookmarkModal: _openBookmarkModal,
        getPositionOrder: () => LAYOUT_POSITION_ORDER[_currentLayout] || [0, 1, 2],
        swapWithSlot: (slotIndexA, slotIndexB) => _swapSlotContents(slotIndexA, slotIndexB),
        // Runtime-session write-backs for launch.js's per-panel overlay. These
        // are how a single panel's own hotswap action (manual URL edit, folder
        // assign, per-panel Shuffle / Shuffle All, Delete, Purge, Kill, 🚀)
        // reaches the authoritative session without the panel ever writing to
        // Store. launch.js pushes its own checkpoint before the content-changing
        // actions, so onPanelContentChanged/onPanelRemoved don't checkpoint again.
        onPanelContentChanged: (idx, newUrl, newFolder) => {
            const urls = getSessionUrls();
            const folderMap = getSessionFolderMap();
            urls[idx] = newUrl;
            if (newFolder !== undefined) folderMap[idx] = newFolder;
            updateGridSession(urls, folderMap);
            setTargetUrls(urls);      // keep state.js's compat view in sync
            setUrlFolderMap(folderMap);
        },
        onPanelRemoved: (idx) => {
            const urls = getSessionUrls();
            urls[idx] = '';
            updateGridSession(urls, getSessionFolderMap());
            setTargetUrls(urls);
        },
        pushUndoCheckpoint: () => pushGridSessionCheckpoint(),
    };

    // 🎬 toggle open/close for the master control bar
    const closeMasterBar = () => {
        masterBarEl.classList.remove('open');
        toggleMasterBtn.classList.remove('active');
        folderDropupEl.classList.remove('open');
    };
    toggleMasterBtn.onclick = () => {
        if (masterBarEl.classList.contains('open')) {
            closeMasterBar();
        } else {
            masterBarEl.classList.add('open');
            toggleMasterBtn.classList.add('active');
        }
    };
    closeMasterBtn.onclick = closeMasterBar;

    // 🖥 Layout switcher — wire each button now. The INITIAL layout is applied
    // after the session loads (below): initGridSession() resolves it from the
    // source workspace's own saved layout, so it can't be known until then.
    Object.entries(layoutBtns).forEach(([name, btn]) => {
        btn.onclick = () => _applyLayout(name, tripleLayoutEl, layoutBtns);
    });

    // 🌐 Folder dropup
    folderBtn.onclick = () => {
        const willOpen = !folderDropupEl.classList.contains('open');
        if (willOpen) _renderFolderDropup(folderDropupEl, ctx);
        folderDropupEl.classList.toggle('open', willOpen);
    };
    document.addEventListener('click', (e) => {
        if (folderDropupEl.classList.contains('open')
            && !folderDropupEl.contains(e.target)
            && e.target !== folderBtn) {
            folderDropupEl.classList.remove('open');
        }
    });

    if (statusEl) statusEl.textContent = 'Loading database…';
    await fetchDatabaseSilently(() => {
        if (!statusEl) return;
        const db = getDatabaseStructure();
        statusEl.textContent = db
            ? `Connected — ${Object.keys(db).length} folders`
            : 'Not connected';
    });

    // Grid sessions can be launched directly in a fresh tab, so this page
    // must load presets.json before resolving ?workspace=<id> — otherwise
    // getPresetById() falls back to an empty default preset and Grid fills
    // every slot with random picks instead of the actual saved workspace.
    await loadPresetsSilently();

    const initialSession = initGridSession(DEFAULT_LAYOUT); // Phase 4B/4D: load working copy + resolved layout from the URL-selected workspace
    // Now that the session exists, apply its resolved layout (preset.layout, or
    // the global tripleLayout preference, or DEFAULT_LAYOUT — decided inside
    // initGridSession). This is the single initial _applyLayout call for boot,
    // and it runs before the first render so _renderPanels reads the right
    // _currentLayout for its visible-slot count.
    _applyLayout(initialSession.layout, tripleLayoutEl, layoutBtns);
    _traceGrid('after session initialization', {
        source: getSourceWorkspaceInfo(),
        initialSession,
        sessionUrls: getSessionUrls(),
        sessionFolderMap: getSessionFolderMap(),
        presetsLoadedBeforeSession: getSourceWorkspaceInfo().type === 'live' ? 'not required' : 'inspect the preset source log above',
    });

    const initialDb = getDatabaseStructure();
    const initialSet = _buildTripleSet(initialDb, _activeFolder);
    _traceGrid('initial triple set', {
        sessionBeforeRender: initialSession,
        databaseFolders: initialDb ? Object.keys(initialDb) : [],
        generatedUrls: initialSet.urls,
        generatedFolderMap: initialSet.map,
    });
    _renderPanels(initialSet.urls, initialSet.map, ctx, { skipUndoSnapshot: true });

    // 🎲 Shuffle — reshuffle every panel independently, each from its OWN
    // currently-assigned folder (same folder it was launched with from index.html)
    shuffleBtn.onclick = () => {
        const db = getDatabaseStructure();
        const set = _reshuffleOwnFolders(db);
        _renderPanels(set.urls, set.map, ctx);
    };

    // 🎲🎲 Shuffle All — ignore every slot's assigned folder, pick a brand new
    // random folder + link for each one independently
    shuffleAllBtn.onclick = () => {
        const db = getDatabaseStructure();
        _activeFolder = '';
        const set = _reshuffleRandomFolders(db);
        _renderPanels(set.urls, set.map, ctx);
    };

    // ↩ Undo — steps back through this SESSION's own history only (Shuffle,
    // Shuffle All, folder reassignment, position swaps). Never touches
    // index.html's Undo — these are two entirely separate undo stacks.
    if (undoBtn) {
        undoBtn.onclick = () => {
            const restored = undoGridSession();
            if (!restored) return;
            setTargetUrls(restored.urls);
            setUrlFolderMap(restored.folderMap);
            _renderPanels(restored.urls, restored.folderMap, ctx, { skipUndoSnapshot: true });
            // undoGridSession() already restored the session's arrangement; now
            // reflect it on the slot elements. Without this, undoing a position
            // swap would restore content but leave the swapped slots in place.
            // _renderPanels only rebuilds panels inside slots — it never touches
            // slot grid-area — so this must be applied explicitly, per slot.
            restored.arrangement.forEach((area, slotIndex) => {
                const slotEl = document.getElementById(SLOT_IDS[slotIndex]);
                if (slotEl) slotEl.style.gridArea = area;
            });
        };
    }
    _updateGridUndoButtonState();

    // 💾 Save Session As... — the ONLY way this session's changes ever reach
    // a real preset. Nothing else in this file writes to presets.json.
    if (saveSessionBtn && saveDropupEl) {
        saveSessionBtn.onclick = () => {
            const willOpen = !saveDropupEl.classList.contains('open');
            if (willOpen) _renderSaveSessionDropup(saveDropupEl, statusEl);
            saveDropupEl.classList.toggle('open', willOpen);
        };
        document.addEventListener('click', (e) => {
            if (saveDropupEl.classList.contains('open')
                && !saveDropupEl.contains(e.target)
                && e.target !== saveSessionBtn) {
                saveDropupEl.classList.remove('open');
            }
        });
    }
});
