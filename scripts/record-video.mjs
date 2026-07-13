// Record a narration-paced SILENT demo video of the Bisik desk with Playwright.
// You lay your own voice + subtitles over the .webm this produces (Encode needs a
// real human voice; this is just the visual track / B-roll).
//
//   npm run demo        # in another terminal: holdings-only seed, desk on :8080
//   npm run record:video
//
// Output: media/bisik-demo-full.webm  (+ the flow is verified end-to-end)
// Env:  SPEED=1.5  slow every hold down 1.5x (default 1). BISIK_URL to override.
import { chromium } from 'playwright';
import { mkdir, rename, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MEDIA = join(HERE, '..', 'media');
const URL = process.env.BISIK_URL ?? 'http://localhost:8080/app.html';
const SPEED = Number(process.env.SPEED ?? 1);
const W = 1600, H = 900;
const wait = (ms) => new Promise((r) => setTimeout(r, ms * SPEED));

// Guide the viewer's eye: pulse a soft accent ring around an element for `ms`.
async function spotlight(page, selector, ms = 1800) {
  await page.evaluate(([sel]) => {
    if (!document.getElementById('__spot_style')) {
      const s = document.createElement('style'); s.id = '__spot_style';
      s.textContent = `@keyframes __spot{0%,100%{box-shadow:0 0 0 3px rgba(110,231,183,.9),0 0 22px 6px rgba(110,231,183,.35)}50%{box-shadow:0 0 0 3px rgba(110,231,183,.45),0 0 10px 3px rgba(110,231,183,.15)}}
      .__spot{animation:__spot 1.1s ease-in-out infinite;border-radius:8px;scroll-margin:120px}`;
      document.head.appendChild(s);
    }
    document.querySelectorAll('.__spot').forEach((e) => e.classList.remove('__spot'));
    const el = document.querySelector(sel);
    if (el) { el.classList.add('__spot'); el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  }, [selector]);
  await wait(ms);
}
const unspot = (page) => page.evaluate(() => document.querySelectorAll('.__spot').forEach((e) => e.classList.remove('__spot')));

(async () => {
  await mkdir(MEDIA, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    recordVideo: { dir: MEDIA, size: { width: W, height: H } },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  const assertNoError = async () => {
    const t = await page.$('.toast.err.show');
    if (t) throw new Error('error toast: ' + (await t.textContent()));
  };

  await page.goto(URL, { waitUntil: 'networkidle' });
  // Wait until the desk discovered its parties (pid no longer the em-dash).
  await page.waitForFunction(() => {
    const el = document.getElementById('pid-buyer');
    return el && el.textContent && el.textContent !== '—';
  }, { timeout: 60000 });
  await wait(3000); // settle-in: let the viewer take in the three columns

  // 1 · Dashboard tiles + sidebar (the "it's an app over a live ledger" beat)
  await spotlight(page, '.stats', 3200);
  await spotlight(page, '.side-nav', 2600);
  await page.click('.side-nav a[href="#nav-audit"]'); await wait(2200);   // in-app nav works
  await page.click('.side-nav a[href="#top"]'); await wait(1500);
  await unspot(page);

  // 2 · Open the RFQ (fields are pre-filled: TBOND30 / 1000 / USDC)
  await spotlight(page, '#nav-rfq', 3000);
  await page.click('#btn-create-rfq');
  await page.waitForSelector('button[data-quote="dealerA"]', { timeout: 15000 });
  await assertNoError();
  await wait(2200);

  // 3 · Dealer A whispers a sealed quote — then HOLD on Dealer B staying blank
  await spotlight(page, '.panel[data-role="dealerA"]', 1400);
  await page.fill('input[id^="ask-dealerA-"]', '4210000');
  await wait(900);
  await page.click('button[data-quote="dealerA"]');
  await page.waitForSelector('#buyer-quotes .card', { timeout: 15000 });
  await assertNoError();
  await spotlight(page, '.panel[data-role="dealerB"]', 4200); // the money shot: empty rival column
  await unspot(page);

  // 4 · Dealer B whispers too
  await page.fill('input[id^="ask-dealerB-"]', '4250000');
  await wait(700);
  await page.click('button[data-quote="dealerB"]');
  await page.waitForSelector('#btn-award:not([disabled])', { timeout: 15000 });
  await assertNoError();
  await wait(1800);

  // 5 · Buyer sees BOTH sealed asks; highlight the two settlement modes
  await spotlight(page, '#buyer-quotes', 3200);                 // both quotes visible to buyer
  const accept = await page.$('button[data-accept]');
  if (accept) await spotlight(page, 'button[data-accept]', 3200); // mode 2: direct OTC
  await spotlight(page, '#btn-award', 2600);                    // mode 1: Vickrey

  // 6 · Settle via the competitive Vickrey Award (atomic DvP)
  await page.click('#btn-award');
  await page.waitForFunction(
    () => document.getElementById('regulator-view')?.textContent?.includes('settled trade'),
    { timeout: 20000 });
  await assertNoError();
  await unspot(page);
  await wait(1800);

  // 7 · The regulator's post-trade audit trail (and only that)
  await page.click('.side-nav a[href="#nav-audit"]'); await wait(800);
  await spotlight(page, '#regulator-view', 4200);
  await spotlight(page, '.stats', 2600); // tiles now show a settled trade + advanced offset
  await unspot(page);
  await wait(2000);

  await context.close(); // finalizes the video
  await browser.close();

  if (errs.length) { console.error('page errors:', errs.join(' | ')); process.exit(1); }

  // Playwright writes a random-named .webm; rename the newest to a stable name.
  const files = (await readdir(MEDIA)).filter((f) => f.endsWith('.webm') && f !== 'bisik-demo-full.webm' && f !== 'bisik-demo-silent.webm');
  if (files.length) {
    const newest = files.map((f) => join(MEDIA, f)).sort();
    await rename(newest[newest.length - 1], join(MEDIA, 'bisik-demo-full.webm'));
  }
  console.log('\n✓ demo verified end-to-end · media/bisik-demo-full.webm');
})().catch((e) => { console.error('record failed:', e.message); process.exit(1); });
