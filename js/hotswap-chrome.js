/**
 * hotswap-chrome.js — Stream Loop Launchpad
 * ─────────────────────────────────────────────────────────────────────────────
 * The preference model behind HOTSWAP CHROME — the per-panel control surface.
 *
 * Chrome is made of two surfaces that share one set of preferences:
 *
 *   TOP TOOLBAR      retractable, anchored immediately inside the panel's top
 *                    boundary. When revealed it INSETS the content (pushes the
 *                    iframe down) rather than overlaying it.
 *   SHORTCUT RUNWAY  a vertical overlay down the right edge, starting below a
 *                    deliberate top-right safe zone.
 *
 * ── BREADCRUMBS — WAS ───────────────────────────────────────────────────────
 * Chrome was a corner-anchored overlay: a "···" trigger pinned top-right, a
 * pop-out tray beside it, and a Quick Action column beneath it. Layer 2 was
 * handled by MOVING those controls to the opposite corner so a nested runtime's
 * chrome would not sit on top of the outer runtime's chrome. Quick Actions were
 * an array of up to three slots where a count of 0 doubled as "feature off".
 *
 * ── BREADCRUMBS — IS ────────────────────────────────────────────────────────
 * One control surface in one place. Layer scope is stated explicitly by a
 * highlighted [L2][L1] selector rather than inferred from where a control
 * physically sits. Quick Actions have an explicit on/off independent of their
 * count (1-8), and the tray and the runway are two independently ordered
 * presentation collections over the SAME canonical action registry.
 *
 * ── BREADCRUMBS — WHY ───────────────────────────────────────────────────────
 * The opposite-corner model does not scale and was solving the wrong problem.
 * It assumed the corners belonged to GS3, when in practice an arbitrary website
 * already owns its own top-left and top-right. Moving controls to dodge a
 * collision only relocated the collision onto the website. Stating the scope
 * explicitly costs one small selector and removes an entire class of "which
 * layer am I even controlling?" ambiguity — the placement was never a
 * legible signal for scope, only an accident of collision avoidance.
 *
 * This module owns preferences and ordering only. It renders nothing and
 * touches no DOM — launch.js builds the surfaces, settings.js edits them.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Store } from './storage.js';
import { HOTSWAP_ACTIONS } from './launch.js';

/** Hard ceiling on the runway. Eight fits Settings' two rows of four cleanly
 *  and is as many controls as a panel edge can carry without becoming a wall. */
export const MAX_QUICK_ACTIONS = 8;

/**
 * BREADCRUMBS — WAS: 6, chosen when Undo/Redo were competing for the same
 * configurable slots.
 * IS: 10. Position, Undo, Redo and "···" are structural and no longer consume
 * configurable capacity, so a wide enough panel can expose essentially the
 * whole ordinary action vocabulary directly.
 * WHY: direct access beats a trip through Deep Cuts whenever the space exists.
 * Responsive pressure still hides shortcuts from the end — it never rewrites
 * the saved count or order.
 */
export const MAX_TOP_SHORTCUTS = 10;

/** How long Chrome waits, after pointer AND focus have left the whole
 *  interaction family, before retracting itself.
 *
 *  BREADCRUMBS — WAS: revealed Chrome stayed open until some other panel's
 *  Chrome displaced it, so a toolbar could hold a slice of the website's height
 *  indefinitely just because the user never touched another panel.
 *  IS: each panel's Chrome owns its own lifecycle and retracts on its own.
 *  WHY: the toolbar temporarily takes height away from the website. A temporary
 *  control surface must give that real estate back when the customer stops
 *  using it, without depending on an unrelated action to trigger it.
 *  850ms: long enough to cross a gap between two controls or overshoot the rail
 *  without being punished, short enough that the website is not left shrunk. */
export const CHROME_RETRACT_DELAY_MS = 850;

/** Every action the Deep Cuts tray presents. Position-owned actions are
 *  excluded: they are reached through the [Position N] button instead, so
 *  listing them here would offer a duplicate the tray no longer renders. */
/**
 * The three configurable Chrome surfaces. Eligibility for each is DERIVED from
 * the canonical registry — no surface keeps a hand-maintained list.
 */
export const SURFACES = Object.freeze({
    TOOLBAR: 'toolbarShortcuts',
    RUNWAY: 'runway',
    DEEP_CUTS: 'deepCuts',
});

/**
 * May this surface present this action?
 *
 * BREADCRUMBS — WHY three questions, not one: "the action exists", "this
 * surface may show it" and "it is structurally owned elsewhere" are genuinely
 * different. Collapsing them into one boolean is what let Edit URL and Assign
 * Folder go missing from two surfaces while staying in a third. Exclusions here
 * are deliberate presentation decisions; every implementation stays reachable.
 */
export function isEligibleFor(surface, action) {
    if (!action) return false;
    // Owned by [Position N]: never a configurable shortcut anywhere.
    if (action.structural === 'positionButton') return false;
    // Already fixed on the rail, so the rail does not also offer it as a
    // configurable shortcut. Other surfaces still may — they do not show it.
    if (action.structural === 'toolbarRail' && surface !== SURFACES.RUNWAY) return false;
    return true;
}

