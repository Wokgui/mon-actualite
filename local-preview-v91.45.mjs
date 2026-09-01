import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '0.0.0.0';
const PROD = 'https://mon-actualite.vercel.app';
const RELEASE = '91.45';

const mime = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon']
]);

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const resolved = path.resolve(ROOT, relative);
  return resolved.startsWith(path.resolve(ROOT) + path.sep) || resolved === path.resolve(ROOT, 'index.html') ? resolved : null;
}

function localIndex(source) {
  const guard = '<script src="summary-visual-guard-v91.45.js?v=91.45"></script>';
  const marker = '<script src="summary-demand-v91.43.js?v=91.44"></script>';
  const injected = source.includes(marker) ? source.replace(marker, `${guard}\n  ${marker}`) : source.replace('</body>', `  ${guard}\n</body>`);
  return injected.replace('</body>', `<script>document.addEventListener('DOMContentLoaded',()=>{const b=document.createElement('div');b.textContent='LOCAL ${RELEASE}';b.style.cssText='position:fixed;right:8px;top:8px;z-index:99999;padding:4px 7px;border-radius:8px;background:#fff;border:1px solid #bbb;font:700 10px system-ui;color:#444;opacity:.82;pointer-events:none';document.body.appendChild(b);});</script>\n</body>`);
}

async function proxyApi(req, res, url) {
  const target = new URL(url.pathname + url.search, PROD);
  const headers = {};
  for (const name of ['content-type', 'accept', 'accept-language']) {
    if (req.headers[name]) headers[name] = req.headers[name];
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  try {
    const response = await fetch(target, {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method || 'GET') ? undefined : body,
      redirect: 'follow',
      cache: 'no-store'
    });
    res.statusCode = response.status;
    for (const [key, value] of response.headers) {
      if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(key.toLowerCase())) res.setHeader(key, value);
    }
    res.setHeader('Cache-Control', 'no-store');
    const buffer = Buffer.from(await response.arrayBuffer());
    res.end(buffer);
  } catch (error) {
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'local-proxy-failed', message: String(error?.message || error) }));
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || `localhost:${PORT}`}`);
  if (url.pathname.startsWith('/api/')) return proxyApi(req, res, url);

  if (url.pathname === '/sw.js') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end("self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));");
    return;
  }

  if (url.pathname === '/test-card-image.svg') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'no-store');
    res.end('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420"><rect width="640" height="420" fill="#ddd"/><text x="40" y="210" font-size="40">IMAGE TEST 91.45</text></svg>');
    return;
  }

  const file = safePath(url.pathname);
  if (!file) {
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }
  try {
    let data = await fs.readFile(file);
    if (path.basename(file) === 'index.html') data = Buffer.from(localIndex(data.toString('utf8')));
    res.statusCode = 200;
    res.setHeader('Content-Type', mime.get(path.extname(file).toLowerCase()) || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.end(data);
  } catch {
    res.statusCode = 404;
    res.end('Not found');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Mon actualité LOCAL ${RELEASE} : http://localhost:${PORT}`);
  console.log(`Téléphone sur le même Wi-Fi : ouvre http://ADRESSE_IP_DU_PC:${PORT}`);
  console.log('Les /api sont relayées vers la production ; aucun déploiement Vercel n’est effectué.');
});
