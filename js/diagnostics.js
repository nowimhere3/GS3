/**
 * RUNTIME MEMORY RM-1 — StreamLoop Tier 2 current-truth snapshot.
 *
 * One on-demand reader, one structured snapshot, one Markdown renderer.
 * This module observes existing state and may perform one bounded GitHub GET.
 * It never writes product state, retries, repairs, navigates, or records a
 * diagnostic history.
 */

import { Store } from './storage.js';
import { getPresetsSha, getPresetsStructure } from './state.js';
import {
    getSessionArrangement, getSessionLayout, getSessionPanels, getGridHistory,
} from './grid-session.js';
import { getPanelRuntimeLayer, isEmptyPanel, isUrlPanel, isWorkspacePanel } from './panels.js';
import { listPositions, resolveSlotAtPosition } from './positions.js';

export const RM_PROTOCOL = 'RM-1';
export const SNAPSHOT_SCHEMA = 1;
export const PROJECT_SLUG = 'streamloop';
export const FRESHNESS_HORIZON_MS = 10 * 60 * 1000;
export const SNAPSHOT_HARD_CAP_BYTES = 40 * 1024;

const TOKEN_PATTERNS = [
    /\bgh[pousr]_[A-Za-z0-9_]{12,}\b/i,
    /\bgithub_pat_[A-Za-z0-9_]{12,}\b/i,
    /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/i,
    /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
    /\bya29\.[A-Za-z0-9_-]{8,}\b/i,
    /\bAIza[A-Za-z0-9_-]{20,}\b/,
    /\b(?:access|refresh|oauth)[_-]?token\s*[:=]\s*\S+/i,
    /\b[A-Fa-f0-9]{32,}\b/,
    /\b[A-Za-z0-9+/]{40,}={0,2}\b/,
];

export function isTokenShaped(value) {
    const text = String(value ?? '');
    return TOKEN_PATTERNS.some((pattern) => pattern.test(text));
}

export function safeScalar(value, { maxLength = 160 } = {}) {
    if (value === null || value === undefined || value === '') return 'unknown';
    if (typeof value === 'boolean' || typeof value === 'number') return String(value);
    const text = String(value).replace(/[\r\n\t]+/g, ' ').trim();
    if (!text || isTokenShaped(text)) return '[redacted]';
    if (/^https?:\/\//i.test(text)) return sanitizeUrl(text).slice(0, maxLength);
    return text.slice(0, maxLength);
}

export async function safeShortHash(value) {
    const bytes = new TextEncoder().encode(String(value ?? ''));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 8);
}

export function sanitizeUrl(value) {
    try {
        const parsed = new URL(String(value));
        if (!/^https?:$/.test(parsed.protocol)) return 'unknown (unsupported URL scheme)';
        const safeHostname = parsed.hostname.split('.').map((label) => (
            isTokenShaped(label) || label.length > 63 ? '[redacted]' : label
        )).join('.');
        const safeHost = `${safeHostname}${parsed.port ? `:${parsed.port}` : ''}`;
        const segments = parsed.pathname.split('/').map((segment) => {
            if (!segment) return segment;
            const decoded = decodeURIComponent(segment);
            return isTokenShaped(decoded) || decoded.length > 64 || /^[A-Za-z0-9_-]{32,}$/.test(decoded)
                ? '[redacted]'
                : encodeURIComponent(decoded);
        });
        return `${parsed.protocol}//${safeHost}${segments.join('/')}`;
    } catch {
        return 'unknown (invalid URL)';
    }
}

function observed(value, reason) {
    const safe = safeScalar(value);
    if (safe === 'unknown') return { value: 'unknown', provenance: 'Observed', reason: safeScalar(reason || 'not available') };
    return { value: safe, provenance: 'Observed' };
}

function derived(value, reason) {
    const safe = safeScalar(value);
    if (safe === 'unknown') return { value: 'unknown', provenance: 'Derived', reason: safeScalar(reason || 'insufficient observed evidence') };
    return { value: safe, provenance: 'Derived' };
}

function unknown(reason, provenance = 'Observed') {
    return { value: 'unknown', provenance, reason: safeScalar(reason || 'not available') };
}

function display(field) {
    if (!field || field.value === 'unknown') return `unknown (${safeScalar(field?.reason || 'not available')})`;
    return safeScalar(field.value);
}

