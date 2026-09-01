import test from 'node:test';
import assert from 'node:assert/strict';

function makeStorage() {
    const values = new Map();
    return {
        getItem: (key) => values.has(key) ? values.get(key) : null,
        setItem: (key, value) => values.set(key, String(value)),
        removeItem: (key) => values.delete(key),
        clear: () => values.clear(),
    };
}

globalThis.localStorage = makeStorage();
const { Store } = await import('../js/storage.js');
const { resolveShuffleScope, setShuffleScopeFolder, planShuffleAllFolders } =
    await import('../js/shuffle-scope.js');

test('Builder Shuffle Scope resolves stored preference and deterministic deletion fallback', () => {
    Store.invalidate('builderShuffleFolder');
    assert.equal(resolveShuffleScope({ A: [], B: [] }), 'A');
    setShuffleScopeFolder('B');
    assert.equal(resolveShuffleScope({ A: [], B: [] }), 'B');
    assert.equal(resolveShuffleScope({ A: [], C: [] }), 'A');
    assert.equal(resolveShuffleScope(null), '');
});

test('Shuffle All planner enforces hard max-2 and deterministically leaves excess rows', () => {
    const plan = planShuffleAllFolders({
        unlockedIdxs: [0, 1, 2, 3, 4, 5], availableFolders: ['A', 'B'], rng: () => 0,
    });
    assert.deepEqual(plan.unfilled, [4, 5]);
    assert.deepEqual(Object.keys(plan.slotFolders).map(Number), [0, 1, 2, 3]);
    const counts = Object.values(plan.slotFolders).reduce((out, folder) => {
        out[folder] = (out[folder] || 0) + 1;
        return out;
    }, {});
    assert.ok(Object.values(counts).every((count) => count <= 2));
});

test('Shuffle All planner never exceeds two uses across repeated deterministic generations', () => {
    for (let seed = 0; seed < 50; seed += 1) {
        let n = seed;
        const plan = planShuffleAllFolders({
            unlockedIdxs: [0, 1, 2, 3, 4, 5], availableFolders: ['A', 'B', 'C', 'D'],
            rng: () => ((n = (n * 1664525 + 1013904223) >>> 0) / 2 ** 32),
        });
        const counts = Object.values(plan.slotFolders).reduce((out, folder) => {
            out[folder] = (out[folder] || 0) + 1;
            return out;
        }, {});
        assert.equal(plan.unfilled.length, 0);
        assert.ok(Object.values(counts).every((count) => count <= 2));
    }
});
