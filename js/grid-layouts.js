/**
 * grid-layouts.js — Stream Loop Launchpad
 * ─────────────────────────────────────────────────────────────────────────────
 * Canonical Grid layout vocabulary shared by Runtime and Settings.
 *
 * `cells` is the count of mini-panel rectangles the floorplan icon draws —
 * the SAME visual grammar the permanent layout-overflow buttons in
 * index3.html have always used (`.layout-icon.li-<id>` + that many `<i>`
 * cells), never a second icon system. getLayoutIconMarkup() is the one
 * function that generates that markup, so a Master Bar layout shortcut and
 * its overflow-menu twin are always visually identical.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const GRID_LAYOUTS = Object.freeze([
    { id: 'top2', title: '2 Top + 1 Bottom Wide', cells: 3 },
    { id: 'bottom2', title: '1 Top Wide + 2 Bottom', cells: 3 },
    { id: '3col', title: '3 Equal Columns', cells: 3 },
    { id: 'lefttall', title: '1 Left Tall + 2 Right Stacked', cells: 3 },
    { id: 'righttall', title: '1 Right Tall + 2 Left Stacked', cells: 3 },
    { id: 'vsplit', title: 'Vertical 50/50 Split', cells: 2 },
    { id: 'hsplit', title: 'Horizontal 50/50 Split', cells: 2 },
    { id: '4grid', title: '4 Screen Grid', cells: 4 },
]);

export const GRID_LAYOUT_IDS = Object.freeze(GRID_LAYOUTS.map(({ id }) => id));

/**
 * Mini-floorplan markup for a layout id — a tiny, immediately-readable
 * representation of the actual panel arrangement (not an abstract glyph).
 * Returns '' for an unknown id so a stale/unreconciled order can never
 * inject broken markup.
 */
export function getLayoutIconMarkup(id) {
    const definition = GRID_LAYOUTS.find((layout) => layout.id === id);
    if (!definition) return '';
    return `<span class="layout-icon li-${definition.id}">${'<i></i>'.repeat(definition.cells)}</span>`;
}
