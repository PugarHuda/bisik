// Bisik DevNet deploy/seed against the shared 5N hackathon validator.
// Reads scripts/.env.devnet (gitignored). Node >= 20.
//   node scripts/devnet.mjs probe
//   node scripts/devnet.mjs upload .daml/dist/bisik-0.4.0.dar
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
  const r = await api('/v2/packages', { method: 'POST', raw: bytes });
  console.log('upload:', r.status, JSON.stringify(r.data).slice(0, 200));
}

const USER = '6';
// v2 party set — isolates this deployment's (new package) contracts from any
// earlier ones on the shared validator, so party queries return only our data.
const HINTS = {
  buyer: 'bisik-v4-buyer', dealerA: 'bisik-v4-dealerA', dealerB: 'bisik-v4-dealerB',
  regulator: 'bisik-v4-regulator', cashIssuer: 'bisik-v4-cashissuer', bondIssuer: 'bisik-v4-bondissuer',
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

// Main package id of .daml/dist/bisik-0.4.0.dar. Regenerate after a model change
// with: daml damlc inspect-dar --json .daml/dist/bisik-0.4.0.dar  (or set BISIK_PKG).
const PKG = process.env.BISIK_PKG ?? 'bf5d9a45552353be29cf4180d9cc7465c5fd0f87822b016b9a0da53cba4948f6';
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

const cmd = process.argv[2];
(async () => {
  ENV = await loadEnv();
  if (cmd === 'probe') await probe();
  else if (cmd === 'cleanup') await cleanup();
  else if (cmd === 'upload') await upload(process.argv[3] ?? '.daml/dist/bisik-0.4.0.dar');
  else if (cmd === 'allocate-one') console.log(await allocateOne(process.argv[3] ?? 'bisik-probe-1'));
  else if (cmd === 'allocate') await allocate();
  else if (cmd === 'seed') await seed();
  else if (cmd === 'settle-demo') await settleDemo();
  else if (cmd === 'verify') await verify();
  else console.log('usage: probe | upload <dar> | allocate | seed | settle-demo | verify');
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
