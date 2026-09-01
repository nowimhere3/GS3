/**
 * positions-history.test.js — permanent regression suite
 * ─────────────────────────────────────────────────────────────────────────────
 * Two things are proven here, headlessly and deterministically:
 *
 *   1. FIXED POSITION SEMANTICS. "Position N" resolves to the same physical
 *      place forever within a layout, no matter how many swaps preceded it, and
 *      internal slot identity never leaks into that answer.
 *
 *   2. THE CANONICAL ACTION HISTORY. Panel Undo/Redo, master Undo, linked
 *      two-panel Position actions and redo invalidation all read and write ONE
 *      action list, so nothing can be undone twice and no stale Redo can
 *      overwrite newer state.
 *
 * Live-media continuity (zero reloads, same iframe nodes/parents/documents) is
 * a DOM property and is proven in boot-smoke.test.js against a real browser.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import test from 'node:test';
import assert from 'node:assert/strict';

function makeStorage() {
    const values = new Map();
    return {
        getItem: (key) => (values.has(key) ? values.get(key) : null),
        setItem: (key, value) => values.set(key, String(value)),
        removeItem: (key) => values.delete(key),
        clear: () => values.clear(),
    };
}

const {
    IDENTITY_ARRANGEMENT, LAYOUT_POSITION_ORDER, getPositionAreas, listPositions,
    resolvePositionOfSlot, resolveSlotAtPosition, getLayoutSlotOrder,
} = await import('../js/positions.js');

/** Boot a fresh isolated Grid session whose slots hold the given URLs. */
async function freshSession(urls = ['A', 'B', 'C'], layout = 'lefttall') {
    globalThis.localStorage = makeStorage();
    globalThis.window = { location: { search: '?workspace=live' } };
    localStorage.setItem('loop_matrix_urls', JSON.stringify(urls));
    localStorage.setItem('triple_screen_layout', layout);
    const session = await import('../js/grid-session.js');
    const { Store } = await import('../js/storage.js');
    ['matrixUrls', 'folderMap', 'tripleLayout'].forEach((key) => Store.invalidate(key));
    session.initGridSession(layout);
    return session;
}

/**
 * Exactly what triple-mode.js's _moveSlotToPosition() does to the session,
 * minus the DOM: resolve the fixed physical Position to its current occupant,
 * then swap the two slots' grid-areas as ONE recorded action.
 */
function moveToPosition(session, layout, slotIndex, position) {
    const arrangement = session.getSessionArrangement();
    const targetSlot = resolveSlotAtPosition(layout, arrangement, position);
    if (targetSlot === null || targetSlot === slotIndex) return false;
    session.beginGridAction('position');
    const held = arrangement[slotIndex];
    arrangement[slotIndex] = arrangement[targetSlot];
    arrangement[targetSlot] = held;
    session.setSessionArrangement(arrangement);
    return true;
}

/** Which URL is currently showing at each Position, in Position order. */
function urlsByPosition(session, layout) {
    const arrangement = session.getSessionArrangement();
    const urls = session.getSessionUrls();
    return listPositions(layout).map((position) => urls[resolveSlotAtPosition(layout, arrangement, position)]);
}

function setPanelUrl(session, slotIndex, url, type = 'url') {
    session.beginGridAction(type);
    const urls = session.getSessionUrls();
    urls[slotIndex] = url;
    session.updateGridSession(urls, session.getSessionFolderMap());
}

// ── Fixed Position geometry ──────────────────────────────────────────────────

test('every layout Position maps to a fixed grid-area and numbers from the top-left', () => {
    // These are the physical cells each layout's CSS grid-template-areas binds,
    // read in visual order. If this table and index3.html ever disagree, the
    // user-facing Position numbering has silently moved.
    assert.deepEqual(getPositionAreas('top2'), ['screen1', 'screen2', 'screen3']);
    assert.deepEqual(getPositionAreas('bottom2'), ['screen1', 'screen3', 'screen2']);
    assert.deepEqual(getPositionAreas('3col'), ['screen1', 'screen2', 'screen3']);
    assert.deepEqual(getPositionAreas('lefttall'), ['screen1', 'screen2', 'screen3']);
    assert.deepEqual(getPositionAreas('righttall'), ['screen2', 'screen1', 'screen3']);
    assert.deepEqual(getPositionAreas('vsplit'), ['screen1', 'screen2']);
    assert.deepEqual(getPositionAreas('hsplit'), ['screen1', 'screen2']);
    assert.deepEqual(getPositionAreas('4grid'), ['screen1', 'screen2', 'screen4', 'screen3']);

    // Only visible Positions are ever offered, and the numbering is contiguous.
    Object.keys(LAYOUT_POSITION_ORDER).forEach((layout) => {
        const positions = listPositions(layout);
        assert.deepEqual(positions, getLayoutSlotOrder(layout).map((_, index) => index + 1));
        assert.equal(new Set(getPositionAreas(layout)).size, positions.length);
    });
});

test('Position resolution round-trips through any arbitrary arrangement', () => {
    const layout = '4grid';
    // Deliberately scrambled: no slot sits in its identity area.
    const arrangement = ['screen4', 'screen3', 'screen1', 'screen2'];
    listPositions(layout).forEach((position) => {
        const slot = resolveSlotAtPosition(layout, arrangement, position);
        assert.equal(resolvePositionOfSlot(layout, arrangement, slot), position);
    });
    // A slot the layout doesn't show has no Position at all.
    assert.equal(resolvePositionOfSlot('vsplit', IDENTITY_ARRANGEMENT, 3), null);
    assert.equal(resolveSlotAtPosition('vsplit', IDENTITY_ARRANGEMENT, 3), null);
});

