// End-to-end UI test for the "Provable best execution" view: money shot → buyer
// discloses both sealed asks to the regulator → Vickrey award → the regulator-side
// view attests the executed price beat every disclosed rival. Also checks the
// Devnet explorer link. Run against a FRESH holdings-only seed:
//   npm run demo                # terminal 1
//   node scripts/e2e-bestexec.mjs   # terminal 2
import { chromium } from 'playwright';
const R = []; const check = (n, c, d = '') => { R.push({ n, ok: !!c }); console.log((c ? '  ✓ ' : '  ✗ FAIL ') + n + (c ? '' : '  — ' + d)); };
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1600, height: 1100 } });
const errs = []; p.on('pageerror', e => errs.push(String(e)));
const wait = ms => p.waitForTimeout(ms); const txt = s => p.locator(s).textContent();
await p.goto('http://localhost:8080/app.html', { waitUntil: 'load' });
await p.waitForFunction(() => document.getElementById('pid-buyer')?.textContent !== '—', { timeout: 60000 }); await wait(1200);

check('sidebar has a Best-execution view + a Devnet explorer link',
  await p.locator('.side-nav a[data-view="bestexec"]').count() === 1 &&
  await p.locator('.side-nav a[href*="seaport"]').count() === 1);

// money shot: both dealers quote TBOND30 1000
await p.fill('#rfq-instrument', 'TBOND30'); await p.fill('#rfq-qty', '1000'); await p.click('#btn-create-rfq');
await p.waitForSelector('button[data-quote="dealerA"]', { timeout: 15000 }); await wait(500);
await p.fill('input[id^="ask-dealerA-"]', '4210000'); await p.click('button[data-quote="dealerA"]');
// let dealer A's sealed quote fully land (buyer card visible) before B quotes — avoids
// racing the 1.8s poll re-render, which can detach B's input mid-submit.
await p.waitForSelector('#buyer-quotes .card', { timeout: 15000 }); await wait(1200);
await p.fill('input[id^="ask-dealerB-"]', '4250000'); await p.click('button[data-quote="dealerB"]');
await p.waitForSelector('#btn-award:not([disabled])', { timeout: 15000 });
await p.waitForFunction(() => document.querySelectorAll('#buyer-quotes .card').length >= 2, { timeout: 15000 }); await wait(600);

// buyer discloses BOTH sealed quotes to the regulator (before award — DiscloseTo is nonconsuming)
const disc = p.locator('#buyer-quotes button[data-disclose]');
const dn = await disc.count();
check('buyer can disclose both competing quotes', dn === 2, 'found ' + dn);
for (let i = 0; i < dn; i++) { await disc.nth(i).click({ force: true }); await wait(1800); }

// award at the Vickrey 2nd price
await p.click('#btn-award');
await p.waitForFunction(() => document.getElementById('regulator-view')?.textContent?.includes('settled trade'), { timeout: 20000 }); await wait(1000);

// Best-execution view
await p.locator('.side-nav a[data-view="bestexec"]').click(); await wait(900);
const body = await txt('#bestexec-body');
check('best-exec view lists the TBOND30 settlement', body.includes('TBOND30'));
check('verdict = best execution attested', (await p.locator('.be-verdict.ok').count()) >= 1, 'ok-verdicts=' + await p.locator('.be-verdict.ok').count());
check('winner ask is tagged', (await p.locator('.be-tag').count()) >= 1);
check('both disclosed asks (4,210,000 & 4,250,000) shown', body.includes('4,210,000') && body.includes('4,250,000'));
check('no "below clearing" warning for the runner-up (Vickrey consistent)', !body.includes('⚠ below clearing') || body.match(/⚠ below clearing/g).length <= 1);
check('zero page errors', errs.length === 0, errs.slice(0, 3).join(' | '));

await b.close();
const pass = R.filter(r => r.ok).length; const f = R.filter(r => !r.ok);
console.log(`\n════ BEST-EXEC: ${pass}/${R.length} passed ════`); if (f.length) console.log('FAIL: ' + f.map(x => x.n).join(' | '));
process.exit(f.length ? 1 : 0);
