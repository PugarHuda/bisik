// Bisik DevNet deploy/seed against the shared 5N hackathon validator.
// Reads scripts/.env.devnet (gitignored). Node >= 20.
//   node scripts/devnet.mjs probe
//   node scripts/devnet.mjs upload .daml/dist/bisik-otc-0.6.0.dar
//   node scripts/devnet.mjs allocate
//   node scripts/devnet.mjs seed
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

async function loadEnv() {
  const txt = await readFile(join(HERE, '.env.devnet'), 'utf8');
  const e = {};
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) e[m[1]] = m[2];
  }
  return e;
}

let ENV, TOKEN, TOKEN_AT = 0;
const L = () => ENV.DEVNET_LEDGER_URL.replace(/\/$/, '');

async function token() {
  if (TOKEN && Date.now() - TOKEN_AT < 6 * 60 * 1000) return TOKEN; // reuse ~6min
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: ENV.DEVNET_CLIENT_ID,
    client_secret: ENV.DEVNET_CLIENT_SECRET,
    audience: ENV.DEVNET_AUDIENCE,
    scope: ENV.DEVNET_SCOPE,
  });
  let lastErr;
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch(ENV.DEVNET_TOKEN_URL, {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body,
      });
      const t = await r.text();
      const j = JSON.parse(t);
      if (j.access_token) { TOKEN = j.access_token.trim(); TOKEN_AT = Date.now(); return TOKEN; }
      lastErr = new Error('no access_token: ' + t.slice(0, 120));
    } catch (e) { lastErr = e; }
    await new Promise((r) => setTimeout(r, 800 * (i + 1)));
  }
  throw lastErr;
}

async function api(path, { method = 'GET', json, raw, contentType, retry = false } = {}) {
  let last;
  for (let i = 0; i < (retry ? 5 : 1); i++) {
    try {
      const t = await token();
      const headers = { authorization: `Bearer ${t}` };
      let body;
      if (json !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(json); }
      else if (raw !== undefined) { headers['content-type'] = contentType ?? 'application/octet-stream'; body = raw; }
      const r = await fetch(L() + path, { method, headers, body });
      const text = await r.text();
      let data; try { data = JSON.parse(text); } catch { data = text; }
      if (r.ok || !retry || ![429, 500, 502, 503, 504].includes(r.status)) return { status: r.status, ok: r.ok, data };
      last = `HTTP ${r.status}`;
    } catch (e) { last = e; if (!retry) throw e; }
    await new Promise((res) => setTimeout(res, 1200 * (i + 1)));
  }
  throw new Error('read failed after retries: ' + last);
}

const P = () => 'participant_admin'; // userId is derived from token sub; unused for commands here
const NS = { value: null };

// ---- commands ----
async function probe() {
  const end = await api('/v2/state/ledger-end');
  console.log('ledger-end:', end.status, JSON.stringify(end.data));
  const ver = await api('/v2/version');
  console.log('version:', ver.status, typeof ver.data === 'object' ? ver.data.version : ver.data);
  const parties = await api('/v2/parties');
  const list = parties.data?.partyDetails ?? [];
  console.log('parties:', parties.status, 'count=', list.length);
  for (const p of list.slice(0, 8)) console.log('   ', p.party);
  // who am I / rights
  const me = await api('/v2/users/6');
  console.log('user 6:', me.status, JSON.stringify(me.data).slice(0, 200));
  const rights = await api('/v2/users/6/rights');
  console.log('user 6 rights:', rights.status, JSON.stringify(rights.data).slice(0, 400));
}

async function upload(darPath) {
  const bytes = await readFile(join(ROOT, darPath));
  // retry: the shared validator returns 503 (gateway timeout) under load; the
  // package upload + vetting can still need several tries to land a clean 200.
  const r = await api('/v2/packages', { method: 'POST', raw: bytes, retry: true });
  console.log('upload:', r.status, JSON.stringify(r.data).slice(0, 200));
}

const USER = '6';
// v2 party set — isolates this deployment's (new package) contracts from any
// earlier ones on the shared validator, so party queries return only our data.
const HINTS = {
  buyer: 'bisik-v6-buyer', dealerA: 'bisik-v6-dealerA', dealerB: 'bisik-v6-dealerB',
  regulator: 'bisik-v6-regulator', cashIssuer: 'bisik-v6-cashissuer', bondIssuer: 'bisik-v6-bondissuer',
};

async function namespace() {
  if (NS.value) return NS.value;
  const me = await api('/v2/users/' + USER);
  NS.value = me.data?.user?.primaryParty?.split('::')[1];
  return NS.value;
}

async function allocateOne(hint) {
  const r = await api('/v2/parties', { method: 'POST', retry: true, json: { partyIdHint: hint, identityProviderId: '' } });
  if (r.status === 200) return r.data?.partyDetails?.party;
  const cause = JSON.stringify(r.data);
  if (cause.includes('already allocated') || cause.includes('already exists')) {
    return `${hint}::${await namespace()}`; // idempotent on the shared namespace
  }
  console.log('  allocate failed for', hint, r.status, cause.slice(0, 160));
  return null;
}

