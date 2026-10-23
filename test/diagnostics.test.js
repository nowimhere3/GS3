import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

function makeStorage(initial = {}) {
    const values = new Map(Object.entries(initial).map(([key, value]) => [key, String(value)]));
    return {
        get length() { return values.size; },
        key: (index) => [...values.keys()][index] ?? null,
        getItem: (key) => values.has(key) ? values.get(key) : null,
        setItem: (key, value) => values.set(key, String(value)),
        removeItem: (key) => values.delete(key),
        clear: () => values.clear(),
        snapshot: () => Object.fromEntries(values),
    };
}

globalThis.localStorage = makeStorage();

const diagnostics = await import('../js/diagnostics.js');

const SAME_SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);
const GENERATED_AT = new Date('2026-09-10T16:00:00.000Z');

function observations(overrides = {}) {
    const base = {
        origin: 'http://localhost:8080',
        page: '/index3.html',
        runtime: {
            executor: 'Grid', layout: 'top2', nestedRuntimeCount: 1,
            masterLayerTarget: 'L2-P1', nestedHosts: 'P1',
        },
        positions: [
            { position: 'P1', panel: 'slot-1', content: 'runtime:grid', runtime: 'grid', nested: 'yes' },
            { position: 'P2', panel: 'slot-2', content: 'web:1234abcd', runtime: 'none', nested: 'no' },
            { position: 'P3', panel: 'slot-3', content: 'empty', runtime: 'none', nested: 'no' },
        ],
        history: {
            l1Undo: 4, l1Redo: 0,
            nested: [{ target: 'L2-P1', value: 'unknown', reason: 'nested history is not exposed without instrumentation' }],
        },
        workspace: { canonicalId: '2', canonicalName: 'Preset 2', visibleLabel: 'Preset 2' },
        persistence: {
            localStorage: 'available', repo: 'owner/repo', branch: null, tokenConfigured: 'yes',
            memoryPresetSha: SAME_SHA, remotePresetSha: SAME_SHA, remoteReason: null,
        },
    };
    return {
        ...base,
        ...overrides,
        runtime: { ...base.runtime, ...overrides.runtime },
        history: { ...base.history, ...overrides.history },
        workspace: { ...base.workspace, ...overrides.workspace },
        persistence: { ...base.persistence, ...overrides.persistence },
    };
}

function snapshot(facts = observations(), options = {}) {
    return diagnostics.createDiagnosticSnapshot(facts, { generatedAt: GENERATED_AT, now: GENERATED_AT, ...options });
}

