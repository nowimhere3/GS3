/**
 * settings.js — Settings Page
 * Boots all settings panels for settings.html.
 * All panels are expanded by default — no drawer toggling.
 */

import { Store } from './storage.js';
import { fetchDatabaseWithUI, fetchDatabaseSilently } from './sync.js';
import { renderFolderManager } from './folders.js';
import { HOTSWAP_ACTIONS } from './launch.js';
import {
    getHotswapTrayOrder, setHotswapTrayOrder, getQuickActionOrder, setQuickActionOrder,
    getQuickActionCount, setQuickActionCount, isQuickActionRunwayEnabled,
    setQuickActionRunwayEnabled, getChromeOpacity, setChromeOpacity,
    getTopShortcutOrder, setTopShortcutOrder, getTopShortcutCount, setTopShortcutCount,
    isTopShortcutsEnabled, setTopShortcutsEnabled,
} from './hotswap-chrome.js';

document.addEventListener('DOMContentLoaded', () => {
    Store.warmCache();
    bootSettings();
});

async function bootSettings() {

    // ── Restore persisted git credentials ─────────────────────────────────────
    const gitTokenEl = document.getElementById('git-token');
    const gitRepoEl  = document.getElementById('git-repo');
    if (gitTokenEl) gitTokenEl.value = Store.get('gitToken') || '';
    if (gitRepoEl)  gitRepoEl.value  = Store.get('gitRepo')  || '';

    // ── Connect & Fetch button ────────────────────────────────────────────────
    const connectBtn = document.getElementById('btn-connect-git');
    if (connectBtn) {
        connectBtn.onclick = async () => {
            const token = gitTokenEl?.value.trim() || '';
            const repo  = gitRepoEl?.value.trim()  || '';
            Store.set('gitToken', token);
            Store.set('gitRepo',  repo);
            const success = await fetchDatabaseWithUI(_refreshFolderManager);
            if (success) {
                _refreshFolderManager();
            }
        };
    }

    // ── Frame Height Settings ─────────────────────────────────────────────────
    _initFrameHeightSettings();

    // ── Hotswap Overlay Controls ───────────────────────────────────────────────
    _initHotswapControls();
    _initGhostMode();

    // ── Auto-fetch database if credentials are saved ──────────────────────────
    if (Store.get('gitToken') && Store.get('gitRepo')) {
        await fetchDatabaseSilently(_refreshFolderManager);
    }

    // Initial folder manager render
    _refreshFolderManager();
}

function _refreshFolderManager() {
    renderFolderManager(null, _refreshFolderManager);
}

function _initFrameHeightSettings() {
    const fhLandscapeInput  = document.getElementById('fh-landscape-input');
    const fhPortraitInput   = document.getElementById('fh-portrait-input');
    const fhSpacerToggle    = document.getElementById('fh-spacer-toggle');
    const fhSpacerInput     = document.getElementById('fh-spacer-input');
    const fhSpacerTopToggle = document.getElementById('fh-spacer-top-toggle');
    const fhSpacerTopInput  = document.getElementById('fh-spacer-top-input');

    if (fhLandscapeInput)  fhLandscapeInput.value    = Store.get('fhLandscape');
    if (fhPortraitInput)   fhPortraitInput.value     = Store.get('fhPortrait');
    if (fhSpacerToggle)    fhSpacerToggle.checked    = Store.get('spacerEndOn');
    if (fhSpacerInput)     fhSpacerInput.value       = Store.get('spacerEndHeight');
    if (fhSpacerTopToggle) fhSpacerTopToggle.checked = Store.get('spacerTopOn');
    if (fhSpacerTopInput)  fhSpacerTopInput.value    = Store.get('spacerTopHeight');

    const applyBtn = document.getElementById('btn-fh-apply');
    if (applyBtn) {
        applyBtn.onclick = () => {
            const land      = parseFloat(fhLandscapeInput?.value);
            const port      = parseFloat(fhPortraitInput?.value);
            const spacerH   = parseFloat(fhSpacerInput?.value);
            const spacerTopH = parseFloat(fhSpacerTopInput?.value);

            if (isNaN(land)       || land < 10      || land > 300)      { alert('Landscape height must be 10–300 vh.'); return; }
            if (isNaN(port)       || port < 10      || port > 300)      { alert('Portrait height must be 10–300 vh.');  return; }
            if (isNaN(spacerH)    || spacerH < 5    || spacerH > 300)   { alert('End spacer must be 5–300 vh.');        return; }
            if (isNaN(spacerTopH) || spacerTopH < 5 || spacerTopH > 300){ alert('Top spacer must be 5–300 vh.');       return; }

            Store.set('fhLandscape', land);
            Store.set('fhPortrait',  port);

            if (!Store.get('spacerEndLocked')) {
                Store.set('spacerEndOn',     fhSpacerToggle?.checked ?? true);
                Store.set('spacerEndHeight', spacerH);
            }
            if (!Store.get('spacerTopLocked')) {
                Store.set('spacerTopOn',     fhSpacerTopToggle?.checked ?? true);
                Store.set('spacerTopHeight', spacerTopH);
            }

            alert(`Saved! Landscape: ${land}vh · Portrait: ${port}vh\nTakes effect on next Launch.`);
        };
    }

    _wireSpacerLock('top', fhSpacerTopToggle, fhSpacerTopInput);
    _wireSpacerLock('end', fhSpacerToggle,    fhSpacerInput);
}

