#!/usr/bin/env node
// Bisik MCP server — exposes the confidential RFQ desk to AI agents as read-only
// tools over the Canton JSON Ledger API. This is the "agentic commerce" angle:
// an agent can audit the post-trade record AND verify Canton's privacy model for
// itself (query as any party and see it only ever receives its own data).
//
// Read-only by construction — no command submission, no signing. Reads the same
// gitignored scripts/.env.devnet and scripts/devnet.parties.json the deployer uses.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

function loadEnv() {
  const e = {};
  try {
    for (const line of readFileSync(join(HERE, '..', 'scripts', '.env.devnet'), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) e[m[1]] = m[2];
    }
  } catch {}
  // Allow env-var overrides (e.g. LEDGER_JSON_URL for a local sandbox with no auth).
  return { ...e, ...process.env };
}
const ENV = loadEnv();
const LEDGER = (ENV.LEDGER_JSON_URL ?? ENV.DEVNET_LEDGER_URL ?? 'http://localhost:7575').replace(/\/$/, '');
const OAUTH = ENV.DEVNET_TOKEN_URL ? {
  url: ENV.DEVNET_TOKEN_URL, clientId: ENV.DEVNET_CLIENT_ID, clientSecret: ENV.DEVNET_CLIENT_SECRET,
  audience: ENV.DEVNET_AUDIENCE, scope: ENV.DEVNET_SCOPE,
} : null;

let PARTIES = {};
try { PARTIES = readJson(join(HERE, '..', 'scripts', 'devnet.parties.json')); } catch {}

let tok = null, tokExp = 0;
async function token() {
  if (!OAUTH) return null;
  if (tok && Date.now() < tokExp) return tok;
  const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: OAUTH.clientId,
    client_secret: OAUTH.clientSecret, audience: OAUTH.audience, scope: OAUTH.scope });
  const r = await fetch(OAUTH.url, { method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  const j = JSON.parse(await r.text());
  if (!j.access_token) throw new Error('token fetch failed');
  tok = j.access_token.trim();
  tokExp = Date.now() + ((Number(j.expires_in) || 360) - 30) * 1000;
  return tok;
}

async function api(path, opts = {}) {
  for (let i = 0; i < 4; i++) {
    try {
      const t = await token();
      const headers = { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) };
      const r = await fetch(LEDGER + path, { ...opts, headers });
      const text = await r.text();
      let data; try { data = JSON.parse(text); } catch { data = text; }
      if (r.ok || ![429, 500, 502, 503, 504].includes(r.status)) return { ok: r.ok, status: r.status, data };
    } catch (e) { if (i === 3) throw e; }
    await new Promise((res) => setTimeout(res, 900 * (i + 1)));
  }
  throw new Error('ledger unreachable after retries');
}

async function acsAs(party) {
  const end = await api('/v2/state/ledger-end');
  const off = end.data?.offset;
  if (typeof off !== 'number') throw new Error('ledger returned no offset');
  const r = await api('/v2/state/active-contracts', { method: 'POST', body: JSON.stringify({
    filter: { filtersByParty: { [party]: { cumulative: [] } } }, verbose: true, activeAtOffset: off }) });
  if (!Array.isArray(r.data)) throw new Error('active-contracts returned no array');
  return r.data.map((x) => x.contractEntry?.JsActiveContract?.createdEvent).filter(Boolean)
    .map((e) => ({ tpl: e.templateId.split(':').slice(-1)[0], arg: e.createArgument }));
}

const resolveParty = (roleOrId) => PARTIES[roleOrId] ?? roleOrId;