function formatIsoWithOffset(dateValue) {
    const date = new Date(dateValue);
    if (!Number.isFinite(date.getTime())) return null;
    const offsetMinutes = -date.getTimezoneOffset();
    const sign = offsetMinutes >= 0 ? '+' : '-';
    const absolute = Math.abs(offsetMinutes);
    const pad = (number, width = 2) => String(number).padStart(width, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
        + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
        + `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}

export function evaluateFreshness(generatedAt, now = new Date()) {
    const ageMs = new Date(now).getTime() - new Date(generatedAt).getTime();
    if (!Number.isFinite(ageMs)) return { status: 'STALE', ageMs: null };
    return { status: ageMs >= 0 && ageMs < FRESHNESS_HORIZON_MS ? 'FRESH' : 'STALE', ageMs: Math.max(0, ageMs) };
}

function formatAge(ageMs) {
    if (!Number.isFinite(ageMs)) return 'age unknown';
    if (ageMs < 60_000) return `${Math.floor(ageMs / 1000)}s old`;
    return `${Math.floor(ageMs / 60_000)}m old`;
}

function safeSha(value) {
    const text = String(value || '');
    return /^[a-f0-9]{7,64}$/i.test(text) ? text.slice(0, 8) : 'unknown';
}

export async function observeRemotePresetsSha({ repo, token, fetchFn = globalThis.fetch, timeoutMs = 4500 } = {}) {
    if (!repo || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) return { sha: null, reason: 'repository not configured' };
    if (typeof fetchFn !== 'function') return { sha: null, reason: 'fetch unavailable' };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.min(Math.max(timeoutMs, 1), 5000));
    try {
        const headers = { Accept: 'application/vnd.github+json' };
        if (token) headers.Authorization = `token ${token}`;
        const response = await fetchFn(`https://api.github.com/repos/${repo}/contents/presets.json`, {
            method: 'GET', headers, cache: 'no-store', signal: controller.signal,
        });
        if (!response.ok) return { sha: null, reason: `HTTP ${response.status}` };
        const body = await response.json();
        if (typeof body?.sha !== 'string') return { sha: null, reason: 'response SHA missing' };
        return { sha: body.sha, reason: null };
    } catch (error) {
        return { sha: null, reason: error?.name === 'AbortError' ? 'timeout' : 'request failed' };
    } finally {
        clearTimeout(timeout);
    }
}

function detectExecutor(pathname) {
    if (/\/index3\.html$/i.test(pathname)) return 'Grid';
    if (/\/index2\.html$/i.test(pathname)) return 'Solo';
    if (/\/settings\.html$/i.test(pathname)) return 'Settings';
    if (/\/(?:index\.html)?$/i.test(pathname)) return 'Workspace/Design-Time';
    return 'unknown';
}

function summarizeHistory(history) {
    const actions = Array.isArray(history) ? history.slice(0, 50) : [];
    return {
        undo: actions.filter((action) => Object.values(action.slotState || {}).includes('applied')).length,
        redo: actions.filter((action) => Object.values(action.slotState || {}).includes('undone')).length,
    };
}

function observeNestedHistory(entries) {
    const source = Array.isArray(entries) && entries.length
        ? entries
        : [{ target: 'L2', value: 'unknown', reason: 'nested history is not exposed without instrumentation' }];
    return source.slice(0, 4).map((entry) => ({
        target: safeScalar(entry?.target),
        value: safeScalar(entry?.value),
        reason: safeScalar(entry?.reason || 'not available'),
        provenance: 'Observed',
    }));
}

async function identifyPanel(panel, slotIndex) {
    const panelIdentity = `slot-${slotIndex + 1}`; // canonical implementation identity; no diagnostic UUID
    if (!panel || isEmptyPanel(panel)) return { panel: panelIdentity, content: 'empty', runtime: 'none', nested: 'no' };
    const layer = getPanelRuntimeLayer(panel);
    if (layer === 2) {
        const kind = isWorkspacePanel(panel) ? 'grid' : safeScalar(panel.options?.runtime?.kind || 'unknown');
        return { panel: panelIdentity, content: `runtime:${kind}`, runtime: kind, nested: 'yes' };
    }
    if (isUrlPanel(panel)) return {
        panel: panelIdentity,
        content: `web:${await safeShortHash(panel.source || '')}`,
        runtime: 'none',
        nested: 'no',
    };
    return { panel: panelIdentity, content: `type:${safeScalar(panel.type)}`, runtime: 'none', nested: 'no' };
}