test('Position N always lands media in physical Position N across repeated swaps', async () => {
    const layout = 'lefttall';
    const session = await freshSession(['A', 'B', 'C'], layout);
    const slotOf = (url) => session.getSessionUrls().indexOf(url);

    assert.deepEqual(urlsByPosition(session, layout), ['A', 'B', 'C']);

    // move A to Position 2
    moveToPosition(session, layout, slotOf('A'), 2);
    assert.deepEqual(urlsByPosition(session, layout), ['B', 'A', 'C']);

    // move A to Position 3 — A is no longer in its original Position, and the
    // request must still mean the THIRD PHYSICAL PLACE, not "slot 3".
    moveToPosition(session, layout, slotOf('A'), 3);
    assert.deepEqual(urlsByPosition(session, layout), ['B', 'C', 'A']);

    // move B to Position 2
    moveToPosition(session, layout, slotOf('B'), 2);
    assert.deepEqual(urlsByPosition(session, layout), ['C', 'B', 'A']);

    // Internal slot identity never moved: content stayed bound to its slot the
    // whole time. That is what keeps a Position move a pure CSS change.
    assert.deepEqual(session.getSessionUrls(), ['A', 'B', 'C']);

    // And each panel reports the Position a user would actually point at.
    const arrangement = session.getSessionArrangement();
    assert.equal(resolvePositionOfSlot(layout, arrangement, slotOf('C')), 1);
    assert.equal(resolvePositionOfSlot(layout, arrangement, slotOf('B')), 2);
    assert.equal(resolvePositionOfSlot(layout, arrangement, slotOf('A')), 3);
});

test('Position numbering is stable in a layout whose visual order is not slot order', async () => {
    const layout = 'righttall'; // Position 1 is slot 1, Position 2 is slot 0
    const session = await freshSession(['A', 'B', 'C'], layout);
    assert.deepEqual(urlsByPosition(session, layout), ['B', 'A', 'C']);

    const slotOf = (url) => session.getSessionUrls().indexOf(url);
    moveToPosition(session, layout, slotOf('C'), 1);
    assert.deepEqual(urlsByPosition(session, layout), ['C', 'A', 'B']);
    moveToPosition(session, layout, slotOf('C'), 2);
    assert.deepEqual(urlsByPosition(session, layout), ['A', 'C', 'B']);
});

// ── Panel Undo / Redo ────────────────────────────────────────────────────────

test('panel Undo and Redo affect only the panel they belong to', async () => {
    const session = await freshSession(['A', 'B', 'C']);

    setPanelUrl(session, 1, 'B2');
    assert.deepEqual(session.getSessionUrls(), ['A', 'B2', 'C']);
    assert.ok(session.canUndoPanelHistory(1));
    assert.ok(!session.canRedoPanelHistory(1));
    assert.ok(!session.canUndoPanelHistory(0), 'panel A has no history of its own');

    const undone = session.undoPanelHistory(1);
    assert.deepEqual(session.getSessionUrls(), ['A', 'B', 'C']);
    assert.deepEqual(undone.changedUrlIndices, [1], 'only slot 1 is written back');
    assert.deepEqual(undone.changedFolderIndices, []);
    assert.equal(undone.arrangementChanged, false);
    assert.ok(!session.canUndoPanelHistory(1));
    assert.ok(session.canRedoPanelHistory(1));

    const redone = session.redoPanelHistory(1);
    assert.deepEqual(session.getSessionUrls(), ['A', 'B2', 'C']);
    assert.deepEqual(redone.changedUrlIndices, [1]);
    assert.ok(session.canUndoPanelHistory(1));
    assert.ok(!session.canRedoPanelHistory(1));
});

test('interleaved panel histories do not interfere with each other', async () => {
    const session = await freshSession(['A', 'B', 'C']);

    setPanelUrl(session, 0, 'A2');
    setPanelUrl(session, 1, 'B2');
    assert.deepEqual(session.getSessionUrls(), ['A2', 'B2', 'C']);

    // Undo A even though B's change is the most recent thing that happened.
    session.undoPanelHistory(0);
    assert.deepEqual(session.getSessionUrls(), ['A', 'B2', 'C'], 'B stays changed');

    session.redoPanelHistory(0);
    assert.deepEqual(session.getSessionUrls(), ['A2', 'B2', 'C'], 'B untouched by A history ops');
    assert.ok(session.canUndoPanelHistory(1), "B's own history is still intact");
});

test('button availability tracks real history at every step', async () => {
    const session = await freshSession(['A', 'B', 'C']);
    const state = () => [session.canUndoPanelHistory(1), session.canRedoPanelHistory(1)];

    assert.deepEqual(state(), [false, false], 'no panel history');
    setPanelUrl(session, 1, 'B2');
    assert.deepEqual(state(), [true, false], 'after action');
    session.undoPanelHistory(1);
    assert.deepEqual(state(), [false, true], 'after undo');
    session.redoPanelHistory(1);
    assert.deepEqual(state(), [true, false], 'after redo');
    setPanelUrl(session, 1, 'B3');
    session.undoPanelHistory(1);
    assert.deepEqual(state(), [true, true], 'older action still undoable, newer redoable');
});

// ── Linked two-panel Position actions ────────────────────────────────────────

test('a Position swap is ONE linked action reversible once from either panel', async () => {
    const layout = 'lefttall';
    const session = await freshSession(['A', 'B', 'C'], layout);

    moveToPosition(session, layout, 0, 2); // A -> Position 2, swapping with B
    const [action] = session.getGridHistory();
    assert.deepEqual(action.slots, [0, 1], 'both occupants are recorded on the one action');
    assert.equal(action.isPosition, true);
    assert.equal(session.getGridHistory().length, 1, 'not duplicated into per-panel histories');
    assert.deepEqual(urlsByPosition(session, layout), ['B', 'A', 'C']);

    // Either panel can undo it...
    assert.ok(session.canUndoPanelHistory(0) && session.canUndoPanelHistory(1));
    session.undoPanelHistory(1); // undo it from the OTHER panel in the swap
    assert.deepEqual(urlsByPosition(session, layout), ['A', 'B', 'C']);

    // ...but only once. It is now invisible to the other panel AND to master.
    assert.ok(!session.canUndoPanelHistory(0), 'no double-undo from the linked panel');
    assert.ok(!session.canUndoPanelHistory(1));
    assert.ok(!session.canUndoGridSession(), 'no double-undo from master either');
    assert.equal(session.undoPanelHistory(0), null);

    // Redo is linked the same way.
    assert.ok(session.canRedoPanelHistory(0) && session.canRedoPanelHistory(1));
    session.redoPanelHistory(0);
    assert.deepEqual(urlsByPosition(session, layout), ['B', 'A', 'C']);
    assert.ok(!session.canRedoPanelHistory(1), 'redo consumed once, for both panels');
});

