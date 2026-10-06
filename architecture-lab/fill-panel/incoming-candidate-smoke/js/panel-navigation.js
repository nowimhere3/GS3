/**
 * panel-navigation.js — Stream Loop Launchpad
 * ─────────────────────────────────────────────────────────────────────────────
 * PANEL NAVIGATION HISTORY — browsing that happens INSIDE a panel's live
 * content, after GS3 has loaded it.
 *
 * This is deliberately NOT the canonical GS3 action history (grid-session.js).
 * There are two different histories and they answer two different questions:
 *
 *   PANEL ACTION HISTORY  (grid-session.js)
 *     Reversible Runtime mutations GS3 itself performed: URL assignment, Panel
 *     Shuffle, Copy to Position, folder assignment, Position swap, each panel's
 *     portion of a Master Shuffle. Master Undo reads ONLY this.
 *
 *   PANEL NAVIGATION HISTORY  (this module)
 *     Browsing the user did inside the content GS3 loaded: a selection page to
 *     a category to a video. GS3 did not cause these and must not record them
 *     as Runtime actions — turning every link click into a fake Shuffle would
 *     corrupt the action history and make Master Undo traverse websites.
 *
 * Panel Undo/Redo consult both and prefer navigation (see triple-mode.js), so
 * the user experiences one continuous local history without needing to know
 * which mechanism produced any given step. Master Undo stays Runtime-only.
 *
 * ── Keyed to PANEL identity ─────────────────────────────────────────────────
 * State is keyed by slot index — this runtime's stable panel identity — never
 * by Position or grid-area. A panel moving from Position 1 to Position 3 keeps
 * its browsing history, because it is the same panel.
 *
 * ── Content generations ─────────────────────────────────────────────────────
 *   panel -> content generation -> navigation stack
 *
 * Every GS3 content assignment opens a NEW generation with a fresh single-entry
 * stack. Browsing inside the old content therefore cannot leak across a
 * deliberate content replacement: after a Panel Shuffle from Site A to Site B,
 * nothing can navigate back into Site A's pages except undoing the GS3 action
 * that replaced it.
 *
 * ── Observability is a capability, not an assumption ────────────────────────
 * Measured, not guessed (see docs/010-PANEL-NAVIGATION.md):
 *
 *   - The parent's iframe `load` event fires for child-initiated navigation at
 *     ANY origin. GS3 can always detect THAT a panel navigated.
 *   - `iframe.contentWindow.location.href` is readable same-origin and throws
 *     SecurityError cross-origin. GS3 can only sometimes know WHERE it went.
 *   - `iframe.contentWindow.history.back()` is NOT frame-scoped. It traverses
 *     the top-level JOINT session history, so it moves whichever browsing
 *     context navigated most recently — measurably another panel, or GS3
 *     itself. It is therefore never used here.
 *
 * So a panel-specific Back is only possible by re-assigning a URL we recorded,
 * which requires having been able to read it. An entry whose URL could not be
 * read is stored honestly as an OPAQUE marker rather than being dropped or
 * fabricated, and traversal steps back to the nearest entry that does have a
 * real URL — never fabricating one, never silently falling through to an older
 * GS3 action as though the navigation had not happened.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** slot index -> navigation state. Panel identity, never Position. */
const _byPanel = new Map();

function _state(slotIndex) {
    let state = _byPanel.get(slotIndex);
    if (!state) {
        state = {
            generation: 0,
            anchor: '',        // the safe return point for this generation
            entries: [],
            cursor: -1,
            pendingLoads: 0,
            settlingAnchor: false, // the opening assignment has not landed yet
            loadsSeen: 0,      // loads observed since this generation opened
            capability: 'unknown',
        };
        _byPanel.set(slotIndex, state);
    }
    return state;
}

/** An entry we can actually navigate back/forward TO. */
function _isTraversable(entry) {
    return Boolean(entry) && typeof entry.url === 'string' && entry.url.length > 0;
}

/** Clear every panel's browsing history — a new Runtime session starts fresh. */
export function resetPanelNavigation() {
    _byPanel.clear();
}

/**
 * GS3 is deliberately assigning this panel's content source. Opens a new
 * content generation: the navigation stack collapses to just this entry, and
 * any forward history from the previous generation is gone.
 *
 * `expectedLoads` is how many iframe `load` events this assignment will itself
 * produce (⟳ Reload produces two: about:blank, then the real URL). Those loads
 * are GS3's own and must never be recorded as user navigation — see
 * notePanelLoad().
 */
export function beginPanelContent(slotIndex, url, expectedLoads = 1) {
    const state = _state(slotIndex);
    state.generation += 1;
    // THE ANCHOR. GS3 chose this URL, so it is always safely known even when
    // everything the panel does afterwards is unreadable. It is the return
    // point Panel Undo falls back to for an opaque journey, which is what stops
    // an untrackable navigation from letting Undo consume an older Runtime
    // action instead.
    state.anchor = url || '';
    state.entries = [{ url: state.anchor, opaque: false, source: 'gs3' }];
    state.cursor = 0;
    // Assigned, not incremented: a new generation cannot inherit a stale
    // expectation from a load that never arrived.
    state.pendingLoads = expectedLoads;
    // Only the loads belonging to THIS assignment may correct the anchor. A
    // later traversal also raises pendingLoads, and legitimately lands
    // somewhere that is not the anchor, so it must never rewrite it.
    state.settlingAnchor = true;
    state.loadsSeen = 0;
    state.capability = 'unknown';
}