async function grant(party) {
  const r = await api(`/v2/users/${USER}/rights`, { method: 'POST', json: {
    userId: USER,
    identityProviderId: '',
    rights: [
      { kind: { CanActAs: { value: { party } } } },
      { kind: { CanReadAs: { value: { party } } } },
    ],
  } });
  if (r.status !== 200 && process.env.DEBUG) console.log('  grant body:', JSON.stringify(r.data).slice(0, 300));
  return r.status;
}

async function allocate() {
  const out = {};
  for (const [role, hint] of Object.entries(HINTS)) {
    const party = await allocateOne(hint);
    if (!party) continue;
    const gs = await grant(party);
    out[role] = party;
    console.log(`${role.padEnd(11)} ${party}   grant=${gs}`);
  }
  await writeFile(join(HERE, 'devnet.parties.json'), JSON.stringify(out, null, 2));
  console.log('wrote scripts/devnet.parties.json');
}

// Main package id of .daml/dist/bisik-otc-0.6.0.dar. Regenerate after a model change
// with: daml damlc inspect-dar --json .daml/dist/bisik-otc-0.6.0.dar  (or set BISIK_PKG).
const PKG = process.env.BISIK_PKG ?? 'b0058535e188b74314740b6d3b1da1d59df999cdd41dac37ef61da23bcd15a30';
let CID = 0;
async function submit(actAs, command) {
  const commandId = `bisik-${Date.now()}-${CID++}`; // stable across retries → dedup on the ledger
  let last;
  for (let i = 0; i < 6; i++) {
    const r = await api('/v2/commands/submit-and-wait-for-transaction', { method: 'POST', json: {
      commands: { userId: USER, commandId, actAs: [actAs], commands: [command] },
    } });
    if (r.ok) return r.data;
    last = `submit ${r.status}: ${JSON.stringify(r.data).slice(0, 200)}`;
    // 409 SEQUENCER_BACKPRESSURE = transient overload on the shared validator.
    if (![409, 503, 429, 500, 502, 504].includes(r.status)) throw new Error(last);
    process.stdout.write(` (retry ${r.status})`);
    await new Promise((res) => setTimeout(res, 2000 * (i + 1)));
  }
  throw new Error('gave up: ' + last);
}
const createHolding = (issuer, owner, instrument, amount) =>
  ({ CreateCommand: { templateId: `${PKG}:Bisik:Holding`, createArguments: { issuer, owner, instrument, amount: String(amount) } } });

const cidOf = (tx) => tx.transaction?.events?.find((e) => e.CreatedEvent)?.CreatedEvent?.contractId;
// A SubmitQuote tx creates both an EscrowedHolding and a Quote — pick by template.
const cidOfTpl = (tx, suffix) => (tx.transaction?.events ?? [])
  .map((e) => e.CreatedEvent).filter(Boolean)
  .find((c) => c.templateId?.endsWith(suffix))?.contractId;

async function parties() {
  const out = {};
  for (const [role, hint] of Object.entries(HINTS)) {
    const p = await allocateOne(hint);
    await grant(p);
    out[role] = p;
  }
  return out;
}

async function seed() {
  const p = await parties();
  console.log('parties ready:');
  for (const [r, v] of Object.entries(p)) console.log('  ', r.padEnd(11), v);

  // Idempotent: if this party set already has a live RFQ, don't double-seed.
  const existing = (await acsAs(p.buyer)).filter((e) => e.templateId.endsWith(':Bisik:RFQ'));
  if (existing.length) {
    await writeFile(join(HERE, 'devnet.parties.json'), JSON.stringify(p, null, 2));
    console.log(`already seeded (${existing.length} live RFQ) — run "cleanup" or use fresh party hints to reseed.`);
    return;
  }

  const cash = cidOf(await submit(p.cashIssuer, createHolding(p.cashIssuer, p.buyer, 'USDC', '5000000.0')));
  const bondA = cidOf(await submit(p.bondIssuer, createHolding(p.bondIssuer, p.dealerA, 'TBOND30', '1000.0')));
  const bondB = cidOf(await submit(p.bondIssuer, createHolding(p.bondIssuer, p.dealerB, 'TBOND30', '1000.0')));
  console.log('minted holdings (cash + 2 bonds)');

  const rfq = cidOf(await submit(p.buyer, { CreateCommand: { templateId: `${PKG}:Bisik:RFQ`, createArguments: {
    buyer: p.buyer, regulator: p.regulator, invitedDealers: [p.dealerA, p.dealerB],
    instrument: 'TBOND30', quantity: '1000.0', payInstrument: 'USDC',
    assetIssuer: p.bondIssuer, payIssuer: p.cashIssuer,
    deadline: '2030-01-01T00:00:00Z' } } }));
  console.log('RFQ live:', rfq.slice(0, 24) + '…');

  const quote = (dealer, price, assetCid) => ({ ExerciseCommand: { templateId: `${PKG}:Bisik:RFQ`,
    contractId: rfq, choice: 'SubmitQuote', choiceArgument: { dealer, price, assetCid } } });
  await submit(p.dealerA, quote(p.dealerA, '4210000.0', bondA));
  await submit(p.dealerB, quote(p.dealerB, '4250000.0', bondB));
  console.log('two sealed quotes submitted (A: 4.21M, B: 4.25M)');

  await writeFile(join(HERE, 'devnet.parties.json'), JSON.stringify(p, null, 2));
  console.log('\nwrote scripts/devnet.parties.json — point the web UI at DevNet and open it.');
}