test('known current truth renders Runtime, Position, Layer, Workspace, and persistence facts', () => {
    const result = snapshot();
    const markdown = diagnostics.renderDiagnosticMarkdown(result, { now: GENERATED_AT });

    assert.equal(result.protocol, 'RM-1');
    assert.equal(result.schema, 1);
    assert.equal(result.project, 'streamloop');
    assert.equal(result.runtime.executor.value, 'Grid');
    assert.equal(result.runtime.layout.value, 'top2');
    assert.equal(result.runtime.nestedRuntimeCount.value, '1');
    assert.equal(result.runtime.masterLayerTarget.value, 'L2-P1');
    assert.equal(result.positions[0].panel.value, 'slot-1');
    assert.equal(result.history.l1Undo.value, '4');
    assert.equal(result.workspace.canonicalName.value, 'Preset 2');
    assert.equal(result.persistence.localStorage.value, 'available');
    assert.match(markdown, /## HEADER/);
    assert.match(markdown, /## VERDICT/);
    assert.match(markdown, /P1  panel slot-1  runtime:grid/);
    assert.match(markdown, /L1  undo 4 · redo 0/);
    assert.match(markdown, /build unknown \(no runtime build identity exists\)/);
    assert.match(markdown, /branch unknown \(not configured or observed\)/);
    assert.match(markdown, /last failed HTTP status unknown \(HTTP failure history is not retained\)/);
});

test('workspace projection reports MATCH and deterministic MISMATCH verdicts', () => {
    const match = snapshot();
    assert.equal(match.workspace.projection.value, 'MATCH');
    assert.deepEqual(match.verdict.map(({ message }) => message), ['No anomalies detected by implemented Tier 2 checks.']);

    const mismatch = snapshot(observations({ workspace: { visibleLabel: 'Cleaned Bookmarks' } }));
    assert.equal(mismatch.workspace.canonicalName.value, 'Preset 2');
    assert.equal(mismatch.workspace.visibleLabel.value, 'Cleaned Bookmarks');
    assert.equal(mismatch.workspace.projection.value, 'MISMATCH');
    assert.match(mismatch.verdict[0].message, /canonical active name differs/);
});

test('preset SHA comparison reports MATCH, MISMATCH, and remote failure as unknown without aborting', () => {
    const match = snapshot();
    assert.equal(match.persistence.shaComparison.value, 'MATCH');

    const mismatch = snapshot(observations({ persistence: { remotePresetSha: OTHER_SHA } }));
    assert.equal(mismatch.persistence.shaComparison.value, 'MISMATCH');
    assert.match(mismatch.verdict.at(-1).message, /in-memory presets SHA differs/);

    const failed = snapshot(observations({ persistence: { remotePresetSha: null, remoteReason: 'request failed' } }));
    assert.equal(failed.persistence.remotePresetSha.value, 'unknown');
    assert.equal(failed.persistence.remotePresetSha.reason, 'request failed');
    assert.equal(failed.persistence.shaComparison.value, 'unknown');
    assert.equal(failed.runtime.executor.value, 'Grid', 'an unavailable remote probe cannot abort other sections');
});

test('remote preset observation performs one bounded GET and fails soft', async () => {
    const calls = [];
    const token = `ghp_${'s'.repeat(24)}`;
    const observed = await diagnostics.observeRemotePresetsSha({
        repo: 'owner/repo', token, timeoutMs: 50,
        fetchFn: async (url, options) => {
            calls.push({ url, options });
            return new Response(JSON.stringify({ sha: SAME_SHA }), {
                status: 200, headers: { 'content-type': 'application/json' },
            });
        },
    });
    assert.deepEqual(observed, { sha: SAME_SHA, reason: null });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.method, 'GET');
    assert.equal(calls[0].url, 'https://api.github.com/repos/owner/repo/contents/presets.json');
    assert.equal(calls[0].options.headers.Authorization, `token ${token}`);
    assert.equal('body' in calls[0].options, false);

    const failed = await diagnostics.observeRemotePresetsSha({
        repo: 'owner/repo', fetchFn: async () => { throw new Error('secret detail'); },
    });
    assert.deepEqual(failed, { sha: null, reason: 'request failed' });
});

test('browser generation observes canonical state without mutating product state', async () => {
    globalThis.localStorage = makeStorage();
    globalThis.window = {
        location: {
            origin: 'http://localhost:8080', pathname: '/index3.html', search: '?workspace=live',
            href: 'http://localhost:8080/index3.html?workspace=live',
        },
    };
    globalThis.document = {
        querySelector(selector) {
            if (selector.startsWith('#workspace-tabs')) return { textContent: '📁 Preset 2' };
            if (selector.startsWith('#master-layer-selector')) return { textContent: 'L2-P1' };
            return null;
        },
    };

    const { Store } = await import('../js/storage.js');
    const state = await import('../js/state.js');
    const session = await import('../js/grid-session.js');
    const { createWorkspacePanel, createUrlPanel } = await import('../js/panels.js');
    ['activeWorkspaceId', 'gitRepo', 'gitToken', 'matrixUrls', 'folderMap', 'tripleLayout'].forEach((key) => Store.invalidate(key));
    Store.set('activeWorkspaceId', '2');
    Store.set('gitRepo', 'owner/repo');
    Store.set('gitToken', `github_pat_${'x'.repeat(24)}`);
    Store.set('matrixUrls', [createWorkspacePanel(1), createUrlPanel('https://media.test/watch?id=signed'), createUrlPanel('')]);
    Store.set('folderMap', {});
    Store.set('tripleLayout', 'top2');
    state.setPresetsStructure([{ id: 2, name: 'Preset 2' }]);
    state.setPresetsSha(SAME_SHA);
    session.initGridSession('top2');

    const before = {
        storage: localStorage.snapshot(), presets: structuredClone(state.getPresetsStructure()),
        sha: state.getPresetsSha(), panels: session.getSessionPanels(), layout: session.getSessionLayout(),
        arrangement: session.getSessionArrangement(), history: session.getGridHistory(),
    };
    const methods = [];
    const result = await diagnostics.generateBrowserDiagnosticSnapshot({
        now: GENERATED_AT,
        fetchFn: async (_url, options) => {
            methods.push(options.method);
            return new Response(JSON.stringify({ sha: SAME_SHA }), { status: 200 });
        },
    });
    const after = {
        storage: localStorage.snapshot(), presets: structuredClone(state.getPresetsStructure()),
        sha: state.getPresetsSha(), panels: session.getSessionPanels(), layout: session.getSessionLayout(),
        arrangement: session.getSessionArrangement(), history: session.getGridHistory(),
    };

    assert.deepEqual(after, before);
    assert.deepEqual(methods, ['GET']);
    assert.equal(result.runtime.executor.value, 'Grid');
    assert.equal(result.runtime.layout.value, 'top2');
    assert.equal(result.runtime.nestedRuntimeCount.value, '1');
    assert.equal(result.runtime.masterLayerTarget.value, 'L2-P1');
    assert.equal(result.positions[0].content.value, 'runtime:grid');
    assert.equal(result.workspace.canonicalName.value, 'Preset 2');
    assert.equal(result.workspace.visibleLabel.value, 'Preset 2');
    assert.equal(result.workspace.projection.value, 'MATCH');
});

test('adversarial credentials, authorization values, signed URLs, and opaque strings are redacted', async () => {
    const secrets = [
        `ghp_${'a'.repeat(24)}`,
        `github_pat_${'b'.repeat(24)}`,
        `eyJ${'a'.repeat(12)}.${'b'.repeat(12)}.${'c'.repeat(12)}`,
        `Bearer ${'z'.repeat(24)}`,
        `ya29.${'q'.repeat(24)}`,
        `AIza${'G'.repeat(28)}`,
        'd'.repeat(48),
        'Q'.repeat(60),
    ];
    for (const secret of secrets) assert.equal(diagnostics.safeScalar(`credential ${secret}`), '[redacted]');

    const signedUrl = `https://${'x'.repeat(40)}.media.test/private/${secrets[0]}?signature=${secrets[1]}#token`;
    const sanitized = diagnostics.sanitizeUrl(signedUrl);
    assert.doesNotMatch(sanitized, /signature|#token|ghp_|x{32}/);
    assert.match(sanitized, /\[redacted\]/);

    const hostile = observations({
        origin: signedUrl,
        runtime: { nestedHosts: secrets[2] },
        positions: [{ position: 'P1', panel: secrets[3], content: signedUrl, runtime: secrets[4], nested: 'yes' }],
        history: { nested: [{ target: secrets[5], value: secrets[6], reason: secrets[7] }] },
        workspace: { canonicalId: secrets[0], canonicalName: secrets[1], visibleLabel: secrets[2] },
        persistence: { repo: secrets[3], memoryPresetSha: secrets[6], remotePresetSha: null, remoteReason: secrets[4] },
    });
    const result = snapshot(hostile);
    const rendered = `${JSON.stringify(result)}\n${diagnostics.renderDiagnosticMarkdown(result, { now: GENERATED_AT })}`;
    for (const secret of secrets) assert.equal(rendered.includes(secret), false, `secret survived: ${secret.slice(0, 12)}`);
    assert.equal(rendered.includes('?signature='), false);
    assert.equal(rendered.includes('#token'), false);
    assert.equal(await diagnostics.safeShortHash(signedUrl), await diagnostics.safeShortHash(signedUrl));
    assert.equal((await diagnostics.safeShortHash(signedUrl)).length, 8);
});

test('freshness is FRESH below ten minutes and STALE at or beyond the horizon', () => {
    const fiveMinutesLater = new Date(GENERATED_AT.getTime() + 5 * 60 * 1000);
    const tenMinutesLater = new Date(GENERATED_AT.getTime() + 10 * 60 * 1000);
    const elevenMinutesLater = new Date(GENERATED_AT.getTime() + 11 * 60 * 1000);
    assert.equal(diagnostics.evaluateFreshness(GENERATED_AT, fiveMinutesLater).status, 'FRESH');
    assert.equal(diagnostics.evaluateFreshness(GENERATED_AT, tenMinutesLater).status, 'STALE');
    assert.equal(diagnostics.evaluateFreshness(GENERATED_AT, elevenMinutesLater).status, 'STALE');
    assert.match(diagnostics.renderDiagnosticMarkdown(snapshot(), { now: fiveMinutesLater }), /· FRESH · 5m old/);
    assert.match(diagnostics.renderDiagnosticMarkdown(snapshot(), { now: elevenMinutesLater }), /· STALE · 11m old/);
});

test('authored worst-case snapshot remains bounded and never truncates silently', () => {
    const long = 'safe-name-'.repeat(30);
    const worst = snapshot(observations({
        runtime: { nestedHosts: long },
        positions: Array.from({ length: 20 }, (_, index) => ({
            position: `P${index + 1}`, panel: long, content: long, runtime: long, nested: long,
        })),
        history: { nested: Array.from({ length: 20 }, (_, index) => ({ target: `L2-P${index + 1}`, value: long, reason: long })) },
        workspace: { canonicalName: long, visibleLabel: long },
    }));
    const markdown = diagnostics.renderDiagnosticMarkdown(worst, { now: GENERATED_AT });
    const bytes = new TextEncoder().encode(markdown).length;
    assert.ok(bytes < 16 * 1024, `expected natural V1 output under 16 KB, got ${bytes}`);
    assert.ok(bytes < diagnostics.SNAPSHOT_HARD_CAP_BYTES);
    assert.equal(markdown.includes('TRUNCATED:'), false);
});

test('Copy and Download transport the identical Markdown from one generated artifact', async () => {
    const artifact = { snapshot: snapshot(), markdown: diagnostics.renderDiagnosticMarkdown(snapshot(), { now: GENERATED_AT }), filename: 'CURRENT.md' };
    let copied = null;
    let downloadedBlob = null;
    let downloadName = null;
    let revoked = null;
    const clipboard = { writeText: async (value) => { copied = value; } };
    const anchor = {
        href: '',
        set download(value) { downloadName = value; },
        click() {},
    };
    const documentRef = { createElement: (tag) => { assert.equal(tag, 'a'); return anchor; } };
    const urlApi = {
        createObjectURL(blob) { downloadedBlob = blob; return 'blob:diagnostics'; },
        revokeObjectURL(value) { revoked = value; },
    };

    assert.equal(await diagnostics.copyDiagnosticArtifact(artifact, clipboard), artifact.markdown);
    assert.equal(diagnostics.downloadDiagnosticArtifact(artifact, documentRef, urlApi), artifact.markdown);
    assert.equal(copied, artifact.markdown);
    assert.equal(await downloadedBlob.text(), artifact.markdown);
    assert.equal(downloadName, 'CURRENT.md');
    assert.equal(revoked, 'blob:diagnostics');
});

test('committed reader front door, Settings, and live Grid bind one browser transport', async () => {
    const [readme, contract, ignore, settingsHtml, settingsJs, gridHtml, gridJs] = await Promise.all([
        readFile(new URL('../Diagnostics/README.md', import.meta.url), 'utf8'),
        readFile(new URL('../Diagnostics/CONTRACT.md', import.meta.url), 'utf8'),
        readFile(new URL('../Diagnostics/.gitignore', import.meta.url), 'utf8'),
        readFile(new URL('../settings.html', import.meta.url), 'utf8'),
        readFile(new URL('../js/settings.js', import.meta.url), 'utf8'),
        readFile(new URL('../index3.html', import.meta.url), 'utf8'),
        readFile(new URL('../js/triple-mode.js', import.meta.url), 'utf8'),
    ]);
    assert.equal(ignore.trim(), 'local/');
    assert.match(readme, /Diagnostics\/local\/CURRENT\.md/);
    assert.match(contract, /Tier 2: implemented/);
    assert.match(contract, /Tier 1 Journal: NOT implemented/);
    assert.match(settingsHtml, /id="btn-copy-diagnostics"/);
    assert.match(settingsHtml, /id="btn-download-diagnostics"/);
    assert.match(settingsJs, /generateDiagnosticArtifact/);
    assert.match(settingsJs, /copyDiagnosticArtifact\(artifact\)/);
    assert.match(settingsJs, /downloadDiagnosticArtifact\(artifact\)/);
    assert.match(gridHtml, /id="btn-master-copy-diagnostics"/);
    assert.match(gridJs, /generateDiagnosticArtifact, copyDiagnosticArtifact/);
    assert.match(gridJs, /copyDiagnosticsBtn\.onclick/);
    assert.match(gridJs, /copyDiagnosticArtifact\(artifact\)/);
    assert.match(readme, /live top-level Grid Runtime/);
    assert.match(contract, /Top-level Grid exposes `Copy Diagnostics`/);
});
