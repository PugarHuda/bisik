// Prove the CIP-0056-shaped token standard live on Devnet: a two-step transfer
// instruction and an atomic DvP allocation swap, on-ledger, verified.
//   BISIK_TOKEN_PKG=<pkgid> LEDGER_ENV_FILE=scripts/.env.devnet node scripts/token-standard-demo.mjs
// Reuses the bisik-v6 parties (a different template than the desk's Holding, so the
// desk view is untouched). Node stdlib only.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
function loadEnv() {
  const e = { ...process.env };
  const f = process.env.LEDGER_ENV_FILE;
  if (f) { try { for (const l of readFileSync(f, 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !e[m[1]]) e[m[1]] = m[2]; } } catch {} }
  return e;
}
const ENV = loadEnv();
const LEDGER = (ENV.LEDGER_JSON_URL ?? ENV.DEVNET_LEDGER_URL ?? 'http://localhost:7575').replace(/\/$/, '');
const USER = ENV.LEDGER_USER_ID ?? (ENV.DEVNET_TOKEN_URL ? '6' : 'participant_admin');
const PKG = ENV.BISIK_TOKEN_PKG ?? '05e4ebb9573dfa44261772a0c6eb40e6f72acc7e959d3eb7a34716c91f9d3b65';
const P = JSON.parse(readFileSync(join(HERE, 'devnet.parties.json'), 'utf8'));
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
async function api(path, { method = 'GET', json } = {}) {
  let last = '';
  for (let i = 0; i < 5; i++) {
    try {
      const t = await token();
      const r = await fetch(LEDGER + path, { method,
        headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) },
        body: json !== undefined ? JSON.stringify(json) : undefined });
      const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
      if (r.ok || ![429, 500, 502, 503, 504].includes(r.status)) return { ok: r.ok, status: r.status, data };
      last = `status ${r.status}: ${String(text).slice(0, 160)}`;
    } catch (e) { last = String(e?.message ?? e); if (i === 4) throw e; }
    await new Promise((res) => setTimeout(res, 900 * (i + 1)));
  }
  throw new Error('ledger unreachable — last: ' + last);
}
let CID = 0;
async function submit(actAs, command) {
  const r = await api('/v2/commands/submit-and-wait-for-transaction', { method: 'POST',
    json: { commands: { userId: USER, commandId: `token-${Date.now()}-${CID++}`, actAs, commands: [command] } } });
  if (!r.ok) throw new Error(`submit ${r.status}: ${JSON.stringify(r.data).slice(0, 240)}`);
  return r.data;
}
const created = (tx, suffix) => tx.transaction?.events?.map((e) => e.CreatedEvent)
  .find((e) => e && e.templateId.endsWith(suffix))?.contractId;
const tid = (t) => `${PKG}:TokenStandard:${t}`;
const FAR = '2030-01-01T00:00:00Z';
const RUN = Date.now().toString(36).slice(-5);

async function ownedAmount(party, instrument) {
  const off = (await api('/v2/state/ledger-end')).data?.offset;
  const r = await api('/v2/state/active-contracts', { method: 'POST', json: {
    filter: { filtersByParty: { [party]: { cumulative: [] } } }, verbose: true, activeAtOffset: off } });
  return (Array.isArray(r.data) ? r.data : []).map((x) => x.contractEntry?.JsActiveContract?.createdEvent).filter(Boolean)
    .filter((e) => e.templateId.endsWith(':TokenStandard:Token') && e.createArgument.owner === party && e.createArgument.instrument === instrument)
    .reduce((s, e) => s + Number(e.createArgument.amount), 0);
}

