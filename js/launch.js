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
    }
    if (folder !== undefined) iframe.setAttribute('data-source-folder', folder || '');
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

// Canonical list of every hotswap-overlay action. Drives both the tray
// (Overlay Button Visibility in Settings) and the Quick Action shortcut slots.
// `shortcutable: false` means the action opens its own picker/dropdown rather
// than firing immediately — those stay tray-only, since a tiny always-visible
// shortcut button isn't a good home for a full picker UI.
export const HOTSWAP_ACTIONS = [
    { key: 'position',   emoji: '📍',  title: 'Move to Position',                                     className: 'btn-hotswap-position',    shortcutable: false },
    { key: 'copyPosition', emoji: '📋', title: "Copy this panel's URL to another Position",            className: 'btn-hotswap-copy-position', shortcutable: false },
    { key: 'folder',     emoji: '📁',  title: 'Assign a folder for this panel',                       className: 'btn-hotswap-folder',      shortcutable: false },
    { key: 'star',       emoji: '⭐',  title: 'Save to Playlist',                                     className: 'btn-hotswap-star',        shortcutable: true },
    { key: 'toggle',     emoji: '🌐',  title: 'Edit URL',                                             className: 'btn-hotswap-toggle',      shortcutable: false },
    { key: 'reload',     emoji: '⟳',  title: 'Reload this panel',                                    className: 'btn-hotswap-reload',      shortcutable: true },
    { key: 'shuffle',    emoji: '🎲',  title: "Shuffle from this panel's assigned folder",            className: 'btn-hotswap-shuffle',     shortcutable: true },
    { key: 'shuffleAll', emoji: '🎲🎲', title: 'Shuffle All — random URL from any folder',             className: 'btn-hotswap-shuffle-all', shortcutable: true },
    { key: 'delete',     emoji: '❌',  title: "Delete this URL from its folder and load a replacement", className: 'btn-hotswap-delete',      shortcutable: true },
    { key: 'kill',       emoji: '☠',  title: 'Remove this panel for this session',                   className: 'btn-hotswap-kill',        shortcutable: true },
    { key: 'purge',      emoji: '🗑️', title: 'Purge — blacklist domain and remove from all folders',  className: 'btn-purge',               shortcutable: true },
    { key: 'launchpad',  emoji: '🚀',  title: 'Load the Stream Loop Launchpad inside this panel',      className: 'btn-hotswap-launchpad',   shortcutable: true },
    // Undo/Redo are panel-scoped and, unlike every other action here, have an
    // AVAILABILITY state. They stay shortcutable — a one-click action is
    // exactly what a Quick Action slot is for — but both the tray button and
    // any Quick Action mirror of it are kept `disabled` in lockstep with the
    // panel's real history, so neither can ever be a control that silently
    // does nothing. See _syncHistoryButtons() below.
    { key: 'undo',       emoji: '↩',  title: 'Undo the last change to this panel',                    className: 'btn-hotswap-undo',        shortcutable: true },
    { key: 'redo',       emoji: '↪',  title: 'Redo the last change undone on this panel',             className: 'btn-hotswap-redo',        shortcutable: true },
];

/**
 * Surgically refresh one already-rendered panel's ↩/↪ availability, tray button
 * and Quick Action mirror alike. Exported so the runtime can re-sync every
 * panel after ANY history mutation (a master Undo, or a Position swap recorded
 * against two panels at once), without the runtime needing to know this
 * module's class names.
 */
export function updatePanelHistoryButtons(panel, { canUndo, canRedo } = {}) {
    if (!panel) return;
    const set = (key, className, enabled) => {
        if (enabled === undefined) return;
        const trayBtn = panel.querySelector(`.${className}`);
        if (trayBtn) trayBtn.disabled = !enabled;
        const mirror = panel.querySelector(`.hotswap-shortcut-btn[data-action-key="${key}"]`);
        if (mirror) mirror.disabled = !enabled;
    };
    set('undo', 'btn-hotswap-undo', canUndo);
    set('redo', 'btn-hotswap-redo', canRedo);
}

// ── Panel builder ─────────────────────────────────────────────────────────────