/** Registry entries this surface may present, in registry order. */
export function getEligibleActions(surface) {
    return HOTSWAP_ACTIONS.filter((action) => isEligibleFor(surface, action));
}

function _eligibleKeys(surface) {
    return getEligibleActions(surface).map((action) => action.key);
}

/**
 * Reconcile a stored order against a surface's eligible set: unknown keys are
 * dropped (the action was removed, or is no longer eligible here), missing keys
 * are appended in registry order (an action was added). A stored order can
 * therefore never desynchronize from the registry, and no action definition is
 * ever duplicated to express order.
 */
function _reconcileOrder(stored, universe) {
    const known = new Set(universe);
    const seen = new Set();
    const ordered = [];
    (Array.isArray(stored) ? stored : []).forEach((key) => {
        if (known.has(key) && !seen.has(key)) { seen.add(key); ordered.push(key); }
    });
    universe.forEach((key) => { if (!seen.has(key)) ordered.push(key); });
    return ordered;
}

// ── Tray order ───────────────────────────────────────────────────────────────
// Presentation only. The tray and the runway are separate ORDERED COLLECTIONS
// over one registry — the same action may appear in both, and neither owns the
// behavior. Forking the action definitions to express order would create two
// sources of truth for what an action does.

function _migrateUnifiedOrderOnce() {
    if (Store.has('hotswapActionOrder')) return;
    const eligible = _eligibleKeys(SURFACES.TOOLBAR);
    const legacyTop = _reconcileOrder(Store.get('topShortcutOrder'), eligible);
    const raw = Number(Store.get('topShortcutCount'));
    const count = Math.max(1, Math.min(MAX_TOP_SHORTCUTS,
        Number.isFinite(raw) ? Math.round(raw) : 3));
    const chosenTop = legacyTop.slice(0, count);
    const legacyTray = _reconcileOrder(Store.get('hotswapTrayOrder'), eligible);
    Store.set('hotswapActionOrder', _reconcileOrder([...chosenTop, ...legacyTray], eligible));
    Store.set('hotswapTopCount', count);
}

export function getHotswapActionOrder() {
    _migrateUnifiedOrderOnce();
    return _reconcileOrder(Store.get('hotswapActionOrder'), _eligibleKeys(SURFACES.TOOLBAR));
}

export function setHotswapActionOrder(order) {
    _migrateUnifiedOrderOnce();
    Store.set('hotswapActionOrder', _reconcileOrder(order, _eligibleKeys(SURFACES.TOOLBAR)));
}

export const getHotswapTrayOrder = getHotswapActionOrder;
export const setHotswapTrayOrder = setHotswapActionOrder;

/** Registry entries in the user's configured tray order. */
export function getOrderedHotswapActions() {
    const byKey = new Map(HOTSWAP_ACTIONS.map((action) => [action.key, action]));
    return getHotswapTrayOrder().map((key) => byKey.get(key)).filter(Boolean);
}

// ── Quick Action runway ──────────────────────────────────────────────────────
// BREADCRUMBS — WAS: `quickActionSlots`, an array whose LENGTH doubled as both
// "how many shortcuts" and "is the feature on at all", so 0 meant two different
// things and there was no way to keep a configuration while switching it off.
// IS: an explicit enabled flag, a count of 1-8, and an ordered list, stored
// separately. WHY: turning the runway off must not destroy the arrangement the
// user built, and "does this surface exist" is a different question from "how
// long is it". Legacy slots migrate on first read; the old key is left in place
// rather than deleted, so downgrading cannot lose data.

function _migrateLegacySlotsOnce() {
    if (Store.has('quickActionsEnabled')) return;
    const legacy = (Store.get('quickActionSlots') || []).filter(Boolean);
    const usable = legacy.filter((key) => _eligibleKeys(SURFACES.RUNWAY).includes(key));
    Store.set('quickActionsEnabled', usable.length > 0);
    if (usable.length > 0) {
        Store.set('quickActionCount', Math.min(usable.length, MAX_QUICK_ACTIONS));
        Store.set('quickActionOrder', usable.slice(0, MAX_QUICK_ACTIONS));
    }
}

export function isQuickActionRunwayEnabled() {
    _migrateLegacySlotsOnce();
    return Store.get('quickActionsEnabled') === true;
}

export function setQuickActionRunwayEnabled(enabled) {
    _migrateLegacySlotsOnce();
    Store.set('quickActionsEnabled', Boolean(enabled));
}

export function getQuickActionCount() {
    _migrateLegacySlotsOnce();
    const raw = Number(Store.get('quickActionCount'));
    if (!Number.isFinite(raw)) return 1;
    return Math.max(1, Math.min(MAX_QUICK_ACTIONS, Math.round(raw)));
}

export function setQuickActionCount(count) {
    _migrateLegacySlotsOnce();
    Store.set('quickActionCount', Math.max(1, Math.min(MAX_QUICK_ACTIONS, Math.round(count) || 1)));
}