const TOOLS = [
  {
    name: 'explain_desk',
    description: 'Explain what the Bisik confidential RFQ desk is and how its privacy model works. No ledger call.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_settlements',
    description: 'The post-trade audit trail: settled trades visible to the regulator (instrument, quantity, Vickrey clearing price). This is all the regulator can see — nothing about the RFQ or the losing quotes.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'party_view',
    description: "Verify Canton's sub-transaction privacy: return the on-ledger contract counts a given party actually receives. A dealer sees only its own quote; the regulator sees no pre-trade flow. Proves the privacy model to an agent.",
    inputSchema: {
      type: 'object',
      properties: { party: { type: 'string', description: 'A role (buyer, dealerA, dealerB, regulator, cashIssuer, bondIssuer) or a full party id.' } },
      required: ['party'],
    },
  },
  {
    name: 'market_snapshot',
    description: 'High-level desk state from the regulator/buyer viewpoint: open RFQs and settled trades.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'best_execution',
    description: "Provable best execution WITHOUT a public order book. For each settled trade the regulator can see, compare the executed clearing price against the sealed competing asks that were selectively disclosed to the regulator, and report whether the buyer's price beat every disclosed rival. This is the institutional payoff of Canton: confidential pre-trade, provable post-trade.",
    inputSchema: { type: 'object', properties: {} },
  },
];

const text = (s) => ({ content: [{ type: 'text', text: s }] });

