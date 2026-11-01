/**
 * multiheart-shortcuts.js — MultiHeart keyboard presets (pure; no DOM side effects).
 *
 * A preset maps PHYSICAL key codes to PHYSICAL Position numbers. It never names a Slot or a
 * Panel: the Runtime resolves Position → Slot → Panel at keypress time (triple-mode.js).
 * The key is matched by `event.code`, so the mapping is layout-independent (AZERTY "1" row,
 * Dvorak ZXCV positions, etc. keep working).
 */

export const MULTIHEART_SHORTCUT_OFF = 'off';

export const MULTIHEART_SHORTCUT_PRESETS = Object.freeze({
    off: Object.freeze({ label: 'Off', keys: Object.freeze([]) }),
    numbers: Object.freeze({ label: '1 2 3 4', keys: Object.freeze(['Digit1', 'Digit2', 'Digit3', 'Digit4']) }),
    zxcv: Object.freeze({ label: 'Z X C V', keys: Object.freeze(['KeyZ', 'KeyX', 'KeyC', 'KeyV']) }),
});

/** Anything unrecognised (corrupt storage, a future preset) is Off, never a hijacked key. */
export function normalizeMultiHeartShortcutPreset(value) {
    return Object.hasOwn(MULTIHEART_SHORTCUT_PRESETS, value) ? value : MULTIHEART_SHORTCUT_OFF;
}

const EDITABLE_SELECTOR = [
    'input', 'textarea', 'select',
    '[contenteditable]:not([contenteditable="false"])',
    '[role="textbox"]', '[role="combobox"]', '[role="searchbox"]', '[role="spinbutton"]',
].join(',');

/** True when the event started in (or inside) something the Human types into. */
export function isEditableEventTarget(event) {
    const origin = typeof event.composedPath === 'function' ? event.composedPath()[0] : event.target;
    const node = origin instanceof Element ? origin : event.target;
    if (!(node instanceof Element)) return false;
    return node.isContentEditable || node.closest(EDITABLE_SELECTOR) !== null;
}

/**
 * Pure decision: which physical Position does this keydown mean, or null.
 * Plain keypress only — Ctrl/Meta/Alt/Shift all disqualify, so Ctrl+Z/X/C/V stay Undo/Cut/
 * Copy/Paste. Repeat is NOT filtered here; the caller consumes repeats without acting.
 */
export function resolveMultiHeartShortcut(event, preset) {
    const keys = MULTIHEART_SHORTCUT_PRESETS[normalizeMultiHeartShortcutPreset(preset)].keys;
    if (keys.length === 0) return null;
    if (event.defaultPrevented || event.isComposing) return null;
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return null;
    const index = keys.indexOf(event.code);
    if (index === -1) return null;
    if (isEditableEventTarget(event)) return null;
    return index + 1; // Position numbers are 1-based
}
