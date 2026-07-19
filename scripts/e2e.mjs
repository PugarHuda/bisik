// End-to-end UI test: drives the actual desk like a user and asserts the response
// at each step. Run against a FRESH holdings-only seed:
//   npm run demo          # terminal 1
//   node scripts/e2e.mjs  # terminal 2
// Exits non-zero if any case fails. Covers: RFQ, the money shot (privacy),
// selective disclosure, Vickrey award, direct OTC, partial fill, baskets, the
// Portfolio / Verify-privacy / Audit views, and input validation.
import { chromium } from 'playwright';

const URL = process.env.BISIK_URL ?? 'http://localhost:8080/app.html';
const results = [];
const check = (name, cond, detail = '') => {
  results.push({ name, ok: !!cond });
  console.log((cond ? '  ✓ ' : '  ✗ FAIL ') + name + (cond ? '' : '  — ' + detail));
};

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  const wait = (ms) => p.waitForTimeout(ms);
  const txt = (sel) => p.locator(sel).textContent();
  const setDesk = () => p.locator('.side-nav a[data-view="desk"]').click().then(() => wait(400));
  const setView = (v) => p.locator(`.side-nav a[data-view="${v}"]`).click().then(() => wait(700));

  await p.goto(URL, { waitUntil: 'load' });
  await p.waitForFunction(() => { const e = document.getElementById('pid-buyer'); return e && e.textContent && e.textContent !== '—'; }, { timeout: 60000 });
  await wait(1200);

  console.log('\n── Case 1 · Buyer opens an RFQ ──');
  await p.click('#btn-create-rfq');
  await p.waitForSelector('button[data-quote="dealerA"]', { timeout: 15000 });
  await wait(700);
  check('dealers receive the RFQ', (await txt('#body-dealerA')).includes('RFQ'));
  check('buyer waits for quotes', (await txt('#buyer-quotes')).toLowerCase().includes('waiting'));

  console.log('── Case 2 · THE MONEY SHOT — Dealer A quotes, Dealer B stays blind ──');
  await p.fill('input[id^="ask-dealerA-"]', '4210000');
  await p.click('button[data-quote="dealerA"]');
  await p.waitForSelector('#buyer-quotes .card', { timeout: 15000 });
  await wait(1200);
  check('buyer receives Dealer A’s quote (4,210,000)', (await txt('#buyer-quotes')).includes('4,210,000'));
  const bCol = await txt('#body-dealerB');
  check('privacy: Dealer B never receives A’s quote', !bCol.includes('4,210,000') && bCol.includes('only ever see your own'));

  console.log('── Case 3 · Dealer B quotes ──');
  await p.fill('input[id^="ask-dealerB-"]', '4250000');
  await p.click('button[data-quote="dealerB"]');
  await p.waitForSelector('#btn-award:not([disabled])', { timeout: 15000 });
  await wait(900);
  const bq = await txt('#buyer-quotes');
  check('buyer sees BOTH sealed quotes', bq.includes('4,210,000') && bq.includes('4,250,000'));

  console.log('── Case 3b · Symmetric disclosure — the DEALER reveals its OWN quote (v6) ──');
  const ddBtns = await p.locator('#body-dealerA button[data-dealerdisclose]').count();
  check('dealer has a disclose-own-quote control', ddBtns >= 1);
  if (ddBtns) {
    await p.locator('#body-dealerA button[data-dealerdisclose]').first().click({ force: true });
    await wait(2500);
    await setView('audit');
    check('regulator sees the dealer-disclosed quote (fair-pricing defence)', (await txt('#audit-table')).includes('fair-pricing defence'));
    await setDesk();
  }

  console.log('── Case 4 · Selective disclosure — reveal one quote to the regulator ──');
  const discBtns = await p.locator('button[data-disclose]').count();
  check('a "disclose to regulator" control exists per quote', discBtns >= 1);
  if (discBtns) {
    await p.locator('button[data-disclose]').first().click({ force: true });
    await wait(2500);
    await setView('audit');
    check('regulator now sees the selectively-disclosed quote', (await txt('#audit-table')).includes('Selectively disclosed'));
    await setDesk();
  }

  console.log('── Case 5 · Vickrey award — cheapest wins, paid the 2nd price ──');
  await p.click('#btn-award');
  await p.waitForFunction(() => document.getElementById('regulator-view')?.textContent?.includes('settled trade'), { timeout: 20000 });
  await wait(1000);
  check('settled at the Vickrey 2nd price (4,250,000)', (await txt('#regulator-view')).includes('4,250,000'));
  check('settled-trades tile incremented', Number(await txt('#stat-settled')) >= 1);

  console.log('── Case 6 · Portfolio / Verify / Audit views ──');
  await setView('portfolio');
  check('Portfolio shows three party columns', (await p.locator('.pf-col').count()) === 3);
  check('Portfolio: buyer received the bond', (await txt('#view-portfolio')).includes('TBOND30'));
  await setView('verify');
  check('Verify-privacy verdict = verified', (await txt('.vf-verdict')).includes('verified'));
  check('Verify-privacy shows 3 green checks', (await p.locator('.vf-badge.ok').count()) === 3);
  await setView('audit');
  check('Audit trail lists the settled trade', (await txt('#audit-table')).includes('TBOND30'));
  await setDesk();

  console.log('── Case 7 · Direct OTC (partial fill) on a second instrument ──');
  await p.fill('#rfq-instrument', 'GILT10');
  await p.fill('#rfq-qty', '100');
  await p.click('#btn-create-rfq');
  await p.waitForFunction(() => !!document.querySelector('button[data-quote="dealerA"]'), { timeout: 15000 });
  await wait(700);
  await p.fill('input[id^="ask-dealerA-"]', '190000');
  await p.click('button[data-quote="dealerA"]');
  await p.waitForSelector('button[data-partial]', { timeout: 15000 });
  await wait(800);
  const fillId = await p.$eval('input[id^="fill-"]', (el) => el.id);
  await p.fill('#' + fillId, '60');
  await p.click('button[data-partial]');
  await p.waitForFunction(() => (document.getElementById('regulator-view')?.textContent?.match(/@/g) || []).length >= 2, { timeout: 20000 });
  await wait(900);
  check('partial fill settled 60/100 at the prorated ask (114,000)', (await txt('#regulator-view')).includes('114,000'));

  console.log('── Case 8 · Multi-instrument basket ──');
  try {
    await p.click('#btn-create-basket');
    await p.waitForSelector('button[data-basketquote]', { timeout: 15000 });
    await wait(800);
    // Quote the basket at a price the buyer's remaining cash covers (earlier cases spent most of it).
    await p.fill('input[id^="bask-"]', '500000');
    await p.locator('button[data-basketquote]').first().click({ force: true });
    await p.waitForSelector('button[data-basketsettle]', { timeout: 15000 });
    await wait(800);
    await p.locator('button[data-basketsettle]').first().click({ force: true });
    await p.waitForFunction(() => document.getElementById('regulator-view')?.textContent?.includes('basket'), { timeout: 20000 });
    await wait(900);
    check('basket settled (atomic multi-leg DvP)', (await txt('#regulator-view')).includes('basket'));
  } catch (e) { check('basket settled (atomic multi-leg DvP)', false, e.message.split('\n')[0]); }

  console.log('── Case 9 · Input validation ──');
  await p.fill('#rfq-instrument', 'TBOND30');
  await p.fill('#rfq-qty', '0'); // non-positive quantity must be rejected
  await p.click('#btn-create-rfq');
  await wait(900);
  check('non-positive quantity is rejected (error toast)', await p.locator('.toast.err.show').count() >= 1 || (await p.locator('.toast').textContent().catch(() => '')).toLowerCase().includes('positive'));

  check('no uncaught page errors during the whole run', errs.length === 0, errs.join(' | '));

  await b.close();
  const pass = results.filter((r) => r.ok).length;
  console.log(`\n=== E2E: ${pass}/${results.length} cases passed ===`);
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error('E2E harness error:', e.message); process.exit(1); });
