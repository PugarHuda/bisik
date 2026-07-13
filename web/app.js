// Bisik desk — three party views of one Canton ledger, via the JSON Ledger API.
// The privacy is real: each panel only ever receives the contracts its party is
// a stakeholder of. Dealer B's column cannot show Dealer A's quote because the
// ledger never sends it to Dealer B's node.

const T = (t) => `Bisik:${t}`; // template-name suffix matcher
let PKG = null;                // discovered model package id (for fresh creates)
let USER_ID = 'participant_admin';
let CFG_PARTIES = {};          // issuer party ids from server config (DevNet)
const P = {};                  // role -> full party id
let awardable = null;          // { rfqCid, tpl, quoteCids, cashCid } when buyer can award
let READONLY = false;          // hosted public demo: the server allows reads only

const api = async (path, method = 'GET', body) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000); // a wedged gateway must not hang forever
  let r;
  try {
    r = await fetch('/api' + path, {
      method, signal: ctrl.signal,
      headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  } finally { clearTimeout(timer); }
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  if (!r.ok) {
    const msg = typeof json === 'string' ? json
      : (json.cause || json.error || json.message || json.errors?.[0]?.message || text || `HTTP ${r.status}`);
    throw new Error(msg);
  }
  return json;
};

// Retry read-only calls a couple of times — DevNet's gateway returns transient
// 502/503s. Safe because these are idempotent; command submits are NOT retried.
const retryRead = async (fn, tries = 3) => {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) { last = e; await new Promise((r) => setTimeout(r, 400 * (i + 1))); }
  }
  throw last;
};

const ledgerEnd = async () => {
  const r = await api('/v2/state/ledger-end');
  if (typeof r.offset !== 'number') throw new Error('ledger-end returned no offset');
  return r.offset;
};

const acs = (party) => retryRead(async () => {
  const off = await ledgerEnd();
  const rows = await api('/v2/state/active-contracts', 'POST', {
    filter: { filtersByParty: { [party]: { cumulative: [] } } },
    verbose: true,
    activeAtOffset: off,
  });
  if (!Array.isArray(rows)) throw new Error('active-contracts returned no array');
  return rows
    .map((r) => r.contractEntry?.JsActiveContract?.createdEvent)
    .filter(Boolean)
    .map((e) => ({ cid: e.contractId, tpl: e.templateId, arg: e.createArgument }));
});

const is = (c, name) => typeof c.tpl === 'string' && c.tpl.endsWith(T(name));

const submit = async (party, cmd) => {
  const commandId = (crypto.randomUUID?.() ?? 'ui-' + Math.random().toString(36).slice(2) + Date.now());
  return api('/v2/commands/submit-and-wait-for-transaction', 'POST', {
    commands: { userId: USER_ID, commandId, actAs: [party], commands: [cmd] },
  });
};

