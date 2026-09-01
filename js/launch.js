/**
 * launch.js — Stream Loop Launchpad
 * ─────────────────────────────────────────────────────────────────────────────
 * Builds and launches the matrix of iframe panels.
 *
 * Exports:
 *   launchMatrix(urls, ctx)  — filters, builds panels, wires overlays, starts
 *
 * The `ctx` object:
 *   {
 *     setupScreenEl,     // #setup-screen
 *     loopScreenEl,      // #loop-screen
 *     feedContainerEl,   // #feed
 *     dirDropdownEl,     // #directory-dropdown
 *     portraitToggle,    // #portrait-mode-toggle checkbox
 *     statusEl,          // #status span
 *     getFrameHeights,   // () => { landscape, portrait, spacerTopOn, ... }
 *     openBookmarkModal, // (url, starBtn) => void
 *     stopScrolling,     // () => void  — from scroll.js
 *   }
 *
 * Each iframe panel contains:
 *   - The iframe itself
 *   - A hotswap overlay with: 📍 Move to Position, 📋 Copy to Position,
 *     📁 folder assign, ☆ star, 🌐 URL edit, ⟳ reload, 🎲 shuffle,
 *     🎲🎲 shuffle all, ❌ delete, ☠ kill, 🗑️ purge, 🚀 load Launchpad,
 *     ↩ Undo, ↪ Redo — each independently hideable via Settings, and (for the
 *     single-click ones) assignable as an always-visible Quick Action shortcut
 *     below the ··· trigger.
 *
 *   Positioning actions and panel history actions are only wired when the host
 *   page supplies the corresponding ctx hooks (index3.html's Grid Runtime
 *   does; index.html's free-form feed does not) — otherwise those buttons hide
 *   themselves entirely rather than sitting there doing nothing.
 *   - An IntersectionObserver for postMessage play/pause
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Store } from './storage.js';
import { getDatabaseStructure, setDatabaseStructure, getDatabaseSha, setDatabaseSha, getUrlFolderMap, setUrlFolderMap } from './state.js';
import { isBlacklisted, addToBlacklist } from './blacklist.js';
import { pushDatabaseToRemote } from './sync.js';
import { beginPanelContent, notePanelLoad } from './panel-navigation.js';
import {
    getHotswapTrayOrder, getActiveQuickActions, getActiveTopShortcuts,
    getVisibleTopDeepActions, getTopShortcutCount,
    isLayerTwoUrl, LAYER_1, LAYER_2, CHROME_RETRACT_DELAY_MS,
    isEligibleFor, SURFACES,
} from './hotswap-chrome.js';

/**
 * Read a panel iframe's current URL, or null when the browsing context is
 * cross-origin and the read throws. Never guesses, never falls back to
 * `iframe.src` — after a child-initiated navigation `src` still holds whatever
 * GS3 last assigned, so using it would fabricate a URL the panel is not on.
 */
function _readFrameUrl(iframe) {
    try {
        const href = iframe.contentWindow?.location?.href;
        return typeof href === 'string' ? href : null;
    } catch {
        return null; // SecurityError — cross-origin, genuinely unknowable
    }
}

/**
 * Surgically synchronize one already-rendered panel. Omitting url guarantees
 * the iframe document is untouched, which is required for metadata-only Undo.
 */
export function updateRenderedPanel(panel, { url, folder } = {}) {
    if (!panel) return;
    const iframe = panel.querySelector('iframe');
    const input = panel.querySelector('.hotswap-input');
    if (!iframe) return;
    if (url !== undefined) {
        // A GS3 content assignment — including one made by Undo/Redo restoring
        // an earlier URL — opens a new content generation, so browsing done
        // inside the OLD content can never leak across the replacement.
        const slotIndex = Number(panel.dataset.slotIndex);
        if (Number.isInteger(slotIndex)) beginPanelContent(slotIndex, url);
        iframe.src = url;
        iframe.setAttribute('data-last-src', url);
        if (input) input.value = url;
        refreshPanelLayerScope(panel); // this content may have created or removed Layer 2
    }
    if (folder !== undefined) iframe.setAttribute('data-source-folder', folder || '');
    updatePanelActionAvailability(panel);
}

/** One availability derivation for the canonical tray action and every mirror. */
export function updatePanelActionAvailability(panel) {
    const iframe = panel?.querySelector('iframe');
    if (!iframe) return;
    const aimedAtLayerTwo = panel.dataset.layerScope === LAYER_2
        && panel.querySelector('.hotswap-layer-selector')?.hidden === false;
    const folder = iframe.getAttribute('data-source-folder') || '';
    const db = getDatabaseStructure();
    const shuffleEnabled = aimedAtLayerTwo || Boolean(folder && db && Object.hasOwn(db, folder));
    const title = shuffleEnabled
        ? "Shuffle from this panel's assigned folder"
        : 'No assigned folder - use Shuffle All or Assign Folder';
    const trayBtn = panel.querySelector('.btn-hotswap-shuffle');
    if (trayBtn) { trayBtn.disabled = !shuffleEnabled; trayBtn.title = title; }
    panel.querySelectorAll('.hotswap-mirror-btn[data-action-key="shuffle"]').forEach((mirror) => {
        mirror.disabled = !shuffleEnabled;
        mirror.title = title;
    });
}

/**
 * Move a panel within its EXISTING content generation — how Panel Undo/Redo
 * performs a navigation step. Deliberately not updateRenderedPanel(): this is
 * traversal inside the content GS3 already assigned, not a new assignment, so
 * it must not open a generation or touch `data-last-src` (which keeps meaning
 * "the content source GS3 assigned", the value ⟳/☆/❌/🗑️ and Save Session act on).
 */
export function navigatePanelTo(panel, url) {
    const iframe = panel?.querySelector('iframe');
    if (!iframe) return false;
    iframe.src = url;
    return true;
}

/**
 * THE canonical Hotswap action registry — the single source of truth for every
 * action any Chrome surface can present.
 *
 * BREADCRUMBS — WAS: a single `shortcutable` boolean decided whether an action
 * could appear on a shortcut surface. It was hand-maintained and drifted:
 * "Edit URL" and "Assign Folder" were reachable in Deep Cuts but silently
 * absent from Toolbar Shortcuts and the Runway, because `shortcutable: false`
 * had been set back when a shortcut was a tiny corner button with nowhere to
 * show a picker.
 * IS: each action declares CAPABILITY (`opensPicker`) and STRUCTURAL OWNERSHIP
 * (`structural`). Surface eligibility is DERIVED from those in one place
 * (hotswap-chrome.js), so no surface keeps its own list to fall out of date.
 * WHY: three hand-curated vocabularies over one set of behaviors is drift
 * waiting to happen — and it already happened. Deriving eligibility means
 * adding an action makes it appear everywhere it is legal, automatically.
 *
 * Fields:
 *   opensPicker  the action reveals a row inside the Deep Cuts tray rather
 *                than firing immediately. Mirrors on other surfaces open the
 *                tray first so the picker is actually visible.
 *   structural   this action is ALREADY presented as fixed, non-removable UI:
 *                  'positionButton' — surfaced by [Position N]
 *                  'toolbarRail'    — a fixed control on the toolbar itself
 *                A surface never offers what it already shows structurally.
 *                The implementation is untouched either way — this governs
 *                presentation only.
 */
