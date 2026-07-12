// Vercel serverless READ-ONLY proxy to the Canton Devnet JSON Ledger API.
//
// Public demo of the Bisik desk: it forwards ONLY read/query calls (injecting the
// Devnet Bearer server-side) and hard-blocks every command submission, so a public
// URL can never drive the ledger. The privileged token never leaves the server.
//
// Reached via a vercel.json rewrite: /api/(.*)  ->  /api/proxy?path=$1
// so e.g. /api/v2/state/ledger-end arrives here as req.query.path = "v2/state/ledger-end".
//
// The interactive local desk (`npm run demo`) still uses web/server.mjs, which is
// unchanged and stays bound to loopback. This function exists purely for hosting.
//
// Required Vercel env vars (from scripts/.env.devnet — the secret is not in git):
//   DEVNET_LEDGER_URL DEVNET_TOKEN_URL DEVNET_CLIENT_ID DEVNET_CLIENT_SECRET
//   DEVNET_AUDIENCE DEVNET_SCOPE   (optional: LEDGER_USER_ID, DEVNET_PARTIES)

// Env values can arrive with a stray BOM/whitespace depending on how they were
// set (e.g. a PowerShell pipe prepends a UTF-8 BOM); trim() drops U+FEFF too.
const clean = (v) => (typeof v === 'string' ? v.trim() : v);
const LEDGER = (clean(process.env.DEVNET_LEDGER_URL) ?? '').replace(/\/$/, '');
const USER_ID = clean(process.env.LEDGER_USER_ID) ?? '6';
const OAUTH = clean(process.env.DEVNET_TOKEN_URL) ? {
  url: clean(process.env.DEVNET_TOKEN_URL), clientId: clean(process.env.DEVNET_CLIENT_ID),
  clientSecret: clean(process.env.DEVNET_CLIENT_SECRET), audience: clean(process.env.DEVNET_AUDIENCE),
  scope: clean(process.env.DEVNET_SCOPE),
} : null;

// Public (non-secret) party ids — matches scripts/devnet.parties.json. Override
// with the DEVNET_PARTIES env var (a JSON object) after a re-seed.
const PARTIES = (() => {
  try { return JSON.parse(process.env.DEVNET_PARTIES); } catch {}
  const s = '::1220a14ca128063b8dc9d1ebb0bd22633be9f2168500f4dbc1ecaeb1855b14e5acf8';
  return { buyer: 'bisik-v4-buyer' + s, dealerA: 'bisik-v4-dealerA' + s, dealerB: 'bisik-v4-dealerB' + s,
    regulator: 'bisik-v4-regulator' + s, cashIssuer: 'bisik-v4-cashissuer' + s, bondIssuer: 'bisik-v4-bondissuer' + s };
})();

// The exact read endpoints the desk needs. Anything else — above all the write
// path /v2/commands/* — is denied here, before any token is ever attached.
const ALLOW = [
  { m: 'GET', p: 'v2/state/ledger-end' },
  { m: 'POST', p: 'v2/state/active-contracts' }, // a POST, but a read (query)
  { m: 'GET', p: 'v2/parties' },
];

let tok = null, tokExp = 0;
async function token() {
  if (!OAUTH) return null;
  if (tok && Date.now() < tokExp) return tok;
  const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: OAUTH.clientId,
    client_secret: OAUTH.clientSecret, audience: OAUTH.audience, scope: OAUTH.scope });
  const r = await fetch(OAUTH.url, { method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  const j = await r.json();
  if (!j.access_token) throw new Error('token fetch failed');
  tok = j.access_token.trim();
  tokExp = Date.now() + ((Number(j.expires_in) || 360) - 30) * 1000;
  return tok;
}

export default async function handler(req, res) {
  const raw = req.query?.path;
  const path = (Array.isArray(raw) ? raw.join('/') : String(raw ?? '')).replace(/^\/+/, '');

  if (path === 'config') return res.status(200).json({ userId: USER_ID, parties: PARTIES, readOnly: true });

  if (!ALLOW.some((a) => a.p === path && a.m === req.method))
    return res.status(403).json({ error: 'read-only public demo — writes are disabled', readOnly: true });

  // Defense-in-depth on a SHARED validator: active-contracts is a read, but scope
  // it to THIS desk's own parties. Otherwise a public caller could reuse the shared
  // M2M token to enumerate any other party the token happens to have readAs for.
  if (path === 'v2/state/active-contracts') {
    const known = new Set(Object.values(PARTIES));
    const asked = Object.keys(req.body?.filter?.filtersByParty ?? {});
    if (!asked.length || !asked.every((p) => known.has(p)))
      return res.status(403).json({ error: 'read-only demo: queries are scoped to the Bisik desk parties', readOnly: true });
  }
  if (!LEDGER) return res.status(500).json({ error: 'ledger not configured (set DEVNET_LEDGER_URL)' });

  try {
    const t = await token();
    const r = await fetch(`${LEDGER}/${path}`, {
      method: req.method,
      headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) },
      body: req.method === 'POST' ? JSON.stringify(req.body ?? {}) : undefined,
    });
    const text = await r.text();
    res.status(r.status);
    res.setHeader('content-type', r.headers.get('content-type') ?? 'application/json');
    return res.send(text);
  } catch (e) {
    return res.status(502).json({ error: 'ledger unreachable: ' + (e?.message ?? e) });
  }
}
