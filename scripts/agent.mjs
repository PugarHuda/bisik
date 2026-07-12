// Bisik autonomous market-maker agent — the "agent initiates a commercial action"
// side of agentic commerce. A software agent, acting as a dealer, watches the
// ledger for RFQs it's invited to and auto-submits a sealed quote priced by its
// own rule. It only ever sees its own invitations (Canton privacy), so it can't
// peek at rival quotes — it quotes blind, like a real market maker.
//
//   node scripts/agent.mjs demo            # self-contained: set up a scenario + quote it
//   node scripts/agent.mjs watch <dealer>  # keep quoting RFQs for an existing dealer party
//
// Defaults to the local sandbox (http://localhost:7575, no auth). Point at Devnet
// with LEDGER_ENV_FILE=scripts/.env.devnet (adds the OAuth Bearer).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REF_PRICE = Number(process.env.AGENT_REF_PRICE ?? 4200000); // agent's reference total ask
const MARKUP_BPS = Number(process.env.AGENT_MARKUP_BPS ?? 100);   // + 1.00% by default

function loadEnv() {
  const e = { ...process.env };
  const f = process.env.LEDGER_ENV_FILE;
  if (f) { try { for (const l of readFileSync(f, 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !e[m[1]]) e[m[1]] = m[2]; } } catch {} }
  return e;
}
const ENV = loadEnv();
const LEDGER = (ENV.LEDGER_JSON_URL ?? ENV.DEVNET_LEDGER_URL ?? 'http://localhost:7575').replace(/\/$/, '');
const USER = ENV.LEDGER_USER_ID ?? (ENV.DEVNET_TOKEN_URL ? '6' : 'participant_admin');
const OAUTH = ENV.DEVNET_TOKEN_URL ? { url: ENV.DEVNET_TOKEN_URL, clientId: ENV.DEVNET_CLIENT_ID,
  clientSecret: ENV.DEVNET_CLIENT_SECRET, audience: ENV.DEVNET_AUDIENCE, scope: ENV.DEVNET_SCOPE } : null;

let tok = null, tokExp = 0;
async function token() {
  if (!OAUTH) return null;
  if (tok && Date.now() < tokExp) return tok;
  const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: OAUTH.clientId,
    client_secret: OAUTH.clientSecret, audience: OAUTH.audience, scope: OAUTH.scope });
  const j = JSON.parse(await (await fetch(OAUTH.url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body })).text());
  tok = j.access_token.trim(); tokExp = Date.now() + ((Number(j.expires_in) || 360) - 30) * 1000; return tok;
}
async function api(path, { method = 'GET', json, retry = true } = {}) {
  for (let i = 0; i < (retry ? 5 : 1); i++) {
    try {
      const t = await token();
      const r = await fetch(LEDGER + path, { method,
        headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) },
        body: json !== undefined ? JSON.stringify(json) : undefined });
      const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
      if (r.ok || ![429, 500, 502, 503, 504].includes(r.status)) return { ok: r.ok, status: r.status, data };
    } catch (e) { if (!retry || i === 4) throw e; }
    await new Promise((res) => setTimeout(res, 900 * (i + 1)));
  }
  throw new Error('ledger unreachable');
}
const cidOf = (tx) => tx.transaction?.events?.find((e) => e.CreatedEvent)?.CreatedEvent?.contractId;
let CID = 0;
async function submit(actAs, cmd) {
  const r = await api('/v2/commands/submit-and-wait-for-transaction', { method: 'POST',
    json: { commands: { userId: USER, commandId: `agent-${Date.now()}-${CID++}`, actAs: [actAs], commands: [cmd] } } });
  if (!r.ok) throw new Error(`submit ${r.status}: ${JSON.stringify(r.data).slice(0, 200)}`);
  return r.data;
}
async function grant(party) {
  await api(`/v2/users/${USER}/rights`, { method: 'POST', json: { userId: USER, identityProviderId: '',
    rights: [{ kind: { CanActAs: { value: { party } } } }, { kind: { CanReadAs: { value: { party } } } }] } });
}
async function allocate(hint) {
  const r = await api('/v2/parties', { method: 'POST', json: { partyIdHint: hint, identityProviderId: '' } });
  const party = r.data?.partyDetails?.party;
  if (!party) throw new Error('allocate failed: ' + JSON.stringify(r.data).slice(0, 160));
  try { await grant(party); } catch {} // no-op if admin already acts-as-any
  return party;
}
async function acs(party) {
  const off = (await api('/v2/state/ledger-end')).data.offset;
  const r = await api('/v2/state/active-contracts', { method: 'POST', json: {
    filter: { filtersByParty: { [party]: { cumulative: [] } } }, verbose: true, activeAtOffset: off } });
  return (Array.isArray(r.data) ? r.data : []).map((x) => x.contractEntry?.JsActiveContract?.createdEvent)
    .filter(Boolean).map((e) => ({ cid: e.contractId, tpl: e.templateId, arg: e.createArgument }));
}
const isT = (c, n) => typeof c.tpl === 'string' && c.tpl.endsWith('Bisik:' + n);