async function acsAs(party) {
  const off = (await api('/v2/state/ledger-end', { retry: true })).data?.offset;
  if (typeof off !== 'number') throw new Error('ledger-end returned no offset (devnet unreachable?)');
  const r = await api('/v2/state/active-contracts', { method: 'POST', retry: true, json: {
    filter: { filtersByParty: { [party]: { cumulative: [] } } }, verbose: true, activeAtOffset: off } });
  if (!Array.isArray(r.data)) throw new Error('active-contracts returned no array: ' + JSON.stringify(r.data).slice(0, 120));
  return r.data.map((x) => x.contractEntry?.JsActiveContract?.createdEvent).filter(Boolean);
}

async function verify() {
  const p = JSON.parse(await readFile(join(HERE, 'devnet.parties.json'), 'utf8'));
  for (const role of ['buyer', 'dealerA', 'dealerB', 'regulator']) {
    const ev = await acsAs(p[role]);
    const byTpl = {};
    for (const e of ev) { const t = e.templateId.split(':').slice(-1)[0]; byTpl[t] = (byTpl[t] ?? 0) + 1; }
    const quotes = ev.filter((e) => e.templateId.endsWith(':Bisik:Quote'))
      .map((e) => e.createArgument.dealer.split('::')[0]);
    console.log(role.padEnd(11), JSON.stringify(byTpl), quotes.length ? 'quotes from: ' + quotes.join(',') : '');
  }
}

// Add ONE prior settled trade (a separate instrument, GILT10) to the live desk, so
// the regulator's post-trade audit column isn't empty — it proves the "regulator
// observes executed trades, and only executed trades" half of the story on Devnet.
// Idempotent: skips if the regulator already sees a TradeReport.
async function settleDemo() {
  const p = JSON.parse(await readFile(join(HERE, 'devnet.parties.json'), 'utf8'));
  const regEv = await acsAs(p.regulator);
  if (regEv.some((e) => e.templateId.endsWith(':Bisik:TradeReport'))) {
    console.log('regulator already has a settled trade — nothing to do.');
    return;
  }
  const inst = 'GILT10';
  // Dedicated 195000 cash so the buyer's 5M TBOND30 float stays intact (exact clear = no change).
  const cash = cidOf(await submit(p.cashIssuer, createHolding(p.cashIssuer, p.buyer, 'USDC', '195000.0')));
  const gA = cidOf(await submit(p.bondIssuer, createHolding(p.bondIssuer, p.dealerA, inst, '100.0')));
  const gB = cidOf(await submit(p.bondIssuer, createHolding(p.bondIssuer, p.dealerB, inst, '100.0')));
  const rfq = cidOf(await submit(p.buyer, { CreateCommand: { templateId: `${PKG}:Bisik:RFQ`, createArguments: {
    buyer: p.buyer, regulator: p.regulator, invitedDealers: [p.dealerA, p.dealerB],
    instrument: inst, quantity: '100.0', payInstrument: 'USDC',
    assetIssuer: p.bondIssuer, payIssuer: p.cashIssuer, deadline: '2030-01-01T00:00:00Z' } } }));
  const quote = (dealer, price, assetCid) => ({ ExerciseCommand: { templateId: `${PKG}:Bisik:RFQ`,
    contractId: rfq, choice: 'SubmitQuote', choiceArgument: { dealer, price, assetCid } } });
  const qA = cidOfTpl(await submit(p.dealerA, quote(p.dealerA, '190000.0', gA)), ':Bisik:Quote');
  const qB = cidOfTpl(await submit(p.dealerB, quote(p.dealerB, '195000.0', gB)), ':Bisik:Quote');
  // Cheapest (A) wins, paid the second price (195000) — atomic DvP; TradeReport → regulator.
  await submit(p.buyer, { ExerciseCommand: { templateId: `${PKG}:Bisik:RFQ`, contractId: rfq,
    choice: 'Award', choiceArgument: { quoteCids: [qA, qB], cashCid: cash } } });
  console.log('settled GILT10 100 @ 195000 (Vickrey) — regulator now sees one executed trade.');
}

// Archive duplicate buyer USDC holdings left by 503-retries; keep exactly one.
async function cleanup() {
  const p = JSON.parse(await readFile(join(HERE, 'devnet.parties.json'), 'utf8'));
  const ev = await acsAs(p.buyer);
  const cash = ev.filter((e) => e.templateId.endsWith(':Bisik:Holding')
    && e.createArgument.owner === p.buyer && e.createArgument.instrument === 'USDC');
  console.log('buyer USDC holdings:', cash.length);
  for (const c of cash.slice(1)) {
    await submit(p.cashIssuer, { ExerciseCommand: { templateId: `${PKG}:Bisik:Holding`,
      contractId: c.contractId, choice: 'Archive', choiceArgument: {} } });
    console.log('  archived duplicate', c.contractId.slice(0, 18) + '…');
  }
  console.log('done — buyer now holds one USDC position');
}