function _wireSpacerLock(which, toggleEl, inputEl) {
    const friendlyKey = which === 'top' ? 'spacerTopLocked' : 'spacerEndLocked';
    const btn   = document.getElementById(which === 'top' ? 'btn-lock-spacer-top' : 'btn-lock-spacer-end');
    const rowEl = document.getElementById(which === 'top' ? 'fh-spacer-top-row'  : 'fh-spacer-end-row');
    if (!btn) return;

    const applyLockUI = (locked) => {
        rowEl?.classList.toggle('spacer-row-locked', locked);
        btn.classList.toggle('locked', locked);
        btn.textContent = locked ? '🔒' : '🔓';
        btn.title = locked ? 'Locked — click to unlock' : 'Lock — prevents Save Heights from changing this row';
        if (toggleEl) toggleEl.style.pointerEvents = locked ? 'none' : '';
        if (inputEl)  inputEl.style.pointerEvents  = locked ? 'none' : '';
    };

    applyLockUI(Store.get(friendlyKey));
    btn.onclick = () => {
        const nowLocked = !Store.get(friendlyKey);
        Store.set(friendlyKey, nowLocked);
        applyLockUI(nowLocked);
    };
}

// BREADCRUMBS — WAS: this list carried a 'trigger' target covering the old
// corner "···" button and its shortcut column.
// IS: those surfaces no longer exist — Hotswap Chrome's own Resting/Hover pair
// governs the toolbar and the runway directly, above.
// WHY: keeping a toggle for a surface that was retired would be a setting the
// user could switch with no visible effect. The remaining targets are separate
// overlays that genuinely still opt in independently.
const GHOST_TARGETS = [
    { key: 'master',  emoji: '🎬',  title: 'Master Overlay (Launch Grid)' },
    { key: 'stream',  emoji: '🚀',  title: 'Stream Overlay (Launch Stream)' },
    { key: 'solo',    emoji: '🎬',  title: 'Solo Overlay (Launch Solo)' },
];

/**
 * Make a list of rows drag-reorderable. Presentation order only — the rows are
 * views over the canonical action registry, never copies of it.
 */