const fmt = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 10 });
// Readable dealer name: the party id-hint (before ::), e.g. "bisik-dealerA-1" or "DealerA".
const dealerLabel = (party) => esc(party.split('::')[0]);
// Escape ledger-sourced strings before putting them in innerHTML (instrument, etc.).
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Validate a positive decimal from an input; return the trimmed string (no lossy
// reformatting) or null. Daml Decimal accepts up to 10 fractional digits.
const posDec = (raw) => {
  const s = String(raw).trim();
  // Plain decimal only. A number <input> also accepts "1e5", ".5", "1000." — all of
  // which would reach the ledger as a malformed Daml Decimal; reject them here.
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  if (!(Number(s) > 0)) return null;
  if (/\.\d{11,}/.test(s)) return null; // more precision than Daml Decimal holds
  return s.includes('.') ? s : s + '.0';
};

let toastEl, toastTimer;
const toast = (msg, err = false) => {
  if (!toastEl) {
    toastEl = document.createElement('div'); toastEl.className = 'toast';
    toastEl.setAttribute('role', 'status'); toastEl.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = msg;
  toastEl.className = 'toast show' + (err ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.className = 'toast'), 2600);
};

// Hosted public demo: the server proxies reads only. Reflect that in the UI —
// disable the write buttons and show a banner. (Security is enforced server-side;
// this is just so the buttons don't look broken.)
const RO_MSG = 'Read-only public demo — clone the repo and run `npm run demo` to drive the flow yourself.';
function enterReadOnly() {
  READONLY = true;
  // Leave the action buttons ENABLED so a click gives a helpful explanation (a
  // disabled button is silently dead); the handlers below no-op with a toast, and
  // the server blocks the write regardless.
  const bar = document.createElement('div');
  bar.textContent = 'Read-only public demo · live Canton Devnet state — actions are disabled. Clone the repo and run `npm run demo` to drive it.';
  bar.style.cssText = 'position:sticky;top:0;z-index:10;padding:6px 12px;font-size:13px;text-align:center;background:#1c2733;color:#8fb4d6;border-bottom:1px solid #2a3947';
  // Insert inside .main (not <body>) — <body class="app"> is a CSS grid, and a
  // banner as a grid child would steal a cell and break the sidebar/desk layout.
  (document.querySelector('.main') ?? document.body).prepend(bar);
}

// ---- discovery ----
async function loadParties(configParties) {
  if (configParties && configParties.buyer) {
    Object.assign(P, configParties); // DevNet: known party IDs from server config
  } else {
    const { partyDetails } = await api('/v2/parties'); // sandbox: discover by id-hint prefix
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
  return hs.map((c) => `<div>${esc(c.arg.instrument)} · ${fmt(c.arg.amount)}</div>`).join('');
}

function renderBuyer(mine) {
  document.getElementById('buyer-holdings').innerHTML = holdingsHtml(mine, P.buyer);

  const rfqs = mine.filter((c) => is(c, 'RFQ'));
  const allQuotes = mine.filter((c) => is(c, 'Quote'));
  const box = document.getElementById('buyer-quotes');
  awardable = null;

  // Scope everything to ONE RFQ: the first that has quotes (else the first open).
  const rfq = rfqs.find((r) => allQuotes.some((q) => q.arg.rfqId === r.cid)) ?? rfqs[0];
  const quotes = rfq ? allQuotes.filter((q) => q.arg.rfqId === rfq.cid) : [];

  if (!quotes.length) {
    box.innerHTML = rfqs.length
      ? '<div class="empty">RFQ live — waiting for dealers to quote…</div>'
      : '<div class="empty">No quotes yet.</div>';
  } else {
    const sorted = [...quotes].sort((a, b) =>
      Number(a.arg.price) - Number(b.arg.price) || a.arg.dealer.localeCompare(b.arg.dealer));
    const winCid = sorted[0].cid;
    const clearing = Number((sorted[1] ?? sorted[0]).arg.price);
    box.innerHTML = sorted.map((c) => `
      <div class="card ${c.cid === winCid ? 'win' : ''}">
        <div class="row"><span>${dealerLabel(c.arg.dealer)}</span><span class="price">${fmt(c.arg.price)} ${esc(c.arg.payInstrument)}</span></div>
        <div class="sub">${esc(c.arg.instrument)} · ${fmt(c.arg.quantity)}${c.cid === winCid ? ' · winner, pays 2nd price ' + fmt(clearing) : ''}</div>
      </div>`).join('');

    const cash = mine.find((c) => is(c, 'Holding') && c.arg.owner === P.buyer
      && c.arg.instrument === rfq.arg.payInstrument && Number(c.arg.amount) >= clearing);
    if (rfq && cash) awardable = { rfqCid: rfq.cid, tpl: rfq.tpl, quoteCids: sorted.map((c) => c.cid), cashCid: cash.cid };
  }
  document.getElementById('btn-award').disabled = !awardable;
}

function renderDealer(role, mine) {
  const panel = document.getElementById('body-' + role);
  // Don't clobber a half-typed ask price (and focus) mid-edit — the poll runs
  // every 1.8s and would otherwise reset the input to its default each tick.
  if (panel.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
  const party = P[role];
  const rfqs = mine.filter((c) => is(c, 'RFQ')); // dealer observes only RFQs they're invited to
  const myQuotes = mine.filter((c) => is(c, 'Quote') && c.arg.dealer === party);
  const bonds = mine.filter((c) => is(c, 'Holding') && c.arg.owner === party);
  const quotedRfqs = new Set(myQuotes.map((q) => q.arg.rfqId));

  const rfqCards = rfqs.map((r) => {
    const already = quotedRfqs.has(r.cid);
    const bond = bonds.find((b) => b.arg.instrument === r.arg.instrument && Number(b.arg.amount) === Number(r.arg.quantity));
    const canQuote = !already && bond;
    return `
      <div class="card">
        <div class="row"><span>RFQ · ${esc(r.arg.instrument)}</span><span class="sub">qty ${fmt(r.arg.quantity)}</span></div>
        ${already ? '<div class="sub">you have quoted (sealed)</div>' :
          canQuote ? `<div class="form" style="margin-top:8px">
              <label>Ask (${esc(r.arg.payInstrument)}) <input type="number" id="ask-${role}-${r.cid}" value="4230000" /></label>
              <button data-quote="${role}" data-rfq="${r.cid}" data-bond="${bond.cid}" data-tpl="${esc(r.tpl)}">Whisper sealed quote</button>
            </div>` : '<div class="sub">no matching asset to quote</div>'}
      </div>`;
  }).join('');

  const mineCards = myQuotes.map((q) => `
      <div class="card"><div class="row"><span>your quote</span><span class="price">${fmt(q.arg.price)}</span></div>
      <div class="sub">${esc(q.arg.instrument)} · ${fmt(q.arg.quantity)} · sealed to buyer only</div></div>`).join('');

  panel.innerHTML = `
    <div class="block"><h3>Incoming RFQs</h3><div class="list">${rfqCards || '<div class="empty">none</div>'}</div></div>
    <div class="block"><h3>Your quotes <span class="hint">(rivals can't see these)</span></h3>
      <div class="list">${mineCards || '<div class="blind">You only ever see your own quotes.<br>Rival dealers’ quotes are never sent to your node.</div>'}</div></div>
    <div class="block"><h3>Your holdings</h3><div class="list mono">${holdingsHtml(mine, party)}</div></div>`;
}

async function renderRegulator() {
  if (!P.regulator) return 0;
  const mine = await acs(P.regulator);
  const reports = mine.filter((c) => is(c, 'TradeReport'));
  const el = document.getElementById('regulator-view');
  el.innerHTML = reports.length
    ? 'Regulator sees ' + reports.length + ' settled trade(s): ' +
      reports.map((r) => `${esc(r.arg.instrument)} ${fmt(r.arg.quantity)} @ ${fmt(r.arg.clearingPrice)}`).join(', ') +
      ' — and nothing about the losing quotes or the RFQ.'
    : 'Regulator view: no settled trades yet (and zero visibility into live RFQs or quotes).';
  return reports.length;
}

// Glanceable KPI row. All values come from the buyer/regulator ACS the refresh
// loop already fetched; only the offset is a fresh (cheap) read for a liveness pulse.
function setStats({ offset, rfqs, quotes, settled }) {
  const set = (id, v) => { const el = document.getElementById(id); if (el && v !== undefined) el.textContent = v; };
  set('stat-offset', offset != null ? Number(offset).toLocaleString() : undefined);
  set('stat-rfqs', rfqs);
  set('stat-quotes', quotes);
  set('stat-settled', settled);
}

// ---- refresh loop ----
let busy = false;
async function refresh() {
  if (busy) return; busy = true;
  try {
    const [b, a, d] = await Promise.all([acs(P.buyer), acs(P.dealerA), acs(P.dealerB)]);
    if (!PKG) { const any = [...b, ...a, ...d].find((c) => typeof c.tpl === 'string' && c.tpl.includes(':Bisik:')); if (any) PKG = any.tpl.split(':')[0]; }
    renderBuyer(b); renderDealer('dealerA', a); renderDealer('dealerB', d);
    const settled = await renderRegulator();
    setStats({ offset: await ledgerEnd(), rfqs: b.filter((c) => is(c, 'RFQ')).length,
      quotes: b.filter((c) => is(c, 'Quote')).length, settled });
    setLedger('ok', 'ledger live · pkg ' + (PKG ? PKG.slice(0, 8) : '—'));
  } catch (e) {
    setLedger('err', 'ledger error: ' + e.message);
  } finally { busy = false; }
}

const setLedger = (cls, msg) => { const el = document.getElementById('ledger-status'); el.className = 'ledger ' + cls; el.textContent = msg; };

// ---- actions ---- (guarded so a double-click can't fire two submits)
let acting = false;
async function guarded(btn, fn) {
  if (acting) return;
  acting = true; if (btn) btn.disabled = true;
  try { await fn(); }
  finally { acting = false; if (btn) btn.disabled = false; }
}

async function createRFQ() {
  if (READONLY) return toast(RO_MSG);
  if (!PKG) return toast('package not discovered yet', true);
  const instrument = document.getElementById('rfq-instrument').value.trim();
  const payInstrument = document.getElementById('rfq-pay').value.trim();
  const quantity = posDec(document.getElementById('rfq-qty').value);
  if (!instrument || !payInstrument) return toast('instrument and pay currency are required', true);
  if (!quantity) return toast('quantity must be a positive number', true);
  await guarded(document.getElementById('btn-create-rfq'), async () => {
    try {
      await submit(P.buyer, { CreateCommand: { templateId: `${PKG}:Bisik:RFQ`, createArguments: {
        buyer: P.buyer, regulator: P.regulator, invitedDealers: [P.dealerA, P.dealerB],
        instrument, quantity, payInstrument,
        assetIssuer: CFG_PARTIES.bondIssuer ?? null, payIssuer: CFG_PARTIES.cashIssuer ?? null,
        // Daml Time as RFC3339 without fractional seconds (the form the ledger's
        // codec is known to accept everywhere else); open for 24h.
        deadline: new Date(Date.now() + 86400000).toISOString().replace(/\.\d+Z$/, 'Z') } } });
      toast('RFQ sent to the dealer panel'); refresh();
    } catch (e) { toast(e.message, true); }
  });
}

async function submitQuote(role, rfqCid, bondCid, tpl, priceRaw, btn) {
  if (READONLY) return toast(RO_MSG);
  const price = posDec(priceRaw);
  if (!price) return toast('ask must be a positive number', true);
  await guarded(btn, async () => {
    try {
      await submit(P[role], { ExerciseCommand: { templateId: tpl, contractId: rfqCid,
        choice: 'SubmitQuote', choiceArgument: { dealer: P[role], price, assetCid: bondCid } } });
      toast(role + ' quote sealed'); refresh();
    } catch (e) { toast(e.message, true); }
  });
}

async function award() {
  if (READONLY) return toast(RO_MSG);
  if (!awardable) return;
  await guarded(document.getElementById('btn-award'), async () => {
    try {
      await submit(P.buyer, { ExerciseCommand: { templateId: awardable.tpl, contractId: awardable.rfqCid,
        choice: 'Award', choiceArgument: { quoteCids: awardable.quoteCids, cashCid: awardable.cashCid } } });
      toast('Awarded — atomic DvP at the Vickrey price'); refresh();
    } catch (e) { toast(e.message, true); }
  });
}

// ---- wire up ----
document.getElementById('btn-create-rfq').addEventListener('click', createRFQ);
document.getElementById('btn-award').addEventListener('click', award);
document.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-quote]');
  if (!b) return;
  const { quote: role, rfq: rfqCid, bond: bondCid, tpl } = b.dataset;
  const price = document.getElementById(`ask-${role}-${rfqCid}`).value;
  submitQuote(role, rfqCid, bondCid, tpl, price, b);
});

(async function main() {
  try {
    let cfg = {};
    try { cfg = await (await fetch('/api/config')).json(); } catch {}
    USER_ID = cfg.userId ?? USER_ID;
    CFG_PARTIES = cfg.parties ?? {};
    if (cfg.readOnly) enterReadOnly();
    if (!(await loadParties(cfg.parties))) { setLedger('err', 'demo parties not found — run seed'); return; }
    await refresh();
    setInterval(refresh, 1800);
  } catch (e) {
    setLedger('err', 'startup failed: ' + (e?.message ?? e));
  }
})();