test('Position Undo/Redo restores arrangement without ever touching content', async () => {
    const layout = 'lefttall';
    const session = await freshSession(['A', 'B', 'C'], layout);
    const contentBefore = session.getSessionUrls();

    moveToPosition(session, layout, 0, 3);
    const undone = session.undoPanelHistory(0);
    assert.equal(undone.arrangementChanged, true);
    assert.deepEqual(undone.changedUrlIndices, [], 'a Position move is presentation only');
    assert.deepEqual(undone.changedFolderIndices, []);
    assert.deepEqual(urlsByPosition(session, layout), ['A', 'B', 'C']);

    const redone = session.redoPanelHistory(0);
    assert.equal(redone.arrangementChanged, true);
    assert.deepEqual(redone.changedUrlIndices, []);
    assert.deepEqual(urlsByPosition(session, layout), ['C', 'B', 'A']);
    assert.deepEqual(session.getSessionUrls(), contentBefore, 'content never moved at all');
});

test('undoing an older Position action does not discard a newer one', async () => {
    const layout = 'lefttall';
    const session = await freshSession(['A', 'B', 'C'], layout);

    moveToPosition(session, layout, 0, 2);              // action 1: slots 0,1
    moveToPosition(session, layout, 0, 3);              // action 2: slots 0,2
    assert.deepEqual(urlsByPosition(session, layout), ['B', 'C', 'A']);

    // Panel 1 (B) is only named on action 1, so its Undo reaches past action 2.
    // Restoration is by inverse composition, never by restoring a whole stale
    // arrangement snapshot — so action 2 survives instead of being clobbered.
    session.undoPanelHistory(1);
    const history = session.getGridHistory();
    assert.equal(history[0].state, 'undone');
    assert.equal(history[1].state, 'applied', 'the newer Position action is still applied');
    assert.equal(new Set(session.getSessionArrangement().slice(0, 3)).size, 3,
        'arrangement is still a valid permutation');
});

// ── Panel Navigation History (the second, separate history) ──────────────────
// Browsing that happens INSIDE a panel's live content. These tests drive the
// model directly; the browser-level proofs (real same-origin and real
// cross-origin navigation, continuity, and the smart Undo dispatch) live in
// boot-smoke.test.js.

const nav = await import('../js/panel-navigation.js');

function freshNav() {
    nav.resetPanelNavigation();
    return nav;
}

test('a GS3 content assignment opens a generation and is not itself a navigation', () => {
    freshNav();
    nav.beginPanelContent(1, '/browse');
    assert.equal(nav.getPanelNavigationState(1).generation, 1);
    assert.equal(nav.canNavigateBack(1), false, 'nothing to go back to yet');

    // The load that assignment produces is GS3's own — already represented in
    // the action history. Recording it again would make one action undo twice.
    assert.equal(nav.notePanelLoad(1, 'http://host/browse'), null);
    const state = nav.getPanelNavigationState(1);
    assert.equal(state.entries.length, 1, 'no second entry was fabricated');
    assert.equal(state.cursor, 0);
    assert.equal(state.pendingLoads, 0);
    assert.equal(nav.canNavigateBack(1), false);
});

test('content-initiated navigation is recorded and traversable', () => {
    freshNav();
    nav.beginPanelContent(1, '/browse');
    nav.notePanelLoad(1, '/browse');

    nav.notePanelLoad(1, '/category');
    nav.notePanelLoad(1, '/video');
    assert.equal(nav.getPanelNavigationState(1).cursor, 2);
    assert.deepEqual(nav.getPanelNavigationState(1).entries.map((e) => e.url),
        ['/browse', '/category', '/video']);
    assert.ok(nav.canNavigateBack(1) && !nav.canNavigateForward(1));

    assert.deepEqual(nav.navigateBack(1), { url: '/category', collapsed: false });
    nav.notePanelLoad(1, '/category'); // the traversal's own load
    assert.ok(nav.canNavigateBack(1) && nav.canNavigateForward(1));

    assert.deepEqual(nav.navigateBack(1), { url: '/browse', collapsed: false });
    nav.notePanelLoad(1, '/browse');
    assert.equal(nav.canNavigateBack(1), false, 'back at the content GS3 assigned');

    assert.deepEqual(nav.navigateForward(1), { url: '/category' });
    nav.notePanelLoad(1, '/category');
    assert.deepEqual(nav.navigateForward(1), { url: '/video' });
    nav.notePanelLoad(1, '/video');
    assert.equal(nav.canNavigateForward(1), false);
});

test('a new navigation discards the stale forward path', () => {
    freshNav();
    nav.beginPanelContent(1, '/browse');
    nav.notePanelLoad(1, '/browse');
    nav.notePanelLoad(1, '/category');
    nav.notePanelLoad(1, '/video-a');

    nav.navigateBack(1);
    nav.notePanelLoad(1, '/category');
    assert.equal(nav.canNavigateForward(1), true, '/video-a is still ahead');

    nav.notePanelLoad(1, '/video-b'); // the user went somewhere else instead
    assert.deepEqual(nav.getPanelNavigationState(1).entries.map((e) => e.url),
        ['/browse', '/category', '/video-b'], 'the abandoned branch is gone');
    assert.equal(nav.canNavigateForward(1), false, 'Redo cannot resurrect /video-a');
});

test('opaque navigation is recorded honestly and never fabricated', () => {
    freshNav();
    nav.beginPanelContent(2, 'https://site-b/browse');
    nav.notePanelLoad(2, null); // cross-origin: the URL read threw
    assert.equal(nav.getPanelNavigationState(2).capability, 'opaque');

    nav.notePanelLoad(2, null); // the user clicked something inside it
    const state = nav.getPanelNavigationState(2);
    assert.deepEqual(state.entries.map((e) => ({ url: e.url, opaque: e.opaque })), [
        { url: 'https://site-b/browse', opaque: false }, // GS3 assigned this, so it is known
        { url: null, opaque: true },                     // this one genuinely is not
    ]);
    assert.equal(state.cursor, 1);

    // Crucially: the panel navigated, so Back must NOT fall through to an older
    // GS3 action. It returns to the content GS3 loaded instead.
    assert.equal(nav.canNavigateBack(2), true);
    assert.deepEqual(nav.navigateBack(2), { url: 'https://site-b/browse', collapsed: true });
    nav.notePanelLoad(2, null);

    // The opaque entry cannot be returned to — there is no URL — so it is
    // discarded rather than left as an unreachable Redo target.
    assert.equal(nav.canNavigateForward(2), false);
    assert.equal(nav.canNavigateBack(2), false, 'now genuinely at the base');
    assert.deepEqual(nav.getPanelNavigationState(2).entries.map((e) => e.url), ['https://site-b/browse']);
});

