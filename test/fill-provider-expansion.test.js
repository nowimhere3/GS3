import test from 'node:test';
import assert from 'node:assert/strict';
import { getFillPresentationUrl, getPresentationUrl } from '../js/presentation-url.js';

const providers = [
    ['xcamladyx.com', 'https://xcamladyx.com', '270156'],
    ['stream-leak.com', 'https://stream-leak.com', '156860'],
    ['webpussi.com', 'https://www.webpussi.com', '57354'],
];

test('new Fill providers accept proven video shapes and discard source query/hash', () => {
    for (const [, origin, id] of providers) {
        const canonical = `${origin}/videos/${id}/real-specimen/?foo=1&embed=evil#t=9`;
        assert.equal(getFillPresentationUrl(canonical), `${origin}/embed/${id}`);
        assert.equal(getPresentationUrl(canonical), canonical);
        assert.equal(getFillPresentationUrl(canonical), getFillPresentationUrl(canonical));
    }
});

test('new Fill providers reject non-video paths, malformed IDs, look-alikes and non-http URLs', () => {
    for (const [host, origin, id] of providers) {
        for (const path of ['/', '/search/person/', '/models/person/', '/tags/person/', '/categories/person/', `/embed/${id}`, '/videos/', '/videos/0/slug/', '/videos/01/slug/', '/videos/abc/slug/', '/videos/-1/slug/', '/videos/12.3/slug/', '/videos/12%2F34/slug/', '/videos/12/slug/more/', '/videos/12/']) {
            assert.equal(getFillPresentationUrl(origin + path), null, origin + path);
        }
        for (const badHost of [`${host}.evil.net`, `not${host}`, `evil.${host}`]) {
            assert.equal(getFillPresentationUrl(`https://${badHost}/videos/${id}/slug/`), null);
        }
        assert.equal(getFillPresentationUrl(`ftp://${host}/videos/${id}/slug/`), null);
        assert.equal(getFillPresentationUrl(`javascript://${host}/videos/${id}/slug/`), null);
    }
    assert.equal(getFillPresentationUrl('https://www.xcamladyx.com/videos/270156/slug/'), null, 'unproven www host');
    assert.equal(getFillPresentationUrl('https://www.stream-leak.com/videos/156860/slug/'), null, 'unproven www host');
    assert.equal(getFillPresentationUrl('https://cdn9.stream-leak.com/remote_control.php?file=/videos/184000/184671/184671.mp4'), null);
    assert.equal(getFillPresentationUrl('https://webpussi.com/videos/57354/slug/'), null, 'unproven bare host');
});