function _makeReorderable(listEl, onReorder) {
    let dragged = null;
    listEl.querySelectorAll('.hotswap-toggle-row').forEach((row) => {
        row.draggable = true;
        row.ondragstart = (e) => {
            dragged = row;
            row.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            try { e.dataTransfer.setData('text/plain', row.dataset.key); } catch {}
        };
        row.ondragend = () => {
            dragged = null;
            listEl.querySelectorAll('.hotswap-toggle-row').forEach((r) =>
                r.classList.remove('dragging', 'drop-target'));
            onReorder([...listEl.querySelectorAll('.hotswap-toggle-row')].map((r) => r.dataset.key));
        };
        row.ondragover = (e) => {
            e.preventDefault();
            if (!dragged || dragged === row) return;
            row.classList.add('drop-target');
            const { top, height } = row.getBoundingClientRect();
            const after = e.clientY > top + height / 2;
            listEl.insertBefore(dragged, after ? row.nextSibling : row);
        };
        row.ondragleave = () => row.classList.remove('drop-target');
        row.ondrop = (e) => { e.preventDefault(); row.classList.remove('drop-target'); };
    });
}

/**
 * BREADCRUMBS — WAS: N repeated "Shortcut 1/2/3" dropdowns, each able to land
 * on the same action, with a slot count of 0 doubling as "feature off".
 * IS: one on/off switch, a 1-8 count laid out as two rows of four, and a single
 * drag-ordered list. The tray has its own independent drag-ordered list.
 * WHY: eight repeated pickers would be router-configuration UI, and letting two
 * pickers choose the same action made uniqueness an accident rather than a
 * property. An ordered permutation of the registry is unique by construction.
 * The tray and the runway are separate ORDERED COLLECTIONS over the SAME
 * canonical actions, so an action can appear in both without being duplicated.
 */
function _initHotswapControls() {
    const toggleListEl = document.getElementById('hotswap-toggle-list');
    if (!toggleListEl) return;

    const visibility = { ...Store.get('hotswapButtonVisibility') };
    const byKey = new Map(HOTSWAP_ACTIONS.map((action) => [action.key, action]));

    function _row(key, { withToggle }) {
        const action = byKey.get(key);
        const row = document.createElement('div');
        row.className = 'hotswap-toggle-row';
        row.dataset.key = key;
        row.innerHTML = `
            <span class="hotswap-toggle-label">
                <span class="drag-handle">☰</span>
                <span class="hotswap-toggle-emoji">${action.emoji}</span>${action.title}
            </span>
            ${withToggle ? `
            <label class="switch" style="margin:0;">
                <input type="checkbox" data-key="${key}" ${visibility[key] !== false ? 'checked' : ''}>
                <span class="slider"></span>
            </label>` : ''}
        `;
        const input = row.querySelector('input');
        if (input) {
            input.onchange = (e) => {
                visibility[key] = e.target.checked;
                Store.set('hotswapButtonVisibility', visibility);
            };
        }
        return row;
    }

    function _renderList(listEl, keys, withToggle, onReorder) {
        listEl.innerHTML = '';
        keys.forEach((key) => listEl.appendChild(_row(key, { withToggle })));
        _makeReorderable(listEl, onReorder);
    }

    /**
     * Wire one shortcut collection: an on/off switch, a 1-N count, and a
     * drag-ordered list. Top Shortcuts and the Runway share this shape
     * deliberately — two surfaces configured the same way, rather than each
     * inventing its own grammar. They remain INDEPENDENT collections: the same
     * canonical action may legitimately appear on both.
     */
    function _wireCollection({ enabledId, configId, countRowId, listId, echoId,
                               isEnabled, setEnabled, getCount, setCount, getOrder, setOrder }) {
        const enabledEl = document.getElementById(enabledId);
        const configEl = document.getElementById(configId);
        const countRowEl = document.getElementById(countRowId);
        const listEl = document.getElementById(listId);
        const echoEl = echoId && document.getElementById(echoId);
        if (!enabledEl || !configEl || !countRowEl || !listEl) return;

        const renderCount = () => {
            const count = getCount();
            countRowEl.querySelectorAll('.btn-slot-count').forEach((btn) => {
                btn.classList.toggle('active', parseInt(btn.dataset.count, 10) === count);
            });
            if (echoEl) echoEl.textContent = String(count);
        };
        const renderEnabled = () => {
            const on = isEnabled();
            enabledEl.checked = on;
            // Off means the surface does not exist. The configuration below is
            // kept, just not applicable, so switching back on restores it whole.
            configEl.classList.toggle('disabled', !on);
        };

        enabledEl.onchange = () => { setEnabled(enabledEl.checked); renderEnabled(); };
        countRowEl.querySelectorAll('.btn-slot-count').forEach((btn) => {
            btn.onclick = () => { setCount(parseInt(btn.dataset.count, 10)); renderCount(); };
        });
        _renderList(listEl, getOrder(), false, setOrder);
        renderCount();
        renderEnabled();
    }

    _wireCollection({
        enabledId: 'top-shortcuts-enabled', configId: 'top-shortcuts-config',
        countRowId: 'top-count-row', listId: 'top-order-list', echoId: 'top-count-echo',
        isEnabled: isTopShortcutsEnabled, setEnabled: setTopShortcutsEnabled,
        getCount: getTopShortcutCount, setCount: setTopShortcutCount,
        getOrder: getTopShortcutOrder, setOrder: setTopShortcutOrder,
    });
    _wireCollection({
        enabledId: 'quick-actions-enabled', configId: 'quick-actions-config',
        countRowId: 'slot-count-row', listId: 'runway-order-list', echoId: 'runway-count-echo',
        isEnabled: isQuickActionRunwayEnabled, setEnabled: setQuickActionRunwayEnabled,
        getCount: getQuickActionCount, setCount: setQuickActionCount,
        getOrder: getQuickActionOrder, setOrder: setQuickActionOrder,
    });

    // Deep Cuts owns visibility as well as order.
    _renderList(toggleListEl, getHotswapTrayOrder(), true, setHotswapTrayOrder);
}