test('an opaque step between known entries collapses to the nearest addressable one', () => {
    freshNav();
    nav.beginPanelContent(0, '/browse');
    nav.notePanelLoad(0, '/browse');
    nav.notePanelLoad(0, '/category');  // observable
    nav.notePanelLoad(0, null);         // then off to somewhere unreadable

    assert.deepEqual(nav.navigateBack(0), { url: '/category', collapsed: true });
    assert.deepEqual(nav.getPanelNavigationState(0).entries.map((e) => e.url), ['/browse', '/category']);
    assert.equal(nav.canNavigateForward(0), false, 'the opaque entry is unreachable, not pending');
});

test('a GS3 content replacement ends the old browsing generation', () => {
    freshNav();
    nav.beginPanelContent(1, '/site-a/p1');
    nav.notePanelLoad(1, '/site-a/p1');
    nav.notePanelLoad(1, '/site-a/p2');
    nav.notePanelLoad(1, '/site-a/p3');

    nav.beginPanelContent(1, '/site-b'); // Panel Shuffle to a different site
    nav.notePanelLoad(1, '/site-b');
    const state = nav.getPanelNavigationState(1);
    assert.equal(state.generation, 2);
    assert.deepEqual(state.entries.map((e) => e.url), ['/site-b']);
    assert.equal(nav.canNavigateBack(1), false,
        'Site A pages cannot be reached by browsing back across the replacement');
    assert.equal(nav.canNavigateForward(1), false);
});

test('⟳ Reload collapses browsing to the assigned source and records neither load', () => {
    freshNav();
    nav.beginPanelContent(1, '/browse');
    nav.notePanelLoad(1, '/browse');
    nav.notePanelLoad(1, '/video');
    assert.equal(nav.canNavigateBack(1), true);

    nav.beginPanelContent(1, '/browse', 2); // about:blank, then the URL
    nav.notePanelLoad(1, 'about:blank');
    nav.notePanelLoad(1, '/browse');
    const state = nav.getPanelNavigationState(1);
    assert.deepEqual(state.entries.map((e) => e.url), ['/browse'], 'no phantom about:blank entry');
    assert.equal(state.pendingLoads, 0);
    assert.equal(nav.canNavigateBack(1), false);
});

test('the generation anchor is always known, even when everything after it is opaque', () => {
    freshNav();
    nav.beginPanelContent(1, 'https://site-b/browse');
    nav.notePanelLoad(1, null);   // GS3's own load, cross-origin
    nav.notePanelLoad(1, null);   // the user clicks something
    nav.notePanelLoad(1, null);   // and something else

    const state = nav.getPanelNavigationState(1);
    assert.equal(state.anchor, 'https://site-b/browse', 'GS3 assigned it, so it is safely known');
    assert.equal(state.cursor, 2);
    assert.equal(nav.canNavigateBack(1), true,
        'an opaque marker plus a known anchor is enough — canUndo must NOT require a readable current entry');

    // Several opaque steps collapse to the anchor in one Undo. That is the
    // honest degradation; what matters is that it does NOT report "nothing to
    // undo" and let an older Runtime action be consumed instead.
    assert.deepEqual(nav.navigateBack(1), { url: 'https://site-b/browse', collapsed: true });
    nav.notePanelLoad(1, null);
    assert.equal(nav.canNavigateBack(1), false);
    assert.equal(nav.canNavigateForward(1), false, 'no impossible Redo target is advertised');
});

test('a redirected assignment anchors on where it landed, not on what was requested', () => {
    freshNav();
    nav.beginPanelContent(1, 'https://site/');
    nav.notePanelLoad(1, 'https://site/home');   // server-side redirect

    const state = nav.getPanelNavigationState(1);
    assert.equal(state.anchor, 'https://site/home', 'Undo would otherwise return to a URL that redirects again');
    assert.equal(state.cursor, 0, 'a redirect is part of the assignment, not a user navigation');
    assert.equal(nav.canNavigateBack(1), false);

    // A traversal also raises the pending count but must never rewrite the anchor.
    nav.notePanelLoad(1, 'https://site/video');
    nav.navigateBack(1);
    nav.notePanelLoad(1, 'https://site/home');
    assert.equal(nav.getPanelNavigationState(1).anchor, 'https://site/home', 'anchor unchanged by traversal');
});

test('⟳ Reload lands its anchor on the URL, not on its about:blank hop', () => {
    freshNav();
    nav.beginPanelContent(1, '/browse', 2);
    nav.notePanelLoad(1, 'about:blank');
    nav.notePanelLoad(1, '/browse');
    assert.equal(nav.getPanelNavigationState(1).anchor, '/browse',
        'the intermediate hop must not be mistaken for where the assignment came to rest');
});

test('navigation history is per panel and never leaks across panels', () => {
    freshNav();
    nav.beginPanelContent(0, '/a/browse');
    nav.notePanelLoad(0, '/a/browse');
    nav.beginPanelContent(1, '/b/browse');
    nav.notePanelLoad(1, '/b/browse');

    nav.notePanelLoad(0, '/a/video');
    nav.notePanelLoad(1, '/b/video');
    assert.ok(nav.canNavigateBack(0) && nav.canNavigateBack(1));

    nav.navigateBack(0);
    nav.notePanelLoad(0, '/a/browse');
    assert.equal(nav.canNavigateBack(0), false);
    assert.equal(nav.canNavigateBack(1), true, "panel 1's browsing is untouched");
    assert.deepEqual(nav.getPanelNavigationState(1).entries.map((e) => e.url), ['/b/browse', '/b/video']);
});

test('an empty panel has nothing to navigate back to', () => {
    freshNav();
    nav.beginPanelContent(3, '');
    nav.notePanelLoad(3, 'about:blank');
    assert.equal(nav.canNavigateBack(3), false, 'an empty base is not a traversable target');
});

// ── Multi-panel content actions are per-panel undoable ───────────────────────
// A Shuffle All changed every panel at the same moment, but for reasons that
// have nothing to do with each other. Panel Undo means "undo the last change to
// THIS panel", so it must reverse that panel's portion alone.

