import test from 'node:test';
import assert from 'node:assert/strict';
import { getFillPresentationUrl, getPresentationUrl } from '../js/presentation-url.js';

// Discovery alone must not enable Fill: XHomeAlone denies its published embeds,
// CumCams has no proven player-only route, and CamWhoresHD uses unrelated remote IDs.
const specimens = [
    ['xhomealone.com', '/videos/162980/meadowthayer-chaturbate-cam-clip-live-cams-panties/'],
    ['xhomealone.com', '/videos/214910/neli-elinek-chaturbate-new-record-clip-crazy-webcam-goddes/'],
    ['cumcams.cc', '/video/190505100/play'],
    ['cumcams.cc', '/video/189616780/play'],
    ['www.camwhoreshd.com', '/videos/1892550/neli-elinek-armpits-4-0f973bf750cd54bd/'],
    ['www.camwhoreshd.com', '/videos/1946972/neli-elinek-123-26fa0aea70d3fc63/'],
];

test('unproven Bundle 2 providers stay unavailable and preserve their assigned presentation', () => {
    for (const [host, path] of specimens) {
        for (const suffix of ['', '?embed=true&play=true#t=9']) {
            const url = `https://${host}${path}${suffix}`;
            assert.equal(getFillPresentationUrl(url), null, url);
            assert.equal(getPresentationUrl(url), url, 'discovery must not alter normal presentation');
        }
    }
});

test('Bundle 2 discovery cannot accidentally grant capability to unsafe hosts, IDs or non-video pages', () => {
    for (const [host, path] of specimens) {
        const baseHost = host.replace(/^www\./, '');
        for (const lookalike of [`${baseHost}.evil.net`, `not${baseHost}`, `evil.${baseHost}`]) {
            assert.equal(getFillPresentationUrl(`https://${lookalike}${path}`), null);
        }
        for (const scheme of ['ftp:', 'javascript:', 'data:']) {
            assert.equal(getFillPresentationUrl(`${scheme}//${host}${path}`), null);
        }
        for (const nonvideo of ['/', '/search/model/', '/tags/model/', '/performer/model/', '/categories/model/', '/embed/162980', '/videos/0/slug/', '/videos/01/slug/', '/videos/abc/slug/', '/videos/-1/slug/', '/videos/1%2F2/slug/', '/videos/../embed/162980', '/videos/162980/slug/more/']) {
            assert.equal(getFillPresentationUrl(`https://${host}${nonvideo}`), null);
        }
    }
});