/** Build the allowlisted structured snapshot from already-observed facts. */
export function createDiagnosticSnapshot(observations, { generatedAt = new Date(), now = generatedAt } = {}) {
    const generated = formatIsoWithOffset(generatedAt) || formatIsoWithOffset(new Date());
    const freshness = evaluateFreshness(generated, now);
    const memoryShaRaw = observations?.persistence?.memoryPresetSha || null;
    const remoteShaRaw = observations?.persistence?.remotePresetSha || null;
    const projectionComparable = observations?.workspace?.canonicalName && observations?.workspace?.visibleLabel;
    const projection = projectionComparable
        ? (String(observations.workspace.canonicalName).trim() === String(observations.workspace.visibleLabel).trim() ? 'MATCH' : 'MISMATCH')
        : 'unknown';
    const shaComparison = memoryShaRaw && remoteShaRaw
        ? (memoryShaRaw === remoteShaRaw ? 'MATCH' : 'MISMATCH')
        : 'unknown';

    const verdict = [];
    if (projection === 'MISMATCH') verdict.push('WARN Workspace: canonical active name differs from visible selector label');
    if (shaComparison === 'MISMATCH') verdict.push('WARN Preset Sync: in-memory presets SHA differs from observed remote SHA');
    if (verdict.length === 0) verdict.push('No anomalies detected by implemented Tier 2 checks.');

    return {
        protocol: RM_PROTOCOL,
        schema: SNAPSHOT_SCHEMA,
        generatedAt: generated,
        freshness: freshness.status,
        ageMs: freshness.ageMs,
        project: PROJECT_SLUG,
        header: {
            origin: observed(observations?.origin, 'browser origin unavailable'),
            page: observed(observations?.page, 'page unavailable'),
            redaction: observed('default'),
            build: observations?.build ? observed(observations.build) : unknown('no runtime build identity exists'),
        },
        verdict: verdict.map((message) => ({ message: safeScalar(message), provenance: 'Derived' })),
        runtime: {
            executor: observed(observations?.runtime?.executor, 'executor unavailable'),
            layout: observations?.runtime?.layout ? observed(observations.runtime.layout) : unknown('not a live Grid Runtime'),
            nestedRuntimeCount: observations?.runtime?.nestedRuntimeCount !== undefined
                ? observed(observations.runtime.nestedRuntimeCount) : unknown('not observable on this page'),
            masterLayerTarget: observations?.runtime?.masterLayerTarget
                ? derived(observations.runtime.masterLayerTarget) : unknown('not observable on this page', 'Derived'),
            nestedHosts: observations?.runtime?.nestedHosts
                ? observed(observations.runtime.nestedHosts) : unknown('not observable on this page'),
        },
        positions: (observations?.positions || []).slice(0, 4).map((position) => ({
            position: observed(position.position), panel: observed(position.panel), content: observed(position.content),
            runtime: observed(position.runtime), nested: observed(position.nested),
        })),
        history: {
            l1Undo: observations?.history?.l1Undo !== undefined ? observed(observations.history.l1Undo) : unknown('not observable on this page'),
            l1Redo: observations?.history?.l1Redo !== undefined ? observed(observations.history.l1Redo) : unknown('not observable on this page'),
            nested: observeNestedHistory(observations?.history?.nested),
        },
        workspace: {
            canonicalId: observed(observations?.workspace?.canonicalId, 'active workspace id unavailable'),
            canonicalName: observed(observations?.workspace?.canonicalName, 'active workspace name unavailable'),
            visibleLabel: observed(observations?.workspace?.visibleLabel, 'visible selector label unavailable'),
            projection: projection === 'unknown' ? unknown('canonical name or visible label unavailable', 'Derived') : derived(projection),
        },
        persistence: {
            origin: observed(observations?.origin, 'browser origin unavailable'),
            localStorage: observed(observations?.persistence?.localStorage, 'local persistence unavailable'),
            repo: observed(observations?.persistence?.repo, 'repository not configured'),
            branch: observations?.persistence?.branch ? observed(observations.persistence.branch) : unknown('not configured or observed'),
            tokenConfigured: observed(observations?.persistence?.tokenConfigured ?? 'no'),
            memoryPresetSha: memoryShaRaw && safeSha(memoryShaRaw) !== 'unknown' ? observed(safeSha(memoryShaRaw)) : unknown('in-memory presets SHA unavailable'),
            remotePresetSha: remoteShaRaw && safeSha(remoteShaRaw) !== 'unknown'
                ? observed(safeSha(remoteShaRaw)) : unknown(observations?.persistence?.remoteReason || 'remote SHA unavailable'),
            shaComparison: shaComparison === 'unknown' ? unknown('both observed SHAs are required', 'Derived') : derived(shaComparison),
            lastFailedHttpStatus: unknown('HTTP failure history is not retained'),
        },
    };
}