/** Exactly what a master Shuffle does to the session: one action, every slot. */
function shuffleAll(session, urls) {
    session.beginGridAction('shuffle');
    session.updateGridSession(urls, session.getSessionFolderMap());
}

test('Panel Undo of a Master Shuffle restores only that panel', async () => {
    const session = await freshSession(['A1', 'B1', 'C1']);
    shuffleAll(session, ['A2', 'B2', 'C2']);
    assert.deepEqual(session.getSessionUrls(), ['A2', 'B2', 'C2']);

    const [action] = session.getGridHistory();
    assert.deepEqual(action.slots, [0, 1, 2], 'still ONE action naming every panel it changed');
    assert.equal(action.atomic, false, 'a content bundle, not an indivisible action');

    const undone = session.undoPanelHistory(1);
    assert.deepEqual(session.getSessionUrls(), ['A2', 'B1', 'C2'], 'only B went back');
    assert.deepEqual(undone.changedUrlIndices, [1], 'only B is written back, so only B can reload');
    assert.deepEqual(undone.changedFolderIndices, []);
    assert.equal(undone.arrangementChanged, false);

    const redone = session.redoPanelHistory(1);
    assert.deepEqual(session.getSessionUrls(), ['A2', 'B2', 'C2'], 'only B came forward');
    assert.deepEqual(redone.changedUrlIndices, [1]);
});

test('each panel reverses its own portion of a Master Shuffle independently', async () => {
    const session = await freshSession(['A1', 'B1', 'C1']);
    shuffleAll(session, ['A2', 'B2', 'C2']);

    session.undoPanelHistory(0);
    assert.deepEqual(session.getSessionUrls(), ['A1', 'B2', 'C2']);
    session.undoPanelHistory(2);
    assert.deepEqual(session.getSessionUrls(), ['A1', 'B2', 'C1']);

    // The one action now carries three different per-panel states at once.
    const [action] = session.getGridHistory();
    assert.deepEqual(action.slotState, { 0: 'undone', 1: 'applied', 2: 'undone' });
    assert.equal(action.state, 'applied', 'still applied overall while any portion is');

    // Each panel's own controls reflect its own portion, nothing else's.
    assert.deepEqual([0, 1, 2].map((slot) => session.canUndoPanelHistory(slot)), [false, true, false]);
    assert.deepEqual([0, 1, 2].map((slot) => session.canRedoPanelHistory(slot)), [true, false, true]);

    session.redoPanelHistory(2);
    assert.deepEqual(session.getSessionUrls(), ['A1', 'B2', 'C2']);
    assert.deepEqual(session.getGridHistory()[0].slotState, { 0: 'undone', 1: 'applied', 2: 'applied' });
});

test('a portion undone by a panel is never restored twice, by any control', async () => {
    const session = await freshSession(['A1', 'B1', 'C1']);
    shuffleAll(session, ['A2', 'B2', 'C2']);

    session.undoPanelHistory(1);
    assert.deepEqual(session.getSessionUrls(), ['A2', 'B1', 'C2']);
    assert.equal(session.undoPanelHistory(1), null, 'B has nothing left to undo');

    // Master Undo still reverses the Shuffle as one session action — but skips
    // B's portion, which the panel already reversed. B must not reload.
    const restored = session.undoGridSession();
    assert.deepEqual(session.getSessionUrls(), ['A1', 'B1', 'C1'], 'the whole Shuffle is now undone');
    assert.deepEqual(restored.changedUrlIndices, [0, 2], 'B was already restored and is left alone');

    assert.ok(!session.canUndoGridSession());
    assert.deepEqual([0, 1, 2].map((slot) => session.canUndoPanelHistory(slot)), [false, false, false]);
});

test('master Undo of a Shuffle never tramples a newer independent panel change', async () => {
    const session = await freshSession(['A1', 'B1', 'C1']);
    shuffleAll(session, ['A2', 'B2', 'C2']);

    session.undoPanelHistory(1);                // B back to B1
    setPanelUrl(session, 1, 'B9', 'url');       // then B moves on independently
    assert.deepEqual(session.getSessionUrls(), ['A2', 'B9', 'C2']);

    // B's undone portion of the Shuffle is now stale and was invalidated, so
    // neither Redo nor any Undo can put B2 or B1 back over B9.
    assert.deepEqual(session.getGridHistory()[0].slotState, { 0: 'applied', 1: 'invalidated', 2: 'applied' });
    assert.ok(!session.canRedoPanelHistory(1));

    session.undoGridSession();                  // newest action is B's own edit
    assert.deepEqual(session.getSessionUrls(), ['A2', 'B1', 'C2']);
    session.undoGridSession();                  // now the Shuffle's live portions
    assert.deepEqual(session.getSessionUrls(), ['A1', 'B1', 'C1']);
    assert.ok(!session.canUndoGridSession());
});

test('a Position swap stays atomic and is never partially undoable', async () => {
    const layout = 'lefttall';
    const session = await freshSession(['A', 'B', 'C'], layout);

    moveToPosition(session, layout, 0, 2);
    const [action] = session.getGridHistory();
    assert.equal(action.atomic, true, 'a Position swap is indivisible');
    assert.deepEqual(action.slots, [0, 1]);

    // Undo from ONE participant moves BOTH — there is no half of a swap.
    session.undoPanelHistory(0);
    assert.deepEqual(urlsByPosition(session, layout), ['A', 'B', 'C']);
    assert.deepEqual(session.getGridHistory()[0].slotState, { 0: 'undone', 1: 'undone' });
    assert.ok(!session.canUndoPanelHistory(1), 'the other side cannot undo it again');

    // Redo from one participant likewise moves both.
    session.redoPanelHistory(1);
    assert.deepEqual(urlsByPosition(session, layout), ['B', 'A', 'C']);
    assert.deepEqual(session.getGridHistory()[0].slotState, { 0: 'applied', 1: 'applied' });

    // And invalidating one side invalidates the whole swap, since a half-redo
    // would leave the arrangement incoherent.
    session.undoPanelHistory(0);
    setPanelUrl(session, 1, 'B2', 'url');
    assert.deepEqual(session.getGridHistory()[0].slotState, { 0: 'invalidated', 1: 'invalidated' });
    assert.ok(!session.canRedoPanelHistory(0) && !session.canRedoPanelHistory(1));
});

