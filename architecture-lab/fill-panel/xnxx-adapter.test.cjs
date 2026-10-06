'use strict';
// Run: node architecture-lab/fill-panel/xnxx-adapter.test.cjs
// Loads adaptEmbed straight out of gs3-live-harness.js. All IDs are synthetic (not from links.json).
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, 'gs3-live-harness.js'), 'utf8');
const a = src.indexOf('function adaptEmbed');
const b = src.indexOf('// ── Geometry');
const adaptEmbed = eval('(' + src.slice(a, b).trim() + ')');

let n = 0;
const ok = (url, id) => {
    const r = adaptEmbed(url);
    assert(r, `should accept ${url}`);
    assert.strictEqual(r.provider, 'xnxx', url);
    assert.strictEqual(r.id, id, url);
    assert.deepStrictEqual(r.embeds, [`https://www.xnxx.com/embedframe/${id}`], url);
    n++;
};
const no = (url) => { assert.strictEqual(adaptEmbed(url), null, `should reject ${url}`); n++; };

// Synthetic ids: numeric, alpha, mixed, long, underscore/hyphen, uppercase, digit-leading.
const ids = ['zq9x', 'ZZZZ', '0', '99999999999', 'a1B2c3D4e5', 'q_w-e_r', 'k7k7k7k7k7k7k7k7', 'Zz0'];
const hosts = ['www.xnxx.com', 'xnxx.com', 'xnxx.tv', 'www.xnxx.es', 'xnxx.health', 'es.xnxx.com',
    'www3.xnxx.com', 'fr.xnxx.tv', 'www.xnxx.co.uk', 'xnxx.gold', 'WWW.XNXX.COM', 'www.xnxx.com:443'];
for (const id of ids) {
    for (const h of hosts) {
        ok(`https://${h}/video-${id}/some_slug`, id);
        ok(`https://${h}/video-${id}`, id);
        ok(`https://${h}/video-${id}/`, id);
    }
    ok(`http://xnxx.com/video-${id}/s?x=1&y=2`, id);
    ok(`https://www.xnxx.com/video-${id}/s#show-related`, id);
    ok(`https://www.xnxx.com/video-${id}/a-totally-different-slug.mp4?t=5#frag`, id);
}

// Rejected: no single video identity.
[
    'https://www.xnxx.com/', 'https://www.xnxx.com', 'https://xnxx.tv/',
    'https://www.xnxx.com/search/anything', 'https://www.xnxx.com/search/video-abc123',
    'https://www.xnxx.com/tags/some_tag', 'https://www.xnxx.com/best/2026-09',
    'https://www.xnxx.com/porn-maker/some-profile', 'https://www.xnxx.com/profileslist/x',
    'https://www.xnxx.com/todays-selection', 'https://www.xnxx.com/video-',
    'https://www.xnxx.com/videos/abc', 'https://www.xnxx.com/?q=/video-abc123',
    'https://www.xnxx.com/#/video-abc123', 'https://www.xnxx.com/c/Teen',
    'not a url', '',
    // not the XNXX family
    'https://notxnxx.com/video-abc123/x', 'https://xnxx.example.org/video-abc123/x',
    'https://example.com/xnxx.com/video-abc123/x', 'https://xnxx.com.evil.net/video-abc123/x',
].forEach(no);

// Other adapters unchanged.
const x = adaptEmbed('https://www.xvideos.com/video.synth1234/slug');
assert.deepStrictEqual(x.embeds, ['https://www.xvideos.com/embedframe/synth1234']); n++;
const r = adaptEmbed('https://www.xvideos.red/video.synth1234/slug');
assert.deepStrictEqual(r.embeds, ['https://www.xvideos.red/embedframe/synth1234', 'https://www.xvideos.com/embedframe/synth1234']); n++;
no('https://www.pornhub.com/view_video.php?viewkey=abc');

console.log(`xnxx adapter: ${n} assertions passed`);