async function handle(name, args) {
  if (name === 'explain_desk') {
    return text([
      'Bisik is a confidential multi-dealer RFQ (request-for-quote) OTC desk, built native on the Canton Network.',
      '',
      '• A buyer requests quotes from a chosen dealer panel. The market never sees the RFQ.',
      '• Each dealer answers with a SEALED quote — rival dealers never receive it (Canton sub-transaction privacy:',
      "  the ledger never sends a dealer's node the other dealers' quotes; it isn't UI-hidden, it's never transmitted).",
      '• The dealer locks the asset into escrow; it cannot be pulled back mid-auction.',
      '• The buyer awards: cheapest ask wins, paid the SECOND-cheapest price (reverse Vickrey), settled atomically',
      '  delivery-versus-payment (cash to dealer + asset to buyer, both legs or neither).',
      '• A regulator observes the executed trade — and only the executed trade (auditable post-trade,',
      '  confidential pre-trade).',
      '',
      'This MCP server is read-only. Deployed live on Canton Devnet.',
    ].join('\n'));
  }
  if (name === 'list_settlements') {
    const reg = resolveParty('regulator');
    if (!reg) return text('No regulator party configured (scripts/devnet.parties.json missing).');
    const ev = await acsAs(reg);
    const reports = ev.filter((e) => e.tpl === 'TradeReport');
    const baskets = ev.filter((e) => e.tpl === 'BasketTradeReport');
    if (!reports.length && !baskets.length) return text('No settled trades yet. The regulator has zero visibility into live RFQs or sealed quotes.');
    const lines = [
      ...reports.map((r) => `• ${r.arg.instrument} × ${r.arg.quantity} @ ${r.arg.clearingPrice} — dealer ${String(r.arg.dealer).split('::')[0]}`),
      ...baskets.map((r) => `• basket [${r.arg.legs.map((l) => `${l.instrument}×${l.quantity}`).join(' + ')}] @ ${r.arg.clearingPrice} — dealer ${String(r.arg.dealer).split('::')[0]}`),
    ];
    return text('Settled trades (regulator audit trail):\n' + lines.join('\n'));
  }
  if (name === 'party_view') {
    const party = resolveParty(args?.party);
    if (!party) return text('Unknown party. Configure scripts/devnet.parties.json or pass a full party id.');
    const ev = await acsAs(party);
    const byTpl = {};
    for (const e of ev) byTpl[e.tpl] = (byTpl[e.tpl] ?? 0) + 1;
    const quotes = ev.filter((e) => e.tpl === 'Quote').map((e) => String(e.arg.dealer).split('::')[0]);
    return text([
      `On-ledger view for ${String(party).split('::')[0]}:`,
      `  contracts: ${JSON.stringify(byTpl)}`,
      quotes.length ? `  quotes visible: from ${[...new Set(quotes)].join(', ')} (only its own if a dealer)` : '  quotes visible: none',
      '',
      'Each party receives only the contracts it is a stakeholder of — this is Canton sub-transaction privacy, verified live.',
    ].join('\n'));
  }
  if (name === 'market_snapshot') {
    const buyer = resolveParty('buyer'); const reg = resolveParty('regulator');
    if (!buyer) return text('No parties configured (scripts/devnet.parties.json missing).');
    const [bev, rev] = await Promise.all([acsAs(buyer), reg ? acsAs(reg) : Promise.resolve([])]);
    const openRfqs = bev.filter((e) => e.tpl === 'RFQ').length;
    const liveQuotes = bev.filter((e) => e.tpl === 'Quote').length;
    const settled = rev.filter((e) => e.tpl === 'TradeReport' || e.tpl === 'BasketTradeReport').length;
    return text(`Desk snapshot:\n  open RFQs: ${openRfqs}\n  sealed quotes in flight (buyer view): ${liveQuotes}\n  settled trades: ${settled}`);
  }
  if (name === 'best_execution') {
    const reg = resolveParty('regulator');
    if (!reg) return text('No regulator party configured (scripts/devnet.parties.json missing).');
    const ev = await acsAs(reg);
    const reports = ev.filter((e) => e.tpl === 'TradeReport');
    if (!reports.length) return text('No settled trades yet — nothing to attest.');
    const disc = ev.filter((e) => e.tpl === 'QuoteDisclosure');
    const byInst = {};
    for (const d of disc) {
      const unit = Number(d.arg.price) / Number(d.arg.quantity);
      (byInst[d.arg.instrument] ??= []).push({ dealer: String(d.arg.dealer).split('::')[0], unit, price: Number(d.arg.price) });
    }
    // Disclosures carry no per-auction id, so they match a settlement only by
    // instrument; if an instrument settled more than once, don't attest the pooled set.
    const instCount = {};
    for (const r of reports) instCount[r.arg.instrument] = (instCount[r.arg.instrument] ?? 0) + 1;
    const lines = reports.map((r) => {
      const inst = r.arg.instrument;
      const clrUnit = Number(r.arg.clearingPrice) / Number(r.arg.quantity);
      const asks = (byInst[inst] ?? []).slice().sort((a, b) => a.unit - b.unit);
      if (asks.length && instCount[inst] > 1) return `• ${inst} × ${r.arg.quantity} @ ${r.arg.clearingPrice} — ambiguous: instrument settled more than once; disclosed asks can't be tied to one trade.`;
      if (!asks.length) return `• ${inst} × ${r.arg.quantity} @ ${r.arg.clearingPrice} — no competing asks disclosed to the regulator; best execution not yet provable (reveal them on demand).`;
      const winner = asks[0];
      const ok = clrUnit + 1e-9 >= winner.unit && asks.every((x) => x === winner || x.unit + 1e-9 >= clrUnit);
      const detail = asks.map((x) => `${x.dealer} ${x.price}${x === winner ? ' (winner, lowest)' : ''}`).join(', ');
      return `• ${inst} × ${r.arg.quantity} @ ${r.arg.clearingPrice} — ${ok ? 'BEST EXECUTION ATTESTED ✓' : 'incomplete disclosure'}; disclosed asks: ${detail}`;
    });
    return text('Provable best execution (regulator view — no public order book):\n' + lines.join('\n') +
      '\n\nEach line compares the executed price to the sealed asks the counterparties selectively disclosed to the regulator. Confidential pre-trade, provable post-trade — Canton selective disclosure.');
  }
  throw new Error('unknown tool: ' + name);
}

const server = new Server({ name: 'bisik', version: '0.6.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  try { return await handle(req.params.name, req.params.arguments); }
  catch (e) { return { content: [{ type: 'text', text: 'error: ' + (e?.message ?? e) }], isError: true }; }
});

await server.connect(new StdioServerTransport());
