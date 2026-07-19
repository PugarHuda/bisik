// Bisik desk — three party views of one Canton ledger, via the JSON Ledger API.
// The privacy is real: each panel only ever receives the contracts its party is
// a stakeholder of. Dealer B's column cannot show Dealer A's quote because the
// ledger never sends it to Dealer B's node.

const T = (t) => `Bisik:${t}`; // template-name suffix matcher
let PKG = null;                // discovered model package id (for fresh creates)
let USER_ID = 'participant_admin';
let CFG_PARTIES = {};          // issuer party ids from server config (DevNet)
const P = {};                  // role -> full party id
let awardable = null;          // { rfqCid, tpl, quoteCids, cashCid, qty } when buyer can award
let cancelableRfq = null;      // { cid, tpl } of the buyer's live RFQ (buyer can cancel it)
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

// Active contracts for a party AT a known offset — the caller fetches ledger-end
// once and shares it across parties, so a refresh is 1 ledger-end + N parallel
// queries instead of one ledger-end per party (much faster with many contracts).
const acsAt = (party, off) => retryRead(async () => {
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
const acs = async (party) => acsAt(party, await ledgerEnd());

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
    // Per-quote "Accept" = direct bilateral OTC: settle THIS dealer at its own
    // ask (SettleQuote at clearingPrice = price), instead of the competitive
    // Vickrey Award (2nd price) below. Same atomic DvP, same sealed privacy.
    box.innerHTML = sorted.map((c) => {
      const cashFor = mine.find((h) => is(h, 'Holding') && h.arg.owner === P.buyer
        && h.arg.instrument === c.arg.payInstrument && Number(h.arg.amount) >= Number(c.arg.price));
      return `
      <div class="card ${c.cid === winCid ? 'win' : ''}">
        <div class="row"><span>${dealerLabel(c.arg.dealer)}</span><span class="price">${fmt(c.arg.price)} ${esc(c.arg.payInstrument)}</span></div>
        <div class="sub">${esc(c.arg.instrument)} · ${fmt(c.arg.quantity)}${c.cid === winCid ? ' · Vickrey winner, pays 2nd price ' + fmt(clearing) : ''}</div>
        ${cashFor ? `<button class="ghost accept" style="margin-top:8px" data-accept="${c.cid}" data-tpl="${esc(c.tpl)}" data-cash="${cashFor.cid}" data-price="${esc(c.arg.price)}">Accept · direct OTC (pay ask ${fmt(c.arg.price)})</button>
        <div class="form" style="margin-top:6px">
          <label>Partial fill <input type="number" id="fill-${c.cid}" value="${esc(c.arg.quantity)}" min="0" max="${esc(c.arg.quantity)}" /></label>
          <button class="ghost" data-partial="${c.cid}" data-tpl="${esc(c.tpl)}" data-cash="${cashFor.cid}">Fill partial (prorated)</button>
        </div>` : ''}
        ${P.regulator ? `<button class="ghost disclose" style="margin-top:6px" data-disclose="${c.cid}" data-tpl="${esc(c.tpl)}">⚖ Disclose to regulator (best-execution audit)</button>` : ''}
        <button class="ghost" style="margin-top:6px" data-reject="${c.cid}" data-tpl="${esc(c.tpl)}">Reject quote (return escrow)</button>
      </div>`;
    }).join('');

    const cash = mine.find((c) => is(c, 'Holding') && c.arg.owner === P.buyer
      && c.arg.instrument === rfq.arg.payInstrument && Number(c.arg.amount) >= clearing);
    if (rfq && cash) awardable = { rfqCid: rfq.cid, tpl: rfq.tpl, quoteCids: sorted.map((c) => c.cid), cashCid: cash.cid, qty: Number(rfq.arg.quantity) };
  }
  document.getElementById('btn-award').disabled = !awardable;

  // Partial-Vickrey: same sealed auction, but the buyer takes only part of the
  // winning lot at the 2nd price, prorated. Shown whenever a full award is possible.
  const pRow = document.getElementById('award-partial-row');
  const pBtn = document.getElementById('btn-award-partial');
  const fillIn = document.getElementById('award-fill');
  if (awardable) {
    pRow.style.display = ''; pBtn.disabled = false; fillIn.max = awardable.qty;
    if (document.activeElement !== fillIn && (!fillIn.value || Number(fillIn.value) > awardable.qty)) fillIn.value = awardable.qty;
  } else { pRow.style.display = 'none'; pBtn.disabled = true; }

  // Cancel own RFQ — the buyer is its sole signatory, so it can archive a live RFQ
  // at any time (e.g. a stray or mistaken one). Any escrowed quotes stay until the
  // dealer withdraws them.
  const cBtn = document.getElementById('btn-cancel-rfq');
  if (rfq) { cBtn.style.display = ''; cancelableRfq = { cid: rfq.cid, tpl: rfq.tpl }; }
  else { cBtn.style.display = 'none'; cancelableRfq = null; }
}