// Seed a live multi-instrument BASKET (TBOND30 + GILT10) with two sealed basket
// quotes, un-settled, so the hosted desk showcases the basket lane on Devnet.
// Mints fresh legs (the dealers' original bonds are escrowed in the single RFQ).
// Idempotent: skips if the buyer already sees a BasketRFQ.
async function seedBasket() {
  const p = JSON.parse(await readFile(join(HERE, 'devnet.parties.json'), 'utf8'));
  if ((await acsAs(p.buyer)).some((e) => e.templateId.endsWith(':Bisik:BasketRFQ'))) {
    console.log('basket already seeded — nothing to do.');
    return;
  }
  const legs = [
    { instrument: 'TBOND30', quantity: '1000.0', assetIssuer: p.bondIssuer },
    { instrument: 'GILT10', quantity: '100.0', assetIssuer: p.bondIssuer },
  ];
  const mkAssets = async (dealer) => [
    cidOf(await submit(p.bondIssuer, createHolding(p.bondIssuer, dealer, 'TBOND30', '1000.0'))),
    cidOf(await submit(p.bondIssuer, createHolding(p.bondIssuer, dealer, 'GILT10', '100.0'))),
  ];
  const aAssets = await mkAssets(p.dealerA);
  const bAssets = await mkAssets(p.dealerB);
  const rfq = cidOf(await submit(p.buyer, { CreateCommand: { templateId: `${PKG}:Bisik:BasketRFQ`, createArguments: {
    buyer: p.buyer, regulator: p.regulator, invitedDealers: [p.dealerA, p.dealerB],
    legs, payInstrument: 'USDC', payIssuer: p.cashIssuer, deadline: '2030-01-01T00:00:00Z' } } }));
  const bq = (dealer, price, assetCids) => ({ ExerciseCommand: { templateId: `${PKG}:Bisik:BasketRFQ`,
    contractId: rfq, choice: 'SubmitBasketQuote', choiceArgument: { dealer, price, assetCids } } });
  await submit(p.dealerA, bq(p.dealerA, '4400000.0', aAssets));
  await submit(p.dealerB, bq(p.dealerB, '4450000.0', bAssets));
  console.log('basket RFQ live with two sealed basket quotes (A 4.40M, B 4.45M).');
}

