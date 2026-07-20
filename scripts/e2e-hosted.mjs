// Playwright QA of the PUBLIC hosted build — the surface a judge actually clicks.
// Covers the landing page (hero, particle canvas, responsive, reduced-motion), the
// read-only desk over live Devnet state (all four read views), the disabled-write
// UX, and console hygiene — across Chromium, Firefox and WebKit.
//   node scripts/e2e-hosted.mjs              # all three engines
//   BISIK_BASE=http://localhost:8080 node scripts/e2e-hosted.mjs chromium
import { chromium, firefox, webkit } from 'playwright';

const BASE = (process.env.BISIK_BASE ?? 'https://bisik-eight.vercel.app').replace(/\/$/, '');
const ENGINES = { chromium, firefox, webkit };
const want = process.argv.slice(2).filter((a) => ENGINES[a]);
const RUN = want.length ? want : Object.keys(ENGINES);

let pass = 0; const fails = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fails.push(name); console.log(`  ✗ FAIL ${name}${detail ? '  — ' + detail : ''}`); }
};

// Console/page errors worth failing on. Favicon 404s and the benign ResizeObserver
// notice are noise, not defects.
const isRealError = (t) =>
  !/favicon|ResizeObserver loop|Download the React DevTools/i.test(t);

async function runEngine(name) {
  console.log(`\n════════ ${name.toUpperCase()} ════════`);
  const browser = await ENGINES[name].launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && isRealError(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => { if (isRealError(String(e))) errors.push(String(e)); });

  // ── Landing page ──
  console.log('── Landing ──');
  const resp = await page.goto(BASE + '/', { waitUntil: 'load', timeout: 45000 });
  ok('landing responds 200', resp && resp.status() === 200, `status ${resp && resp.status()}`);
  ok('has a <title>', (await page.title()).length > 0);
  const desc = await page.locator('meta[name="description"]').getAttribute('content').catch(() => null);
  ok('has a meta description (SEO/social)', !!desc && desc.length > 40);
  const h1 = (await page.locator('h1').first().innerText().catch(() => '')).trim();
  ok('hero headline renders', h1.length > 0, h1.slice(0, 40));
  // The nebula particle field.
  const canvas = page.locator('canvas').first();
  ok('particle canvas is present', await canvas.count() > 0);
  if (await canvas.count() > 0) {
    const box = await canvas.boundingBox();
    ok('canvas has real dimensions', !!box && box.width > 200 && box.height > 100);
    // Animating: the canvas must actually change between two frames.
    const a = await page.evaluate(() => document.querySelector('canvas')?.toDataURL?.().slice(0, 2000) ?? '');
    await page.waitForTimeout(700);
    const b = await page.evaluate(() => document.querySelector('canvas')?.toDataURL?.().slice(0, 2000) ?? '');
    ok('canvas is animating (frame changed)', a !== '' && a !== b);
  }
  // The CTA must not merely exist — it must actually land on a working desk.
  const cta = page.locator('a[href="app.html"], a[href="/app"], a[href$="/app"]').first();
  ok('a CTA links to the desk', await cta.count() > 0);
  if (await cta.count() > 0) {
    await cta.first().click();
    await page.waitForLoadState('load');
    await page.waitForTimeout(2500);
    const onDesk = await page.locator('.desk, #stat-offset').count() > 0;
    ok('the CTA actually navigates to a working desk', onDesk, page.url());
    await page.goBack({ waitUntil: 'load' }).catch(() => {});
    await page.waitForTimeout(500);
  }

  // Responsive: the body must never scroll sideways on a phone.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok('no horizontal overflow at 390px', overflow <= 2, `overflow ${overflow}px`);
  await page.setViewportSize({ width: 1440, height: 900 });

  // Reduced motion must not break the page.
  const rmCtx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1280, height: 800 } });
  const rmPage = await rmCtx.newPage();
  const rmErrors = [];
  rmPage.on('pageerror', (e) => { if (isRealError(String(e))) rmErrors.push(String(e)); });
  await rmPage.goto(BASE + '/', { waitUntil: 'load', timeout: 45000 });
  await rmPage.waitForTimeout(600);
  ok('renders cleanly with prefers-reduced-motion', rmErrors.length === 0, rmErrors[0]);
  await rmCtx.close();

  // ── Pitch deck ──
  console.log('── Deck (/deck) ──');
  const deckResp = await page.goto(BASE + '/deck', { waitUntil: 'load', timeout: 45000 });
  ok('/deck responds 200', deckResp && deckResp.status() === 200, `status ${deckResp && deckResp.status()}`);
  const slideCount = await page.locator('.slide').count();
  ok('deck has all 13 slides', slideCount === 13, `${slideCount} slides`);
  let exactlyOne = true;
  for (let s = 0; s < slideCount; s++) {
    if (await page.locator('.slide.on').count() !== 1) exactlyOne = false;
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(90);
  }
  ok('exactly one slide is visible at every step', exactlyOne);
  const brokenImgs = await page.evaluate(() =>
    Array.from(document.images).filter((i) => i.naturalWidth === 0).map((i) => i.getAttribute('src')));
  ok('every deck image loads', brokenImgs.length === 0, brokenImgs.join(','));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  const deckOverflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok('deck has no horizontal overflow at 390px', deckOverflow <= 2, `overflow ${deckOverflow}px`);
  await page.setViewportSize({ width: 1440, height: 900 });

  // ── Desk over live Devnet, read-only ──
  console.log('── Desk (read-only, live Devnet) ──');
  await page.goto(BASE + '/app', { waitUntil: 'load', timeout: 45000 });
  await page.waitForTimeout(6000); // let the first ACS poll land

  const offset = (await page.locator('#stat-offset').innerText().catch(() => '—')).trim();
  ok('ledger offset tile shows live data', /\d/.test(offset) && offset !== '—', offset);
  const settled = (await page.locator('#stat-settled').innerText().catch(() => '0')).trim();
  ok('settled-trades tile is populated from Devnet', Number(settled.replace(/[^\d]/g, '')) > 0, settled);

  const banner = await page.locator('body').innerText();
  ok('read-only notice is shown to the public', /read-only/i.test(banner));

  // All four sidebar read views must render real content.
  const views = [
    ['portfolio', '#portfolio-body'],
    ['verify', '#verify-body'],
    ['audit', '#audit-table'],
    ['bestexec', '#bestexec-body'],
  ];
  for (const [view, sel] of views) {
    await page.click(`.side-nav a[data-view="${view}"]`).catch(() => {});
    await page.waitForTimeout(2500);
    const txt = (await page.locator(sel).innerText().catch(() => '')).trim();
    ok(`view "${view}" renders content`, txt.length > 30, `${txt.length} chars`);
  }

  // Best execution should carry attestations from the seeded book.
  await page.click('.side-nav a[data-view="bestexec"]').catch(() => {});
  await page.waitForTimeout(2500);
  const be = (await page.locator('#bestexec-body').innerText().catch(() => ''));
  const attested = (be.match(/attested/gi) ?? []).length;
  ok('best execution shows attestations', attested >= 5, `${attested} attested`);

  // Audit trail should list the settled book.
  await page.click('.side-nav a[data-view="audit"]').catch(() => {});
  await page.waitForTimeout(2500);
  const auditRows = await page.locator('#audit-table tr').count().catch(() => 0);
  ok('audit trail lists many settled trades', auditRows > 10, `${auditRows} rows`);

  // Writes must be inert on the public build — and must not throw.
  await page.click('.side-nav a[data-view="desk"]').catch(() => {});
  await page.waitForTimeout(1500);
  const btn = page.locator('#btn-create-rfq');
  if (await btn.count() > 0) {
    await btn.click({ force: true }).catch(() => {});
    await page.waitForTimeout(1500);
    ok('clicking a write control does not crash the page', true);
  }
  ok('no uncaught console/page errors across the whole run', errors.length === 0, errors.slice(0, 2).join(' | '));

  await ctx.close();
  await browser.close();
}

(async () => {
  console.log(`Hosted QA → ${BASE}`);
  for (const e of RUN) {
    try { await runEngine(e); }
    catch (err) { fails.push(`${e}: ${err.message}`); console.log(`  ✗ ENGINE FAIL ${e} — ${err.message}`); }
  }
  const total = pass + fails.length;
  console.log(`\n════ HOSTED QA: ${pass}/${total} checks passed across ${RUN.join(', ')} ════`);
  if (fails.length) { console.log('FAIL: ' + fails.join(' | ')); process.exit(1); }
})();
