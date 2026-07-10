// Bisik dev/demo server: serves the static desk UI and proxies /api/v2/* to the
// Canton JSON Ledger API. Node stdlib only — no dependencies.
// Point at LocalNet or Devnet by setting LEDGER_JSON_URL.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT ?? 8080);
const LEDGER = (process.env.LEDGER_JSON_URL ?? 'http://localhost:7575').replace(/\/$/, '');
const USER_ID = process.env.LEDGER_USER_ID ?? 'participant_admin';

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

const send = (res, status, body, type = 'application/json') => {
  res.writeHead(status, { 'content-type': type });
  res.end(body);
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // App config the frontend needs (ledger user-id for command submission).
  if (url.pathname === '/api/config') return send(res, 200, JSON.stringify({ userId: USER_ID }));

  // Transparent proxy: /api/v2/... -> <LEDGER>/v2/...
  if (url.pathname.startsWith('/api/v2/')) {
    const target = LEDGER + url.pathname.slice(4) + url.search;
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      try {
        const upstream = await fetch(target, {
          method: req.method,
          headers: { 'content-type': 'application/json' },
          body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
        });
        const text = await upstream.text();
        send(res, upstream.status, text);
      } catch (e) {
        send(res, 502, JSON.stringify({ error: 'ledger unreachable', detail: String(e), target }));
      }
    });
    return;
  }

  // Static files.
  let p = normalize(url.pathname === '/' ? '/index.html' : url.pathname).replace(/^(\.\.[/\\])+/, '');
  try {
    const data = await readFile(join(DIR, p));
    send(res, 200, data, MIME[extname(p)] ?? 'application/octet-stream');
  } catch {
    send(res, 404, 'not found', 'text/plain');
  }
});

server.listen(PORT, () => {
  console.log(`bisik desk on http://localhost:${PORT}  ->  ledger ${LEDGER} (user ${USER_ID})`);
});