/**
 * An iframe `load` fired for this panel.
 *
 * @param {number} slotIndex
 * @param {string|null} observedUrl — the URL if it could be read, or null when
 *        the browsing context is cross-origin. Never a guess: the caller reads
 *        it inside a try/catch and passes null when the read throws.
 *
 * GS3-initiated loads are distinguished from user navigation by a pending-load
 * count, not by timing or by comparing URLs. Assigning `iframe.src` starts a
 * navigation immediately, so the next load event on that element belongs to
 * that assignment — deterministic, and it works identically cross-origin where
 * no URL comparison is possible at all.
 */
export function notePanelLoad(slotIndex, observedUrl) {
    const state = _state(slotIndex);
    state.loadsSeen += 1;
    state.capability = observedUrl === null ? 'opaque' : 'observable';

    if (state.pendingLoads > 0) {
        state.pendingLoads -= 1;
        // Once GS3's own navigation has fully come to rest (⟳ Reload expects
        // two loads: about:blank, then the URL), the anchor is corrected to
        // where it actually LANDED. A server-side redirect means the assigned
        // URL is not the page the panel is really sitting on, and Undo should
        // return the user to the real landing page rather than to a URL that
        // would just redirect again. Only done when the URL is readable —
        // never guessed, and never for opaque content.
        if (state.settlingAnchor && state.pendingLoads === 0) {
            state.settlingAnchor = false;
            if (observedUrl !== null && observedUrl !== state.anchor) {
                state.anchor = observedUrl;
                if (state.entries[0]) state.entries[0] = { ...state.entries[0], url: observedUrl };
            }
        }
        return null; // GS3's own load — already represented in the action history
    }

    // Content-initiated navigation. Anything ahead of the cursor is a branch the
    // user has now abandoned (§ navigation redo invalidation).
    state.entries = state.entries.slice(0, state.cursor + 1);
    state.entries.push({
        url: observedUrl,
        opaque: observedUrl === null,
        source: 'content',
    });
    state.cursor = state.entries.length - 1;
    return state.entries[state.cursor];
}

/**
 * Index of the nearest entry behind the cursor we can actually return to.
 *
 * Deliberately independent of whether the CURRENT entry is readable: an opaque
 * navigation marker plus a known anchor is enough to make Undo reversible.
 * Index 0 is the generation anchor, which GS3 assigned and therefore always
 * knows, so for a wholly opaque journey this resolves to the anchor rather than
 * reporting "nothing to undo" and letting an older Runtime action be consumed.
 */
function _backTargetIndex(state) {
    for (let index = state.cursor - 1; index >= 0; index -= 1) {
        if (_isTraversable(state.entries[index])) return index;
    }
    return -1;
}

export function canNavigateBack(slotIndex) {
    return _backTargetIndex(_state(slotIndex)) !== -1;
}

export function canNavigateForward(slotIndex) {
    const state = _state(slotIndex);
    return _isTraversable(state.entries[state.cursor + 1]);
}

/**
 * Step this panel back one entry, or — when the entries in between are opaque
 * and so cannot be re-addressed — to the nearest entry that has a real URL.
 *
 * Returns `{ url, collapsed }`, or null if there is nowhere to go. `collapsed`
 * is true when opaque entries were passed over: those are discarded rather than
 * kept as forward history, because there is no URL with which to return to
 * them. This is the honest cross-origin degradation — one Undo returns the
 * panel to the content GS3 loaded instead of pretending to be a one-step Back.
 *
 * The caller is responsible for actually assigning the returned URL; the
 * pending-load count is raised here so that load is not mistaken for the user
 * navigating again.
 */
export function navigateBack(slotIndex) {
    const state = _state(slotIndex);
    const target = _backTargetIndex(state);
    if (target === -1) return null;

    const collapsed = state.entries
        .slice(target + 1, state.cursor + 1)
        .some((entry) => entry.opaque);
    if (collapsed) state.entries = state.entries.slice(0, target + 1);

    state.cursor = target;
    state.pendingLoads += 1;
    return { url: state.entries[target].url, collapsed };
}

/** Step this panel forward one entry. Returns `{ url }` or null. */
export function navigateForward(slotIndex) {
    const state = _state(slotIndex);
    const next = state.entries[state.cursor + 1];
    if (!_isTraversable(next)) return null;
    state.cursor += 1;
    state.pendingLoads += 1;
    return { url: next.url };
}

/** Read-only projection — diagnostics and tests. */
export function getPanelNavigationState(slotIndex) {
    const state = _state(slotIndex);
    return {
        generation: state.generation,
        anchor: state.anchor,
        loadsSeen: state.loadsSeen,
        cursor: state.cursor,
        capability: state.capability,
        pendingLoads: state.pendingLoads,
        entries: state.entries.map((entry) => ({ ...entry })),
        canBack: canNavigateBack(slotIndex),
        canForward: canNavigateForward(slotIndex),
    };
}