async function discoverPkg() {
  const parties = (await api('/v2/parties')).data?.partyDetails ?? [];
  for (const p of parties) {
    const any = (await acs(p.party)).find((c) => typeof c.tpl === 'string' && c.tpl.includes(':Bisik:'));
    if (any) return any.tpl.split(':')[0];
  }
  throw new Error('no Bisik package on the ledger — deploy/seed first');
}

// The agent's pricing decision: a fixed reference ask plus a configurable markup.
const priceFor = () => (REF_PRICE * (1 + MARKUP_BPS / 10000)).toFixed(1);

// One pass of the agent loop: quote every RFQ this dealer is invited to, has a
// matching unpledged asset for, and hasn't already quoted.
async function quotePass(pkg, dealer) {
  const mine = await acs(dealer);
  const rfqs = mine.filter((c) => isT(c, 'RFQ'));
  const alreadyQuotedRfq = new Set(mine.filter((c) => isT(c, 'Quote') && c.arg.dealer === dealer).map((c) => c.arg.rfqId));
  const bonds = mine.filter((c) => isT(c, 'Holding') && c.arg.owner === dealer);
  let quoted = 0;
  for (const r of rfqs) {
    if (alreadyQuotedRfq.has(r.cid)) continue;
    const bond = bonds.find((b) => b.arg.instrument === r.arg.instrument && Number(b.arg.amount) === Number(r.arg.quantity));
    if (!bond) { console.log(`· skip RFQ ${r.arg.instrument} ×${r.arg.quantity} — no matching asset`); continue; }
    const price = priceFor();
    await submit(dealer, { ExerciseCommand: { templateId: r.tpl, contractId: r.cid, choice: 'SubmitQuote',
      choiceArgument: { dealer, price, assetCid: bond.cid } } });
    console.log(`· detected RFQ ${r.arg.instrument} ×${r.arg.quantity} → sealed quote ${Number(price).toLocaleString()} (ref ${REF_PRICE.toLocaleString()} + ${MARKUP_BPS}bps)`);
    quoted++;
  }
  return quoted;
}

async function demo() {
  const pkg = await discoverPkg();
  console.log('agent online · package', pkg.slice(0, 8), '· ledger', LEDGER);
  const [buyer, dealer, regulator, cashIssuer, bondIssuer] = await Promise.all(
    ['AgentBuyer', 'MarketMaker', 'AgentRegulator', 'AgentCash', 'AgentBond'].map(allocate));
  const H = (issuer, owner, instrument, amount) => ({ CreateCommand: { templateId: `${pkg}:Bisik:Holding`,
    createArguments: { issuer, owner, instrument, amount } } });
  await submit(cashIssuer, H(cashIssuer, buyer, 'USDC', '5000000.0'));
  await submit(bondIssuer, H(bondIssuer, dealer, 'TBOND30', '1000.0'));
  // A human/other-system posts the RFQ inviting our market-maker agent.
  const rfq = cidOf(await submit(buyer, { CreateCommand: { templateId: `${pkg}:Bisik:RFQ`, createArguments: {
    buyer, regulator, invitedDealers: [dealer], instrument: 'TBOND30', quantity: '1000.0', payInstrument: 'USDC',
    assetIssuer: bondIssuer, payIssuer: cashIssuer } } }));
  console.log('· a buyer posted an RFQ (TBOND30 ×1000), inviting the market-maker\n');

  console.log('agent watching…');
  const n = await quotePass(pkg, dealer);           // autonomous reaction
  if (n !== 1) throw new Error(`expected the agent to place 1 quote, placed ${n}`);
  // Prove it landed, sealed to the buyer.
  const buyerSees = (await acs(buyer)).filter((c) => isT(c, 'Quote'));
  const idle = await quotePass(pkg, dealer);         // idempotent: nothing new to do
  console.log(`\n✓ buyer received ${buyerSees.length} sealed quote from the agent; re-run placed ${idle} (idempotent).`);
  if (buyerSees.length !== 1 || idle !== 0) throw new Error('agent verification failed');
}

const cmd = process.argv[2];
(async () => {
  if (cmd === 'demo') await demo();
  else if (cmd === 'watch') {
    const dealer = process.argv[3];
    if (!dealer) return console.log('usage: agent.mjs watch <full-dealer-party-id>');
    const pkg = await discoverPkg();
    console.log(`market-maker watching for RFQs as ${dealer.split('::')[0]} (ref ${REF_PRICE} + ${MARKUP_BPS}bps)…`);
    for (;;) { try { await quotePass(pkg, dealer); } catch (e) { console.error('· ', e.message); } await new Promise((r) => setTimeout(r, 3000)); }
  } else console.log('usage: demo | watch <dealer>');
})().catch((e) => { console.error('agent error:', e.message); process.exit(1); });
