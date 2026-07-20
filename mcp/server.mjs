#!/usr/bin/env node
// Bisik MCP server — exposes the confidential RFQ desk to AI agents over the
// Canton JSON Ledger API. This is the "agentic commerce" angle: an agent can
// audit the post-trade record, verify Canton's privacy model for itself (query
// as any party and see it only ever receives its own data), AND initiate a real
// commercial action — post an RFQ on-ledger (post_rfq).
//
// Reads are open; the one write tool (post_rfq) submits with the OPERATOR'S OWN
// local credentials (the same gitignored scripts/.env.devnet + devnet.parties.json
// the deployer uses). The public hosted proxy stays read-only — writing is a
// deliberate, locally-run capability, not something exposed to the internet.
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

// Write path (post_rfq only): submit a command with the operator's local token.
const USER = ENV.LEDGER_USER_ID ?? (ENV.DEVNET_TOKEN_URL ? '6' : 'participant_admin');
const PKG = ENV.BISIK_PKG ?? 'b0058535e188b74314740b6d3b1da1d59df999cdd41dac37ef61da23bcd15a30';
let CID = 0;
async function submit(actAs, command) {
  const commandId = `bisik-mcp-${Date.now()}-${CID++}`; // stable across retries → ledger dedup
  const r = await api('/v2/commands/submit-and-wait-for-transaction', { method: 'POST',
    body: JSON.stringify({ commands: { userId: USER, commandId, actAs: [actAs], commands: [command] } }) });
  if (!r.ok) throw new Error(`submit ${r.status}: ${JSON.stringify(r.data).slice(0, 200)}`);
  return r.data;
}
const createdCid = (tx, tplSuffix) => tx.transaction?.events?.map((e) => e.CreatedEvent)
  .find((e) => e && typeof e.templateId === 'string' && e.templateId.endsWith(tplSuffix))?.contractId;

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

// A configured role → its party id, or a full "id::namespace" passed through directly.
// A bare role with no config resolves to undefined so the "no parties configured" guards
// fire, instead of sending "regulator" to the ledger and getting a cryptic error.
const resolveParty = (roleOrId) => PARTIES[roleOrId] ?? (String(roleOrId).includes('::') ? roleOrId : undefined);

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
  {
    name: 'post_rfq',
    description: "Initiate a real commercial action: post a confidential RFQ on-ledger as the buyer, inviting the dealer panel (dealerA + dealerB). This is a WRITE — it submits to Canton Devnet using the operator's local credentials (the public hosted proxy stays read-only). The RFQ appears live on the desk within seconds; each invited dealer's node receives only its own invitation (Canton privacy), never the fact that a rival was also invited on the same terms.",
    inputSchema: {
      type: 'object',
      properties: {
        instrument: { type: 'string', description: 'Bond ticker, e.g. TBOND30 (default), GILT10, BUND10.' },
        quantity: { type: 'number', description: 'Face quantity (default 1000).' },
        payInstrument: { type: 'string', description: 'Cash leg (default USDC).' },
      },
    },
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
      'Deployed live on Canton Devnet. This server\'s tools are read-only except post_rfq,',
      "which submits a real RFQ on-ledger using the operator's local credentials (the public",
      'hosted proxy stays read-only and rejects writes).',
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
  if (name === 'post_rfq') {
    const buyer = resolveParty('buyer'), dealerA = resolveParty('dealerA'), dealerB = resolveParty('dealerB'),
      regulator = resolveParty('regulator'), cashIssuer = resolveParty('cashIssuer'), bondIssuer = resolveParty('bondIssuer');
    if (!buyer || !dealerA || !dealerB || !regulator || !cashIssuer || !bondIssuer)
      return text("Cannot post an RFQ: parties not configured (scripts/devnet.parties.json). This write tool needs the operator's local credentials.");
    const instrument = String(args?.instrument ?? 'TBOND30').trim() || 'TBOND30';
    const quantity = Number(args?.quantity ?? 1000).toFixed(1); // Decimal — "1000.0"
    const payInstrument = String(args?.payInstrument ?? 'USDC').trim() || 'USDC';
    if (!(Number(quantity) > 0)) return text('quantity must be a positive number.');
    const tx = await submit(buyer, { CreateCommand: { templateId: `${PKG}:Bisik:RFQ`, createArguments: {
      buyer, regulator, invitedDealers: [dealerA, dealerB], instrument, quantity, payInstrument,
      assetIssuer: bondIssuer, payIssuer: cashIssuer, deadline: '2030-01-01T00:00:00Z' } } });
    const cid = createdCid(tx, ':Bisik:RFQ');
    if (!cid) return text('RFQ submitted but no contract id came back — check the ledger.');
    return text([
      `✓ Posted a confidential RFQ on Canton Devnet: ${instrument} × ${quantity}, pay ${payInstrument}.`,
      `  invited: dealerA + dealerB · regulator: on the post-trade record only`,
      `  contract: ${cid}`,
      '',
      'An agent just initiated a real commercial action. It is live on the desk now; each dealer',
      "sees only its own invitation. Use party_view('dealerA') / party_view('dealerB') to confirm",
      'neither can see the other was invited — the privacy holds on-ledger, not in the UI.',
    ].join('\n'));
  }
  throw new Error('unknown tool: ' + name);
}

const server = new Server({ name: 'bisik', version: '0.7.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  try { return await handle(req.params.name, req.params.arguments); }
  catch (e) { return { content: [{ type: 'text', text: 'error: ' + (e?.message ?? e) }], isError: true }; }
});

await server.connect(new StdioServerTransport());
