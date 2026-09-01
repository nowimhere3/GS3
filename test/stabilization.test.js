import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

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

test('presets data has schema-complete IDs 1 through 9 and empty slots 6-9', async () => {
    const presets = JSON.parse(await readFile(new URL('../presets.json', import.meta.url), 'utf8'));
    assert.equal(presets.length, 9);
    assert.deepEqual(presets.map((preset) => preset.id), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const keys = ['id', 'name', 'panels', 'folderMap', 'lockState', 'layout', 'rowCount', 'streamCount', 'isEmpty', 'savedAt'];
    for (const preset of presets) assert.deepEqual(Object.keys(preset).sort(), [...keys].sort());
    for (const preset of presets.slice(5)) {
        assert.deepEqual(preset, {
            id: preset.id, name: `Preset ${preset.id}`, panels: [], folderMap: {}, lockState: {},
            layout: null, rowCount: 0, streamCount: 0, isEmpty: true, savedAt: null,
        });
    }
});

test('preset normalization extends legacy remote data and leaves complete data unchanged', async () => {
    const { createEmptyPreset, ensureMinimumPresetCount } = await import('../js/presets.js');
    const legacy = Array.from({ length: 5 }, (_, index) => ({
        ...createEmptyPreset(index + 1),
        name: `Remote custom ${index + 1}`,
        savedAt: `2026-01-0${index + 1}T00:00:00.000Z`,
        customMetadata: { preserved: index + 1 },
    }));
    const before = structuredClone(legacy);
    const normalized = ensureMinimumPresetCount(legacy);
    assert.deepEqual(normalized.slice(0, 5), before);
    assert.deepEqual(normalized.slice(5), [6, 7, 8, 9].map(createEmptyPreset));

    const complete = [...normalized];
    assert.equal(ensureMinimumPresetCount(complete), complete);
    assert.deepEqual(complete, normalized);
});

test('initGridSession reaches a supplied layout fallback when no preference exists', async () => {
    globalThis.localStorage = makeStorage();
    globalThis.window = { location: { search: '?workspace=live' } };
    const { initGridSession } = await import('../js/grid-session.js');
    assert.equal(initGridSession('righttall').layout, 'righttall');
    localStorage.setItem('triple_screen_layout', 'lefttall');
    const { Store } = await import('../js/storage.js');
    Store.invalidate('tripleLayout');
    assert.equal(initGridSession('righttall').layout, 'lefttall');
});

test('links database larger than 1 MB round-trips exactly through indexed cassettes', async () => {
    globalThis.localStorage = makeStorage();
    globalThis.alert = () => {};
    const { Store } = await import('../js/storage.js');
    const { setDatabaseStructure, getDatabaseStructure } = await import('../js/state.js');
    const { pushDatabaseToRemote, fetchDatabaseSilently } = await import('../js/sync.js');
    Store.set('gitToken', 'test-token');
    Store.set('gitRepo', 'owner/repo');

    const database = {};
    for (let folder = 0; folder < 40; folder += 1) {
        database[`folder-${folder}`] = [];
        for (let i = 0; i < 500; i += 1) {
            database[`folder-${folder}`].push(`https://example.test/${folder}/${i}/${'x'.repeat(64)}`);
        }
    }
    const raw = JSON.stringify(database, null, 2);
    assert.ok(Buffer.byteLength(raw) > 1024 * 1024);
    setDatabaseStructure(database);

    const files = new Map();
    const writes = [];
    const json = (value, status = 200) => new Response(JSON.stringify(value), {
        status, headers: { 'content-type': 'application/json' },
    });
    globalThis.fetch = async (url, options = {}) => {
        const path = new URL(url).pathname;
        const method = options.method || 'GET';
        const filename = decodeURIComponent(path.split('/contents/')[1] || '');
        if (method === 'PUT' && filename) {
            const body = JSON.parse(options.body);
            files.set(filename, body.content);
            writes.push(filename);
            return json({ content: { sha: `sha-${filename}` } }, 201);
        }
        if (method === 'GET' && filename && files.has(filename)) {
            return json({ sha: `sha-${filename}`, encoding: 'base64', content: files.get(filename) });
        }
        if (method === 'GET' && filename === 'links-index.json') return json({ message: 'not found' }, 404);
        return json({ message: `unhandled ${method} ${path}` }, 500);
    };

    assert.equal(await pushDatabaseToRemote('large database proof', true), true);
    assert.equal(writes.at(-1), 'links-index.json');
    const cassetteNames = writes.slice(0, -1);
    assert.ok(cassetteNames.length > 1);
    for (const name of cassetteNames) {
        const decoded = Buffer.from(files.get(name), 'base64').toString('utf8');
        assert.ok(Buffer.byteLength(decoded) <= 950 * 1024);
    }
    setDatabaseStructure(null);
    assert.equal(await fetchDatabaseSilently(), true);
    assert.deepEqual(getDatabaseStructure(), database);
});