export const HOTSWAP_ACTIONS = [
    // Position-owned: reachable through [Position N], never as a configurable
    // shortcut. Keeping them in the ordinary collections would duplicate the
    // control and hide the relationship between Position identity and Position
    // actions.
    { key: 'position',     emoji: '📍',  title: 'Move to Position',                                      className: 'btn-hotswap-position',      structural: 'positionButton' },
    { key: 'copyPosition', emoji: '📋',  title: "Copy this panel's URL to another Position",             className: 'btn-hotswap-copy-position', structural: 'positionButton' },

    // Ordinary configurable actions. These two open a picker row — previously
    // that alone excluded them from every shortcut surface.
    { key: 'toggle',       emoji: '🌐',  title: 'Edit URL',                                              className: 'btn-hotswap-toggle',        opensPicker: true },
    { key: 'folder',       emoji: '📁',  title: 'Assign a folder for this panel',                        className: 'btn-hotswap-folder',        opensPicker: true },
    { key: 'star',         emoji: '⭐',  title: 'Save to Playlist',                                      className: 'btn-hotswap-star' },
    { key: 'reload',       emoji: '⟳',  title: 'Reload this panel',                                     className: 'btn-hotswap-reload' },
    { key: 'shuffle',      emoji: '🎲',  title: "Shuffle from this panel's assigned folder",             className: 'btn-hotswap-shuffle' },
    { key: 'shuffleAll',   emoji: '🎲🎲', title: 'Shuffle All — random URL from any folder',              className: 'btn-hotswap-shuffle-all' },
    { key: 'delete',       emoji: '❌',  title: "Delete this URL from its folder and load a replacement", className: 'btn-hotswap-delete' },
    { key: 'kill',         emoji: '☠',  title: 'Remove this panel for this session',                    className: 'btn-hotswap-kill' },
    { key: 'purge',        emoji: '🗑️', title: 'Purge — blacklist domain and remove from all folders',   className: 'btn-purge' },
    { key: 'launchpad',    emoji: '🚀',  title: 'Load the Stream Loop Launchpad inside this panel',       className: 'btn-hotswap-launchpad' },

    // Fixed on the toolbar rail, so they never consume a configurable Toolbar
    // Shortcut position. They remain eligible for the Runway and Deep Cuts —
    // those are different surfaces, where they are not already present.
    // Unlike every other action these carry an AVAILABILITY state; every
    // rendering of them is kept disabled in lockstep with the panel's real
    // history, so none can be a control that silently does nothing.
    { key: 'undo',         emoji: '↩',  title: 'Undo the last change to this panel',                    className: 'btn-hotswap-undo',          structural: 'toolbarRail' },
    { key: 'redo',         emoji: '↪',  title: 'Redo the last change undone on this panel',             className: 'btn-hotswap-redo',          structural: 'toolbarRail' },
];

/**
 * Surgically refresh one already-rendered panel's ↩/↪ availability, tray button
 * and Quick Action mirror alike. Exported so the runtime can re-sync every
 * panel after ANY history mutation (a master Undo, or a Position swap recorded
 * against two panels at once), without the runtime needing to know this
 * module's class names.
 */
/**
 * The parent -> Layer 2 message contract. Only OUR OWN runtime executor pages
 * are ever addressed (isLayerTwoUrl proves same-origin), and the message is
 * posted with an explicit same-origin target, never '*'.
 */
export const LAYER_MESSAGE_SOURCE = 'gs3-layer-scope';

/**
 * Actions that mean something different when aimed at Layer 2, and can
 * therefore be forwarded into the nested runtime.
 *
 * BREADCRUMBS — WHY this is a subset: the rest act on the CONTAINER — which URL
 * this panel holds, which folder it draws from, where it sits, whether it still
 * exists. Those have exactly one sensible target no matter which scope is
 * selected, and forwarding them would be inventing a meaning ("copy to
 * Position 3" inside a nested grid is not the same request). Being honest about
 * which actions are scopable beats pretending every button changes meaning.
 */
export const LAYER_SCOPED_ACTIONS = new Set(['undo', 'redo', 'shuffle', 'shuffleAll', 'reload']);

/**
 * Refresh a rendered panel's toolbar identity strip: the fixed Position it
 * currently occupies, and whether a Layer 2 selector applies.
 *
 * BREADCRUMBS — WHY the label is refreshed rather than owned: POSITION is a
 * property of the physical slot, not of the panel. When two panels swap,
 * Position 1 stays Position 1 and the panel occupying it changes — so the label
 * has to be re-derived from the arrangement, while the controls beside it keep
 * targeting the panel that is now there.
 */
export function updatePanelToolbar(panel, { positionLabel } = {}) {
    if (!panel) return;
    const labelEl = panel.querySelector('.hotswap-position-label');
    if (labelEl && positionLabel !== undefined) labelEl.textContent = positionLabel || '';
    refreshPanelLayerScope(panel);
}

/**
 * Re-derive whether this panel currently offers a Layer 2 scope, and light the
 * active one. Layer 2 comes and goes with the panel's CONTENT — loading a
 * nested runtime creates it, replacing that content destroys it — so this is
 * refreshed on every content change rather than decided once at build.
 *
 * BREADCRUMBS — WHY hidden when absent: with only one possible target there is
 * no choice to present. A permanently-lit lone [L1] would be pure clutter, and
 * worse, would imply a scope decision the user does not actually have.
 */
export function refreshPanelLayerScope(panel) {
    if (!panel) return;
    const selector = panel.querySelector('.hotswap-layer-selector');
    const iframe = panel.querySelector('iframe');
    if (!selector || !iframe) return;
    const available = isLayerTwoUrl(iframe.getAttribute('data-last-src') || '');
    selector.hidden = !available;
    // `layerScope` is a PREFERENCE, not a live fact: it is never overwritten
    // just because Layer 2 is currently absent. Forcing it to L1 while there is
    // no Layer 2 would make the default silently stick at L1 the moment one
    // appeared — the user would have to notice and correct it every time.
    // Absence is handled where it matters instead: dispatch requires Layer 2 to
    // actually exist, so an L2 preference with nothing nested simply acts here.
    selector.querySelectorAll('.hotswap-layer-btn').forEach((button) => {
        const isActive = button.dataset.layer === panel.dataset.layerScope;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-pressed', String(isActive));
    });
}

export function updatePanelHistoryButtons(panel, { canUndo, canRedo } = {}) {
    if (!panel) return;
    // BREADCRUMBS — WHY availability is scope-aware: local history describes
    // THIS panel. When the controls are aimed at Layer 2 that history is not
    // the thing being undone, and the nested runtime's own history is not
    // visible from here — so disabling on local state would be a guess that
    // hides a legitimate action. The forwarded request is always well-formed;
    // the nested runtime decides what it can do with it.
    const aimedAtLayerTwo = panel.dataset.layerScope === LAYER_2
        && panel.querySelector('.hotswap-layer-selector')?.hidden === false;
    const set = (key, className, enabled) => {
        if (enabled === undefined) return;
        const trayBtn = panel.querySelector(`.${className}`);
        if (trayBtn) trayBtn.disabled = !enabled;
        panel.querySelectorAll(`.hotswap-mirror-btn[data-action-key="${key}"]`)
            .forEach((mirror) => { mirror.disabled = !enabled; });
    };
    set('undo', 'btn-hotswap-undo', aimedAtLayerTwo ? true : canUndo);
    set('redo', 'btn-hotswap-redo', aimedAtLayerTwo ? true : canRedo);
}

// ── Panel builder ─────────────────────────────────────────────────────────────