// ── Master / panel interoperability ──────────────────────────────────────────

test('an action undone by Panel Undo can never be undone again by master Undo', async () => {
    const session = await freshSession(['A', 'B', 'C']);

    setPanelUrl(session, 1, 'B2');
    assert.ok(session.canUndoGridSession());

    session.undoPanelHistory(1);
    assert.deepEqual(session.getSessionUrls(), ['A', 'B', 'C']);

    assert.ok(!session.canUndoGridSession(), 'master sees nothing left to undo');
    assert.equal(session.undoGridSession(), null);
    assert.deepEqual(session.getSessionUrls(), ['A', 'B', 'C'], 'no older phantom state applied');
});

test('an action undone by master Undo can never be undone again by Panel Undo', async () => {
    const session = await freshSession(['A', 'B', 'C']);

    setPanelUrl(session, 2, 'C2');
    session.undoGridSession();
    assert.deepEqual(session.getSessionUrls(), ['A', 'B', 'C']);

    assert.ok(!session.canUndoPanelHistory(2));
    assert.equal(session.undoPanelHistory(2), null);
    assert.ok(session.canRedoPanelHistory(2), 'it is a redo candidate for that panel instead');
    session.redoPanelHistory(2);
    assert.deepEqual(session.getSessionUrls(), ['A', 'B', 'C2']);
});

test('master Undo takes the newest applied action, panel Undo the newest for that panel', async () => {
    const session = await freshSession(['A', 'B', 'C']);
    setPanelUrl(session, 0, 'A2');
    setPanelUrl(session, 1, 'B2');
    setPanelUrl(session, 2, 'C2');

    session.undoPanelHistory(0); // reaches past two newer actions
    assert.deepEqual(session.getSessionUrls(), ['A', 'B2', 'C2']);

    session.undoGridSession(); // newest still-applied action is C's
    assert.deepEqual(session.getSessionUrls(), ['A', 'B2', 'C']);

    session.undoGridSession();
    assert.deepEqual(session.getSessionUrls(), ['A', 'B', 'C']);
    assert.ok(!session.canUndoGridSession());
});

// ── Copy to Position ─────────────────────────────────────────────────────────

test('Copy to Position writes the URL only, to the destination only, undoably', async () => {
    const layout = 'lefttall';
    const session = await freshSession(['A', 'B', 'C'], layout);
    session.updateGridSession(session.getSessionUrls(), { 0: 'FolderA', 2: 'FolderC' });

    // Exactly what triple-mode.js's _copyUrlToPosition() does to the session.
    const arrangement = session.getSessionArrangement();
    const destSlot = resolveSlotAtPosition(layout, arrangement, 3);
    assert.equal(destSlot, 2);
    session.beginGridAction('copy');
    const urls = session.getSessionUrls();
    urls[destSlot] = urls[0];
    session.updateGridSession(urls, session.getSessionFolderMap());

    assert.deepEqual(session.getSessionUrls(), ['A', 'B', 'A']);
    assert.deepEqual(session.getSessionFolderMap(), { 0: 'FolderA', 2: 'FolderC' },
        "the destination keeps its own folder — copy means URL only");

    const [copyAction] = session.getGridHistory();
    assert.deepEqual(copyAction.slots, [2], 'only the destination panel is affected');
    assert.equal(copyAction.type, 'copy');

    const undone = session.undoPanelHistory(2);
    assert.deepEqual(session.getSessionUrls(), ['A', 'B', 'C']);
    assert.deepEqual(undone.changedUrlIndices, [2], 'only the destination is written back');

    session.redoPanelHistory(2);
    assert.deepEqual(session.getSessionUrls(), ['A', 'B', 'A']);
    assert.ok(!session.canUndoPanelHistory(0), 'the source panel never gained history');
});

// ── Redo invalidation ────────────────────────────────────────────────────────

test('a stale Redo can never overwrite newer state on the same panel', async () => {
    const session = await freshSession(['A', 'B', 'C']);

    setPanelUrl(session, 1, 'B2');
    session.undoPanelHistory(1);
    assert.ok(session.canRedoPanelHistory(1));

    // A new, conflicting action on the same panel branches the history.
    setPanelUrl(session, 1, 'B3');
    assert.ok(!session.canRedoPanelHistory(1), 'the stale redo is gone');
    assert.equal(session.redoPanelHistory(1), null);
    assert.deepEqual(session.getSessionUrls(), ['A', 'B3', 'C'], 'newer state stands');

    assert.equal(session.getGridHistory()[0].state, 'invalidated');

    // The newer action is itself normally undoable/redoable.
    session.undoPanelHistory(1);
    assert.deepEqual(session.getSessionUrls(), ['A', 'B', 'C']);
    session.redoPanelHistory(1);
    assert.deepEqual(session.getSessionUrls(), ['A', 'B3', 'C']);
});

test('redo invalidation is scoped to the panels the new action touched', async () => {
    const session = await freshSession(['A', 'B', 'C']);

    setPanelUrl(session, 0, 'A2');
    setPanelUrl(session, 1, 'B2');
    session.undoPanelHistory(0);
    session.undoPanelHistory(1);
    assert.ok(session.canRedoPanelHistory(0) && session.canRedoPanelHistory(1));

    setPanelUrl(session, 1, 'B3'); // conflicts with B's undone action only
    assert.ok(!session.canRedoPanelHistory(1), "B's stale redo is dropped");
    assert.ok(session.canRedoPanelHistory(0), "A's redo is untouched");

    session.redoPanelHistory(0);
    assert.deepEqual(session.getSessionUrls(), ['A2', 'B3', 'C']);
});

test('changing layout invalidates Position history but never content history', async () => {
    const session = await freshSession(['A', 'B', 'C'], 'lefttall');

    setPanelUrl(session, 0, 'A2');
    moveToPosition(session, 'lefttall', 0, 2);
    assert.equal(session.getGridHistory().filter((a) => a.isPosition).length, 1);

    session.setSessionLayout('4grid'); // Positions are defined per-layout
    const history = session.getGridHistory();
    assert.equal(history.find((a) => a.isPosition).state, 'invalidated');
    assert.equal(history.find((a) => !a.isPosition).state, 'applied');

    assert.ok(session.canUndoPanelHistory(0), 'the URL change is still undoable');
    session.undoPanelHistory(0);
    assert.deepEqual(session.getSessionUrls(), ['A', 'B', 'C']);
    assert.deepEqual(session.getSessionArrangement(), [...IDENTITY_ARRANGEMENT],
        'the stale swap was not replayed against the new layout');
});

