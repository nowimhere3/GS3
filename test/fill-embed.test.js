import test from 'node:test';
import assert from 'node:assert/strict';
import { getFillPresentationUrl, getPresentationUrl } from '../js/presentation-url.js';

// Synthetic ids on purpose: the adapters are pattern-based, not corpus-based.
const CASES = [
    ['xvideos.com', 'https://www.xvideos.com/video.zq9x81k/some_slug', 'https://www.xvideos.com/embedframe/zq9x81k'],
    ['xvideos.com (no www, query+hash)', 'https://xvideos.com/video.AB12cd/s?pl=9&x=1#t=5', 'https://www.xvideos.com/embedframe/AB12cd'],
    ['xvideos.red', 'https://www.xvideos.red/video.q7w8e9r/slug', 'https://www.xvideos.com/embedframe/q7w8e9r'],
    ['xnxx.com', 'https://www.xnxx.com/video-9a8b7c6/slug', 'https://www.xnxx.com/embedframe/9a8b7c6'],
    ['xnxx other TLD', 'https://www.xnxx.tv/video-k1j2h3/slug#show-related', 'https://www.xnxx.com/embedframe/k1j2h3'],
    ['xnxx subdomain', 'https://es.xnxx.com/video-Zz0/slug', 'https://www.xnxx.com/embedframe/Zz0'],
    ['pornhub.com', 'https://www.pornhub.com/view_video.php?viewkey=ph0a1b2c3d4e5', 'https://www.pornhub.com/embed/ph0a1b2c3d4e5'],
    ['pornhub extra params', 'https://pornhub.com/view_video.php?foo=1&viewkey=abc123XYZ&t=5#c', 'https://www.pornhub.com/embed/abc123XYZ'],
    ['spankbang.com', 'https://spankbang.com/9zz9z/video/some+slug', 'https://spankbang.com/9zz9z/embed/'],
    ['eporner.com', 'https://www.eporner.com/video-AbCdEf12345/slug/', 'https://www.eporner.com/embed/AbCdEf12345/'],
    ['porntrex.com', 'https://www.porntrex.com/video/8675309/slug', 'https://www.porntrex.com/embed/8675309'],
    ['tnaflix.com', 'https://www.tnaflix.com/cat-videos/%5Bx%5D-slug/video1234567', 'https://player.tnaflix.com/video/1234567'],
    // real shapes found in the library (coverage expansion, each proven to play in a Fill overlay)
    ['xvideos legacy numeric', 'https://www.xvideos.com/video7461269/mary_anne_black_attack_gangbang', 'https://www.xvideos.com/embedframe/7461269'],
    ['xvideos legacy, query+hash', 'https://xvideos.com/video123456/slug?x=1#t=5', 'https://www.xvideos.com/embedframe/123456'],
    ['xvideos de. host', 'https://de.xvideos.com/video.uavehkb6ea2/slug#show-related', 'https://www.xvideos.com/embedframe/uavehkb6ea2'],
    ['eporner /hd-porn/', 'https://www.eporner.com/hd-porn/2KQFuGdodJO/Extreme-fuck-and-BJ/', 'https://www.eporner.com/embed/2KQFuGdodJO/'],
    ['tnaflix m.', 'https://m.tnaflix.com/anal-porn/Skinny-Schoolgirl/video7123328', 'https://player.tnaflix.com/video/7123328'],
    ['wxx.wtf video page', 'https://www.wxx.wtf/videos/96805/blondiekayy-18-sex-with-a-slutty-whore-2022-webcam-3e83825c8299b492/', 'https://www.wxx.wtf/embed/96805'],
    ['wxx.wtf no-www, query+hash', 'https://wxx.wtf/videos/114117/lika-moon-private-with-moans/?x=1#t=5', 'https://www.wxx.wtf/embed/114117'],
    ['wxx.wtf http', 'http://www.wxx.wtf/videos/66611/slug', 'https://www.wxx.wtf/embed/66611'],
    ['tnaflix morigin /br/', 'https://morigin.tnaflix.com/br/blowjob-videos/%28New%29-x/video11495693', 'https://player.tnaflix.com/video/11495693'],
];