function _buildPanel(url, index, panelClass, panelHeight, ctx) {
    const db           = getDatabaseStructure();
    const urlFolderMap = getUrlFolderMap();

    const launchFolder = urlFolderMap[index]
        || (ctx.dirDropdownEl?.value !== 'manual' ? ctx.dirDropdownEl?.value : null)
        || null;

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
        if (!db || !db[folderName]) return null;
        const pool = db[folderName].filter(u => !isBlacklisted(u));
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

    // ── Overlay trigger (always-visible ··· button) ──────────────────────────
    const triggerBtn = document.createElement('button');
    triggerBtn.className   = 'hotswap-trigger';
    triggerBtn.textContent = '···';
    triggerBtn.title       = 'Open controls';

    triggerBtn.onclick = (e) => {
        e.stopPropagation();
        const isOpen = overlay.classList.toggle('open');
        triggerBtn.classList.toggle('open', isOpen);
        triggerBtn.textContent = isOpen ? '✕' : '···';
    };

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

    // 📋 Copy to Position — copies THIS panel's current URL into whichever panel
    // is currently occupying the chosen Position. URL only: the destination
    // keeps its own folder assignment and everything else. The source panel is
    // untouched, and only the destination iframe reloads.
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
        const isOpen = folderRow.classList.toggle('open');
        folderBtn.classList.toggle('active', isOpen);
        if (!isOpen) return;

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
                folderRow.classList.remove('open');
                folderBtn.classList.remove('active');
            };
            folderRow.appendChild(item);
        });
    };

    // 🌐 URL edit toggle
    toggleBtn.onclick = (e) => {
        e.stopPropagation();
        const isOpen = urlRow.classList.toggle('open');
        toggleBtn.classList.toggle('active', isOpen);
        if (isOpen) {
            inputField.value = iframe.getAttribute('data-last-src') || iframe.src;
            inputField.focus();
        }
    };

    const processHotswap = () => {
        const newUrl = inputField.value.trim();
        if (newUrl.length > 0) {
            if (typeof ctx.pushUndoCheckpoint === 'function') ctx.pushUndoCheckpoint();
            setIframeUrl(newUrl);
            urlRow.classList.remove('open');
            toggleBtn.classList.remove('active');
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

    // ── Overlay Button Visibility + Quick Action Shortcuts ────────────────────
    // Hide any button the user turned off in Settings, and pull out whichever
    // ones are assigned to a Quick Action slot (those move below ··· instead
    // of living in the tray — never both).
    const visibility = Store.get('hotswapButtonVisibility') || {};
    const quickSlots = (Store.get('quickActionSlots') || []).filter(Boolean);

    // Actions this host page can't perform at all already hid their own button
    // above. They must stay hidden regardless of what Settings says, and they
    // must never be offered as a Quick Action here.
    const unsupported = new Set();
    if (!positionsSupported) { unsupported.add('position'); unsupported.add('copyPosition'); }
    if (!historySupported)   { unsupported.add('undo'); unsupported.add('redo'); }

    HOTSWAP_ACTIONS.forEach(({ key, className }) => {
        const btn = overlay.querySelector(`.${className}`);
        if (!btn || unsupported.has(key)) return;
        const isShortcut  = quickSlots.includes(key);
        const trayVisible = visibility[key] !== false && !isShortcut;
        btn.style.display = trayVisible ? '' : 'none';
    });

    let shortcutRow = null;
    const eligibleShortcuts = quickSlots.filter((key) =>
        !unsupported.has(key) && HOTSWAP_ACTIONS.find((a) => a.key === key)?.shortcutable
    );
    if (eligibleShortcuts.length > 0) {
        shortcutRow = document.createElement('div');
        shortcutRow.className = 'hotswap-shortcut-row';
        eligibleShortcuts.forEach((key) => {
            const action = HOTSWAP_ACTIONS.find((a) => a.key === key);
            const trayBtn = overlay.querySelector(`.${action.className}`);
            if (!trayBtn) return;
            const shortcutBtn = document.createElement('button');
            shortcutBtn.className = 'hotswap-shortcut-btn';
            // Lets updatePanelHistoryButtons() find and disable the ↩/↪ mirrors
            // in lockstep with their tray buttons.
            shortcutBtn.dataset.actionKey = key;
            shortcutBtn.title = action.title;
            shortcutBtn.textContent = action.emoji;
            shortcutBtn.onclick = (e) => {
                e.stopPropagation();
                if (shortcutBtn.disabled) return;
                trayBtn.click(); // reuses that action's exact existing handler
            };
            shortcutRow.appendChild(shortcutBtn);
        });
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
    panel.appendChild(iframe);
    panel.appendChild(triggerBtn);
    if (shortcutRow) panel.appendChild(shortcutRow);
    panel.appendChild(overlay);

    // A freshly built panel starts with whatever history it actually has — a
    // panel rebuilt mid-session by a master Shuffle may well have some.
    syncHistoryButtons();

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