/**
 * Make a list of rows drag-reorderable. Presentation order only — the rows are
 * views over the canonical action registry, never copies of it.
 */
function _initGhostMode() {
    const toggleListEl = document.getElementById('ghost-toggle-list');
    if (!toggleListEl) return;

    // BREADCRUMBS — WAS: these two values dimmed the top toolbar as well.
    // IS: they describe the RIGHT RUNWAY only, and live in its Settings card.
    // WHY: the toolbar retracts to nothing when unused, which already solves
    // the intrusion opacity exists to solve. Using both mechanisms on one
    // surface only made a deliberately-summoned control harder to read.
    const wireOpacity = (sliderId, inputId, apply, initial) => {
        const sliderEl = document.getElementById(sliderId);
        const inputEl = document.getElementById(inputId);
        if (!sliderEl || !inputEl) return;
        sliderEl.value = initial;
        inputEl.value = initial;
        const set = (value) => {
            const clamped = Math.max(0, Math.min(100, Math.round(value) || 0));
            sliderEl.value = clamped;
            inputEl.value = clamped;
            apply(clamped);
        };
        sliderEl.oninput = () => set(parseFloat(sliderEl.value));
        inputEl.oninput = () => { if (inputEl.value !== '') set(parseFloat(inputEl.value)); };
        inputEl.onblur = () => set(parseFloat(inputEl.value) || 0);
    };

    const opacity = getChromeOpacity();
    wireOpacity('ghost-opacity-slider', 'ghost-opacity-input',
        (value) => setChromeOpacity({ resting: value }), opacity.resting);
    wireOpacity('hover-opacity-slider', 'hover-opacity-input',
        (value) => setChromeOpacity({ hover: value }), opacity.hover);

    const targets = { ...Store.get('ghostTargets') };
    GHOST_TARGETS.forEach(({ key, emoji, title }) => {
        const row = document.createElement('div');
        row.className = 'hotswap-toggle-row';
        row.innerHTML = `
            <span class="hotswap-toggle-label">
                <span class="hotswap-toggle-emoji">${emoji}</span>${title}
            </span>
            <label class="switch" style="margin:0;">
                <input type="checkbox" data-key="${key}" ${targets[key] ? 'checked' : ''}>
                <span class="slider"></span>
            </label>
        `;
        row.querySelector('input').onchange = (e) => {
            targets[key] = e.target.checked;
            Store.set('ghostTargets', targets);
        };
        toggleListEl.appendChild(row);
    });
}