// Seed a spread of REALISTIC settled trades across instruments and settlement
// modes (Vickrey, direct OTC, partial fill, basket), so the regulator's on-chain
// audit trail on the hosted desk looks like a real desk's post-trade record.
// Idempotent per instrument. Institutional tickers, block-size notionals in USD.
async function seedCases() {
  const p = JSON.parse(await readFile(join(HERE, 'devnet.parties.json'), 'utf8'));
  const reg = await acsAs(p.regulator);
  const doneInst = new Set(reg.filter((e) => e.templateId.endsWith(':Bisik:TradeReport')).map((e) => e.createArgument.instrument));
  const doneBasket = reg.filter((e) => e.templateId.endsWith(':Bisik:BasketTradeReport')).length >= 1;

  const cash = async (amt) => cidOf(await submit(p.cashIssuer, createHolding(p.cashIssuer, p.buyer, 'USDC', amt)));
  const bond = async (owner, inst, qty) => cidOf(await submit(p.bondIssuer, createHolding(p.bondIssuer, owner, inst, qty)));
  const mkRfq = async (inst, qty) => cidOf(await submit(p.buyer, { CreateCommand: { templateId: `${PKG}:Bisik:RFQ`, createArguments: {
    buyer: p.buyer, regulator: p.regulator, invitedDealers: [p.dealerA, p.dealerB],
    instrument: inst, quantity: qty, payInstrument: 'USDC', assetIssuer: p.bondIssuer, payIssuer: p.cashIssuer,
    deadline: '2030-01-01T00:00:00Z' } } }));
  const quote = async (dealer, rfq, price, assetCid) => cidOfTpl(await submit(dealer, { ExerciseCommand: {
    templateId: `${PKG}:Bisik:RFQ`, contractId: rfq, choice: 'SubmitQuote', choiceArgument: { dealer, price, assetCid } } }), ':Bisik:Quote');
  const onQuote = (qCid, choice, arg) => submit(p.buyer, { ExerciseCommand: { templateId: `${PKG}:Bisik:Quote`, contractId: qCid, choice, choiceArgument: arg } });
  // A third dealer for the 3-dealer Vickrey cases (idempotent allocation).
  const dealerC = await allocateOne('bisik-v6-dealerC'); await grant(dealerC);
  // Helpers: run a full 2- or 3-dealer Vickrey and settle it.
  const vickrey2 = async (inst, qty, pA, pB, cashAmt) => {
    const c = await cash(cashAmt); const bA = await bond(p.dealerA, inst, qty); const bB = await bond(p.dealerB, inst, qty);
    const rfq = await mkRfq(inst, qty); const qA = await quote(p.dealerA, rfq, pA, bA); const qB = await quote(p.dealerB, rfq, pB, bB);
    await submit(p.buyer, { ExerciseCommand: { templateId: `${PKG}:Bisik:RFQ`, contractId: rfq, choice: 'Award', choiceArgument: { quoteCids: [qA, qB], cashCid: c } } });
  };
  const vickrey3 = async (inst, qty, pA, pB, pC, cashAmt) => {
    const c = await cash(cashAmt); const bA = await bond(p.dealerA, inst, qty); const bB = await bond(p.dealerB, inst, qty); const bC = await bond(dealerC, inst, qty);
    const rfq = cidOf(await submit(p.buyer, { CreateCommand: { templateId: `${PKG}:Bisik:RFQ`, createArguments: {
      buyer: p.buyer, regulator: p.regulator, invitedDealers: [p.dealerA, p.dealerB, dealerC],
      instrument: inst, quantity: qty, payInstrument: 'USDC', assetIssuer: p.bondIssuer, payIssuer: p.cashIssuer, deadline: '2030-01-01T00:00:00Z' } } }));
    const qA = await quote(p.dealerA, rfq, pA, bA); const qB = await quote(p.dealerB, rfq, pB, bB); const qC = await quote(dealerC, rfq, pC, bC);
    await submit(p.buyer, { ExerciseCommand: { templateId: `${PKG}:Bisik:RFQ`, contractId: rfq, choice: 'Award', choiceArgument: { quoteCids: [qA, qB, qC], cashCid: c } } });
  };
  const directOtc = async (inst, qty, price, cashAmt) => {
    const c = await cash(cashAmt); const bA = await bond(p.dealerA, inst, qty);
    const rfq = await mkRfq(inst, qty); const qA = await quote(p.dealerA, rfq, price, bA);
    await onQuote(qA, 'SettleQuote', { cashCid: c, clearingPrice: price });
  };
  const partial = async (inst, qty, price, fill, cashAmt) => {
    const c = await cash(cashAmt); const bA = await bond(p.dealerA, inst, qty);
    const rfq = await mkRfq(inst, qty); const qA = await quote(p.dealerA, rfq, price, bA);
    await onQuote(qA, 'AcceptPartial', { cashCid: c, fillQuantity: fill });
  };
  const basketTrade = async (legDefs, price, cashAmt) => {
    const c = await cash(cashAmt);
    const assetCids = []; for (const [inst, qty] of legDefs) assetCids.push(await bond(p.dealerA, inst, qty));
    const legs = legDefs.map(([inst, qty]) => ({ instrument: inst, quantity: qty, assetIssuer: p.bondIssuer }));
    const brfq = cidOf(await submit(p.buyer, { CreateCommand: { templateId: `${PKG}:Bisik:BasketRFQ`, createArguments: {
      buyer: p.buyer, regulator: p.regulator, invitedDealers: [p.dealerA, p.dealerB], legs, payInstrument: 'USDC', payIssuer: p.cashIssuer, deadline: '2030-01-01T00:00:00Z' } } }));
    const bq = cidOfTpl(await submit(p.dealerA, { ExerciseCommand: { templateId: `${PKG}:Bisik:BasketRFQ`, contractId: brfq, choice: 'SubmitBasketQuote', choiceArgument: { dealer: p.dealerA, price, assetCids } } }), ':Bisik:BasketQuote');
    await submit(p.buyer, { ExerciseCommand: { templateId: `${PKG}:Bisik:BasketQuote`, contractId: bq, choice: 'SettleBasket', choiceArgument: { cashCid: c } } });
  };

  // 1 · Competitive Vickrey (2 dealers): German Bund 10Y, A 490k / B 495k → A paid the 2nd price 495k.
  if (!doneInst.has('BUND10')) {
    const c = await cash('600000.0'); const bA = await bond(p.dealerA, 'BUND10', '500.0'); const bB = await bond(p.dealerB, 'BUND10', '500.0');
    const rfq = await mkRfq('BUND10', '500.0');
    const qA = await quote(p.dealerA, rfq, '490000.0', bA); const qB = await quote(p.dealerB, rfq, '495000.0', bB);
    await submit(p.buyer, { ExerciseCommand: { templateId: `${PKG}:Bisik:RFQ`, contractId: rfq, choice: 'Award', choiceArgument: { quoteCids: [qA, qB], cashCid: c } } });
    console.log('· Vickrey     BUND10  500 @ 495,000 (2 dealers, 2nd price)');
  }
  // 2 · Direct bilateral OTC (settle at ask): US Treasury 2Y, 2,000 @ 1.98M.
  if (!doneInst.has('UST2Y')) {
    const c = await cash('1980000.0'); const bA = await bond(p.dealerA, 'UST2Y', '2000.0');
    const rfq = await mkRfq('UST2Y', '2000.0'); const qA = await quote(p.dealerA, rfq, '1980000.0', bA);
    await onQuote(qA, 'SettleQuote', { cashCid: c, clearingPrice: '1980000.0' });
    console.log('· direct OTC  UST2Y  2000 @ 1,980,000 (at ask)');
  }
  // 3 · Partial fill: Apple 2030 corp, ask 520k on 500, buyer fills 300 → 312,000 prorated.
  if (!doneInst.has('AAPL30')) {
    const c = await cash('520000.0'); const bA = await bond(p.dealerA, 'AAPL30', '500.0');
    const rfq = await mkRfq('AAPL30', '500.0'); const qA = await quote(p.dealerA, rfq, '520000.0', bA);
    await onQuote(qA, 'AcceptPartial', { cashCid: c, fillQuantity: '300.0' });
    console.log('· partial     AAPL30 300/500 @ 312,000 (prorated ask)');
  }
  // 4 · Multi-instrument basket settled: [US Treasury 10Y ×1000 + JPMorgan 2028 ×200] @ 2.30M.
  if (!doneBasket) {
    const c = await cash('2300000.0'); const t = await bond(p.dealerA, 'UST10Y', '1000.0'); const j = await bond(p.dealerA, 'JPM28', '200.0');
    const legs = [{ instrument: 'UST10Y', quantity: '1000.0', assetIssuer: p.bondIssuer }, { instrument: 'JPM28', quantity: '200.0', assetIssuer: p.bondIssuer }];
    const brfq = cidOf(await submit(p.buyer, { CreateCommand: { templateId: `${PKG}:Bisik:BasketRFQ`, createArguments: {
      buyer: p.buyer, regulator: p.regulator, invitedDealers: [p.dealerA, p.dealerB], legs, payInstrument: 'USDC', payIssuer: p.cashIssuer, deadline: '2030-01-01T00:00:00Z' } } }));
    const bq = cidOfTpl(await submit(p.dealerA, { ExerciseCommand: { templateId: `${PKG}:Bisik:BasketRFQ`, contractId: brfq,
      choice: 'SubmitBasketQuote', choiceArgument: { dealer: p.dealerA, price: '2300000.0', assetCids: [t, j] } } }), ':Bisik:BasketQuote');
    await submit(p.buyer, { ExerciseCommand: { templateId: `${PKG}:Bisik:BasketQuote`, contractId: bq, choice: 'SettleBasket', choiceArgument: { cashCid: c } } });
    console.log('· basket      [UST10Y 1000 + JPM28 200] @ 2,300,000 (atomic multi-leg)');
  }
  // 5 · Three-dealer Vickrey (proves 3+ competing dealers on-chain): US Treasury 5Y.
  if (!doneInst.has('UST5Y')) {
    await vickrey3('UST5Y', '1500.0', '1470000.0', '1485000.0', '1500000.0', '1500000.0');
    console.log('· Vickrey×3   UST5Y 1500 @ 1,485,000 (3 dealers, 2nd price)');
  }
  // 6 · Direct OTC: Microsoft 2029 corp, 400 @ 410,000 (at ask).
  if (!doneInst.has('MSFT29')) {
    const c = await cash('410000.0'); const bA = await bond(p.dealerA, 'MSFT29', '400.0');
    const rfq = await mkRfq('MSFT29', '400.0'); const qA = await quote(p.dealerA, rfq, '410000.0', bA);
    await onQuote(qA, 'SettleQuote', { cashCid: c, clearingPrice: '410000.0' });
    console.log('· direct OTC  MSFT29 400 @ 410,000');
  }
  // 7 · Partial fill: Mexico 2034 sovereign, ask 950k on 1000, buyer fills 600 → 570,000.
  if (!doneInst.has('MEX34')) {
    const c = await cash('950000.0'); const bA = await bond(p.dealerA, 'MEX34', '1000.0');
    const rfq = await mkRfq('MEX34', '1000.0'); const qA = await quote(p.dealerA, rfq, '950000.0', bA);
    await onQuote(qA, 'AcceptPartial', { cashCid: c, fillQuantity: '600.0' });
    console.log('· partial     MEX34 600/1000 @ 570,000');
  }
  // 8 · Second basket settled: [UK Gilt 30Y ×500 + German Bund 5Y ×300] @ 1.80M.
  if (reg.filter((e) => e.templateId.endsWith(':Bisik:BasketTradeReport')).length < 2) {
    const c = await cash('1800000.0'); const g = await bond(p.dealerA, 'GILT30', '500.0'); const bu = await bond(p.dealerA, 'BUND5Y', '300.0');
    const legs = [{ instrument: 'GILT30', quantity: '500.0', assetIssuer: p.bondIssuer }, { instrument: 'BUND5Y', quantity: '300.0', assetIssuer: p.bondIssuer }];
    const brfq = cidOf(await submit(p.buyer, { CreateCommand: { templateId: `${PKG}:Bisik:BasketRFQ`, createArguments: { buyer: p.buyer, regulator: p.regulator, invitedDealers: [p.dealerA, p.dealerB], legs, payInstrument: 'USDC', payIssuer: p.cashIssuer, deadline: '2030-01-01T00:00:00Z' } } }));
    const bq = cidOfTpl(await submit(p.dealerA, { ExerciseCommand: { templateId: `${PKG}:Bisik:BasketRFQ`, contractId: brfq, choice: 'SubmitBasketQuote', choiceArgument: { dealer: p.dealerA, price: '1800000.0', assetCids: [g, bu] } } }), ':Bisik:BasketQuote');
    await submit(p.buyer, { ExerciseCommand: { templateId: `${PKG}:Bisik:BasketQuote`, contractId: bq, choice: 'SettleBasket', choiceArgument: { cashCid: c } } });
    console.log('· basket      [GILT30 500 + BUND5Y 300] @ 1,800,000');
  }
  // 9 · Vickrey: Alphabet 2031 corp, A 255k / B 260k → A paid 260k.
  if (!doneInst.has('GOOGL31')) {
    const c = await cash('300000.0'); const bA = await bond(p.dealerA, 'GOOGL31', '250.0'); const bB = await bond(p.dealerB, 'GOOGL31', '250.0');
    const rfq = await mkRfq('GOOGL31', '250.0'); const qA = await quote(p.dealerA, rfq, '255000.0', bA); const qB = await quote(p.dealerB, rfq, '260000.0', bB);
    await submit(p.buyer, { ExerciseCommand: { templateId: `${PKG}:Bisik:RFQ`, contractId: rfq, choice: 'Award', choiceArgument: { quoteCids: [qA, qB], cashCid: c } } });
    console.log('· Vickrey     GOOGL31 250 @ 260,000');
  }
  // 10 · Vickrey: Japan Government Bond 10Y, A 1.960M / B 1.975M → A paid 1.975M.
  if (!doneInst.has('JGB10Y')) { await vickrey2('JGB10Y', '2000.0', '1960000.0', '1975000.0', '2000000.0'); console.log('· Vickrey     JGB10Y 2000 @ 1,975,000'); }
  // 11 · Direct OTC: France OAT 10Y, 600 @ 615,000 (at ask).
  if (!doneInst.has('OAT10Y')) { await directOtc('OAT10Y', '600.0', '615000.0', '615000.0'); console.log('· direct OTC  OAT10Y 600 @ 615,000'); }
  // 12 · Partial fill: Brazil 2033 sovereign, ask 720k on 800, buyer fills 500 → 450,000.
  if (!doneInst.has('BRAZIL33')) { await partial('BRAZIL33', '800.0', '720000.0', '500.0', '500000.0'); console.log('· partial     BRAZIL33 500/800 @ 450,000'); }
  // 13 · Three-dealer Vickrey: Tesla 2030 corp, A 310k / B 315k / C 320k → A paid 315k.
  if (!doneInst.has('TSLA30')) { await vickrey3('TSLA30', '300.0', '310000.0', '315000.0', '320000.0', '320000.0'); console.log('· Vickrey×3   TSLA30 300 @ 315,000 (3 dealers)'); }
  // 14 · Third basket settled: [France OAT 30Y ×400 + Japan JGB 5Y ×600] @ 1.05M.
  if (reg.filter((e) => e.templateId.endsWith(':Bisik:BasketTradeReport')).length < 3) {
    await basketTrade([['OAT30', '400.0'], ['JGB5Y', '600.0']], '1050000.0', '1050000.0');
    console.log('· basket      [OAT30 400 + JGB5Y 600] @ 1,050,000');
  }

  // Extra OPEN RFQs on-chain (real un-settled data): the buyer holds several live
  // requests at once, each with two sealed quotes.
  const openInst = new Set((await acsAs(p.buyer)).filter((e) => e.templateId.endsWith(':Bisik:RFQ')).map((e) => e.createArgument.instrument));
  const openRfq = async (inst, qty, pA, pB) => {
    if (openInst.has(inst)) return;
    const bA = await bond(p.dealerA, inst, qty); const bB = await bond(p.dealerB, inst, qty);
    const rfq = await mkRfq(inst, qty);
    await quote(p.dealerA, rfq, pA, bA); await quote(p.dealerB, rfq, pB, bB);
    console.log(`· open RFQ    ${inst} ${qty} (2 sealed quotes, un-settled)`);
  };
  await openRfq('UST30Y', '800.0', '3800000.0', '3820000.0');
  await openRfq('BUND30', '400.0', '1900000.0', '1920000.0');
  await openRfq('JGB30Y', '1000.0', '2400000.0', '2415000.0');
  await openRfq('OAT5Y', '700.0', '710000.0', '715000.0');

  // Tidy: direct-OTC and partial settles archive the winning Quote, not the RFQ,
  // and SettleBasket archives the BasketQuote, not the BasketRFQ — so those shells
  // linger with no live quotes. Cancel/archive any quote-less RFQ or basket RFQ.
  const buyerNow = await acsAs(p.buyer);
  const withQuotes = new Set(buyerNow.filter((e) => e.templateId.endsWith(':Bisik:Quote')).map((e) => e.createArgument.rfqId).filter(Boolean));
  for (const r of buyerNow.filter((e) => e.templateId.endsWith(':Bisik:RFQ'))) {
    if (!withQuotes.has(r.contractId)) {
      await submit(p.buyer, { ExerciseCommand: { templateId: `${PKG}:Bisik:RFQ`, contractId: r.contractId, choice: 'CancelRFQ', choiceArgument: {} } });
      console.log(`· tidied orphan RFQ ${r.createArgument.instrument}`);
    }
  }
  // BasketRFQ has no cancel choice, but the buyer is its sole signatory → the
  // built-in Archive choice tidies the settled-basket shells (no redeploy needed).
  const withBQuotes = new Set(buyerNow.filter((e) => e.templateId.endsWith(':Bisik:BasketQuote')).map((e) => e.createArgument.rfqId).filter(Boolean));
  for (const r of buyerNow.filter((e) => e.templateId.endsWith(':Bisik:BasketRFQ'))) {
    if (!withBQuotes.has(r.contractId)) {
      await submit(p.buyer, { ExerciseCommand: { templateId: `${PKG}:Bisik:BasketRFQ`, contractId: r.contractId, choice: 'Archive', choiceArgument: {} } });
      console.log('· tidied orphan BasketRFQ');
    }
  }

  console.log('\nseed-cases done — the regulator now audits a spread of real settlement types on-chain.');
}

