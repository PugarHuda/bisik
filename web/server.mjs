// Bisik dev/demo server: serves the static desk UI and proxies /api/v2/* to the
// Canton JSON Ledger API. Node stdlib only — no dependencies.
// Point at LocalNet or Devnet by setting LEDGER_JSON_URL.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT ?? 8080);
const LEDGER = (process.env.LEDGER_JSON_URL ?? 'http://localhost:7575').replace(/\/$/, '');
const USER_ID = process.env.LEDGER_USER_ID ?? 'participant_admin';

// Optional OAuth2 client-credentials (DevNet). If unset, no auth header (sandbox).
const OAUTH = process.env.LEDGER_TOKEN_URL ? {
  url: process.env.LEDGER_TOKEN_URL,
  clientId: process.env.LEDGER_CLIENT_ID,
  clientSecret: process.env.LEDGER_CLIENT_SECRET,
  audience: process.env.LEDGER_AUDIENCE,
  scope: process.env.LEDGER_SCOPE,
} : null;

let tok = null, tokAt = 0;
async function bearer() {
  if (!OAUTH) return null;
  if (tok && Date.now() - tokAt < 6 * 60 * 1000) return tok;
  const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: OAUTH.clientId,
    client_secret: OAUTH.clientSecret, audience: OAUTH.audience, scope: OAUTH.scope });
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch(OAUTH.url, { method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
      const j = JSON.parse(await r.text());
      if (j.access_token) { tok = j.access_token.trim(); tokAt = Date.now(); return tok; }
    } catch {}
    await new Promise((r) => setTimeout(r, 700 * (i + 1)));
  }
  throw new Error('token fetch failed');
}

// Known party IDs for the frontend. Only used in DevNet mode (10k parties there
// make prefix discovery unreliable). On the local sandbox we leave this empty so
// the frontend discovers its parties by id-hint prefix instead.
let PARTIES = {};
const partiesFile = process.env.LEDGER_PARTIES ?? (OAUTH ? join(DIR, '..', 'scripts', 'devnet.parties.json') : null);
if (partiesFile) {
  try { PARTIES = JSON.parse(readFileSync(partiesFile, 'utf8')); } catch { PARTIES = {}; }
}

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

const send = (res, status, body, type = 'application/json') => {
  res.writeHead(status, { 'content-type': type });
  res.end(body);
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // App config the frontend needs: ledger user-id + known party IDs.
  if (url.pathname === '/api/config')
    return send(res, 200, JSON.stringify({ userId: USER_ID, parties: PARTIES }));

  // Transparent proxy: /api/v2/... -> <LEDGER>/v2/... (adds Bearer token on DevNet).
  if (url.pathname.startsWith('/api/v2/')) {
    const target = LEDGER + url.pathname.slice(4) + url.search;
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      try {
        const headers = { 'content-type': 'application/json' };
        const t = await bearer();
        if (t) headers.authorization = `Bearer ${t}`;
        const upstream = await fetch(target, {
          method: req.method,
          headers,
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