const REJECT = [
    'https://www.xvideos.com/', 'https://www.xvideos.com/tags/anything', 'https://www.xvideos.com/video.ab<c/x',
    'https://www.xnxx.com/', 'https://www.xnxx.com/search/anything?top', 'https://www.xnxx.com/porn-maker/someone', 'https://www.xnxx.com/video-',
    'https://www.pornhub.com/', 'https://www.pornhub.com/video/search?search=x', 'https://www.pornhub.com/view_video.php',
    'https://www.pornhub.com/view_video.php?viewkey=a/../b', 'https://www.pornhub.com/view_video.php?viewkey=',
    'https://spankbang.com/', 'https://spankbang.com/s/anything/', 'https://www.eporner.com/', 'https://www.eporner.com/cat/anything/',
    'https://www.porntrex.com/', 'https://www.porntrex.com/video/abc/', 'https://www.porntrex.com/categories/', 'https://www.tnaflix.com/', 'https://www.tnaflix.com/popular/',
    // look-alikes and smuggling attempts
    'https://notxvideos.com/video.abc/x', 'https://xvideos.com.evil.net/video.abc/x', 'https://www.xnxx.com.evil.net/video-abc/x',
    'https://evilxnxx.com/video-abc/x', 'https://evil.com/?u=https://www.xvideos.com/video.abc/x', 'https://evil.com/video.abc/x',
    'https://pornhub.com.evil.net/view_video.php?viewkey=abc', 'https://spankbang.com.evil.net/abc/video/x', 'https://xvideos.com@evil.net/video.abc/x',
    // library URLs that are NOT a single video page (still unsupported after the coverage expansion)
    'https://www.xvideos.com/favorite/83907575/high_as_hell', 'https://www.xvideos.com/video/abc', 'https://www.xvideos.com/videos-i-like/x',
    'https://www.xvideos.red/account/premium', 'https://www.xvideos.red/favorite/5546763/blowjobs', 'https://www.xvideos.red/my-feed',
    'https://fr.xvideos.com/video.abc123/x', 'https://de.xvideos.com/tags/x', 'https://de.xvideos.com.evil.net/video.abc123/x',
    'https://www.eporner.com/hd-porn/', 'https://www.eporner.com/cat/group-sex/13/', 'https://www.eporner.com/pornstar/erika-devine/',
    'https://www.eporner.com/profile/electropunk/playlist/MmFgAQfLraW/Broken/', 'https://www.eporner.com/hd-porn/ab<c/x',
    'https://www.tnaflix.com/search?what=meadowthayer', 'https://m.tnaflix.com/', 'https://evil.tnaflix.com/x/video123', 'https://m.tnaflix.com.evil.net/x/video123',
    'https://spankbang.com/8mh1c-fkw7k5/playlist/1feet+playlist', 'https://spankbang.com/s/long%20toes/', 'https://spankbang.com/tag/alanna+gold/',
    'https://ru.spankbang.com/6mcdc/video/x', 'https://tr.spankbang.com/7ctig-hossoz/playlist/self', 'https://la.spankbang.com/93fsn-h69rmd/playlist/spanish',
    'https://www.porntrex.com/search/Cindy-Shine/', 'https://www.porntrex.com/tags/yessica-bunny/most-popular/',
    'https://www.pornhub.com/channels/gangbangcreampie', 'https://www.pornhub.com/video/search?search=dolly+little+xxx', 'https://www.xnxx.com/porn-maker/anal-vids-teens',
    // wxx.wtf: only /videos/<digits>/ pages; home, search, embed pages, look-alikes, non-numeric ids
    'https://www.wxx.wtf/', 'https://www.wxx.wtf/videos/', 'http://www.wxx.wtf/search/blondiekayy/', 'https://www.wxx.wtf/embed/96805', 'https://www.wxx.wtf/videos/abc/slug/',
    'https://www.wxx.wtf/categories/', 'https://wxx.wtf.evil.example/videos/96805/x/', 'https://notwxx.wtf/videos/96805/x/', 'https://evil.com/?u=https://www.wxx.wtf/videos/96805/x/',
    'https://sub.wxx.wtf/videos/96805/x/', 'https://www.camhub.world/embed/445721',
    // other providers and Cloudbate are not FILL_EMBED
    'https://xhamster.com/videos/some-slug-3298012', 'https://www.cloudbate.com/video/1136214/x/', 'https://www.youtube.com/watch?v=abc',
    // malformed / non-http
    'not a url', '', 'about:blank', 'javascript:alert(1)', 'ftp://www.xvideos.com/video.abc/x', 'index.html', undefined, null, 42,
];

test('FILL_EMBED adapters build the provider-native URL from the ID only', () => {
    for (const [name, input, expected] of CASES) assert.equal(getFillPresentationUrl(input), expected, name);
});

test('FILL_EMBED returns null for non-video, look-alike, unsupported and malformed inputs', () => {
    for (const input of REJECT) assert.equal(getFillPresentationUrl(input), null, String(input));
});

test('FILL_EMBED is pure and idempotent on its inputs', () => {
    const input = 'https://www.xvideos.com/video.zq9x81k/some_slug?pl=1#a';
    const first = getFillPresentationUrl(input);
    assert.equal(getFillPresentationUrl(input), first);
    assert.equal(input, 'https://www.xvideos.com/video.zq9x81k/some_slug?pl=1#a');
});

test('the presentation adapter for Cloudbate is unchanged by the FILL_EMBED family', () => {
    assert.equal(getPresentationUrl('https://www.cloudbate.com/video/123/slug/'), 'https://www.cloudbate.com/video/123/slug/?play=true');
    assert.equal(getPresentationUrl('https://www.cloudbate.com/'), 'https://www.cloudbate.com/');
    assert.equal(getPresentationUrl('https://www.xvideos.com/video.abc/x'), 'https://www.xvideos.com/video.abc/x');
});
