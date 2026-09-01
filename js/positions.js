/**
 * positions.js — Stream Loop Launchpad
 * ─────────────────────────────────────────────────────────────────────────────
 * Fixed Position geometry for Runtime layouts.
 *
 * A POSITION is a permanent physical location in the current layout. Position 1
 * is always the first physical place, Position 2 always the second, and so on,
 * for as long as the layout is unchanged. Media moves. Panels move. A Position
 * never does.
 *
 * The three identities this module translates between:
 *
 *   PANEL IDENTITY   slot index 0..3. Owns content (url + folder). A panel's
 *                    DOM container (#screen-N-slot) and its iframe never move,
 *                    which is what makes every Position change a pure CSS
 *                    reassignment with zero reload/rebuild/reparent.
 *
 *   ARRANGEMENT      slot index -> grid-area name currently applied to that
 *                    slot. Owned by grid-session.js. This is the only thing a
 *                    Position move mutates.
 *
 *   PHYSICAL POSITION
 *                    1-based index into the layout's visual ordering. Because
 *                    each layout's CSS `grid-template-areas` binds a grid-area
 *                    NAME to a fixed physical cell, "Position N" resolves to a
 *                    fixed grid-area name — and from there to whichever slot
 *                    currently renders as that area.
 *
 * So the resolution is always:
 *
 *   Position N  ->  area = POSITION_AREAS[layout][N - 1]        (fixed, forever)
 *               ->  slot = arrangement.indexOf(area)            (current occupant)
 *
 * which is why "Position 3" keeps meaning the same physical place no matter how
 * many swaps preceded it. Nothing here reads the DOM, and there is deliberately
 * no second copy of the layout geometry anywhere else in the app — this module
 * owns LAYOUT_POSITION_ORDER and triple-mode.js imports it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** slot index -> its default grid-area name. index 0 is always 'screen1'. */
export const IDENTITY_ARRANGEMENT = ['screen1', 'screen2', 'screen3', 'screen4'];

// Visual (clockwise from top-left) order of slot-indices for each layout, under
// the IDENTITY arrangement — i.e. this doubles as the visual order of grid-area
// names, which is what actually defines the fixed Positions. Since it only ever
// lists the slots a layout actually uses, it also defines which slots are
// visible for that layout.
export const LAYOUT_POSITION_ORDER = {
    top2:      [0, 1, 2],
    bottom2:   [0, 2, 1],
    '3col':    [0, 1, 2],
    lefttall:  [0, 1, 2],
    righttall: [1, 0, 2],
    vsplit:    [0, 1],
    hsplit:    [0, 1],
    '4grid':   [0, 1, 3, 2], // TL, TR, BR, BL
};

const FALLBACK_ORDER = [0, 1, 2];

/** Slot-indices this layout uses, in visual order. Also the visible-slot set. */
export function getLayoutSlotOrder(layout) {
    return LAYOUT_POSITION_ORDER[layout] || FALLBACK_ORDER;
}

/**
 * The grid-area name owning each physical Position, in Position order.
 * Index 0 is Position 1. This is a pure function of the layout — it never
 * changes as panels are moved around, which is the whole point.
 */
export function getPositionAreas(layout) {
    return getLayoutSlotOrder(layout).map((slotIndex) => IDENTITY_ARRANGEMENT[slotIndex]);
}

/** [1, 2, ... N] — the Positions this layout actually shows. */
export function listPositions(layout) {
    return getLayoutSlotOrder(layout).map((_, index) => index + 1);
}

/** How many Positions this layout shows. */
export function getVisiblePositionCount(layout) {
    return getLayoutSlotOrder(layout).length;
}

/**
 * Which 1-based physical Position is `slotIndex` currently sitting in?
 * Returns null if that slot isn't visible in this layout.
 */
export function resolvePositionOfSlot(layout, arrangement, slotIndex) {
    const area = arrangement?.[slotIndex];
    if (area === undefined) return null;
    const index = getPositionAreas(layout).indexOf(area);
    return index === -1 ? null : index + 1;
}

/**
 * Which slot is currently rendering at 1-based physical `position`?
 * Returns null for a Position this layout doesn't show, or one no slot
 * currently claims. This is the function that makes "Move to Position 3"
 * mean the physical third place regardless of swap history.
 */
export function resolveSlotAtPosition(layout, arrangement, position) {
    const area = getPositionAreas(layout)[position - 1];
    if (area === undefined || !Array.isArray(arrangement)) return null;
    const slotIndex = arrangement.indexOf(area);
    return slotIndex === -1 ? null : slotIndex;
}