/** Every runway-eligible action, in the user's configured order. */
export function getQuickActionOrder() {
    _migrateLegacySlotsOnce();
    return _reconcileOrder(Store.get('quickActionOrder'), _eligibleKeys(SURFACES.RUNWAY));
}

export function setQuickActionOrder(order) {
    _migrateLegacySlotsOnce();
    Store.set('quickActionOrder', _reconcileOrder(order, _eligibleKeys(SURFACES.RUNWAY)));
}

/**
 * The actions the runway actually renders: none when the runway is off,
 * otherwise the first N of the configured order. Assignments stay unique by
 * construction — the order is a permutation of the registry, not N independent
 * pickers that could each land on the same action.
 */
export function getActiveQuickActions() {
    if (!isQuickActionRunwayEnabled()) return [];
    return getQuickActionOrder().slice(0, getQuickActionCount());
}

// ── Top Shortcuts ────────────────────────────────────────────────────────────
// The horizontal collection that rides the toolbar itself. Same grammar as the
// runway — enabled, a count, and an order — deliberately, so the two shortcut
// surfaces are configured the same way rather than each inventing a shape.
// They are INDEPENDENT collections: exposing the same canonical action on both
// is presentation duplication, which is allowed, not behavior duplication.

export function isTopShortcutsEnabled() {
    return Store.get('topShortcutsEnabled') !== false;
}

export function setTopShortcutsEnabled(enabled) {
    Store.set('topShortcutsEnabled', Boolean(enabled));
}

export function getTopShortcutCount() {
    _migrateUnifiedOrderOnce();
    const raw = Number(Store.get('hotswapTopCount'));
    if (!Number.isFinite(raw)) return 1;
    return Math.max(1, Math.min(MAX_TOP_SHORTCUTS, Math.round(raw)));
}

export function setTopShortcutCount(count) {
    _migrateUnifiedOrderOnce();
    Store.set('hotswapTopCount', Math.max(1, Math.min(MAX_TOP_SHORTCUTS, Math.round(count) || 1)));
}

export function getTopShortcutOrder() {
    return getHotswapActionOrder();
}

export function setTopShortcutOrder(order) {
    setHotswapActionOrder(order);
}

/** The actions the toolbar renders, before responsive capacity is applied. */
export function getVisibleTopDeepActions(visibility = {}) {
    return getHotswapActionOrder().filter((key) => visibility[key] !== false);
}

export function getActiveTopShortcuts(visibility = {}) {
    if (!isTopShortcutsEnabled()) return [];
    return getVisibleTopDeepActions(visibility).slice(0, getTopShortcutCount());
}

// ── Opacity ──────────────────────────────────────────────────────────────────
// BREADCRUMBS — WAS: these two values dimmed the top toolbar as well as the
// runway.
// IS: they govern the RIGHT RUNWAY only. The top toolbar is full opacity
// whenever it is revealed.
// WHY: opacity and retraction solve the same problem — an overlay intruding on
// the website — and the toolbar already solves it structurally by retracting to
// nothing. Fading a surface that is only present while deliberately in use just
// makes it harder to read. Two mechanisms on one surface is one too many.

export function getChromeOpacity() {
    const clamp = (value, fallback) => {
        const number = Number(value);
        if (!Number.isFinite(number)) return fallback;
        return Math.max(0, Math.min(100, Math.round(number)));
    };
    return {
        resting: clamp(Store.get('ghostOpacity'), 12),
        hover: clamp(Store.get('hotswapHoverOpacity'), 100),
    };
}

export function setChromeOpacity({ resting, hover } = {}) {
    if (resting !== undefined) Store.set('ghostOpacity', Math.max(0, Math.min(100, Math.round(resting) || 0)));
    if (hover !== undefined) Store.set('hotswapHoverOpacity', Math.max(0, Math.min(100, Math.round(hover) || 0)));
}

// ── Layer scope ──────────────────────────────────────────────────────────────
// BREADCRUMBS — WHY: a two-scope system, deliberately not a generic nesting
// selector. Layer 2 exists to run another Workspace inside a panel; there is no
// Layer 3 in the product and none is planned, so a depth-generic control would
// be speculative surface area with no user meaning.

export const LAYER_1 = 'L1';
export const LAYER_2 = 'L2';

/** Our own runtime executors. A panel showing one of these hosts a Layer 2
 *  runtime — this is a same-origin judgement about OUR pages, never a guess
 *  about arbitrary third-party content. */
const RUNTIME_EXECUTORS = ['index.html', 'index2.html', 'index3.html'];

export function isLayerTwoUrl(url) {
    if (typeof url !== 'string' || url === '') return false;
    try {
        const resolved = new URL(url, window.location.href);
        if (resolved.origin !== window.location.origin) return false; // third-party content is never our runtime
        const file = resolved.pathname.split('/').pop() || 'index.html';
        return RUNTIME_EXECUTORS.includes(file);
    } catch {
        return false;
    }
}