function _buildPanel(url, index, panelClass, panelHeight, ctx) {
    const db           = getDatabaseStructure();
    const urlFolderMap = getUrlFolderMap();

    const launchFolder = urlFolderMap[index] || null;

    // ── Panel shell ──────────────────────────────────────────────────────────
    const panel = document.createElement('div');
    panel.className   = panelClass;
    panel.style.height = panelHeight;
    // Stable panel identity on the element, so updateRenderedPanel() can reach
    // this panel's navigation history without being handed the index again.
    // Slot index, never Position — a panel keeps its browsing history when it
    // moves to another Position.
    panel.dataset.slotIndex = String(index);

    // ── iframe ───────────────────────────────────────────────────────────────
    const iframe = document.createElement('iframe');
    iframe.src       = url;
    iframe.className = 'post-iframe';
    iframe.allow     = 'autoplay; fullscreen';
    iframe.sandbox   = 'allow-same-origin allow-scripts allow-forms allow-popups';
    iframe.setAttribute('data-last-src', url);
    iframe.setAttribute('data-source-folder', launchFolder || '');

    // Building the panel IS a GS3 content assignment: open generation 1, and
    // expect the one load the src above will produce.
    beginPanelContent(index, url);

    // Every subsequent load is either GS3's own (already accounted for by the
    // pending count) or the user navigating inside the content. The URL is read
    // defensively — cross-origin content records an opaque marker instead.
    iframe.addEventListener('load', () => {
        notePanelLoad(index, _readFrameUrl(iframe));
        if (typeof ctx.onPanelNavigated === 'function') ctx.onPanelNavigated(index);
    });

    // ── Helpers ──────────────────────────────────────────────────────────────

    /** Get the folder this iframe was launched from */
    const getSourceFolder = () => iframe.getAttribute('data-source-folder') || null;

    /** Pick a random non-blacklisted URL from a folder */
    const loadReplacement = (folderName) => {
        const currentDb = getDatabaseStructure();
        if (!currentDb || !currentDb[folderName]) return null;
        const pool = currentDb[folderName].filter(u => !isBlacklisted(u));
        return pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : null;
    };

    /** Sync iframe src, input field, and persisted URL list */
    /** Update the iframe + (if present) input field, and persist the change.
     * If ctx provides onPanelContentChanged (only true for index3.html's
     * Grid, which owns its own runtime session), delegate persistence to
     * it entirely — this panel must never write to the shared Store surface
     * directly in that context, or a Grid-session edit would leak into
     * whatever workspace is active on index.html. Otherwise (plain
     * index.html), this write IS the correct persistence path — the
     * setup-screen's own auto-save only covers its own inputs, not an
     * already-launched panel like this one. */
    const setIframeUrl = (newUrl, newFolder) => {
        updateRenderedPanel(panel, { url: newUrl, folder: newFolder });

        if (typeof ctx.onPanelContentChanged === 'function') {
            ctx.onPanelContentChanged(index, newUrl, newFolder);
        } else {
            const urls = JSON.parse(localStorage.getItem('loop_matrix_urls') || '[]');
            urls[index] = newUrl;
            Store.set('matrixUrls', urls);
            if (newFolder !== undefined) {
                setUrlFolderMap({ ...getUrlFolderMap(), [index]: newFolder });
            }
        }
    };

    // ── Overlay HTML ─────────────────────────────────────────────────────────
    const overlay = document.createElement('div');
    overlay.className = 'hotswap-overlay';
    overlay.innerHTML = `
        <div class="hotswap-icon-row">
            <button class="btn-hotswap-position" title="Move to Position">📍</button>
            <button class="btn-hotswap-copy-position" title="Copy this panel's URL to another Position">📋</button>
            <button class="btn-hotswap-folder" title="Assign a folder for this panel">📁</button>
            <button class="btn-hotswap-star" title="Save to Playlist">☆</button>
            <button class="btn-hotswap-toggle" title="Edit URL">🌐</button>
            <button class="btn-hotswap-reload" title="Reload this panel">⟳</button>
            <button class="btn-hotswap-shuffle" title="Shuffle from this panel's assigned folder">🎲</button>
            <button class="btn-hotswap-shuffle-all" title="Shuffle All — random URL from any folder">🎲🎲</button>
            <button class="btn-hotswap-delete" title="Delete this URL from its folder and load a replacement">❌</button>
            <button class="btn-hotswap-kill" title="Remove this panel for this session">☠</button>
            <button class="btn-purge" title="Purge — blacklist domain and remove from all folders">🗑️</button>
            <button class="btn-hotswap-launchpad" title="Load the Stream Loop Launchpad inside this panel">🚀</button>
            <button class="btn-hotswap-undo" title="Undo the last change to this panel">↩</button>
            <button class="btn-hotswap-redo" title="Redo the last change undone on this panel">↪</button>
        </div>
        <div class="hotswap-empty-state" hidden>All actions are on the toolbar.</div>
        <div class="hotswap-position-row"></div>
        <div class="hotswap-copy-row"></div>
        <div class="hotswap-folder-row"></div>
        <div class="hotswap-url-row">
            <input type="text" class="hotswap-input" value="${url}" placeholder="https://...">
            <button class="hotswap-submit-btn">✓</button>
        </div>
    `;

    const toggleBtn      = overlay.querySelector('.btn-hotswap-toggle');
    const urlRow         = overlay.querySelector('.hotswap-url-row');
    const inputField     = overlay.querySelector('.hotswap-input');
    const submitBtn      = overlay.querySelector('.hotswap-submit-btn');
    const starBtn        = overlay.querySelector('.btn-hotswap-star');
    const reloadBtn      = overlay.querySelector('.btn-hotswap-reload');
    const shuffleBtn     = overlay.querySelector('.btn-hotswap-shuffle');
    const shuffleAllBtn  = overlay.querySelector('.btn-hotswap-shuffle-all');
    const deleteBtn      = overlay.querySelector('.btn-hotswap-delete');
    const killBtn        = overlay.querySelector('.btn-hotswap-kill');
    const purgeBtn       = overlay.querySelector('.btn-purge');
    const positionBtn    = overlay.querySelector('.btn-hotswap-position');
    const positionRow    = overlay.querySelector('.hotswap-position-row');
    const copyBtn        = overlay.querySelector('.btn-hotswap-copy-position');
    const copyRow        = overlay.querySelector('.hotswap-copy-row');
    const undoBtn        = overlay.querySelector('.btn-hotswap-undo');
    const redoBtn        = overlay.querySelector('.btn-hotswap-redo');
    const folderBtn      = overlay.querySelector('.btn-hotswap-folder');
    const folderRow      = overlay.querySelector('.hotswap-folder-row');
    const launchpadBtn   = overlay.querySelector('.btn-hotswap-launchpad');
    const pickerRows = [folderRow, urlRow];
    const hasOpenPicker = () => pickerRows.some((row) => row.classList.contains('open'));
    // Retained while a utility is open so the control that opened it counts as
    // "inside" — otherwise pointerdown closes it and the following click event
    // re-opens it, breaking the same-control toggle. Cleared in closePicker().
    let activePickerAnchor = null;
    const closePicker = () => {
        pickerRows.forEach((row) => row.classList.remove('open'));
        [folderBtn, toggleBtn].forEach((button) => button.classList.remove('active'));
        activePickerAnchor = null;
    };

    // ── Retractable top toolbar ──────────────────────────────────────────────
    // BREADCRUMBS — WAS: an always-visible "···" trigger pinned to the panel's
    // top-right corner, with the tray popping out beside it, permanently
    // occupying territory an arbitrary website almost certainly wants.
    // IS: a toolbar anchored immediately inside the panel's TOP boundary that
    // is retracted to zero height at rest and, when revealed, INSETS the
    // content — the iframe is pushed down rather than covered.
    // WHY: the website should own essentially all panel real estate whenever
    // GS3's controls are not in use. Overlaying the top strip would sit on the
    // site's own header; permanently reserving the strip would shrink every
    // site forever. Insetting only while revealed does neither. Revealing and
    // retracting is a pure layout change on a container the iframe already
    // lives in, so the document inside is never touched — see PART 18.
    const toolbar = document.createElement('div');
    toolbar.className = 'hotswap-toolbar';
    toolbar.innerHTML = `
        <button class="hotswap-position-btn" type="button"><span class="hotswap-position-label"></span> <span class="hotswap-caret">\u25be</span></button>
        <span class="hotswap-toolbar-spacer"></span>
        <div class="hotswap-layer-selector" hidden>
            <button class="hotswap-layer-btn" data-layer="L2">L2</button>
            <button class="hotswap-layer-btn" data-layer="L1">L1</button>
        </div>
        <div class="hotswap-top-shortcuts"></div>
        <div class="hotswap-toolbar-actions"></div>
    `;
    const positionBtnEl = toolbar.querySelector('.hotswap-position-btn');
    const positionLabelEl = toolbar.querySelector('.hotswap-position-label');
    // BREADCRUMBS — the pop-under is a PANEL child, never a toolbar child. The
    // rail is `overflow: hidden` so it can animate from zero height, which also
    // clips anything hanging below it — that is exactly what made the Position
    // button appear inert: the menu opened, fully clipped and un-hittable.
    const positionMenuEl = document.createElement('div');
    positionMenuEl.className = 'hotswap-position-menu';
    positionMenuEl.hidden = true;
    const layerSelectorEl = toolbar.querySelector('.hotswap-layer-selector');
    const topShortcutsEl = toolbar.querySelector('.hotswap-top-shortcuts');
    const toolbarActionsEl = toolbar.querySelector('.hotswap-toolbar-actions');

    // BREADCRUMBS — WHY: the resize boundary and the Chrome activation region
    // are deliberately SEPARATE hit targets. The true border keeps resize; this
    // strip sits just inside it, clear of the resizer's own grab zone, so a
    // given pixel always means exactly one thing. Sharing the target would make
    // pointer intent ambiguous — a drag that sometimes opens a menu instead.
    const activationEl = document.createElement('div');
    activationEl.className = 'hotswap-activation';

    const triggerBtn = document.createElement('button');
    triggerBtn.className   = 'hotswap-trigger';
    triggerBtn.textContent = '\u00b7\u00b7\u00b7';
    triggerBtn.title       = 'Deep Cuts';

    // ── Chrome lifecycle ─────────────────────────────────────────────────────
    // Everything the user could plausibly be reaching for is ONE interaction
    // family. While pointer or focus is inside it, Chrome stays. When both
    // leave, a short countdown retracts it — see CHROME_RETRACT_DELAY_MS.
    const inChromeFamily = (node) => node instanceof Node
        && (toolbar.contains(node) || overlay.contains(node)
            || activationEl.contains(node) || positionMenuEl.contains(node)
            || pickerRows.some((row) => row.contains(node)));
    const inRailFamily = (node) => node instanceof Node
        && (toolbar.contains(node) || overlay.contains(node)
            || activationEl.contains(node) || positionMenuEl.contains(node));
    // The dismissal boundary for an OPEN utility: itself + its invoking control.
    // Deliberately NOT inChromeFamily — that predicate answers a different
    // question (should the 850ms retract timer run) and is far too broad here.
    const inActiveUtility = (node) => node instanceof Node
        && (pickerRows.some((row) => row.classList.contains('open') && row.contains(node))
            || (activePickerAnchor && activePickerAnchor.contains(node)));

    let retractTimer = null;
    const cancelRetract = () => { clearTimeout(retractTimer); retractTimer = null; };

    /** Close the deepest open child, or report that there was none. */
    const closeDeepestChild = () => {
        const openChild = panel.querySelector('.hotswap-position-row.open, .hotswap-copy-row.open');
        if (openChild) {
            openChild.classList.remove('open');
            overlay.querySelectorAll('.hotswap-icon-row .active').forEach((b) => b.classList.remove('active'));
            return true;
        }
        if (hasOpenPicker()) { closePicker(); return true; }
        if (!positionMenuEl.hidden) { closePositionMenu(); return true; }
        if (overlay.classList.contains('open')) { closeDeepCuts(); return true; }
        return false;
    };

    const setToolbarRevealed = (revealed) => {
        panel.classList.toggle('chrome-revealed', revealed);
        if (revealed) { cancelRetract(); layoutTopShortcuts(); return; }
        closePositionMenu();
        closeDeepCuts();
    };

    const scheduleRetract = () => {
        cancelRetract();
        retractTimer = setTimeout(() => {
            retractTimer = null;
            if (hasOpenPicker()) return;
            // Deliberately unconditional: an open tray must not be able to hold
            // the website's height hostage once the user has walked away. While
            // they are still IN the family every leave is cancelled above, so
            // this only ever fires after they are genuinely done.
            setToolbarRevealed(false);
        }, CHROME_RETRACT_DELAY_MS);
    };

    const revealToolbar = () => { cancelRetract(); setToolbarRevealed(true); };

    activationEl.addEventListener('pointerenter', revealToolbar);
    [toolbar, overlay, positionMenuEl].forEach((surface) => {
        surface.addEventListener('pointerenter', revealToolbar);
        surface.addEventListener('pointerleave', (e) => {
            if (!inChromeFamily(e.relatedTarget)) scheduleRetract();
        });
    });
    // Keyboard users are part of the family too — focus keeps Chrome alive.
    panel.addEventListener('focusin', (e) => {
        if (!inChromeFamily(e.target)) return;
        cancelRetract();
        if (inRailFamily(e.target)) revealToolbar();
    });
    panel.addEventListener('focusout', (e) => {
        if (inChromeFamily(e.target) && !inChromeFamily(e.relatedTarget)) scheduleRetract();
    });
    // Leaving the panel entirely — including onto a cross-origin iframe, whose
    // own events GS3 can never see — is the reliable signal that the user is
    // back on the content.
    panel.addEventListener('pointerleave', (e) => {
        if (!inChromeFamily(e.relatedTarget)) scheduleRetract();
    });
    // Moving onto the content INSIDE this panel counts as leaving Chrome. The
    // iframe swallows its own pointer events, so this is the last observable
    // moment before the pointer disappears into content GS3 cannot watch.
    iframe.addEventListener('pointerenter', scheduleRetract);
    // Chromium does not dispatch `focus` on the iframe element when a click
    // moves focus into its browsing context. It does blur the parent window,
    // with the iframe exposed as document.activeElement. Check that honest
    // cross-origin-safe signal on the next frame: nothing is placed over the
    // website and the interaction that caused the transition continues intact.
    window.addEventListener('blur', () => {
        if (!hasOpenPicker()) return;
        requestAnimationFrame(() => {
            if (hasOpenPicker() && document.activeElement === iframe) closePicker();
        });
    });
    // Retain direct iframe focus as a fallback for programmatic/browser paths
    // that do focus the element itself.
    iframe.addEventListener('focus', () => {
        if (hasOpenPicker()) closePicker();
    });

    /**
     * Fit the Top Shortcuts to the rail.
     *
     * BREADCRUMBS — WHY a priority rather than wrapping: a second row would
     * double the height the toolbar steals from the website, and clipping
     * mid-button looks broken. Survival order is Position button, layer
     * selector, Undo, Redo, "...", and Top Shortcuts consume whatever is left —
     * they are the only genuinely optional group, and Deep Cuts still reaches
     * every one of them. Nothing is written back to preferences: a narrow panel
     * renders fewer, and widening restores them automatically.
     */
    let lastPhysicalFitCutoff = null;
    function layoutTopShortcuts() {
        const shortcuts = [...topShortcutsEl.children];
        const railWidth = toolbar.clientWidth;
        if (railWidth === 0) return; // retracted; measured again on reveal
        shortcuts.forEach((button) => { button.hidden = false; });
        const reserved = positionBtnEl.offsetWidth
            + (layerSelectorEl.hidden ? 0 : layerSelectorEl.offsetWidth)
            + toolbarActionsEl.offsetWidth
            + 40; // rail padding, gaps, and a little breathing room
        const budget = Math.max(0, railWidth - reserved);
        let used = 0;
        let fits = 0;
        for (const button of shortcuts) {
            const width = button.getBoundingClientRect().width + (fits > 0 ? 6 : 0);
            if (used + width > budget) break;
            used += width;
            fits += 1;
        }
        if (fits === lastPhysicalFitCutoff) return;
        lastPhysicalFitCutoff = fits;
        shortcuts.forEach((button, i) => { button.hidden = i >= fits; });
        projectDeepCuts(fits);
    }

    // ── Deep Cuts ────────────────────────────────────────────────────────────
    // BREADCRUMBS — WAS: the tray opened on "..." and stayed until the user
    // hunted down the X.
    // IS: X still closes it, and so does Escape, an observable outside click, or
    // simply going back to the content.
    // WHY: resuming work in the website already means "I am done with GS3".
    // Making that require a second, precise click was friction with no purpose.
    // X is kept as the explicit "close this now" affordance, not the only one.
    function closeDeepCuts() {
        overlay.classList.remove('open');
        overlay.querySelectorAll('.open').forEach((row) => row.classList.remove('open'));
        overlay.querySelectorAll('.hotswap-icon-row .active').forEach((b) => b.classList.remove('active'));
        triggerBtn.classList.remove('open');
        triggerBtn.textContent = '\u00b7\u00b7\u00b7';
    }

    // Edit URL and Assign Folder share one website-relative utility dock.
    // Invocation selects the canonical action; it never selects geometry.
    function placePicker(row) {
        requestAnimationFrame(() => {
            if (!row.classList.contains('open')) return;
            const panelBox = panel.getBoundingClientRect();
            const pickerBox = row.getBoundingClientRect();
            const inset = 8;
            const websiteInset = parseFloat(getComputedStyle(panel)
                .getPropertyValue('--hotswap-website-inset')) || 0;
            const top = Math.max(inset, Math.min(
                websiteInset + inset,
                panelBox.height - pickerBox.height - inset,
            ));
            row.style.left = 'auto';
            row.style.right = `${inset}px`;
            row.style.top = `${top}px`;
        });
    }

    triggerBtn.onclick = (e) => {
        e.stopPropagation();
        const willOpen = !overlay.classList.contains('open');
        closePositionMenu();
        if (willOpen) {
            overlay.classList.add('open');
            triggerBtn.classList.add('open');
            triggerBtn.textContent = '\u2715';
            revealToolbar();
        } else {
            closeDeepCuts();
        }
    };

    // ── Position button ──────────────────────────────────────────────────────
    // BREADCRUMBS — WAS: "Position N" was an inert label, and the actions about
    // this physical place lived deeper in the tray.
    // IS: it is the button those actions hang from.
    // WHY: the question "what should happen relative to THIS physical place?"
    // is best answered behind the thing that names the place. It is deliberately
    // not a general shortcut surface — only genuinely Position-owned actions
    // belong here, or it becomes a second miscellaneous tray.
    function closePositionMenu() {
        positionMenuEl.hidden = true;
        positionBtnEl.classList.remove('open');
    }

    function buildPositionMenu() {
        positionMenuEl.innerHTML = '';
        const group = (title, onPick) => {
            const wrap = document.createElement('div');
            wrap.className = 'hotswap-position-group';
            const heading = document.createElement('div');
            heading.className = 'hotswap-position-group-title';
            heading.textContent = title;
            wrap.appendChild(heading);
            ctx.getPositionOptions(index).forEach(({ position, isCurrent }) => {
                const item = document.createElement('button');
                item.type = 'button';
                item.className = 'hotswap-position-item' + (isCurrent ? ' current' : '');
                item.innerHTML = `<span>Position ${position}</span>`
                    + (isCurrent ? '<span class="hotswap-position-note">current</span>' : '');
                if (isCurrent) item.disabled = true;
                else item.onclick = (ev) => { ev.stopPropagation(); onPick(position); closePositionMenu(); };
                wrap.appendChild(item);
            });
            return wrap;
        };
        // The SAME canonical pathways the tray uses — no second swap engine, no
        // second copy implementation, no second history stack.
        if (typeof ctx.moveToPosition === 'function') {
            positionMenuEl.appendChild(group('Swap Position', (position) => ctx.moveToPosition(index, position)));
        }
        if (typeof ctx.copyUrlToPosition === 'function') {
            positionMenuEl.appendChild(group('Copy To Position', (position) => ctx.copyUrlToPosition(index, position)));
        }
    }

    if (typeof ctx.getPositionOptions === 'function') {
        positionBtnEl.onclick = (e) => {
            e.stopPropagation();
            if (!positionMenuEl.hidden) { closePositionMenu(); return; }
            closeDeepCuts();
            buildPositionMenu();          // clicking alone moves nothing
            positionMenuEl.hidden = false;
            positionBtnEl.classList.add('open');
            revealToolbar();
        };
    } else {
        positionBtnEl.disabled = true;
        toolbar.querySelector('.hotswap-caret')?.remove();
    }

    // Escape unwinds UI depth, one level at a time. Presentation only — it
    // never triggers a Runtime action.
    panel.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (closeDeepestChild()) { e.stopPropagation(); return; }
        if (panel.classList.contains('chrome-revealed')) { setToolbarRevealed(false); e.stopPropagation(); }
    });

    // Observable outside clicks dismiss too. This is a supplement, never the
    // primary mechanism: a click inside a cross-origin iframe does not reach us.
    document.addEventListener('pointerdown', (e) => {
        // An open utility is dismissed by ANY click outside itself, including
        // other GS3 Chrome (Top Toolbar, Position, ···, Runway). Runs first and
        // independently, and never returns early, so the tray/position-menu
        // rules below still apply. No preventDefault: the click must still
        // reach whatever the customer aimed at, in the same gesture.
        if (hasOpenPicker() && !inActiveUtility(e.target)) closePicker();

        if (!overlay.classList.contains('open') && positionMenuEl.hidden) return;
        if (inChromeFamily(e.target)) return;
        closeDeepCuts();
        closePositionMenu();
    });

    // ── Button handlers ───────────────────────────────────────────────────────

    // ── Fixed Positions ──────────────────────────────────────────────────────
    // A POSITION is a permanent physical location in the current layout, NOT
    // this panel's original screen identity. "Position 3" is the third physical
    // place, forever, however many swaps came before — the runtime resolves the
    // Position to whichever panel currently occupies it (see positions.js).
    // Only layouts with a defined position geometry supply these hooks, so on
    // index.html's free-form feed both buttons hide themselves entirely.
    const positionsSupported = typeof ctx.getPositionOptions === 'function';

    /** Build one "Position N" picker list; `onPick` receives the Position number.
     *  The panel's OWN current Position is listed but disabled, so the numbering
     *  the user sees is always the layout's complete, stable numbering rather
     *  than a gap-ridden list that shifts as they move around. */
    const buildPositionList = (rowEl, labelFor, onPick) => {
        rowEl.innerHTML = '';
        ctx.getPositionOptions(index).forEach(({ position, isCurrent }) => {
            const item = document.createElement('div');
            item.className = 'hotswap-position-item' + (isCurrent ? ' current' : '');
            item.innerHTML = `<span>${labelFor(position)}</span>`
                + (isCurrent ? '<span class="hotswap-position-note">current</span>' : '');
            if (isCurrent) {
                item.setAttribute('aria-disabled', 'true');
            } else {
                item.onclick = (ev) => { ev.stopPropagation(); onPick(position); };
            }
            rowEl.appendChild(item);
        });
    };

    // 📍 Move to Position — swaps the visual occupants of this panel's Position
    // and the chosen one. Presentation only: no reload, no rebuild, no reparent.
    if (positionsSupported && typeof ctx.moveToPosition === 'function') {
        positionBtn.onclick = (e) => {
            e.stopPropagation();
            const isOpen = positionRow.classList.toggle('open');
            positionBtn.classList.toggle('active', isOpen);
            if (!isOpen) return;
            copyRow.classList.remove('open');
            copyBtn.classList.remove('active');
            buildPositionList(positionRow, (position) => `Position ${position}`, (position) => {
                ctx.moveToPosition(index, position);
                positionRow.classList.remove('open');
                positionBtn.classList.remove('active');
            });
        };
    } else {
        positionBtn.style.display = 'none';
    }

    // 📋 Copy to Position — duplicates this panel's content assignment (URL +
    // ROOT) into the panel currently occupying the chosen Position.
    if (positionsSupported && typeof ctx.copyUrlToPosition === 'function') {
        copyBtn.onclick = (e) => {
            e.stopPropagation();
            const isOpen = copyRow.classList.toggle('open');
            copyBtn.classList.toggle('active', isOpen);
            if (!isOpen) return;
            positionRow.classList.remove('open');
            positionBtn.classList.remove('active');
            buildPositionList(copyRow, (position) => `Copy to Position ${position}`, (position) => {
                ctx.copyUrlToPosition(index, position);
                copyRow.classList.remove('open');
                copyBtn.classList.remove('active');
            });
        };
    } else {
        copyBtn.style.display = 'none';
    }

    // ── ↩ Undo / ↪ Redo (panel-scoped) ───────────────────────────────────────
    // These step through THIS panel's own history — the most recent undoable
    // action that affected this panel — not the most recent thing that happened
    // anywhere in the Runtime. They read and write the one canonical session
    // history, so master Undo and Panel Undo can never apply the same action
    // twice.
    const historySupported = typeof ctx.getPanelHistory === 'function'
        && typeof ctx.undoPanel === 'function' && typeof ctx.redoPanel === 'function';

    const syncHistoryButtons = () => {
        if (!historySupported) return;
        updatePanelHistoryButtons(panel, ctx.getPanelHistory(index));
    };

    if (historySupported) {
        undoBtn.onclick = (e) => {
            e.stopPropagation();
            if (undoBtn.disabled) return;
            ctx.undoPanel(index);
        };
        redoBtn.onclick = (e) => {
            e.stopPropagation();
            if (redoBtn.disabled) return;
            ctx.redoPanel(index);
        };
    } else {
        undoBtn.style.display = 'none';
        redoBtn.style.display = 'none';
    }

    // 📁 Folder assign — manually pin this panel to a folder; shuffles in a
    // fresh link from it immediately, and future 🎲 Shuffles on this panel
    // (and the master overlay's own-folder Shuffle) will use it too.
    folderBtn.onclick = (e) => {
        e.stopPropagation();
        if (folderRow.classList.contains('open')) { closePicker(); return; }
        closePicker();
        folderRow.classList.add('open');
        folderBtn.classList.add('active');
        activePickerAnchor = folderBtn;
        placePicker(folderRow);

        // Assign Folder owns focus on its own container (not a real button, so
        // nothing focuses it by accident) — this is what makes Escape reach the
        // panel's keydown handler deterministically, matching Edit URL below.
        folderRow.tabIndex = -1;
        requestAnimationFrame(() => {
            if (folderRow.classList.contains('open')) folderRow.focus({ preventScroll: true });
        });

        folderRow.innerHTML = '';
        const currentDb = getDatabaseStructure();
        if (!currentDb || Object.keys(currentDb).length === 0) {
            folderRow.innerHTML = '<div class="hotswap-folder-item" style="cursor:default;">No folders available</div>';
            return;
        }

        Object.keys(currentDb).forEach((folderName) => {
            const item = document.createElement('div');
            item.className = 'hotswap-folder-item';
            item.innerHTML = `<span>${folderName}</span><span class="hotswap-folder-count">${currentDb[folderName].length}</span>`;
            item.onclick = (ev) => {
                ev.stopPropagation();
                const newUrl = loadReplacement(folderName);
                const currentUrl = iframe.getAttribute('data-last-src') || iframe.src;
                // Folder assignment always applies, even if that folder has
                // no available URL right now — same as before, just funneled
                // through one path instead of a direct attribute write plus
                // a separate, session-unaware setUrlFolderMap() call.
                if (typeof ctx.pushUndoCheckpoint === 'function') ctx.pushUndoCheckpoint();
                setIframeUrl(newUrl || currentUrl, folderName);
                closePicker();
            };
            folderRow.appendChild(item);
        });
    };

    // 🌐 URL edit toggle
    toggleBtn.onclick = (e) => {
        e.stopPropagation();
        if (urlRow.classList.contains('open')) { closePicker(); return; }
        closePicker();
        urlRow.classList.add('open');
        toggleBtn.classList.add('active');
        activePickerAnchor = toggleBtn;
        placePicker(urlRow);
        inputField.value = iframe.getAttribute('data-last-src') || iframe.src;
        requestAnimationFrame(() => {
            inputField.focus({ preventScroll: true });
            const end = inputField.value.length;
            inputField.setSelectionRange(end, end);
            inputField.scrollLeft = inputField.scrollWidth;
        });
    };

    const processHotswap = () => {
        const newUrl = inputField.value.trim();
        if (newUrl.length > 0) {
            if (typeof ctx.pushUndoCheckpoint === 'function') ctx.pushUndoCheckpoint();
            setIframeUrl(newUrl);
            closePicker();
        }
    };
    submitBtn.onclick  = (e) => { e.stopPropagation(); processHotswap(); };
    inputField.onkeydown = (e) => { if (e.key === 'Enter') { e.stopPropagation(); processHotswap(); } };

    // ☆ Star — open bookmark modal
    starBtn.onclick = (e) => {
        e.stopPropagation();
        if (typeof ctx.openBookmarkModal === 'function') {
            ctx.openBookmarkModal(iframe.getAttribute('data-last-src') || iframe.src, starBtn);
        }
    };

    // ⟳ Reload — soft reload without losing src
    reloadBtn.onclick = (e) => {
        e.stopPropagation();
        reloadBtn.classList.add('spinning');
        setTimeout(() => reloadBtn.classList.remove('spinning'), 450);
        const savedSrc = iframe.getAttribute('data-last-src') || iframe.src;
        // Reload returns the panel to its GS3-assigned source, so the browsing
        // stack collapses back to that entry. Two loads follow (about:blank,
        // then the URL) and neither is user navigation.
        beginPanelContent(index, savedSrc, 2);
        iframe.src = 'about:blank';
        setTimeout(() => { iframe.src = savedSrc; }, 80);
    };

    // ☠ Kill — remove panel from session (no DB changes)
    killBtn.onclick = (e) => {
        e.stopPropagation();
        panel.style.transition = 'opacity 0.25s, transform 0.25s';
        panel.style.opacity    = '0';
        panel.style.transform  = 'scaleY(0.8)';
        setTimeout(() => {
            panel.remove();
            const remaining = ctx.feedContainerEl?.querySelectorAll('.stream-panel').length ?? 0;
            if (ctx.statusEl) ctx.statusEl.textContent = `${remaining} streams`;
            if (typeof ctx.onPanelRemoved === 'function') {
                if (typeof ctx.pushUndoCheckpoint === 'function') ctx.pushUndoCheckpoint();
                ctx.onPanelRemoved(index);
            }
        }, 250);
    };

    // 🎲 Shuffle — new URL from this panel's own assigned folder
    shuffleBtn.onclick = (e) => {
        e.stopPropagation();
        const folder = getSourceFolder();
        if (!folder) { alert('No source folder tracked for this panel. Use 🌐 to set a URL manually.'); return; }
        const newUrl = loadReplacement(folder);
        if (!newUrl) { alert('No available URLs in this folder (empty or all blacklisted).'); return; }
        if (typeof ctx.pushUndoCheckpoint === 'function') ctx.pushUndoCheckpoint();
        setIframeUrl(newUrl);
    };

    // 🎲🎲 Shuffle All — random URL from ANY folder in the database
    shuffleAllBtn.onclick = (e) => {
        e.stopPropagation();
        const db = getDatabaseStructure();
        if (!db) { alert('No database connected.'); return; }
        const allFolders = Object.keys(db).filter(f => db[f].some(u => !isBlacklisted(u)));
        if (allFolders.length === 0) { alert('No available URLs across any folder.'); return; }
        const randomFolder = allFolders[Math.floor(Math.random() * allFolders.length)];
        const newUrl = loadReplacement(randomFolder);
        if (!newUrl) return;
        if (typeof ctx.pushUndoCheckpoint === 'function') ctx.pushUndoCheckpoint();
        // Folder + URL update together — setIframeUrl's second argument
        // handles the data-source-folder attribute too, so future
        // single-shuffles correctly use the new folder.
        setIframeUrl(newUrl, randomFolder);
    };

    // ❌ Delete — remove URL from folder, load replacement, sync silently
    deleteBtn.onclick = async (e) => {
        e.stopPropagation();
        const deadUrl = iframe.getAttribute('data-last-src') || iframe.src;
        const folder  = getSourceFolder();
        const currentDb = getDatabaseStructure();

        if (!folder || !currentDb || !currentDb[folder]) {
            alert('No source folder tracked for this panel — cannot delete.'); return;
        }

        const idx = currentDb[folder].indexOf(deadUrl);
        if (idx !== -1) currentDb[folder].splice(idx, 1);
        setDatabaseStructure(currentDb);

        const replacement = loadReplacement(folder);
        if (typeof ctx.pushUndoCheckpoint === 'function') ctx.pushUndoCheckpoint();
        setIframeUrl(replacement || 'about:blank');
        await pushDatabaseToRemote(`Deleted URL from folder: ${folder}`, true);
    };

    // 🗑️ Purge — blacklist domain, remove from all folders, load replacement
    purgeBtn.onclick = async (e) => {
        e.stopPropagation();
        const deadUrl = iframe.getAttribute('data-last-src') || iframe.src;
        if (!confirm(
            `Confirm absolute deletion of link from repository records?\nThis will also blacklist the domain locally.\n\n${deadUrl}`
        )) return;

        addToBlacklist(deadUrl);

        const folder      = getSourceFolder();
        const currentDb   = getDatabaseStructure();
        const replacement = (folder && loadReplacement(folder)) || 'https://example.com';
        if (typeof ctx.pushUndoCheckpoint === 'function') ctx.pushUndoCheckpoint();
        setIframeUrl(replacement);

        if (currentDb) {
            let deleted = false;
            Object.keys(currentDb).forEach(f => {
                const i = currentDb[f].indexOf(deadUrl);
                if (i !== -1) { currentDb[f].splice(i, 1); deleted = true; }
            });

            if (deleted) {
                setDatabaseStructure(currentDb);
                const token          = Store.get('gitToken');
                const repo           = Store.get('gitRepo');
                const updatedContent = btoa(unescape(encodeURIComponent(JSON.stringify(currentDb, null, 2))));
                try {
                    const res = await fetch(
                        `https://api.github.com/repos/${repo}/contents/links.json`,
                        {
                            method:  'PUT',
                            headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json' },
                            body:    JSON.stringify({
                                message: 'Purged dead link via Matrix Launcher',
                                content: updatedContent,
                                sha:     getDatabaseSha(),
                            }),
                        }
                    );
                    if (res.ok) setDatabaseSha((await res.json()).content.sha);
                } catch (err) { console.error('[Launch] Purge sync failed:', err); }
            }
        }
    };

    // 🚀 Load Launchpad inside this panel — unlike ⚙ (which navigates the whole
    // page away and ends the session), this only replaces THIS iframe's content
    // with a fresh Launchpad instance; every other panel keeps running.
    launchpadBtn.onclick = (e) => {
        e.stopPropagation();
        if (typeof ctx.pushUndoCheckpoint === 'function') ctx.pushUndoCheckpoint();
        // Clear the folder — this panel is no longer sourced from a content
        // folder now that it's showing the Launchpad itself.
        setIframeUrl('index.html', '');
    };

    // ── Layer scope ──────────────────────────────────────────────────────────
    // BREADCRUMBS — WAS: Layer 2 was expressed by MOVING controls to the
    // opposite corner, so "which layer does this button act on?" had to be
    // inferred from where the button happened to sit.
    // IS: one control surface in one place, with an explicit, strongly
    // highlighted [L2][L1] selector naming the target.
    // WHY: placement was never a legible signal for scope — it was collision
    // avoidance that users had to reverse-engineer. Stating the scope makes it
    // unmistakable and lets both layers share one surface. The selector is
    // HIDDEN ENTIRELY when no Layer 2 exists: with only one possible target
    // there is no choice to present, and a lone permanently-lit [L1] would be
    // pure clutter. Two scopes only — there is no Layer 3 in the product.
    // Scope lives on the element rather than in this closure so ANY surface —
    // including a later content change that creates or removes Layer 2 — can
    // re-derive it without a handle on the panel's internals.
    panel.dataset.layerScope = LAYER_2; // Layer 2, when it exists, is the default
    layerSelectorEl.querySelectorAll('.hotswap-layer-btn').forEach((button) => {
        button.onclick = (e) => {
            e.stopPropagation();
            panel.dataset.layerScope = button.dataset.layer === LAYER_1 ? LAYER_1 : LAYER_2;
            refreshPanelLayerScope(panel);
            updatePanelActionAvailability(panel);
        };
    });

    /**
     * Forward an action into the nested runtime instead of acting on this
     * panel. Same-origin by construction — isLayerTwoUrl() only ever matches
     * our own executor pages — so the message is posted to our own origin and
     * never to arbitrary third-party content.
     * Returns true when the action was handed to Layer 2.
     */
    const dispatchToLayerTwo = (key) => {
        if (panel.dataset.layerScope !== LAYER_2) return false;
        if (!isLayerTwoUrl(iframe.getAttribute('data-last-src') || '')) return false;
        if (!LAYER_SCOPED_ACTIONS.has(key)) return false; // see LAYER_SCOPED_ACTIONS
        try {
            iframe.contentWindow?.postMessage(
                { source: LAYER_MESSAGE_SOURCE, action: key }, window.location.origin);
            return true;
        } catch {
            return false;
        }
    };

    // ── Tray order, visibility, and the mirrored surfaces ─────────────────────
    // BREADCRUMBS — WHY: the tray, the toolbar and the runway are three
    // PRESENTATION collections over one canonical action registry. Only the
    // tray button carries a handler; every other surface forwards its click to
    // that same button. Ordering and membership therefore never fork the
    // behavior — there is exactly one implementation of each action, and a
    // surface can be reordered or removed without touching it.
    const visibility = Store.get('hotswapButtonVisibility') || {};
    const visibleTopDeepKeys = getVisibleTopDeepActions(visibility);
    const configuredTopKeys = visibleTopDeepKeys.slice(0, getTopShortcutCount());

    // Actions this host page cannot perform at all already hid their own button
    // above. They stay hidden regardless of Settings, and are never offered on
    // any other surface.
    const unsupported = new Set();
    if (!positionsSupported) { unsupported.add('position'); unsupported.add('copyPosition'); }
    if (!historySupported)   { unsupported.add('undo'); unsupported.add('redo'); }
    // Render the tray in the user's configured order without re-creating any
    // button: the nodes (and their handlers) are simply re-appended in place.
    const iconRow = overlay.querySelector('.hotswap-icon-row');
    getHotswapTrayOrder().forEach((key) => {
        const action = HOTSWAP_ACTIONS.find((candidate) => candidate.key === key);
        const button = action && overlay.querySelector(`.${action.className}`);
        if (button) iconRow.appendChild(button);
    });

    /** Build a click-forwarding mirror of a tray button for another surface. */
    const buildMirror = (key, className) => {
        const action = HOTSWAP_ACTIONS.find((candidate) => candidate.key === key);
        const trayBtn = action && overlay.querySelector(`.${action.className}`);
        if (!trayBtn || unsupported.has(key)) return null;
        const mirror = document.createElement('button');
        mirror.className = className;
        mirror.dataset.actionKey = key;
        mirror.title = action.title;
        if (key === 'shuffleAll' && className.includes('hotswap-runway-btn')) {
            mirror.classList.add('hotswap-runway-shuffle-all');
            for (let i = 0; i < 2; i += 1) {
                const die = document.createElement('span');
                die.textContent = '🎲';
                mirror.appendChild(die);
            }
        } else {
            mirror.textContent = action.emoji;
        }
        mirror.onclick = (e) => {
            e.stopPropagation();
            if (mirror.disabled) return;
            trayBtn.click(); // the one canonical implementation of this action
        };
        return mirror;
    };

    HOTSWAP_ACTIONS.forEach(({ key, className, structural }) => {
        const btn = overlay.querySelector(`.${className}`);
        if (!btn) return;
        // Position-owned actions are retired from the tray's PRESENTATION —
        // their implementations stay, reached through [Position N] instead.
        if (structural === 'positionButton') { btn.style.display = 'none'; return; }
        if (structural === 'toolbarRail') { btn.style.display = 'none'; return; }
        if (unsupported.has(key)) return; // already hid itself: this page can't do it
        btn.style.display = visibility[key] === false ? 'none' : '';
    });

    const emptyStateEl = overlay.querySelector('.hotswap-empty-state');
    function projectDeepCuts(physicalFit = configuredTopKeys.length) {
        const effective = Math.min(configuredTopKeys.length, physicalFit);
        const deepKeys = new Set(visibleTopDeepKeys.slice(effective));
        visibleTopDeepKeys.forEach((key) => {
            const action = HOTSWAP_ACTIONS.find((candidate) => candidate.key === key);
            const button = action && overlay.querySelector(`.${action.className}`);
            if (button && !unsupported.has(key)) button.style.display = deepKeys.has(key) ? '' : 'none';
        });
        if (emptyStateEl) emptyStateEl.hidden = deepKeys.size !== 0;
    }

    // Layer scope is enforced ONCE, on the canonical tray button, so it applies
    // no matter which surface invoked the action. Enforcing it on the mirrors
    // instead would leave the tray — the button that actually carries the
    // handler — silently ignoring the selected scope.
    LAYER_SCOPED_ACTIONS.forEach((key) => {
        const action = HOTSWAP_ACTIONS.find((candidate) => candidate.key === key);
        const btn = action && overlay.querySelector(`.${action.className}`);
        if (!btn || unsupported.has(key)) return;
        const canonical = btn.onclick;
        btn.onclick = (e) => {
            if (dispatchToLayerTwo(key)) { e?.stopPropagation?.(); return; }
            if (typeof canonical === 'function') canonical.call(btn, e);
        };
    });

    // ── Top Shortcuts ────────────────────────────────────────────────────────
    // BREADCRUMBS — WAS: common actions were disproportionately routed through
    // the "..." tray, with one limited shortcut mechanism beside it.
    // IS: three presentation surfaces — Top Shortcuts (frequent, while the rail
    // is open), the Right Runway (fastest, straight over content), and Deep Cuts
    // (the deeper toolbox) — all invoking the SAME canonical actions.
    // WHY: different ergonomics deserve different surfaces; they do not deserve
    // different implementations.
    getActiveTopShortcuts(visibility).forEach((key) => {
        const mirror = buildMirror(key, 'hotswap-mirror-btn hotswap-toolbar-btn hotswap-top-shortcut');
        if (mirror) topShortcutsEl.appendChild(mirror);
    });

    // Undo/Redo stay directly visible whenever the rail is open — they are the
    // two actions worth reaching without opening anything else.
    ['undo', 'redo'].forEach((key) => {
        const mirror = buildMirror(key, 'hotswap-mirror-btn hotswap-toolbar-btn');
        if (mirror) toolbarActionsEl.appendChild(mirror);
    });
    toolbarActionsEl.appendChild(triggerBtn);

    // ── Quick Action runway ──────────────────────────────────────────────────
    // BREADCRUMBS — WHY: the runway stays an OVERLAY while the toolbar insets.
    // Insetting from the right would change the iframe's WIDTH, and width is
    // what triggers substantial responsive reflow on a real website; height
    // changes are comparatively cheap. It also deliberately surrenders the
    // top-right corner (see --shortcut-runway-top-offset): almost every site
    // puts account/settings/notification controls there, and a GS3 hitbox
    // across them — even a fully transparent one — would silently steal clicks.
    let runwayEl = null;
    const activeQuickActions = getActiveQuickActions().filter((key) => !unsupported.has(key));
    if (activeQuickActions.length > 0) {
        runwayEl = document.createElement('div');
        runwayEl.className = 'hotswap-runway';
        activeQuickActions.forEach((key) => {
            const mirror = buildMirror(key, 'hotswap-mirror-btn hotswap-runway-btn');
            if (mirror) runwayEl.appendChild(mirror);
        });
        // The runway is exactly as long as it needs to be. A full-height strip
        // would be an invisible wall down the side of every website.
        runwayEl.style.setProperty('--runway-count', String(runwayEl.children.length));
        if (runwayEl.children.length === 0) runwayEl = null;
    }

    // ── Viewport Director (postMessage play/pause) ────────────────────────────
    const viewportObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const msg = entry.isIntersecting ? 'LAUNCHPAD_PLAY' : 'LAUNCHPAD_PAUSE';
            try { iframe.contentWindow.postMessage({ type: msg }, '*'); } catch (e) {}
        });
    }, { threshold: 0.5 });
    viewportObserver.observe(panel);

    // ── Assemble ─────────────────────────────────────────────────────────────
    // Order matters: the toolbar is a FLEX SIBLING placed before the iframe, so
    // revealing it insets the content. Everything else is absolutely positioned
    // and cannot affect the iframe's box.
    panel.appendChild(activationEl);
    panel.appendChild(toolbar);
    panel.appendChild(positionMenuEl);
    panel.appendChild(iframe);
    if (runwayEl) panel.appendChild(runwayEl);
    panel.appendChild(overlay);
    pickerRows.forEach((row) => {
        row.classList.add('hotswap-picker');
        panel.appendChild(row);
    });

    layoutTopShortcuts();
    if (typeof ResizeObserver === 'function') {
        // Re-measure whenever the panel changes width — a Position swap into a
        // narrower slot, an orientation change, or a border drag.
        new ResizeObserver(() => layoutTopShortcuts()).observe(panel);
    }

    refreshPanelLayerScope(panel);
    if (typeof ctx.getPositionLabel === 'function') {
        positionLabelEl.textContent = ctx.getPositionLabel(index) || '';
    }

    // A freshly built panel starts with whatever history it actually has — a
    // panel rebuilt mid-session by a master Shuffle may well have some.
    syncHistoryButtons();
    updatePanelActionAvailability(panel);

    return panel;
}

