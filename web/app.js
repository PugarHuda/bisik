// Bisik desk — three party views of one Canton ledger, via the JSON Ledger API.
// The privacy is real: each panel only ever receives the contracts its party is
// a stakeholder of. Dealer B's column cannot show Dealer A's quote because the
// ledger never sends it to Dealer B's node.

const T = (t) => `Bisik:${t}`; // template-name suffix matcher
let PKG = null;                // discovered model package id
let USER_ID = 'participant_admin';
const P = {};                  // role -> full party id
let awardable = null;          // { rfqCid, quoteCids, cashCid } when buyer can award

const api = async (path, method = 'GET', body) => {
  const r = await fetch('/api' + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  if (!r.ok) throw new Error(typeof json === 'string' ? json : (json.cause || json.error || text));
  return json;
};

const ledgerEnd = async () => (await api('/v2/state/ledger-end')).offset;

const acs = async (party) => {
  const off = await ledgerEnd();
  const rows = await api('/v2/state/active-contracts', 'POST', {
    filter: { filtersByParty: { [party]: { cumulative: [] } } },
    verbose: true,
    activeAtOffset: off,
  });
  return rows
    .map((r) => r.contractEntry?.JsActiveContract?.createdEvent)
    .filter(Boolean)
    .map((e) => ({ cid: e.contractId, tpl: e.templateId, arg: e.createArgument }));
};

const is = (c, name) => typeof c.tpl === 'string' && c.tpl.endsWith(T(name));

const submit = async (party, cmd) => {
  const commandId = 'ui-' + Math.floor(performance.now()) + '-' + Object.keys(cmd)[0];
  return api('/v2/commands/submit-and-wait-for-transaction', 'POST', {
    commands: { userId: USER_ID, commandId, actAs: [party], commands: [cmd] },
  });
};

const fmt = (n) => Number(n).toLocaleString('en-US');
// Readable dealer name: the party id-hint (before ::), e.g. "bisik-dealerA-1" or "DealerA".
const dealerLabel = (party) => party.split('::')[0];

let toastEl;
const toast = (msg, err = false) => {
  if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'toast'; document.body.appendChild(toastEl); }
  toastEl.textContent = msg;
  toastEl.className = 'toast show' + (err ? ' err' : '');
  setTimeout(() => (toastEl.className = 'toast'), 2600);
};

// ---- discovery ----
async function loadParties(configParties) {
  if (configParties && configParties.buyer) {
    // DevNet: use the known party IDs from server config.
    Object.assign(P, configParties);
  } else {
    // Sandbox: discover by party-id-hint prefix.
    const { partyDetails } = await api('/v2/parties');
    const find = (pfx) => partyDetails.find((p) => p.party.startsWith(pfx + '-') || p.party.startsWith(pfx + '::'))?.party;
    P.buyer = find('Buyer'); P.dealerA = find('DealerA'); P.dealerB = find('DealerB'); P.regulator = find('Regulator');
  }
  for (const role of ['buyer', 'dealerA', 'dealerB', 'regulator']) {
    const el = document.getElementById('pid-' + role);
    if (el && P[role]) el.textContent = P[role].split('::')[0];
  }
  return P.buyer && P.dealerA && P.dealerB;
}

// ---- rendering ----
function holdingsHtml(contracts, owner) {
  const hs = contracts.filter((c) => is(c, 'Holding') && c.arg.owner === owner);
  if (!hs.length) return '<div class="empty">none</div>';
  return hs.map((c) => `<div>${c.arg.instrument} · ${fmt(c.arg.amount)}</div>`).join('');
}

