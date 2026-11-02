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
    mpunct: Object.freeze({ label: 'M , . /', keys: Object.freeze(['KeyM', 'Comma', 'Period', 'Slash']) }),
});

/** Every code any preset can ever map: the exact set a forwarded SHORTCUT_KEY may carry. */
export const MULTIHEART_SHORTCUT_CODES = Object.freeze(new Set(
    Object.values(MULTIHEART_SHORTCUT_PRESETS).flatMap(preset => preset.keys)));

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
 * Event-level safety for a NATIVE keydown (preset-independent): plain keypress only —
 * Ctrl/Meta/Alt/Shift all disqualify, so Ctrl+Z/X/C/V stay Undo/Cut/Copy/Paste — and never
 * while composing, already handled elsewhere, or typing in an editable. Repeat is NOT
 * filtered here; the caller consumes repeats without acting. A Gallery-forwarded code has
 * already passed the same checks child-side and enters below this layer.
 */
export function isPlainMultiHeartKeydown(event) {
    if (event.defaultPrevented || event.isComposing) return false;
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
    return !isEditableEventTarget(event);
}

/**
 * The ONE preset -> Position mapping: an approved physical key code under a preset becomes
 * a 1-based physical Position number, or null (Off, other preset's key, unknown code).
 * Used by both the native keydown and the Gallery-forwarded path.
 */
export function resolveMultiHeartShortcutCode(code, preset) {
    const index = MULTIHEART_SHORTCUT_PRESETS[normalizeMultiHeartShortcutPreset(preset)].keys.indexOf(code);
    return index === -1 ? null : index + 1;
}
