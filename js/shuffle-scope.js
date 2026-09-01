/** Builder Shuffle Scope — a preference, never row provenance or Workspace data. */
import { Store } from './storage.js';
import { getDatabaseStructure } from './state.js';

export function setShuffleScopeFolder(folder) {
    Store.set('builderShuffleFolder', folder || '');
}

export function resolveShuffleScope(db) {
    if (!db) return '';
    const stored = Store.get('builderShuffleFolder') || '';
    if (stored && Object.hasOwn(db, stored)) return stored;
    return Object.keys(db)[0] || '';
}

export function getShuffleScopeFolder() {
    return resolveShuffleScope(getDatabaseStructure());
}

/** Plan one mixed generation. Excess rows remain unassigned by this plan. */
export function planShuffleAllFolders({ unlockedIdxs, availableFolders, maxPerFolder = 2, rng = Math.random }) {
    const usage = {};
    const slotFolders = {};
    const unfilled = [];

    unlockedIdxs.forEach((index) => {
        const eligible = availableFolders.filter((folder) => (usage[folder] || 0) < maxPerFolder);
        if (eligible.length === 0) {
            unfilled.push(index);
            return;
        }
        const chosen = eligible[Math.floor(rng() * eligible.length)];
        usage[chosen] = (usage[chosen] || 0) + 1;
        slotFolders[index] = chosen;
    });

    return { slotFolders, unfilled };
}