function renderBuyer(mine) {
  document.getElementById('buyer-holdings').innerHTML = holdingsHtml(mine, P.buyer);

  const rfqs = mine.filter((c) => is(c, 'RFQ'));
  const quotes = mine.filter((c) => is(c, 'Quote'));
  const box = document.getElementById('buyer-quotes');
  awardable = null;

  if (!quotes.length) {
    box.innerHTML = rfqs.length
      ? '<div class="empty">RFQ live — waiting for dealers to quote…</div>'
      : '<div class="empty">No quotes yet.</div>';
  } else {
    const sorted = [...quotes].sort((a, b) => Number(a.arg.price) - Number(b.arg.price));
    const winCid = sorted[0].cid;
    const clearing = Number((sorted[1] ?? sorted[0]).arg.price);
    box.innerHTML = sorted.map((c) => `
      <div class="card ${c.cid === winCid ? 'win' : ''}">
        <div class="row"><span>${dealerLabel(c.arg.dealer)}</span><span class="price">${fmt(c.arg.price)} ${c.arg.payInstrument}</span></div>
        <div class="sub">${c.arg.instrument} · ${fmt(c.arg.quantity)}${c.cid === winCid ? ' · winner, pays 2nd price ' + fmt(clearing) : ''}</div>
      </div>`).join('');

    // Pick the RFQ these quotes belong to, and a cash holding big enough.
    const q0 = sorted[0].arg;
    const rfq = rfqs.find((r) => r.arg.instrument === q0.instrument && r.arg.payInstrument === q0.payInstrument);
    const cash = mine.find((c) => is(c, 'Holding') && c.arg.owner === P.buyer
      && c.arg.instrument === q0.payInstrument && Number(c.arg.amount) >= clearing);
    if (rfq && cash) awardable = { rfqCid: rfq.cid, quoteCids: sorted.map((c) => c.cid), cashCid: cash.cid };
  }
  document.getElementById('btn-award').disabled = !awardable;
}

function renderDealer(role, mine) {
  const party = P[role];
  const rfqs = mine.filter((c) => is(c, 'RFQ')); // dealer is an observer of RFQs they're invited to
  const myQuotes = mine.filter((c) => is(c, 'Quote') && c.arg.dealer === party);
  const bonds = mine.filter((c) => is(c, 'Holding') && c.arg.owner === party);
  const quotedInstruments = new Set(myQuotes.map((q) => q.arg.instrument));

  const rfqCards = rfqs.map((r) => {
    const already = quotedInstruments.has(r.arg.instrument);
    const bond = bonds.find((b) => b.arg.instrument === r.arg.instrument && Number(b.arg.amount) === Number(r.arg.quantity));
    const canQuote = !already && bond;
    return `
      <div class="card">
        <div class="row"><span>RFQ · ${r.arg.instrument}</span><span class="sub">qty ${fmt(r.arg.quantity)}</span></div>
        ${already ? '<div class="sub">you have quoted (sealed)</div>' :
          canQuote ? `<div class="form" style="margin-top:8px">
              <label>Ask (${r.arg.payInstrument}) <input type="number" id="ask-${role}-${r.cid}" value="4230000" /></label>
              <button data-quote="${role}" data-rfq="${r.cid}" data-bond="${bond.cid}">Whisper sealed quote</button>
            </div>` : '<div class="sub">no matching asset to quote</div>'}
      </div>`;
  }).join('');

  const mineCards = myQuotes.map((q) => `
      <div class="card"><div class="row"><span>your quote</span><span class="price">${fmt(q.arg.price)}</span></div>
      <div class="sub">${q.arg.instrument} · ${fmt(q.arg.quantity)} · sealed to buyer only</div></div>`).join('');

  document.getElementById('body-' + role).innerHTML = `
    <div class="block"><h3>Incoming RFQs</h3><div class="list">${rfqCards || '<div class="empty">none</div>'}</div></div>
    <div class="block"><h3>Your quotes <span class="hint">(rivals can't see these)</span></h3>
      <div class="list">${mineCards || '<div class="blind">You only ever see your own quotes.<br>Rival dealers’ quotes are never sent to your node.</div>'}</div></div>
    <div class="block"><h3>Your holdings</h3><div class="list mono">${holdingsHtml(mine, party)}</div></div>`;
}