// ── Recording hygiene ────────────────────────────────────────────────────────

test('an action that changed nothing is never recorded', async () => {
    const session = await freshSession(['A', 'B', 'C']);

    session.beginGridAction('url');
    session.updateGridSession(session.getSessionUrls(), session.getSessionFolderMap());
    assert.deepEqual(session.getGridHistory(), []);
    assert.ok(!session.canUndoGridSession());
    assert.ok(!session.canUndoPanelHistory(0));

    // Folder-only changes ARE recorded, and are reported as metadata-only so
    // the runtime can restore them without reloading any iframe.
    session.beginGridAction('folder');
    session.updateGridSession(session.getSessionUrls(), { 1: 'Docs' });
    const restored = session.undoPanelHistory(1);
    assert.deepEqual(restored.changedFolderIndices, [1]);
    assert.deepEqual(restored.changedUrlIndices, [], 'no iframe needs to reload');
});

test('a fresh session starts with an empty history', async () => {
    const session = await freshSession(['A', 'B', 'C']);
    setPanelUrl(session, 0, 'A2');
    assert.equal(session.getGridHistory().length, 1);
    session.initGridSession('lefttall');
    assert.deepEqual(session.getGridHistory(), []);
    assert.ok(!session.canUndoGridSession());
    assert.ok(!session.canRedoPanelHistory(0));
});

// ── Hotswap Chrome preferences ───────────────────────────────────────────────
// Ordering, the runway's on/off + count, and the two opacity values. The
// rendered behavior is proven in boot-smoke.test.js; this pins the model.

async function freshChrome(seed = {}) {
    globalThis.localStorage = makeStorage();
    globalThis.window = { location: { search: '', href: 'https://host.test/index3.html', origin: 'https://host.test' } };
    globalThis.URL = URL;
    Object.entries(seed).forEach(([key, value]) => localStorage.setItem(key, value));
    const chrome = await import('../js/hotswap-chrome.js');
    const { Store } = await import('../js/storage.js');
    ['hotswapTrayOrder', 'hotswapActionOrder', 'hotswapTopCount', 'topShortcutOrder',
        'topShortcutCount', 'quickActionSlots', 'quickActionsEnabled', 'quickActionCount',
        'quickActionOrder', 'ghostOpacity', 'hotswapHoverOpacity'].forEach((key) => Store.invalidate(key));
    return chrome;
}

test('tray order reconciles against the canonical registry, never forking it', async () => {
    const chrome = await freshChrome();
    const { HOTSWAP_ACTIONS } = await import('../js/launch.js');
    // Position-owned actions are presented by the [Position N] button, so the
    // tray — and its Settings list — deliberately do not offer them.
    const everyKey = HOTSWAP_ACTIONS
        .filter((a) => !a.structural).map((action) => action.key);
    assert.ok(HOTSWAP_ACTIONS.some((a) => a.structural === 'positionButton'),
        'the registry still defines them');
    assert.ok(!everyKey.includes('position') && !everyKey.includes('copyPosition'));

    assert.deepEqual(chrome.getHotswapTrayOrder(), everyKey, 'an unset order is registry order');

    // A stored order that is stale in both directions: it names an action that
    // no longer exists and omits ones that were added since.
    chrome.setHotswapTrayOrder(['purge', 'ghost-action-that-was-removed', 'reload']);
    const order = chrome.getHotswapTrayOrder();
    assert.deepEqual(order.slice(0, 2), ['purge', 'reload'], 'the stored preference is honoured');
    assert.equal(order.length, everyKey.length, 'and every real action still appears exactly once');
    assert.deepEqual([...new Set(order)].sort(), [...everyKey].sort());
    assert.deepEqual(chrome.getOrderedHotswapActions().map((action) => action.key), order);
});

test('legacy Top and Deep preferences migrate deterministically once', async () => {
    const seed = {
        hotswap_top_shortcut_order: JSON.stringify(['reload', 'toggle', 'purge', 'shuffle']),
        hotswap_top_shortcut_count: '3',
        hotswap_tray_order: JSON.stringify(['folder', 'star', 'purge', 'reload']),
    };
    const chrome = await freshChrome(seed);
    assert.deepEqual(chrome.getHotswapActionOrder().slice(0, 5),
        ['reload', 'toggle', 'purge', 'folder', 'star']);
    assert.equal(chrome.getTopShortcutCount(), 3);
    assert.equal(localStorage.getItem('hotswap_top_shortcut_count'), '3', 'legacy count remains readable');
    assert.ok(localStorage.getItem('hotswap_tray_order'), 'legacy tray order remains intact');
    const migrated = localStorage.getItem('hotswap_action_order');
    localStorage.setItem('hotswap_tray_order', JSON.stringify(['launchpad']));
    assert.equal(JSON.stringify(chrome.getHotswapActionOrder()), migrated,
        'later legacy writes cannot overwrite migrated state');
});

test('visibility filters before the unified Top cutoff', async () => {
    const chrome = await freshChrome();
    chrome.setTopShortcutOrder(['reload', 'toggle', 'purge', 'shuffle', 'folder', 'star', 'delete']);
    chrome.setTopShortcutCount(6);
    assert.deepEqual(chrome.getActiveTopShortcuts({ purge: false }),
        ['reload', 'toggle', 'shuffle', 'folder', 'star', 'delete']);
});

test('the runway on/off is independent of its count', async () => {
    const chrome = await freshChrome();
    assert.equal(chrome.isQuickActionRunwayEnabled(), false, 'off by default');
    assert.deepEqual(chrome.getActiveQuickActions(), [], 'off means no runway at all');

    chrome.setQuickActionCount(6);
    chrome.setQuickActionOrder(['undo', 'redo', 'star']);
    assert.deepEqual(chrome.getActiveQuickActions(), [], 'still nothing while off');

    chrome.setQuickActionRunwayEnabled(true);
    assert.equal(chrome.getActiveQuickActions().length, 6);
    assert.deepEqual(chrome.getActiveQuickActions().slice(0, 3), ['undo', 'redo', 'star']);

    // Switching off and on again must not have destroyed the configuration —
    // this is the whole reason count and enablement are separate.
    chrome.setQuickActionRunwayEnabled(false);
    chrome.setQuickActionRunwayEnabled(true);
    assert.equal(chrome.getQuickActionCount(), 6);
    assert.deepEqual(chrome.getActiveQuickActions().slice(0, 3), ['undo', 'redo', 'star']);
});

