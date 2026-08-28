// Minimal static file server for local development.
// No dependencies, so `node server.js` is all it takes.

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 4321;
// Normally the repo root. Pointed at www/ when capturing App Store
// screenshots, so the frames show the bundle that actually ships - the store
// build hides the Give tab, and a screenshot of a tab the app does not have
// is a review finding.
const ROOT = process.env.ROOT ? path.resolve(process.env.ROOT) : __dirname;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith('/')) pathname += 'index.html';

  const filePath = path.join(ROOT, pathname);

  // Never serve anything outside the project, or the raw source downloads.
  if (!filePath.startsWith(ROOT) || pathname.startsWith('/_source')) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      // The service worker must always be revalidated or updates never land.
      'Cache-Control': pathname.endsWith('sw.js') ? 'no-cache' : 'no-cache',
    });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Lantern running at http://localhost:${PORT}`);
});
