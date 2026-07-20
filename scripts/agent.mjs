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
  const off = (await api('/v2/state/ledger-end')).data?.offset;
  if (typeof off !== 'number') throw new Error('ledger-end returned no offset (ledger unreachable?)');
  const r = await api('/v2/state/active-contracts', { method: 'POST', json: {
    filter: { filtersByParty: { [party]: { cumulative: [] } } }, verbose: true, activeAtOffset: off } });
  return (Array.isArray(r.data) ? r.data : []).map((x) => x.contractEntry?.JsActiveContract?.createdEvent)
    .filter(Boolean).map((e) => ({ cid: e.contractId, tpl: e.templateId, arg: e.createArgument }));
}
const isT = (c, n) => typeof c.tpl === 'string' && c.tpl.endsWith('Bisik:' + n);

async function discoverPkg() {
  // Fast path: on a busy shared validator, scanning every party's ACS is slow —
  // let BISIK_PKG name the package id directly (same knob devnet.mjs uses).
  if (ENV.BISIK_PKG) return ENV.BISIK_PKG;
  const parties = (await api('/v2/parties')).data?.partyDetails ?? [];
  for (const p of parties) {
    const any = (await acs(p.party)).find((c) => typeof c.tpl === 'string' && c.tpl.includes(':Bisik:'));
    if (any) return any.tpl.split(':')[0];
  }
  throw new Error('no Bisik package on the ledger — deploy/seed first');
}

// The agent's pricing decision: a fixed reference ask plus a configurable markup.
const priceFor = (markupBps = MARKUP_BPS) => (REF_PRICE * (1 + markupBps / 10000)).toFixed(1);

// One pass of the agent loop: quote every RFQ this dealer is invited to, has a
// matching unpledged asset for, and hasn't already quoted.
async function quotePass(pkg, dealer, markupBps = MARKUP_BPS) {
  const mine = await acs(dealer);
  const rfqs = mine.filter((c) => isT(c, 'RFQ'));
  const alreadyQuotedRfq = new Set(mine.filter((c) => isT(c, 'Quote') && c.arg.dealer === dealer).map((c) => c.arg.rfqId));
  const bonds = mine.filter((c) => isT(c, 'Holding') && c.arg.owner === dealer);
  let quoted = 0;
  for (const r of rfqs) {
    if (alreadyQuotedRfq.has(r.cid)) continue;
    const bond = bonds.find((b) => b.arg.instrument === r.arg.instrument && Number(b.arg.amount) === Number(r.arg.quantity));
    if (!bond) { console.log(`· skip RFQ ${r.arg.instrument} ×${r.arg.quantity} — no matching asset`); continue; }
    const price = priceFor(markupBps);
    await submit(dealer, { ExerciseCommand: { templateId: r.tpl, contractId: r.cid, choice: 'SubmitQuote',
      choiceArgument: { dealer, price, assetCid: bond.cid } } });
    console.log(`· detected RFQ ${r.arg.instrument} ×${r.arg.quantity} → sealed quote ${Number(price).toLocaleString()} (ref ${REF_PRICE.toLocaleString()} + ${markupBps}bps)`);
    quoted++;
  }
  return quoted;
}

