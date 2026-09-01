/**
 * sync.js — Stream Loop Launchpad
 * ─────────────────────────────────────────────────────────────────────────────
 * All GitHub API communication lives here.
 *
 * Exports (links.json):
 *   pushDatabaseToRemote(commitMessage)  — PUT links.json to GitHub
 *   fetchDatabaseSilently()              — GET links.json quietly on load
 *   fetchDatabaseWithUI()               — GET links.json with alert feedback
 *   reorderDatabase(listEl, updateDropdownFn) — reorder keys then push
 *
 * Exports (presets.json):
 *   pushPresetsToRemote(commitMessage)   — PUT presets.json to GitHub
 *   fetchPresetsSilently()               — GET presets.json quietly on load
 *   fetchPresetsWithUI()                — GET presets.json with alert feedback
 *
 * This module only ever talks to GitHub and reads/writes the raw structures
 * in state.js — it doesn't know what a "workspace" or "preset summary" is.
 * That business logic lives in presets.js, which calls these functions.
 *
 * Dependencies:
 *   Store          → reads gitToken, gitRepo
 *   getDatabaseStructure / setDatabaseStructure / setDatabaseSha
 *   getPresetsStructure / setPresetsStructure / getPresetsSha / setPresetsSha
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Store } from './storage.js';
import {
    getDatabaseStructure, setDatabaseStructure, setDatabaseSha,
    getPresetsStructure, setPresetsStructure,
    getPresetsSha, setPresetsSha,
} from './state.js';

const LINKS_FILE   = 'links.json';
const LINKS_INDEX_FILE = 'links-index.json';
const PRESETS_FILE = 'presets.json';
const CASSETTE_MAX_BYTES = 950 * 1024;
let _linksIndexSha = null;

/** Encode a JS value to base64 for GitHub API */
function _encodeContent(value) {
    return btoa(unescape(encodeURIComponent(JSON.stringify(value, null, 2))));
}

/** Decode base64 content from GitHub API response */
function _decodeContent(base64Content) {
    return JSON.parse(decodeURIComponent(escape(atob(base64Content))));
}

/** Build the GitHub API URL for a given file in the repo root */
function _apiUrl(filename) {
    const repo = Store.get('gitRepo');
    return `https://api.github.com/repos/${repo}/contents/${filename}`;
}

function _packDatabaseCassettes(db) {
    const cassettes = [];
    let current = {};
    for (const [key, value] of Object.entries(db)) {
        const record = { [key]: value };
        if (new TextEncoder().encode(JSON.stringify(record, null, 2)).length > CASSETTE_MAX_BYTES) {
            throw new Error(`Folder "${key}" is too large for one cassette; no data was written.`);
        }
        const candidate = { ...current, [key]: value };
        if (Object.keys(current).length > 0 && new TextEncoder().encode(JSON.stringify(candidate, null, 2)).length > CASSETTE_MAX_BYTES) {
            cassettes.push(current);
            current = record;
        } else {
            current = candidate;
        }
    }
    if (Object.keys(current).length > 0 || cassettes.length === 0) cassettes.push(current);
    return cassettes;
}