/**
 * Reusable stream panel factory for alternative layouts (e.g. index3.html).
 * Wraps the internal panel builder so behavior stays identical.
 */
export function buildStreamPanel(url, index, panelClass, panelHeight, ctx) {
    return _buildPanel(url, index, panelClass, panelHeight, ctx);
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Filter URLs against the blacklist, build all iframe panels,
 * wire overlays, and transition from setup screen to loop screen.
 *
 * @param {string[]} urls
 * @param {Object}   ctx  — see module header for shape
 */
export function launchMatrix(urls, ctx) {
    // Filter blacklisted
    const filtered = urls.filter(u => !isBlacklisted(u));
    const skipped  = urls.length - filtered.length;

    if (filtered.length === 0) {
        alert('All provided links are on the domain blacklist. Add new links or clear the blacklist.');
        return;
    }
    if (skipped > 0) console.info(`[Blacklist] Skipped ${skipped} blacklisted URL(s).`);

    const isPortrait  = ctx.portraitToggle?.checked ?? false;
    const heights     = ctx.getFrameHeights();
    const panelHeight = isPortrait ? heights.portrait : heights.landscape;
    const panelClass  = isPortrait ? 'stream-panel mode-portrait' : 'stream-panel mode-landscape';

    // Switch screens
    if (ctx.setupScreenEl)   ctx.setupScreenEl.style.display  = 'none';
    if (ctx.loopScreenEl)    ctx.loopScreenEl.style.display   = 'block';
    if (ctx.feedContainerEl) ctx.feedContainerEl.innerHTML    = '';

    // Top spacer
    if (heights.spacerTopOn) {
        const spacer = document.createElement('div');
        spacer.className   = 'spacer-panel';
        spacer.style.height = heights.spacerTopHeight;
        ctx.feedContainerEl.appendChild(spacer);
    }

    // Build panels
    filtered.forEach((url, index) => {
        const panel = _buildPanel(url, index, panelClass, panelHeight, ctx);
        ctx.feedContainerEl.appendChild(panel);
    });

    // End spacer
    if (heights.spacerOn) {
        const spacer = document.createElement('div');
        spacer.className   = 'spacer-panel';
        spacer.style.height = heights.spacerHeight;
        ctx.feedContainerEl.appendChild(spacer);
    }

    if (ctx.statusEl)      ctx.statusEl.textContent = `${filtered.length} streams`;
}
