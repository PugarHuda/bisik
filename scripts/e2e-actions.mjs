// End-to-end UI test for the desk's action choices — the housekeeping/settlement
// paths beyond the money shot. Drives each through the real UI and asserts the
// ledger response. Run against a FRESH holdings-only seed:
//   npm run demo               # terminal 1
//   node scripts/e2e-actions.mjs   # terminal 2
// Covers: AwardPartial (partial-Vickrey), CancelRFQ, RejectQuote,
// WithdrawBasketQuote, RejectBasketQuote. Complements scripts/e2e.mjs.
import { chromium } from 'playwright';
const URL = 'http://localhost:8080/app.html';
const R = [];
const check = (n, c, d = '') => { R.push({ n, ok: !!c }); console.log((c ? '  ✓ ' : '  ✗ FAIL ') + n + (c ? '' : '  — ' + d)); };
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(String(e))); p.on('console', m => { if (m.type() === 'error') errs.push('console:' + m.text()); });
  const wait = ms => p.waitForTimeout(ms); const txt = s => p.locator(s).textContent();
  const toastText = () => p.locator('.toast').textContent().catch(() => '');
  const setDesk = () => p.locator('.side-nav a[data-view="desk"]').click().then(() => wait(400));
  const setView = v => p.locator(`.side-nav a[data-view="${v}"]`).click().then(() => wait(700));
  const rfq = async (i, q) => { await p.fill('#rfq-instrument', i); await p.fill('#rfq-qty', String(q)); await p.click('#btn-create-rfq'); };
  await p.goto(URL, { waitUntil: 'load' });
  await p.waitForFunction(() => document.getElementById('pid-buyer')?.textContent !== '—', { timeout: 60000 }); await wait(1200);

  console.log('\n── 1 · AwardPartial (partial-Vickrey) ──');
  try {
    await rfq('TBOND30', 1000);
    await p.waitForSelector('button[data-quote="dealerA"]', { timeout: 15000 }); await wait(600);
    await p.fill('input[id^="ask-dealerA-"]', '4210000'); await p.click('button[data-quote="dealerA"]');
    await p.waitForFunction(() => !!document.querySelector('button[data-quote="dealerB"]'), { timeout: 15000 }); await wait(400);
    await p.fill('input[id^="ask-dealerB-"]', '4250000'); await p.click('button[data-quote="dealerB"]');
    await p.waitForSelector('#btn-award:not([disabled])', { timeout: 15000 }); await wait(700);
    check('partial-award row is visible when award is possible', await p.$eval('#award-partial-row', el => el.style.display !== 'none'));
    const settledBefore = Number(await txt('#stat-settled'));
    await p.fill('#award-fill', '400'); await p.click('#btn-award-partial');
    await p.waitForFunction(b => Number(document.getElementById('stat-settled')?.textContent) > b, { timeout: 20000 }, settledBefore).catch(() => {});
    await wait(900);
    // report: quantity = 400 (the fill), clearing prorated = 4,250,000 * 400/1000 = 1,700,000
    const reg = await txt('#regulator-view');
    const m = reg.match(/TBOND30 400 @ ([\d,]+)/); // qty 400, prorated clearing price
    check('regulator sees a partial-fill report of TBOND30 400', !!m, reg);
    const price = m ? Number(m[1].replace(/,/g, '')) : 0;
    check('partial clearing price is prorated to the 400/1000 fill (< full lot)', price > 0 && price < 2000000, 'price=' + price);
    check('settled tile incremented', Number(await txt('#stat-settled')) === settledBefore + 1);
  } catch (e) { check('AwardPartial flow', false, e.message.split('\n')[0]); }

  console.log('\n── 2 · CancelRFQ ──');
  try {
    await setDesk();
    await rfq('GILT10', 100);
    await p.waitForFunction(() => document.getElementById('btn-cancel-rfq')?.style.display !== 'none', { timeout: 15000 }); await wait(500);
    check('cancel-RFQ button appears for a live RFQ', await p.$eval('#btn-cancel-rfq', el => el.style.display !== 'none'));
    const rfqsBefore = Number(await txt('#stat-rfqs'));
    await p.click('#btn-cancel-rfq'); await wait(1500);
    check('cancel produced the "RFQ cancelled" toast', (await toastText()).toLowerCase().includes('cancel'));
    check('open-RFQ tile dropped after cancel', Number(await txt('#stat-rfqs')) < rfqsBefore, `before ${rfqsBefore} now ${await txt('#stat-rfqs')}`);
  } catch (e) { check('CancelRFQ flow', false, e.message.split('\n')[0]); }

  console.log('\n── 3 · RejectQuote (buyer declines, escrow returns) ──');
  try {
    await rfq('GILT10', 100);
    await p.waitForFunction(() => !!document.querySelector('button[data-quote="dealerA"]'), { timeout: 15000 }); await wait(600);
    await p.fill('input[id^="ask-dealerA-"]', '188000'); await p.click('button[data-quote="dealerA"]');
    await p.waitForSelector('#buyer-quotes button[data-reject]', { timeout: 15000 }); await wait(700);
    check('reject-quote button exists on the buyer card', await p.locator('#buyer-quotes button[data-reject]').count() >= 1);
    const qBefore = Number(await txt('#stat-quotes'));
    await p.locator('#buyer-quotes button[data-reject]').first().click({ force: true });
    await p.waitForFunction(b => Number(document.getElementById('stat-quotes')?.textContent) < b, { timeout: 20000 }, qBefore).catch(() => {});
    await wait(900);
    check('reject produced the escrow-return toast', (await toastText()).toLowerCase().includes('reject'));
    check('sealed-quotes tile dropped after reject', Number(await txt('#stat-quotes')) < qBefore, `before ${qBefore} now ${await txt('#stat-quotes')}`);
  } catch (e) { check('RejectQuote flow', false, e.message.split('\n')[0]); }

  console.log('\n── 4 · WithdrawBasketQuote (dealer releases legs) ──');
  try {
    await p.click('#btn-create-basket');
    await p.waitForSelector('button[data-basketquote]', { timeout: 15000 }); await wait(800);
    // quote from whichever dealer still holds both legs
    await p.locator('input[id^="bask-"]').first().fill('500000');
    await p.locator('button[data-basketquote]').first().click({ force: true });
    await p.waitForSelector('button[data-basketwithdraw]', { timeout: 15000 }); await wait(700);
    check('dealer sees its own basket quote with a withdraw control', await p.locator('button[data-basketwithdraw]').count() >= 1);
    await p.locator('button[data-basketwithdraw]').first().click({ force: true }); await wait(1500);
    check('basket-withdraw produced the release toast', (await toastText()).toLowerCase().includes('withdraw'));
    check('the dealer basket quote is gone after withdraw', await p.locator('button[data-basketwithdraw]').count() === 0);
  } catch (e) { check('WithdrawBasketQuote flow', false, e.message.split('\n')[0]); }

  console.log('\n── 5 · RejectBasketQuote (buyer declines, legs return) ──');
  try {
    // a fresh basket quote to reject (either dealer)
    if (await p.locator('button[data-basketquote]').count() === 0) { await p.click('#btn-create-basket'); await p.waitForSelector('button[data-basketquote]', { timeout: 15000 }); await wait(700); }
    await p.locator('input[id^="bask-"]').first().fill('510000');
    await p.locator('button[data-basketquote]').first().click({ force: true });
    await p.waitForSelector('#buyer-baskets button[data-basketreject]', { timeout: 15000 }); await wait(800);
    check('buyer sees a reject-basket control', await p.locator('#buyer-baskets button[data-basketreject]').count() >= 1);
    await p.locator('#buyer-baskets button[data-basketreject]').first().click({ force: true }); await wait(1500);
    check('basket-reject produced the return-legs toast', (await toastText()).toLowerCase().includes('reject'));
  } catch (e) { check('RejectBasketQuote flow', false, e.message.split('\n')[0]); }

  console.log('\n── No uncaught errors ──');
  check('zero page/console errors', errs.length === 0, errs.slice(0, 4).join(' | '));
  await b.close();
  const pass = R.filter(r => r.ok).length;
  console.log(`\n════ ALL-FEATURES: ${pass}/${R.length} passed ════`);
  const f = R.filter(r => !r.ok); if (f.length) console.log('FAIL: ' + f.map(x => x.n).join(' | '));
  process.exit(f.length ? 1 : 0);
})().catch(e => { console.error('harness error:', e.stack); process.exit(2); });