test('the runway count is clamped to 1-8', async () => {
    const chrome = await freshChrome();
    chrome.setQuickActionRunwayEnabled(true);
    chrome.setQuickActionCount(99);
    assert.equal(chrome.getQuickActionCount(), chrome.MAX_QUICK_ACTIONS);
    assert.equal(chrome.MAX_QUICK_ACTIONS, 8);
    chrome.setQuickActionCount(0);
    assert.equal(chrome.getQuickActionCount(), 1, 'zero is no longer a way to express "off"');
    chrome.setQuickActionCount(8);
    assert.equal(chrome.getActiveQuickActions().length, 8);
});

test('runway assignments are unique by construction', async () => {
    const chrome = await freshChrome();
    chrome.setQuickActionRunwayEnabled(true);
    chrome.setQuickActionCount(8);
    chrome.setQuickActionOrder(['undo', 'undo', 'redo', 'undo']);
    const active = chrome.getActiveQuickActions();
    assert.deepEqual(active.slice(0, 2), ['undo', 'redo'], 'duplicates collapse');
    assert.equal(new Set(active).size, active.length, 'no action can occupy two runway slots');
});

test('legacy Quick Action slots migrate once, without destroying the old key', async () => {
    const chrome = await freshChrome({ hotswap_quick_action_slots: JSON.stringify(['star', '', 'reload']) });
    assert.equal(chrome.isQuickActionRunwayEnabled(), true, 'a configured legacy user keeps their runway');
    assert.equal(chrome.getQuickActionCount(), 2, 'empty legacy slots are not counted');
    assert.deepEqual(chrome.getActiveQuickActions(), ['star', 'reload']);
    assert.ok(localStorage.getItem('hotswap_quick_action_slots'), 'the legacy key is left in place');

    // A legacy user who had the feature off (all slots empty) stays off.
    const off = await freshChrome({ hotswap_quick_action_slots: JSON.stringify(['', '', '']) });
    assert.equal(off.isQuickActionRunwayEnabled(), false);
});

test('exactly two opacity preferences, clamped and persisted', async () => {
    const chrome = await freshChrome();
    assert.deepEqual(chrome.getChromeOpacity(), { resting: 12, hover: 100 });

    chrome.setChromeOpacity({ resting: 0 });
    chrome.setChromeOpacity({ hover: 100 });
    assert.deepEqual(chrome.getChromeOpacity(), { resting: 0, hover: 100 }, 'boundaries are usable');
    // The resting key is deliberately the pre-existing one, so an upgrading
    // user keeps the value they already chose.
    assert.equal(localStorage.getItem('hotswap_ghost_opacity'), '0');

    chrome.setChromeOpacity({ resting: 140, hover: -20 });
    assert.deepEqual(chrome.getChromeOpacity(), { resting: 100, hover: 0 });
});

test('Layer 2 is recognised only for our own runtime pages, same-origin', async () => {
    const chrome = await freshChrome();
    assert.equal(chrome.isLayerTwoUrl('index3.html'), true);
    assert.equal(chrome.isLayerTwoUrl('https://host.test/index.html'), true);
    assert.equal(chrome.isLayerTwoUrl('/index2.html?workspace=2'), true);

    assert.equal(chrome.isLayerTwoUrl('https://example.com/index3.html'), false,
        'a third-party page that merely shares a filename is not our runtime');
    assert.equal(chrome.isLayerTwoUrl('https://host.test/other.html'), false);
    assert.equal(chrome.isLayerTwoUrl(''), false);
    assert.equal(chrome.isLayerTwoUrl(null), false);
    assert.equal(chrome.isLayerTwoUrl('not a url at all'), false, 'never throws on junk');
});

test('Top Shortcuts are their own collection, independent of the runway', async () => {
    const chrome = await freshChrome();
    assert.equal(chrome.MAX_TOP_SHORTCUTS, 10,
        'structural controls no longer consume configurable capacity');
    assert.equal('isTopShortcutsEnabled' in chrome, false,
        'no separate enable switch — the Top/Deep Cuts cutoff already expresses this');

    chrome.setTopShortcutOrder(['star', 'shuffle', 'reload']);
    chrome.setTopShortcutCount(2);
    chrome.setQuickActionRunwayEnabled(true);
    chrome.setQuickActionOrder(['undo', 'redo']);
    chrome.setQuickActionCount(2);

    assert.deepEqual(chrome.getActiveTopShortcuts(), ['star', 'shuffle']);
    assert.deepEqual(chrome.getActiveQuickActions(), ['undo', 'redo'],
        'the two collections do not influence each other');

    // Deliberately exposing the same action on both is presentation
    // duplication, which is allowed — behavior is still one implementation.
    chrome.setTopShortcutOrder(['reload', 'star']);
    assert.deepEqual(chrome.getActiveTopShortcuts(), ['reload', 'star']);
    assert.deepEqual(chrome.getActiveQuickActions(), ['undo', 'redo']);

    // A stale stored "disabled" value from before this pass must be ignored —
    // Toolbar Shortcuts are structurally available whenever the toolbar is
    // revealed, controlled only through count and order.
    localStorage.setItem('hotswap_top_shortcuts_enabled', 'false');
    assert.deepEqual(chrome.getActiveTopShortcuts(), ['reload', 'star'],
        'a legacy disabled flag no longer suppresses Toolbar Shortcuts');

    chrome.setTopShortcutCount(99);
    assert.equal(chrome.getTopShortcutCount(), 10);
    chrome.setTopShortcutCount(0);
    assert.equal(chrome.getTopShortcutCount(), 1, 'zero is not a way to express "off" here either');
});

test('the retract delay is forgiving but prompt', async () => {
    const chrome = await freshChrome();
    assert.ok(chrome.CHROME_RETRACT_DELAY_MS >= 750 && chrome.CHROME_RETRACT_DELAY_MS <= 1000,
        `${chrome.CHROME_RETRACT_DELAY_MS}ms is within the intended window`);
});