async function _putContentsFile(filename, value, message, sha = null) {
    const body = { message, content: _encodeContent(value) };
    if (sha) body.sha = sha;
    const res = await fetch(_apiUrl(filename), {
        method: 'PUT', headers: _headers(), body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`GitHub rejected ${filename} (${res.status} ${res.statusText})`);
    return res.json();
}

async function _loadIndexShaIfNeeded() {
    if (_linksIndexSha) return;
    const res = await fetch(_apiUrl(LINKS_INDEX_FILE), { headers: _headers(), cache: 'no-store' });
    if (res.ok) {
        _linksIndexSha = (await res.json()).sha;
    } else if (res.status !== 404) {
        throw new Error(`Could not inspect ${LINKS_INDEX_FILE} before publishing.`);
    }
}

async function _fetchDatabaseFromRemote() {
    const indexRes = await fetch(_apiUrl(LINKS_INDEX_FILE), { headers: _headers(), cache: 'no-store' });
    if (indexRes.ok) {
        const indexData = await indexRes.json();
        const index = _decodeContent(indexData.content);
        if (index.version !== 1 || !Array.isArray(index.cassettes)) throw new Error('Invalid links cassette index.');
        const parts = await Promise.all(index.cassettes.map(async (filename) => {
            const res = await fetch(_apiUrl(filename), { headers: _headers(), cache: 'no-store' });
            if (!res.ok) throw new Error(`Missing cassette ${filename}.`);
            return _decodeContent((await res.json()).content);
        }));
        const db = {};
        parts.forEach((part) => Object.entries(part).forEach(([key, value]) => { db[key] = value; }));
        _linksIndexSha = indexData.sha;
        setDatabaseSha(indexData.sha);
        return db;
    }
    if (indexRes.status !== 404) throw new Error(`Could not read ${LINKS_INDEX_FILE}.`);

    // Backward compatibility: repositories that have not migrated yet still
    // load their single legacy links.json unchanged.
    const legacyRes = await fetch(_apiUrl(LINKS_FILE), { headers: _headers(), cache: 'no-store' });
    if (!legacyRes.ok) throw new Error(`Could not read ${LINKS_FILE}.`);
    const legacy = await legacyRes.json();
    setDatabaseSha(legacy.sha);
    return _decodeContent(legacy.content);
}

/** Build auth headers */
function _headers() {
    return {
        'Authorization': `token ${Store.get('gitToken')}`,
        'Content-Type': 'application/json',
    };
}

/**
 * Push the current databaseStructure to GitHub.
 * Alerts on success or failure.
 * @param {string} commitMessage
 * @param {boolean} [silent=false] — if true, suppresses the success alert
 */
export async function pushDatabaseToRemote(commitMessage, silent = false) {
    const token = Store.get('gitToken');
    const repo  = Store.get('gitRepo');
    const db    = getDatabaseStructure();

    if (!token || !repo || !db) return;

    try {
        await _loadIndexShaIfNeeded();
        const cassettes = _packDatabaseCassettes(db);
        const generation = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        const filenames = cassettes.map((_, index) =>
            `cassette-${generation}-${String(index + 1).padStart(3, '0')}.json`
        );

        // Immutable generation files are written first. The live index is
        // updated only after every cassette succeeds, so readers can never be
        // directed at a partial generation.
        for (let index = 0; index < cassettes.length; index += 1) {
            await _putContentsFile(filenames[index], cassettes[index], `${commitMessage} (cassette ${index + 1}/${cassettes.length})`);
        }
        const index = { version: 1, generation, cassettes: filenames };
        const result = await _putContentsFile(LINKS_INDEX_FILE, index, `${commitMessage} (publish cassette index)`, _linksIndexSha);
        _linksIndexSha = result.content.sha;
        setDatabaseSha(result.content.sha);
        if (!silent) alert('Cloud Repository synchronized successfully! Links integrated.');
        return true;
    } catch (err) {
        alert('Cloud Synchronization failed: ' + err.message);
        return false;
    }
}

/**
 * Silently fetch links.json on page load.
 * No alerts — fails quietly if credentials missing or network unavailable.
 * Calls updateDropdownFn() if provided after loading.
 * @param {Function} [updateDropdownFn]
 */
export async function fetchDatabaseSilently(updateDropdownFn) {
    const token = Store.get('gitToken');
    const repo  = Store.get('gitRepo');
    if (!token || !repo) return false;

    try {
        setDatabaseStructure(await _fetchDatabaseFromRemote());
        if (typeof updateDropdownFn === 'function') updateDropdownFn();
        return true;
    } catch (e) {
        console.error('[sync] fetchDatabaseSilently failed:', e);
    }

    return false;
}

/**
 * Fetch links.json with full UI feedback (used by Connect button).
 * Calls updateDropdownFn() on success.
 * @param {Function} updateDropdownFn
 * @returns {boolean} true on success
 */
export async function fetchDatabaseWithUI(updateDropdownFn) {
    const token = Store.get('gitToken');
    const repo  = Store.get('gitRepo');

    if (!token || !repo) {
        alert('Please populate both Token and Repository target strings.');
        return false;
    }

    try {
        setDatabaseStructure(await _fetchDatabaseFromRemote());
        if (typeof updateDropdownFn === 'function') updateDropdownFn();
        alert('Database synchronized successfully! Directory pools populated.');
        return true;
    } catch (err) {
        alert('Sync Error: ' + err.message);
        return false;
    }
}

/**
 * Reorder folder keys in databaseStructure to match current DOM order,
 * then push to GitHub.
 * @param {HTMLElement} listEl — the folder-manager-list DOM element
 * @param {Function} updateDropdownFn
 */
export async function reorderDatabase(listEl, updateDropdownFn) {
    const db = getDatabaseStructure();
    if (!listEl || !db) return;

    const newOrder = [...listEl.querySelectorAll('.folder-manager-row')].map(r => r.dataset.folder);
    const reordered = {};
    newOrder.forEach(key => { if (db[key] !== undefined) reordered[key] = db[key]; });
    setDatabaseStructure(reordered);

    if (typeof updateDropdownFn === 'function') updateDropdownFn();
    await pushDatabaseToRemote('Reordered folders via drag-and-drop', true);
}

/**
 * Push the current presetsStructure to GitHub.
 * @param {string} commitMessage
 * @param {boolean} [silent=false] — if true, suppresses the success alert
 * @returns {boolean} true on success
 */
export async function pushPresetsToRemote(commitMessage, silent = false) {
    const token   = Store.get('gitToken');
    const repo    = Store.get('gitRepo');
    const presets = getPresetsStructure();

    if (!token || !repo || !presets) return false;

    const updatedContent = _encodeContent(presets);

    try {
        const res = await fetch(_apiUrl(PRESETS_FILE), {
            method: 'PUT',
            headers: _headers(),
            body: JSON.stringify({
                message: commitMessage,
                content: updatedContent,
                sha: getPresetsSha(),
            }),
        });

        if (res.ok) {
            const resData = await res.json();
            setPresetsSha(resData.content.sha);
            if (!silent) alert('Presets synchronized successfully!');
            return true;
        }
        throw new Error('Push rejected. Double-check branch states or credential authorizations.');
    } catch (err) {
        alert('Preset Sync failed: ' + err.message);
        return false;
    }
}

/**
 * Silently fetch presets.json on page load. No alerts — fails quietly if
 * credentials missing, the file doesn't exist yet, or network unavailable.
 * @param {Function} [onLoaded] — called with the decoded presets array on success
 * @returns {boolean} true on success
 */
export async function fetchPresetsSilently(onLoaded) {
    const token = Store.get('gitToken');
    const repo  = Store.get('gitRepo');
    if (!token || !repo) return false;

    try {
        const res = await fetch(_apiUrl(PRESETS_FILE), { headers: _headers(), cache: 'no-store' });
        if (res.ok) {
            const data = await res.json();
            setPresetsSha(data.sha);
            const decoded = _decodeContent(data.content);
            setPresetsStructure(decoded);
            if (typeof onLoaded === 'function') onLoaded(decoded);
            return true;
        }
        if (res.status !== 404) {
            console.error('[sync] fetchPresetsSilently: non-OK response', res.status, res.statusText);
        }
    } catch (e) {
        console.error('[sync] fetchPresetsSilently failed:', e);
    }

    return false;
}

/**
 * Fetch presets.json with full UI feedback.
 * @param {Function} [onLoaded] — called with the decoded presets array on success
 * @returns {boolean} true on success
 */
export async function fetchPresetsWithUI(onLoaded) {
    const token = Store.get('gitToken');
    const repo  = Store.get('gitRepo');

    if (!token || !repo) {
        alert('Please connect your GitHub credentials first (Settings page).');
        return false;
    }

    try {
        const res = await fetch(_apiUrl(PRESETS_FILE), { headers: _headers(), cache: 'no-store' });
        if (!res.ok) throw new Error('Could not find or access presets.json in root repository area.');

        const data = await res.json();
        setPresetsSha(data.sha);
        const decoded = _decodeContent(data.content);
        setPresetsStructure(decoded);
        if (typeof onLoaded === 'function') onLoaded(decoded);
        return true;
    } catch (err) {
        alert('Preset Sync Error: ' + err.message);
        return false;
    }
}
