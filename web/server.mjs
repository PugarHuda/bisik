// Bisik dev/demo server: serves the static desk UI and proxies /api/v2/* to the
// Canton JSON Ledger API. Node stdlib only — no dependencies.
// Local sandbox:  node server.mjs            (no auth)
// Devnet:         LEDGER_ENV_FILE=../scripts/.env.devnet node server.mjs
//                 (reads the gitignored env file so the secret is never on the CLI)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(DIR); // web root without a trailing separator, for the traversal check
const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? '127.0.0.1'; // bind loopback: the proxy injects a privileged token

// Config from env, optionally overlaid from a DEVNET env file (keeps secrets off the CLI).
function loadConfig() {
  const cfg = { ...process.env };
  const f = process.env.LEDGER_ENV_FILE;
  if (f) {
    try {
      for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^([A-Z_]+)=(.*)$/);
        if (m && !cfg[m[1]]) cfg[m[1]] = m[2];
      }
      // Map DEVNET_* → LEDGER_* if not already set explicitly.
      cfg.LEDGER_JSON_URL ??= cfg.DEVNET_LEDGER_URL;
      cfg.LEDGER_TOKEN_URL ??= cfg.DEVNET_TOKEN_URL;
      cfg.LEDGER_CLIENT_ID ??= cfg.DEVNET_CLIENT_ID;
      cfg.LEDGER_CLIENT_SECRET ??= cfg.DEVNET_CLIENT_SECRET;
      cfg.LEDGER_AUDIENCE ??= cfg.DEVNET_AUDIENCE;
      cfg.LEDGER_SCOPE ??= cfg.DEVNET_SCOPE;
      cfg.LEDGER_USER_ID ??= '6';
    } catch (e) { console.error('could not read LEDGER_ENV_FILE:', String(e)); }
  }
  return cfg;
}
const C = loadConfig();
const LEDGER = (C.LEDGER_JSON_URL ?? 'http://localhost:7575').replace(/\/$/, '');
const USER_ID = C.LEDGER_USER_ID ?? 'participant_admin';

const OAUTH = C.LEDGER_TOKEN_URL ? {
  url: C.LEDGER_TOKEN_URL, clientId: C.LEDGER_CLIENT_ID, clientSecret: C.LEDGER_CLIENT_SECRET,
  audience: C.LEDGER_AUDIENCE, scope: C.LEDGER_SCOPE,
} : null;

// Token cache with single-flight (concurrent requests share one fetch) and
// real expiry from the IdP's expires_in.
let tok = null, tokExp = 0, inflight = null;
async function fetchToken() {
  const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: OAUTH.clientId,
    client_secret: OAUTH.clientSecret, audience: OAUTH.audience, scope: OAUTH.scope });
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch(OAUTH.url, { method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
      const j = JSON.parse(await r.text());
      if (j.access_token) {
        const ttl = Number(j.expires_in) > 0 ? Number(j.expires_in) : 360;
        tok = j.access_token.trim();
        tokExp = Date.now() + (ttl - 30) * 1000; // refresh 30s before expiry
        return tok;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 700 * (i + 1)));
  }
  throw new Error('token fetch failed');
}
async function bearer() {
  if (!OAUTH) return null;
  if (tok && Date.now() < tokExp) return tok;
  if (!inflight) inflight = fetchToken().finally(() => { inflight = null; });
  return inflight;
}

// Known party IDs for the frontend. DevNet only (10k parties there make prefix
// discovery unreliable); the local sandbox leaves this empty for prefix discovery.
let PARTIES = {};
const partiesFile = C.LEDGER_PARTIES ?? (OAUTH ? join(DIR, '..', 'scripts', 'devnet.parties.json') : null);
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
  const url = new URL(req.url, `http://${HOST}:${PORT}`);

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
          method: req.method, headers,
          body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
        });
        send(res, upstream.status, await upstream.text());
      } catch (e) {
        send(res, 502, JSON.stringify({ error: 'ledger unreachable', detail: String(e), target }));
      }
    });
    return;
  }

  // Static files — resolve and confirm the real path stays inside the web root.
  const rel = normalize(url.pathname === '/' ? '/index.html' : url.pathname);
  const full = resolve(ROOT, '.' + rel);
  if (full !== ROOT && !full.startsWith(ROOT + sep)) return send(res, 403, 'forbidden', 'text/plain');
  try {
    send(res, 200, await readFile(full), MIME[extname(full)] ?? 'application/octet-stream');
  } catch {
    send(res, 404, 'not found', 'text/plain');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`bisik desk on http://${HOST}:${PORT}  ->  ledger ${LEDGER} (user ${USER_ID})`);
});