async function demo() {
  const pkg = await discoverPkg();
  console.log('agent online · package', pkg.slice(0, 8), '· ledger', LEDGER);
  // Unique party hints per run so the demo is cleanly repeatable on a shared ledger.
  const RUN = Date.now().toString(36).slice(-5);
  const [buyer, dealerA, dealerB, regulator, cashIssuer, bondIssuer] = await Promise.all(
    [`AgentBuyer-${RUN}`, `MarketMakerA-${RUN}`, `MarketMakerB-${RUN}`, `AgentReg-${RUN}`, `AgentCash-${RUN}`, `AgentBond-${RUN}`].map(allocate));
  const H = (issuer, owner, instrument, amount) => ({ CreateCommand: { templateId: `${pkg}:Bisik:Holding`,
    createArguments: { issuer, owner, instrument, amount } } });
  await submit(cashIssuer, H(cashIssuer, buyer, 'USDC', '5000000.0'));
  await submit(bondIssuer, H(bondIssuer, dealerA, 'TBOND30', '1000.0'));
  await submit(bondIssuer, H(bondIssuer, dealerB, 'TBOND30', '1000.0'));
  // A human/other system posts the RFQ, inviting both market-maker agents.
  const rfq = cidOf(await submit(buyer, { CreateCommand: { templateId: `${pkg}:Bisik:RFQ`, createArguments: {
    buyer, regulator, invitedDealers: [dealerA, dealerB], instrument: 'TBOND30', quantity: '1000.0', payInstrument: 'USDC',
    assetIssuer: bondIssuer, payIssuer: cashIssuer, deadline: '2030-01-01T00:00:00Z' } } }));
  console.log('· a buyer posted an RFQ (TBOND30 ×1000), inviting two market-maker agents\n');

  console.log('agents watching…');
  // Each dealer-agent prices independently, blind to the rival — different markups.
  const nA = await quotePass(pkg, dealerA, 80);   // MarketMaker A: +0.80%
  const nB = await quotePass(pkg, dealerB, 140);  // MarketMaker B: +1.40%
  if (nA !== 1 || nB !== 1) throw new Error(`expected 1 quote from each agent, got A=${nA} B=${nB}`);

  // Privacy proof: on the ledger, each dealer's node holds only its own quote.
  const aSees = (await acs(dealerA)).filter((c) => isT(c, 'Quote'));
  const bSees = (await acs(dealerB)).filter((c) => isT(c, 'Quote'));
  if (aSees.length !== 1 || bSees.length !== 1) throw new Error('privacy check failed — a dealer saw more than its own quote');
  console.log('· each dealer-agent sees exactly its own quote — blind to the rival ✓');

  // Autonomous buyer-agent: read the sealed quotes, award. The buyer never sets a
  // price — the on-ledger Award choice picks the winner and clears at the Vickrey
  // (second) price. Two software agents coordinate a real trade, privately.
  const buyerAcs = await acs(buyer);
  const myQuotes = buyerAcs.filter((c) => isT(c, 'Quote') && c.arg.rfqId === rfq);
  if (myQuotes.length !== 2) throw new Error(`buyer expected 2 sealed quotes, saw ${myQuotes.length}`);
  const cash = buyerAcs.find((c) => isT(c, 'Holding') && c.arg.instrument === 'USDC');
  // Award settles DvP atomically: one tx emits the TradeReport plus the bond/cash
  // transfers, so pick the TradeReport out of the created events by template.
  const awardTx = await submit(buyer, { ExerciseCommand: { templateId: `${pkg}:Bisik:RFQ`, contractId: rfq,
    choice: 'Award', choiceArgument: { quoteCids: myQuotes.map((q) => q.cid), cashCid: cash.cid } } });
  const trEv = awardTx.transaction?.events?.map((e) => e.CreatedEvent).find((e) => e && e.templateId.endsWith(':Bisik:TradeReport'));
  if (!trEv) throw new Error('Award produced no TradeReport');
  const tr = trEv.contractId;

  // Verify the settled trade on the regulator's ledger — cleared at the SECOND
  // price, not the winner's own lower ask (proof the Vickrey rail ran on-chain).
  // This per-run regulator sees only this one trade.
  const report = (await acs(regulator)).find((c) => isT(c, 'TradeReport'));
  if (!report || report.cid !== tr) throw new Error('no matching TradeReport on the regulator ledger — settlement did not land');
  const priceA = priceFor(80), priceB = priceFor(140), cleared = report.arg.clearingPrice;
  console.log('\n✓ two agents negotiated and settled a real trade on-ledger:');
  console.log(`  · MarketMaker A asked ${Number(priceA).toLocaleString()} (+0.80%) — won`);
  console.log(`  · MarketMaker B asked ${Number(priceB).toLocaleString()} (+1.40%) — runner-up`);
  console.log(`  · cleared at ${Number(cleared).toLocaleString()} = the SECOND price (Vickrey), not the winner's ask`);
  console.log(`  · TradeReport ${tr.slice(0, 24)}… now on the regulator's ledger`);
  if (Number(cleared) !== Number(priceB)) throw new Error(`clearing ${cleared} != Vickrey second price ${priceB}`);
  // Idempotent: a re-quote pass places nothing new (quotes already consumed by settlement).
  const idle = (await quotePass(pkg, dealerA, 80)) + (await quotePass(pkg, dealerB, 140));
  if (idle !== 0) throw new Error(`expected no new quotes on re-run, placed ${idle}`);
  console.log('  · re-run placed 0 new quotes (idempotent) ✓');
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