/** Observe the current browser document and existing GS3 state, then do one bounded read-only SHA GET. */
export async function generateBrowserDiagnosticSnapshot({ fetchFn = globalThis.fetch, now = new Date() } = {}) {
    const location = globalThis.window?.location;
    const origin = location?.origin || null;
    const page = location?.pathname || null;
    const executor = detectExecutor(page || '');
    const observations = {
        origin,
        page,
        runtime: { executor },
        positions: [],
        history: {},
        workspace: {},
        persistence: {},
    };

    try {
        localStorage.length;
        observations.persistence.localStorage = 'available';
    } catch {
        observations.persistence.localStorage = null;
    }
    try {
        observations.workspace.canonicalId = Store.get('activeWorkspaceId') || 'live';
        if (observations.workspace.canonicalId === 'live') observations.workspace.canonicalName = 'Live Builder';
        else {
            const presets = getPresetsStructure();
            observations.workspace.canonicalName = Array.isArray(presets)
                ? presets.find((preset) => String(preset?.id) === String(observations.workspace.canonicalId))?.name || null
                : null;
        }
    } catch { /* leave canonical fields unknown */ }
    try {
        const visibleText = globalThis.document
            ?.querySelector('#workspace-tabs .workspace-tab.active .workspace-tab-name')?.textContent?.trim() || null;
        observations.workspace.visibleLabel = visibleText?.replace(/^📁\s*/u, '') || null;
    } catch { /* leave projection unknown */ }
    try {
        observations.persistence.repo = Store.get('gitRepo') || null;
        const token = Store.get('gitToken') || '';
        observations.persistence.tokenConfigured = token ? 'yes' : 'no';
        observations.persistence.memoryPresetSha = getPresetsSha();
        const remote = await observeRemotePresetsSha({ repo: observations.persistence.repo, token, fetchFn });
        observations.persistence.remotePresetSha = remote.sha;
        observations.persistence.remoteReason = remote.reason;
    } catch {
        observations.persistence.remoteReason = 'probe setup failed';
    }

    if (executor === 'Grid') {
        try {
            const layout = getSessionLayout();
            const arrangement = getSessionArrangement();
            const panels = getSessionPanels();
            observations.runtime.layout = layout;
            const nestedHosts = [];
            for (const position of listPositions(layout)) {
                const slotIndex = resolveSlotAtPosition(layout, arrangement, position);
                if (slotIndex === null) continue;
                const identity = await identifyPanel(panels[slotIndex], slotIndex);
                observations.positions.push({ position: `P${position}`, ...identity });
                if (identity.nested === 'yes') nestedHosts.push(`P${position}`);
            }
            observations.runtime.nestedRuntimeCount = nestedHosts.length;
            observations.runtime.nestedHosts = nestedHosts.length ? nestedHosts.join(', ') : 'none';
            observations.runtime.masterLayerTarget = globalThis.document
                ?.querySelector('#master-layer-selector .hotswap-layer-btn.active')?.textContent?.trim() || null;
            const history = summarizeHistory(getGridHistory());
            observations.history.l1Undo = history.undo;
            observations.history.l1Redo = history.redo;
            observations.history.nested = nestedHosts.map((target) => ({
                target: `L2-${target}`, value: 'unknown', reason: 'nested history is not exposed without instrumentation',
            }));
        } catch {
            observations.runtime.nestedHosts = null;
        }
    }

    return createDiagnosticSnapshot(observations, { generatedAt: now, now });
}