// A single auction where the buyer selectively DISCLOSES both competing sealed asks
// to the regulator before awarding — so the hosted "Provable best execution" view and
// the MCP best_execution tool show a real, green attestation on live Devnet data.
async function seedBestExec() {
  const p = JSON.parse(await readFile(join(HERE, 'devnet.parties.json'), 'utf8'));
  const inst = 'UST7Y', qty = '1000.0';
  const reg = await acsAs(p.regulator);
  if (reg.some((e) => e.templateId.endsWith(':Bisik:TradeReport') && e.createArgument.instrument === inst)) {
    console.log(`seed-bestexec: ${inst} already settled — skipping (idempotent)`); return;
  }
  const cash = cidOf(await submit(p.cashIssuer, createHolding(p.cashIssuer, p.buyer, 'USDC', '1500000.0')));
  const bA = cidOf(await submit(p.bondIssuer, createHolding(p.bondIssuer, p.dealerA, inst, qty)));
  const bB = cidOf(await submit(p.bondIssuer, createHolding(p.bondIssuer, p.dealerB, inst, qty)));
  const rfq = cidOf(await submit(p.buyer, { CreateCommand: { templateId: `${PKG}:Bisik:RFQ`, createArguments: {
    buyer: p.buyer, regulator: p.regulator, invitedDealers: [p.dealerA, p.dealerB],
    instrument: inst, quantity: qty, payInstrument: 'USDC', assetIssuer: p.bondIssuer, payIssuer: p.cashIssuer,
    deadline: '2030-01-01T00:00:00Z' } } }));
  const q = async (dealer, price, asset) => cidOfTpl(await submit(dealer, { ExerciseCommand: { templateId: `${PKG}:Bisik:RFQ`,
    contractId: rfq, choice: 'SubmitQuote', choiceArgument: { dealer, price, assetCid: asset } } }), ':Bisik:Quote');
  const qA = await q(p.dealerA, '1470000.0', bA);
  const qB = await q(p.dealerB, '1490000.0', bB);
  // Disclose BOTH sealed asks to the regulator (nonconsuming) BEFORE the award — this
  // is exactly what makes best execution provable without a public order book.
  const disclose = (qc) => submit(p.buyer, { ExerciseCommand: { templateId: `${PKG}:Bisik:Quote`, contractId: qc,
    choice: 'DiscloseTo', choiceArgument: { auditor: p.regulator, reason: 'best-execution audit' } } });
  await disclose(qA); await disclose(qB);
  await submit(p.buyer, { ExerciseCommand: { templateId: `${PKG}:Bisik:RFQ`, contractId: rfq,
    choice: 'Award', choiceArgument: { quoteCids: [qA, qB], cashCid: cash } } });
  console.log(`seed-bestexec: ${inst} ${qty} — dealerA 1,470,000 wins, cleared at the Vickrey 1,490,000; both asks disclosed → best execution attested on-ledger.`);
}

const cmd = process.argv[2];
(async () => {
  ENV = await loadEnv();
  if (cmd === 'probe') await probe();
  else if (cmd === 'cleanup') await cleanup();
  else if (cmd === 'upload') await upload(process.argv[3] ?? '.daml/dist/bisik-otc-0.6.0.dar');
  else if (cmd === 'allocate-one') console.log(await allocateOne(process.argv[3] ?? 'bisik-probe-1'));
  else if (cmd === 'allocate') await allocate();
  else if (cmd === 'seed') await seed();
  else if (cmd === 'settle-demo') await settleDemo();
  else if (cmd === 'seed-basket') await seedBasket();
  else if (cmd === 'seed-cases') await seedCases();
  else if (cmd === 'seed-bestexec') await seedBestExec();
  else if (cmd === 'verify') await verify();
  else console.log('usage: probe | upload <dar> | allocate | seed | settle-demo | seed-basket | seed-cases | seed-bestexec | verify');
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