(async () => {
  console.log('token standard · package', PKG.slice(0, 8), '· ledger', LEDGER, '\n');

  // ── 1. Two-step transfer instruction ──
  const cash = created(await submit([P.cashIssuer], { CreateCommand: { templateId: tid('Token'),
    createArguments: { issuer: P.cashIssuer, owner: P.buyer, instrument: `USDC-${RUN}`, amount: '1000.0', lock: null } } }), ':TokenStandard:Token');
  const ti = created(await submit([P.buyer], { ExerciseCommand: { templateId: tid('Token'), contractId: cash,
    choice: 'TokenTransfer', choiceArgument: { receiver: P.dealerA, transferAmount: '400.0', deadline: FAR, meta: { values: [{ _1: 'kind', _2: 'demo' }] } } } }), ':TokenStandard:TransferInstruction');
  await submit([P.dealerA], { ExerciseCommand: { templateId: tid('TransferInstruction'), contractId: ti, choice: 'AcceptTransfer', choiceArgument: {} } });
  const aliceUsdc = await ownedAmount(P.buyer, `USDC-${RUN}`), bobUsdc = await ownedAmount(P.dealerA, `USDC-${RUN}`);
  console.log('two-step transfer instruction:');
  console.log(`  · buyer sent 400 of 1000 → dealerA accepted. buyer keeps ${aliceUsdc}, dealerA holds ${bobUsdc}`);
  if (aliceUsdc !== 600 || bobUsdc !== 400) throw new Error(`transfer math wrong: ${aliceUsdc}/${bobUsdc}`);

  // ── 2. Atomic DvP via allocations ──
  const cash2 = created(await submit([P.cashIssuer], { CreateCommand: { templateId: tid('Token'),
    createArguments: { issuer: P.cashIssuer, owner: P.buyer, instrument: `USDC2-${RUN}`, amount: '600.0', lock: null } } }), ':TokenStandard:Token');
  const bond = created(await submit([P.bondIssuer], { CreateCommand: { templateId: tid('Token'),
    createArguments: { issuer: P.bondIssuer, owner: P.dealerA, instrument: `TBOND-${RUN}`, amount: '10.0', lock: null } } }), ':TokenStandard:Token');
  const allocA = created(await submit([P.buyer], { ExerciseCommand: { templateId: tid('Token'), contractId: cash2,
    choice: 'AllocateForSettlement', choiceArgument: { receiver: P.dealerA, settlementId: `S-${RUN}`, allocAmount: '600.0', meta: { values: [] } } } }), ':TokenStandard:Allocation');
  const allocB = created(await submit([P.dealerA], { ExerciseCommand: { templateId: tid('Token'), contractId: bond,
    choice: 'AllocateForSettlement', choiceArgument: { receiver: P.buyer, settlementId: `S-${RUN}`, allocAmount: '10.0', meta: { values: [] } } } }), ':TokenStandard:Allocation');
  const dvp = created(await submit([P.buyer, P.dealerA], { CreateCommand: { templateId: tid('DvpSettlement'),
    createArguments: { partyA: P.buyer, partyB: P.dealerA, settlementId: `S-${RUN}`, legAtoB: allocA, legBtoA: allocB } } }), ':TokenStandard:DvpSettlement');
  await submit([P.buyer], { ExerciseCommand: { templateId: tid('DvpSettlement'), contractId: dvp, choice: 'SettleDvp', choiceArgument: {} } });
  const buyerBond = await ownedAmount(P.buyer, `TBOND-${RUN}`), dealerCash = await ownedAmount(P.dealerA, `USDC2-${RUN}`);
  console.log('atomic DvP (allocation swap, one transaction):');
  console.log(`  · buyer paid 600 cash, dealerA delivered a bond — both legs or neither`);
  console.log(`  · after settlement: buyer holds bond ${buyerBond}, dealerA holds cash ${dealerCash}`);
  if (buyerBond !== 10 || dealerCash !== 600) throw new Error(`DvP wrong: bond ${buyerBond}, cash ${dealerCash}`);

  console.log('\n✓ CIP-0056-shaped token standard live on Devnet: transfer instruction + atomic DvP, verified on-ledger.');
})().catch((e) => { console.error('token demo error:', e.message); process.exit(1); });
