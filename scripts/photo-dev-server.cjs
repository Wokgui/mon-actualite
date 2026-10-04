// Local end-to-end verification: current web app and current photo handlers.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  try {
    if (/^\/api\/(?:article-photo-fast|article-photo|article-thumbnail)$/.test(url.pathname)) {
      req.query = Object.fromEntries(url.searchParams);
      const started = performance.now();
      await require(path.join(root, `${url.pathname}.js`))(req, res);
      console.log(JSON.stringify({ route: url.pathname, article: req.query.url, ms: Math.round(performance.now() - started), status: res.statusCode, photo: res.getHeader('X-Thumbnail-Status'), cache: res.getHeader('X-Photo-Cache') }));
      return;
    }
    if (url.pathname === '/api/news') {
      // Consume the live news catalogue; photo requests use the local handlers.
      const endpoint = new URL('https://mon-actualite.vercel.app/api/news');
      endpoint.search = url.search;
      const body = [];
      for await (const chunk of req) body.push(chunk);
      const response = await fetch(endpoint, { method: req.method, signal: AbortSignal.timeout(25000), headers: { 'Content-Type': 'application/json' }, ...(req.method === 'POST' ? { body: Buffer.concat(body) } : {}) });
      res.statusCode = response.status;
      res.setHeader('Content-Type', 'application/json');
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    const target = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!target.startsWith(root + path.sep) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) { res.statusCode = 404; res.end(); return; }
    res.setHeader('Content-Type', types[path.extname(target)] || 'application/octet-stream');
    fs.createReadStream(target).pipe(res);
  } catch (error) { console.error(error.message); if (!res.headersSent) res.statusCode = 502; res.end(); }
}).listen(Number(process.env.PORT || 4174), '127.0.0.1', () => console.log('Local photo app ready on 4174'));
