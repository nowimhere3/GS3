// R0 fixture: serves a stand-in GS3 host page (gs3.test) and several unrelated "provider" sites
// (a.test / b.test / c.test) from one local port. Chrome maps *.test -> this server via
// --host-resolver-rules, so each hostname is a distinct cross-site origin (=> OOPIF) with no real network.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURE_PORT = 8765;

const page = (host, title, body, head = '') => `<!doctype html><meta charset=utf-8><title>${title}</title>${head}
<body style="font:14px monospace;padding:8px"><h3>${host}: ${title}</h3>${body}`;

function site(host, url) {
    const p = url.pathname;
    const links = (...l) => l.map(([h, t]) => `<p><a id="${t}" href="${h}">${t}</a></p>`).join('');
    if (p === '/') return page(host, 'home', links(['/search/deepthroat?top', 'to-search'], ['/video-q9x7zz/some_slug', 'to-video'],
        ['http://c.test/', 'to-c'], ['/spa', 'to-spa'], ['/hijack', 'to-hijack']));
    if (p.startsWith('/search/')) return page(host, 'search', links(['/video-zz81k2/another_slug?x=1', 'to-video'], ['/spa', 'to-spa'], ['http://b.test/', 'to-b']));
    if (p.startsWith('/video-')) return page(host, 'video ' + p, links(['/spa', 'to-spa'], ['http://b.test/', 'to-b'], ['/', 'to-home']));
    if (p === '/spa' || p.startsWith('/spa/')) return page(host, 'spa',
        `<button id=push onclick="history.pushState({}, '', '/spa/pushed')">push</button>
         <button id=replace onclick="history.replaceState({}, '', '/spa/replaced')">replace</button>
         <a id=hash href="#route2">hash</a>`);
    if (p === '/hijack') return page(host, 'hijack', `<script>window.name='gs3-panel-slot-2'</script>${links(['/video-hj1/x', 'to-video'])}`);
    return page(host, 'generic ' + p, links(['/', 'to-home']));
}

export function startFixture(port = FIXTURE_PORT) {
    const srv = http.createServer((req, res) => {
        const host = (req.headers.host || '').split(':')[0];
        const url = new URL(req.url, `http://${host}`);
        if (host === 'gs3.test') {
            const f = url.pathname === '/' ? 'host.html' : url.pathname.slice(1);
            const fp = path.join(dir, path.basename(f));
            if (!fs.existsSync(fp)) { res.writeHead(404).end('nf'); return; }
            res.writeHead(200, { 'content-type': fp.endsWith('.js') ? 'text/javascript' : 'text/html' });
            res.end(fs.readFileSync(fp)); return;
        }
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(site(host, url));
    });
    return new Promise((r) => srv.listen(port, '127.0.0.1', () => r(srv)));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) { await startFixture(); console.log('fixture on', FIXTURE_PORT); }