// Buyer's basket lane: show the open basket RFQ and any sealed basket quotes,
// each settleable in one atomic multi-leg DvP.
function renderBasketBuyer(mine) {
  const box = document.getElementById('buyer-baskets');
  if (!box) return;
  const rfqs = mine.filter((c) => is(c, 'BasketRFQ'));
  const quotes = mine.filter((c) => is(c, 'BasketQuote'));
  if (!rfqs.length && !quotes.length) { box.innerHTML = '<div class="empty">No basket RFQ open.</div>'; return; }
  if (!quotes.length) { box.innerHTML = '<div class="empty">Basket RFQ live — waiting for dealers…</div>'; return; }
  box.innerHTML = quotes.map((c) => {
    const legs = c.arg.legs.map((l) => `${esc(l.instrument)} ×${fmt(l.quantity)}`).join(' + ');
    const cash = mine.find((h) => is(h, 'Holding') && h.arg.owner === P.buyer
      && h.arg.instrument === c.arg.payInstrument && Number(h.arg.amount) >= Number(c.arg.price));
    return `<div class="card">
      <div class="row"><span>${dealerLabel(c.arg.dealer)}</span><span class="price">${fmt(c.arg.price)} ${esc(c.arg.payInstrument)}</span></div>
      <div class="sub">${legs}</div>
      ${cash ? `<button class="ghost" style="margin-top:6px" data-basketsettle="${c.cid}" data-tpl="${esc(c.tpl)}" data-cash="${cash.cid}">Accept basket · atomic multi-leg DvP</button>` : ''}
      <button class="ghost" style="margin-top:6px" data-basketreject="${c.cid}" data-tpl="${esc(c.tpl)}">Reject basket (return all legs)</button>
    </div>`;
  }).join('');
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
      <div class="sub">${esc(q.arg.instrument)} · ${fmt(q.arg.quantity)} · sealed to buyer only</div>
      ${P.regulator ? `<button class="ghost disclose" style="margin-top:8px" data-dealerdisclose="${q.cid}" data-tpl="${esc(q.tpl)}" data-role="${role}">⚖ Disclose to regulator (fair-pricing defence)</button>` : ''}
      <button class="ghost" style="margin-top:6px" data-withdraw="${q.cid}" data-tpl="${esc(q.tpl)}" data-role="${role}">Withdraw quote (release escrow)</button>
      </div>`).join('');

  // ---- multi-instrument baskets: a dealer quotes ONE price for the whole package ----
  const basketRfqs = mine.filter((c) => is(c, 'BasketRFQ'));
  const myBasketQuotes = mine.filter((c) => is(c, 'BasketQuote') && c.arg.dealer === party);
  const quotedBaskets = new Set(myBasketQuotes.map((q) => q.arg.rfqId));
  const basketCards = basketRfqs.map((r) => {
    const already = quotedBaskets.has(r.cid);
    // one owned holding per leg (matching instrument + quantity), in leg order
    const legAssets = r.arg.legs.map((leg) => bonds.find((b) => b.arg.instrument === leg.instrument && Number(b.arg.amount) === Number(leg.quantity)));
    const haveAll = legAssets.every(Boolean);
    const legTxt = r.arg.legs.map((l) => `${esc(l.instrument)} ×${fmt(l.quantity)}`).join(' + ');
    return `
      <div class="card">
        <div class="row"><span>Basket RFQ</span><span class="sub">${legTxt}</span></div>
        ${already ? '<div class="sub">you have quoted (sealed)</div>' :
          haveAll ? `<div class="form" style="margin-top:8px">
              <label>Basket ask (USDC) <input type="number" id="bask-${role}-${r.cid}" value="4400000" /></label>
              <button data-basketquote="${role}" data-rfq="${r.cid}" data-tpl="${esc(r.tpl)}" data-assets="${legAssets.map((a) => a.cid).join(',')}">Whisper basket quote</button>
            </div>` : '<div class="sub">no matching assets for all legs</div>'}
      </div>`;
  }).join('');
  const myBasketCards = myBasketQuotes.map((q) => {
    const legTxt = q.arg.legs.map((l) => `${esc(l.instrument)} ×${fmt(l.quantity)}`).join(' + ');
    return `<div class="card"><div class="row"><span>your basket quote</span><span class="price">${fmt(q.arg.price)}</span></div>
      <div class="sub">${legTxt} · sealed to buyer only</div>
      <button class="ghost" style="margin-top:8px" data-basketwithdraw="${q.cid}" data-tpl="${esc(q.tpl)}" data-role="${role}">Withdraw basket quote (release all legs)</button></div>`;
  }).join('');
  const basketBlock = (basketRfqs.length || myBasketQuotes.length)
    ? `<div class="block"><h3>Incoming baskets <span class="hint">(multi-leg)</span></h3><div class="list">${basketCards || '<div class="empty">none</div>'}</div>`
      + (myBasketCards ? `<h3 style="margin-top:14px">Your basket quotes <span class="hint">(rivals can't see these)</span></h3><div class="list">${myBasketCards}</div>` : '')
      + `</div>`
    : '';

  panel.innerHTML = `
    <div class="block"><h3>Incoming RFQs</h3><div class="list">${rfqCards || '<div class="empty">none</div>'}</div></div>
    <div class="block"><h3>Your quotes <span class="hint">(rivals can't see these)</span></h3>
      <div class="list">${mineCards || '<div class="blind">You only ever see your own quotes.<br>Rival dealers’ quotes are never sent to your node.</div>'}</div></div>
    ${basketBlock}`;
}

function renderRegulator(mine) {
  if (!P.regulator || !mine) return 0;
  const reports = mine.filter((c) => is(c, 'TradeReport'));
  const baskets = mine.filter((c) => is(c, 'BasketTradeReport'));
  const total = reports.length + baskets.length;
  const parts = [
    ...reports.map((r) => `${esc(r.arg.instrument)} ${fmt(r.arg.quantity)} @ ${fmt(r.arg.clearingPrice)}`),
    ...baskets.map((r) => `basket [${r.arg.legs.map((l) => esc(l.instrument)).join(' + ')}] @ ${fmt(r.arg.clearingPrice)}`),
  ];
  const el = document.getElementById('regulator-view');
  el.innerHTML = total
    ? 'Regulator sees ' + total + ' settled trade(s): ' + parts.join(', ') +
      ' — and nothing about the losing quotes or the RFQ.'
    : 'Regulator view: no settled trades yet (and zero visibility into live RFQs or quotes).';
  return total;
}

// ---- view switcher (sidebar): the 3-column desk · Portfolio · Audit trail ----
let lastReg = [];
let lastAcs = { buyer: [], dealerA: [], dealerB: [] };
function showView(v) {
  const desk = v === 'desk';
  document.querySelector('.desk').style.display = desk ? '' : 'none';
  document.querySelector('.foot').style.display = desk ? '' : 'none';
  document.getElementById('view-audit').hidden = v !== 'audit';
  document.getElementById('view-portfolio').hidden = v !== 'portfolio';
  document.getElementById('view-verify').hidden = v !== 'verify';
  const ht = document.getElementById('howto'); if (ht) ht.style.display = desk ? '' : 'none';
  document.querySelectorAll('.side-nav a[data-view]').forEach((a) => a.classList.toggle('on', a.dataset.view === v));
  if (v === 'audit') renderAudit();
  if (v === 'portfolio') renderPortfolio();
  if (v === 'verify') renderVerify();
}
// Live, on-ledger privacy proof: count what each party's node actually holds.
function renderVerify() {
  const el = document.getElementById('verify-body'); if (!el) return;
  const scan = (arr, party) => {
    const quotes = arr.filter((c) => is(c, 'Quote'));
    const own = quotes.filter((c) => c.arg.dealer === party).length;
    return { total: quotes.length, own, rival: quotes.length - own };
  };
  const a = scan(lastAcs.dealerA, P.dealerA), b = scan(lastAcs.dealerB, P.dealerB);
  const regQuotes = lastReg.filter((c) => is(c, 'Quote')).length;
  const regRfq = lastReg.filter((c) => is(c, 'RFQ') || is(c, 'BasketRFQ')).length;
  const regTrades = lastReg.filter((c) => is(c, 'TradeReport') || is(c, 'BasketTradeReport')).length;
  const pass = a.rival === 0 && b.rival === 0 && regQuotes === 0 && regRfq === 0;
  const row = (name, detail, ok) => `<div class="vf-row"><div class="vf-name">${name}</div><div class="vf-detail">${detail}</div><div class="vf-badge ${ok ? 'ok' : 'bad'}">${ok ? '✓' : '✗'}</div></div>`;
  el.innerHTML =
    `<div class="vf-verdict ${pass ? 'ok' : ''}">${pass ? '✓ Sub-transaction privacy verified on-ledger' : 'seed some quotes to verify…'}</div>`
    + '<div class="vf-grid">'
    + row('Dealer A’s node', `holds <b>${a.total}</b> sealed quote(s) — all <b>${a.own}</b> its own. Rivals’ quotes received: <b>${a.rival}</b>.`, a.rival === 0)
    + row('Dealer B’s node', `holds <b>${b.total}</b> sealed quote(s) — all <b>${b.own}</b> its own. Rivals’ quotes received: <b>${b.rival}</b>.`, b.rival === 0)
    + row('Regulator’s node', `holds <b>${regTrades}</b> settled trade(s), <b>${regQuotes}</b> sealed quotes, <b>${regRfq}</b> live RFQ(s). Pre-trade visibility: <b>none</b>.`, regQuotes === 0 && regRfq === 0)
    + '</div>'
    + '<div class="vf-note">Each figure is the number of contracts that party’s participant node actually holds — queried live over the JSON Ledger API, not filtered by this UI. A rival dealer’s quote isn’t hidden from the screen; it was never transmitted to that node. That is Canton sub-transaction privacy — no ZK proofs, no FHE, no TEE.</div>';
}
// Portfolio: each party's holdings, aggregated by instrument.
function renderPortfolio() {
  const el = document.getElementById('portfolio-body'); if (!el) return;
  const col = (name, party, contracts) => {
    const byInst = {};
    for (const h of contracts.filter((c) => is(c, 'Holding') && c.arg.owner === party))
      byInst[h.arg.instrument] = (byInst[h.arg.instrument] ?? 0) + Number(h.arg.amount);
    const rows = Object.entries(byInst).sort(([a], [b]) => a.localeCompare(b));
    return `<div class="pf-col"><h3>${name}</h3><span class="pid">${party ? esc(party.split('::')[0]) : ''}</span>`
      + (rows.length ? rows.map(([inst, amt]) => `<div class="pf-row"><span>${esc(inst)}</span><span class="num">${fmt(amt)}</span></div>`).join('')
                     : '<div class="empty">no positions</div>') + '</div>';
  };
  el.innerHTML = col('Buyer', P.buyer, lastAcs.buyer) + col('Dealer A', P.dealerA, lastAcs.dealerA) + col('Dealer B', P.dealerB, lastAcs.dealerB);
}
function renderAudit() {
  const el = document.getElementById('audit-table'); if (!el) return;
  const rows = [
    ...lastReg.filter((c) => is(c, 'TradeReport')).map((c) => ({ inst: esc(c.arg.instrument), qty: fmt(c.arg.quantity), price: fmt(c.arg.clearingPrice), kind: 'single-instrument' })),
    ...lastReg.filter((c) => is(c, 'BasketTradeReport')).map((c) => ({ inst: 'basket [' + c.arg.legs.map((l) => esc(l.instrument)).join(' + ') + ']', qty: c.arg.legs.map((l) => fmt(l.quantity)).join(' / '), price: fmt(c.arg.clearingPrice), kind: 'basket' })),
  ];
  const trades = rows.length
    ? '<table class="audit"><thead><tr><th>Instrument</th><th>Quantity</th><th>Clearing price</th><th>Type</th></tr></thead><tbody>'
      + rows.map((r) => `<tr><td>${r.inst}</td><td class="num">${r.qty}</td><td class="num">${r.price}</td><td class="mode">${r.kind}</td></tr>`).join('')
      + '</tbody></table>'
    : '<div class="audit-empty">No settled trades yet — the regulator sees nothing pre-trade.</div>';
  // Selective disclosures: sealed quotes the buyer revealed to the regulator on demand.
  const disc = lastReg.filter((c) => is(c, 'QuoteDisclosure'));
  const who = (d) => d.arg.discloser === P.buyer ? 'buyer' : dealerLabel(d.arg.dealer);
  const disclosures = disc.length
    ? '<h3 style="margin-top:34px;font-size:15px;color:var(--ink)">Selectively disclosed quotes '
      + '<span class="hint" style="font-weight:400">— sealed quotes the buyer OR the dealer chose to reveal to the regulator on demand (never public, never sent to rivals)</span></h3>'
      + '<table class="audit"><thead><tr><th>Disclosed by</th><th>Dealer</th><th>Instrument</th><th>Quantity</th><th>Quoted price</th><th>Reason</th></tr></thead><tbody>'
      + disc.map((d) => `<tr><td>${who(d)}</td><td>${dealerLabel(d.arg.dealer)}</td><td>${esc(d.arg.instrument)}</td><td class="num">${fmt(d.arg.quantity)}</td><td class="num">${fmt(d.arg.price)}</td><td class="mode">${esc(d.arg.reason)}</td></tr>`).join('')
      + '</tbody></table>'
    : '';
  el.innerHTML = trades + disclosures;
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
    // One ledger-end, then every party's contracts in parallel at that offset.
    const off = await ledgerEnd();
    const [b, a, d, r] = await Promise.all([
      acsAt(P.buyer, off), acsAt(P.dealerA, off), acsAt(P.dealerB, off),
      P.regulator ? acsAt(P.regulator, off) : Promise.resolve([]),
    ]);
    if (!PKG) { const any = [...b, ...a, ...d].find((c) => typeof c.tpl === 'string' && c.tpl.includes(':Bisik:')); if (any) PKG = any.tpl.split(':')[0]; }
    renderBuyer(b); renderBasketBuyer(b); renderDealer('dealerA', a); renderDealer('dealerB', d);
    const settled = renderRegulator(r);
    lastReg = r; lastAcs = { buyer: b, dealerA: a, dealerB: d };
    if (!document.getElementById('view-audit')?.hidden) renderAudit();
    if (!document.getElementById('view-portfolio')?.hidden) renderPortfolio();
    if (!document.getElementById('view-verify')?.hidden) renderVerify();
    setStats({ offset: off, rfqs: b.filter((c) => is(c, 'RFQ')).length,
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

// Direct bilateral OTC: buyer hits one dealer's firm quote at its ask price.
// Reuses the Quote's SettleQuote choice (atomic DvP) with clearingPrice = ask —
// no auction, no second-price. The other dealers' quotes stay live (a dealer can
// still WithdrawQuote its escrow), exactly like hitting one counterparty on a desk.
async function acceptQuote(quoteCid, tpl, cashCid, price, btn) {
  if (READONLY) return toast(RO_MSG);
  await guarded(btn, async () => {
    try {
      await submit(P.buyer, { ExerciseCommand: { templateId: tpl, contractId: quoteCid,
        choice: 'SettleQuote', choiceArgument: { cashCid, clearingPrice: price } } });
      toast('Direct OTC settled at ask — atomic DvP'); refresh();
    } catch (e) { toast(e.message, true); }
  });
}

// Partial bilateral fill: settle `fill` units (<= the quote's size) of one dealer
// at its prorated ask, via the Quote's AcceptPartial choice (atomic DvP). The
// unfilled remainder returns to the dealer.
async function partialFill(quoteCid, tpl, cashCid, fillRaw, btn) {
  if (READONLY) return toast(RO_MSG);
  const fill = posDec(fillRaw);
  if (!fill) return toast('fill quantity must be a positive number', true);
  await guarded(btn, async () => {
    try {
      await submit(P.buyer, { ExerciseCommand: { templateId: tpl, contractId: quoteCid,
        choice: 'AcceptPartial', choiceArgument: { cashCid, fillQuantity: fill } } });
      toast('Partial fill settled — prorated atomic DvP'); refresh();
    } catch (e) { toast(e.message, true); }
  });
}

// Selective disclosure: the buyer reveals one sealed quote to the regulator on
// demand (best-execution audit) — without making it public or telling rivals.
async function discloseQuote(quoteCid, tpl, btn) {
  if (READONLY) return toast(RO_MSG);
  await guarded(btn, async () => {
    try {
      await submit(P.buyer, { ExerciseCommand: { templateId: tpl, contractId: quoteCid, choice: 'DiscloseTo',
        choiceArgument: { auditor: P.regulator, reason: 'best-execution audit' } } });
      toast('Quote selectively disclosed to the regulator — rivals still can’t see it'); refresh();
    } catch (e) { toast(e.message, true); }
  });
}

// Symmetric selective disclosure: the DEALER reveals its OWN sealed quote to the
// regulator — a fair-pricing / dispute defence — without exposing it to rivals or
// the public. Either side of the trade controls its own disclosure (Canton v6).
async function dealerDiscloseQuote(role, quoteCid, tpl, btn) {
  if (READONLY) return toast(RO_MSG);
  await guarded(btn, async () => {
    try {
      await submit(P[role], { ExerciseCommand: { templateId: tpl, contractId: quoteCid, choice: 'DealerDiscloseTo',
        choiceArgument: { auditor: P.regulator, reason: 'fair-pricing defence' } } });
      toast('Dealer disclosed its own quote to the regulator — rivals still can’t see it'); refresh();
    } catch (e) { toast(e.message, true); }
  });
}

// Dealer walks away from a live (un-awarded) quote: WithdrawQuote archives it and
// returns the escrowed bond to the dealer. Without this, a losing/stale quote's
// collateral stays locked forever.
async function withdrawQuote(role, quoteCid, tpl, btn) {
  if (READONLY) return toast(RO_MSG);
  await guarded(btn, async () => {
    try {
      await submit(P[role], { ExerciseCommand: { templateId: tpl, contractId: quoteCid, choice: 'WithdrawQuote', choiceArgument: {} } });
      toast('Quote withdrawn — escrow released back to the dealer'); refresh();
    } catch (e) { toast(e.message, true); }
  });
}

// ---- multi-instrument baskets ----
const basketLegs = () => [
  { instrument: 'TBOND30', quantity: '1000.0', assetIssuer: CFG_PARTIES.bondIssuer ?? null },
  { instrument: 'GILT10', quantity: '100.0', assetIssuer: CFG_PARTIES.bondIssuer ?? null },
];
async function createBasketRFQ() {
  if (READONLY) return toast(RO_MSG);
  if (!PKG) return toast('package not discovered yet', true);
  await guarded(document.getElementById('btn-create-basket'), async () => {
    try {
      await submit(P.buyer, { CreateCommand: { templateId: `${PKG}:Bisik:BasketRFQ`, createArguments: {
        buyer: P.buyer, regulator: P.regulator, invitedDealers: [P.dealerA, P.dealerB],
        legs: basketLegs(), payInstrument: 'USDC', payIssuer: CFG_PARTIES.cashIssuer ?? null,
        deadline: new Date(Date.now() + 86400000).toISOString().replace(/\.\d+Z$/, 'Z') } } });
      toast('Basket RFQ sent to the dealer panel'); refresh();
    } catch (e) { toast(e.message, true); }
  });
}
async function quoteBasket(role, rfqCid, tpl, assetsCsv, priceRaw, btn) {
  if (READONLY) return toast(RO_MSG);
  const price = posDec(priceRaw);
  if (!price) return toast('basket ask must be a positive number', true);
  await guarded(btn, async () => {
    try {
      await submit(P[role], { ExerciseCommand: { templateId: tpl, contractId: rfqCid, choice: 'SubmitBasketQuote',
        choiceArgument: { dealer: P[role], price, assetCids: assetsCsv.split(',') } } });
      toast(role + ' basket quote sealed'); refresh();
    } catch (e) { toast(e.message, true); }
  });
}
async function settleBasket(quoteCid, tpl, cashCid, btn) {
  if (READONLY) return toast(RO_MSG);
  await guarded(btn, async () => {
    try {
      await submit(P.buyer, { ExerciseCommand: { templateId: tpl, contractId: quoteCid,
        choice: 'SettleBasket', choiceArgument: { cashCid } } });
      toast('Basket settled — atomic multi-leg DvP'); refresh();
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

// Partial-Vickrey: run the same sealed auction, but the buyer takes only
// `fillQuantity` of the winning lot at the 2nd price, prorated (AwardPartial).
async function awardPartial() {
  if (READONLY) return toast(RO_MSG);
  if (!awardable) return;
  const fill = posDec(document.getElementById('award-fill').value);
  if (!fill) return toast('partial award quantity must be a positive number', true);
  if (Number(fill) > awardable.qty) return toast('partial award exceeds the RFQ quantity', true);
  await guarded(document.getElementById('btn-award-partial'), async () => {
    try {
      await submit(P.buyer, { ExerciseCommand: { templateId: awardable.tpl, contractId: awardable.rfqCid,
        choice: 'AwardPartial', choiceArgument: { quoteCids: awardable.quoteCids, cashCid: awardable.cashCid, fillQuantity: fill } } });
      toast('Awarded partially — atomic DvP at the prorated Vickrey price'); refresh();
    } catch (e) { toast(e.message, true); }
  });
}

// Buyer archives its own live RFQ (sole signatory). Stray/mistaken RFQs.
async function cancelRFQ() {
  if (READONLY) return toast(RO_MSG);
  if (!cancelableRfq) return;
  await guarded(document.getElementById('btn-cancel-rfq'), async () => {
    try {
      await submit(P.buyer, { ExerciseCommand: { templateId: cancelableRfq.tpl, contractId: cancelableRfq.cid, choice: 'CancelRFQ', choiceArgument: {} } });
      toast('RFQ cancelled'); refresh();
    } catch (e) { toast(e.message, true); }
  });
}

// Buyer declines a sealed quote — its escrowed bond returns to the dealer.
async function rejectQuote(quoteCid, tpl, btn) {
  if (READONLY) return toast(RO_MSG);
  await guarded(btn, async () => {
    try {
      await submit(P.buyer, { ExerciseCommand: { templateId: tpl, contractId: quoteCid, choice: 'RejectQuote', choiceArgument: {} } });
      toast('Quote rejected — escrow returned to the dealer'); refresh();
    } catch (e) { toast(e.message, true); }
  });
}

// Dealer withdraws its live basket quote — every escrowed leg returns to it.
async function withdrawBasket(role, quoteCid, tpl, btn) {
  if (READONLY) return toast(RO_MSG);
  await guarded(btn, async () => {
    try {
      await submit(P[role], { ExerciseCommand: { templateId: tpl, contractId: quoteCid, choice: 'WithdrawBasketQuote', choiceArgument: {} } });
      toast('Basket quote withdrawn — all legs released back to the dealer'); refresh();
    } catch (e) { toast(e.message, true); }
  });
}

// Buyer declines a basket quote — every leg returns to the dealer.
async function rejectBasket(quoteCid, tpl, btn) {
  if (READONLY) return toast(RO_MSG);
  await guarded(btn, async () => {
    try {
      await submit(P.buyer, { ExerciseCommand: { templateId: tpl, contractId: quoteCid, choice: 'RejectBasketQuote', choiceArgument: {} } });
      toast('Basket rejected — all legs returned to the dealer'); refresh();
    } catch (e) { toast(e.message, true); }
  });
}

// ---- wire up ----
document.getElementById('btn-create-rfq').addEventListener('click', createRFQ);
document.getElementById('btn-award').addEventListener('click', award);
document.getElementById('btn-award-partial')?.addEventListener('click', awardPartial);
document.getElementById('btn-cancel-rfq')?.addEventListener('click', cancelRFQ);
document.getElementById('btn-create-basket')?.addEventListener('click', createBasketRFQ);
document.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-quote]');
  if (!b) return;
  const { quote: role, rfq: rfqCid, bond: bondCid, tpl } = b.dataset;
  const price = document.getElementById(`ask-${role}-${rfqCid}`).value;
  submitQuote(role, rfqCid, bondCid, tpl, price, b);
});
document.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-accept]');
  if (!b) return;
  acceptQuote(b.dataset.accept, b.dataset.tpl, b.dataset.cash, b.dataset.price, b);
});
document.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-partial]');
  if (!b) return;
  const fill = document.getElementById('fill-' + b.dataset.partial)?.value;
  partialFill(b.dataset.partial, b.dataset.tpl, b.dataset.cash, fill, b);
});
document.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-basketquote]');
  if (!b) return;
  const price = document.getElementById(`bask-${b.dataset.basketquote}-${b.dataset.rfq}`).value;
  quoteBasket(b.dataset.basketquote, b.dataset.rfq, b.dataset.tpl, b.dataset.assets, price, b);
});
document.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-basketsettle]');
  if (!b) return;
  settleBasket(b.dataset.basketsettle, b.dataset.tpl, b.dataset.cash, b);
});
document.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-disclose]');
  if (!b) return;
  discloseQuote(b.dataset.disclose, b.dataset.tpl, b);
});
document.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-dealerdisclose]');
  if (!b) return;
  dealerDiscloseQuote(b.dataset.role, b.dataset.dealerdisclose, b.dataset.tpl, b);
});
document.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-withdraw]');
  if (!b) return;
  withdrawQuote(b.dataset.role, b.dataset.withdraw, b.dataset.tpl, b);
});
document.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-reject]');
  if (!b) return;
  rejectQuote(b.dataset.reject, b.dataset.tpl, b);
});
document.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-basketwithdraw]');
  if (!b) return;
  withdrawBasket(b.dataset.role, b.dataset.basketwithdraw, b.dataset.tpl, b);
});
document.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-basketreject]');
  if (!b) return;
  rejectBasket(b.dataset.basketreject, b.dataset.tpl, b);
});
// Sidebar view switcher: swap the main area between the 3-column desk and the
// dedicated audit-trail page (external links carry no data-view and navigate away).
document.querySelector('.side-nav')?.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-view]');
  if (!a) return;
  e.preventDefault();
  showView(a.dataset.view);
});
document.getElementById('howto-x')?.addEventListener('click', () => document.getElementById('howto')?.remove());

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
    // Near-instant updates when the local server offers an SSE push stream; a
    // harmless no-op on hosts that don't (the timed poll above still runs).
    try {
      const es = new EventSource('/api/stream');
      es.onmessage = () => refresh();
      es.onerror = () => es.close();
    } catch { /* no EventSource / no stream — polling covers it */ }
  } catch (e) {
    setLedger('err', 'startup failed: ' + (e?.message ?? e));
  }
})();