export function renderDiagnosticMarkdown(snapshot, { now = new Date() } = {}) {
    const freshness = evaluateFreshness(snapshot.generatedAt, now);
    const lines = [
        '# STREAMLOOP DIAGNOSTICS',
        '',
        `${snapshot.protocol} · snapshot schema ${snapshot.schema}`,
        '',
        '## HEADER',
        '',
        `generated ${snapshot.generatedAt} · ${freshness.status} · ${formatAge(freshness.ageMs)}`,
        `project ${snapshot.project}`,
        `origin ${display(snapshot.header.origin)} [${snapshot.header.origin.provenance}]`,
        `page ${display(snapshot.header.page)} [${snapshot.header.page.provenance}]`,
        `build ${display(snapshot.header.build)} [${snapshot.header.build.provenance}]`,
        `redaction ${display(snapshot.header.redaction)}`,
        '',
        '## VERDICT',
        '',
        ...snapshot.verdict.map((entry) => `${entry.message} [${entry.provenance}]`),
        '',
        '## RUNTIME',
        '',
        `executor ${display(snapshot.runtime.executor)} [${snapshot.runtime.executor.provenance}]`,
        `outer Grid layout ${display(snapshot.runtime.layout)} [${snapshot.runtime.layout.provenance}]`,
        `nested Runtime count ${display(snapshot.runtime.nestedRuntimeCount)} [${snapshot.runtime.nestedRuntimeCount.provenance}]`,
        `effective Master Layer target ${display(snapshot.runtime.masterLayerTarget)} [${snapshot.runtime.masterLayerTarget.provenance}]`,
        `truthful nested hosts ${display(snapshot.runtime.nestedHosts)} [${snapshot.runtime.nestedHosts.provenance}]`,
        '',
        '## POSITIONS',
        '',
    ];
    if (snapshot.positions.length === 0) lines.push('unknown (no live Grid Runtime on this page) [Observed]');
    else snapshot.positions.forEach((position) => lines.push(
        `${display(position.position)}  panel ${display(position.panel)}  ${display(position.content)}  runtime:${display(position.runtime)}  nested=${display(position.nested)} [Observed]`
    ));
    lines.push('', '## HISTORY', '',
        `L1  undo ${display(snapshot.history.l1Undo)} · redo ${display(snapshot.history.l1Redo)} [Observed]`);
    snapshot.history.nested.slice(0, 4).forEach((entry) => lines.push(
        `${safeScalar(entry.target)}  ${entry.value === 'unknown' ? `unknown (${safeScalar(entry.reason)})` : safeScalar(entry.value)} [Observed]`
    ));
    lines.push('', '## WORKSPACE / PRESET PROJECTION', '',
        `canonical active id ${display(snapshot.workspace.canonicalId)} [${snapshot.workspace.canonicalId.provenance}]`,
        `canonical active name ${display(snapshot.workspace.canonicalName)} [${snapshot.workspace.canonicalName.provenance}]`,
        `visible selector label ${display(snapshot.workspace.visibleLabel)} [${snapshot.workspace.visibleLabel.provenance}]`,
        `projection ${display(snapshot.workspace.projection)} [${snapshot.workspace.projection.provenance}]`,
        '', '## PERSISTENCE', '',
        `browser origin ${display(snapshot.persistence.origin)} [Observed]`,
        `local persistence ${display(snapshot.persistence.localStorage)} [Observed]`,
        `repo ${display(snapshot.persistence.repo)} [Observed]`,
        `branch ${display(snapshot.persistence.branch)} [Observed]`,
        `token configured ${display(snapshot.persistence.tokenConfigured)} [Observed]`,
        `presets SHA in memory ${display(snapshot.persistence.memoryPresetSha)} [Observed]`,
        `remote presets SHA ${display(snapshot.persistence.remotePresetSha)} [Observed]`,
        `SHA comparison ${display(snapshot.persistence.shaComparison)} [Derived]`,
        `last failed HTTP status ${display(snapshot.persistence.lastFailedHttpStatus)} [Observed]`,
        '', '## REFERENCES', '',
        'Diagnostics/CONTRACT.md',
        'Docs ANCHOR/004-RUNTIME-SESSION.md',
        'Docs ANCHOR/007-PANEL-IDENTITY.md',
        'Docs ANCHOR/011-HOTSWAP-CHROME.md',
        ''
    );
    let markdown = lines.join('\n');
    if (new TextEncoder().encode(markdown).length > SNAPSHOT_HARD_CAP_BYTES) {
        markdown = `${lines.slice(0, lines.indexOf('## POSITIONS')).join('\n')}\n\n## TRUNCATION\n\nTRUNCATED: lower-priority sections exceeded the 40 KB hard cap.\n`;
    }
    return markdown;
}

export async function generateDiagnosticArtifact(options = {}) {
    const snapshot = await generateBrowserDiagnosticSnapshot(options);
    return { snapshot, markdown: renderDiagnosticMarkdown(snapshot, { now: options.now || new Date() }), filename: 'CURRENT.md' };
}

export async function copyDiagnosticArtifact(artifact, clipboard = navigator.clipboard) {
    await clipboard.writeText(artifact.markdown);
    return artifact.markdown;
}

export function downloadDiagnosticArtifact(artifact, documentRef = document, urlApi = URL) {
    const href = urlApi.createObjectURL(new Blob([artifact.markdown], { type: 'text/markdown;charset=utf-8' }));
    const anchor = documentRef.createElement('a');
    anchor.href = href;
    anchor.download = artifact.filename;
    anchor.click();
    urlApi.revokeObjectURL(href);
    return artifact.markdown;
}
