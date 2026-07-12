// Drive the Bisik desk through the money shot and capture screenshots + video.
// Requires the local demo running (npm run demo). Output goes to media/.
//   npm run record
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MEDIA = join(HERE, '..', 'media');
const URL = process.env.BISIK_URL ?? 'http://localhost:8080';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const step = async (page, name, ms = 2600) => { await wait(ms); await page.screenshot({ path: join(MEDIA, name) }); console.log('  📸', name); };

(async () => {
  await mkdir(MEDIA, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    recordVideo: { dir: MEDIA, size: { width: 1600, height: 900 } },
  });
  const page = await context.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });

  // Wait until the desk has discovered its parties (pid no longer the em-dash).
  await page.waitForFunction(() => {
    const el = document.getElementById('pid-buyer');
    return el && el.textContent && el.textContent !== '—';
  }, { timeout: 60000 });
  await step(page, '01-desk-loaded.png');

  // Fail loudly if any action surfaces an error toast (so we never screenshot a
  // failure and still exit 0).
  const assertNoError = async () => {
    const t = await page.$('.toast.err.show');
    if (t) throw new Error('error toast: ' + (await t.textContent()));
  };

  // Buyer opens an RFQ to the dealer panel.
  await page.click('#btn-create-rfq');
  await page.waitForSelector('button[data-quote="dealerA"]', { timeout: 15000 });
  await assertNoError();
  await step(page, '02-rfq-open.png');

  // Dealer A whispers a sealed quote. Watch Dealer B's column stay empty.
  await page.fill('input[id^="ask-dealerA-"]', '4210000');
  await page.click('button[data-quote="dealerA"]');
  await page.waitForSelector('#buyer-quotes .card', { timeout: 15000 }); // buyer received it
  await assertNoError();
  await step(page, '03-dealerA-quoted-dealerB-blind.png', 3000);

  // Dealer B whispers too.
  await page.fill('input[id^="ask-dealerB-"]', '4250000');
  await page.click('button[data-quote="dealerB"]');
  await page.waitForSelector('#btn-award:not([disabled])', { timeout: 15000 }); // awardable
  await assertNoError();
  await step(page, '04-both-quoted.png');

  // Buyer awards — Vickrey second price, atomic DvP. Confirm settlement landed.
  await page.click('#btn-award');
  await page.waitForFunction(
    () => document.getElementById('regulator-view')?.textContent?.includes('settled trade'),
    { timeout: 20000 });
  await assertNoError();
  await step(page, '05-awarded.png', 1500);

  await context.close(); // finalizes the video
  await browser.close();
  console.log('\n✓ award flow verified end-to-end; media/ has screenshots + video');
})().catch((e) => { console.error('record failed:', e.message); process.exit(1); });