async function renderRegulator() {
  if (!P.regulator) return;
  const mine = await acs(P.regulator);
  const reports = mine.filter((c) => is(c, 'TradeReport'));
  const el = document.getElementById('regulator-view');
  el.innerHTML = reports.length
    ? 'Regulator sees ' + reports.length + ' settled trade(s): ' +
      reports.map((r) => `${r.arg.instrument} ${fmt(r.arg.quantity)} @ ${fmt(r.arg.clearingPrice)}`).join(', ') +
      ' — and nothing about the losing quotes or the RFQ.'
    : 'Regulator view: no settled trades yet (and zero visibility into live RFQs or quotes).';
}

// ---- refresh loop ----
let busy = false;
async function refresh() {
  if (busy) return; busy = true;
  try {
    const [b, a, d] = await Promise.all([acs(P.buyer), acs(P.dealerA), acs(P.dealerB)]);
    if (!PKG) { const any = [...b, ...a, ...d].find((c) => typeof c.tpl === 'string' && c.tpl.includes(':Bisik:')); if (any) PKG = any.tpl.split(':')[0]; }
    renderBuyer(b); renderDealer('dealerA', a); renderDealer('dealerB', d);
    await renderRegulator();
    setLedger('ok', 'ledger live · pkg ' + (PKG ? PKG.slice(0, 8) : '—'));
  } catch (e) {
    setLedger('err', 'ledger error: ' + e.message);
  } finally { busy = false; }
}

const setLedger = (cls, msg) => { const el = document.getElementById('ledger-status'); el.className = 'ledger ' + cls; el.textContent = msg; };

// ---- actions ----
async function createRFQ() {
  if (!PKG) return toast('package not discovered yet', true);
  const instrument = document.getElementById('rfq-instrument').value.trim();
  const quantity = document.getElementById('rfq-qty').value.trim();
  const payInstrument = document.getElementById('rfq-pay').value.trim();
  try {
    await submit(P.buyer, { CreateCommand: { templateId: `${PKG}:Bisik:RFQ`, createArguments: {
      buyer: P.buyer, regulator: P.regulator, invitedDealers: [P.dealerA, P.dealerB],
      instrument, quantity: String(Number(quantity).toFixed(1)), payInstrument } } });
    toast('RFQ sent to the dealer panel'); refresh();
  } catch (e) { toast(e.message, true); }
}

async function submitQuote(role, rfqCid, bondCid, price) {
  try {
    await submit(P[role], { ExerciseCommand: { templateId: `${PKG}:Bisik:RFQ`, contractId: rfqCid,
      choice: 'SubmitQuote', choiceArgument: { dealer: P[role], price: String(Number(price).toFixed(1)), assetCid: bondCid } } });
    toast(role + ' quote sealed'); refresh();
  } catch (e) { toast(e.message, true); }
}

async function award() {
  if (!awardable) return;
  try {
    await submit(P.buyer, { ExerciseCommand: { templateId: `${PKG}:Bisik:RFQ`, contractId: awardable.rfqCid,
      choice: 'Award', choiceArgument: { quoteCids: awardable.quoteCids, cashCid: awardable.cashCid } } });
    toast('Awarded — atomic DvP at the Vickrey price'); refresh();
  } catch (e) { toast(e.message, true); }
}

// ---- wire up ----
document.getElementById('btn-create-rfq').addEventListener('click', createRFQ);
document.getElementById('btn-award').addEventListener('click', award);
document.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-quote]');
  if (!b) return;
  const role = b.dataset.quote, rfqCid = b.dataset.rfq, bondCid = b.dataset.bond;
  const price = document.getElementById(`ask-${role}-${rfqCid}`).value;
  submitQuote(role, rfqCid, bondCid, price);
});

(async function main() {
  let cfg = {};
  try { cfg = await (await fetch('/api/config')).json(); USER_ID = cfg.userId ?? USER_ID; } catch {}
  if (!(await loadParties(cfg.parties))) { setLedger('err', 'demo parties not found — run seed'); return; }
  await refresh();
  setInterval(refresh, 1800);
})();
