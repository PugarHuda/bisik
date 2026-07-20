// Record the full Bisik live-demo video: landing page → the desk (every feature,
// driven for real) → the pitch deck. Silent by design — you lay YOUR OWN voice over
// it (Encode requires a real human voice). Subtitles are generated from the actual
// measured timeline, so they line up with the finished video exactly.
//
//   npm run demo            # terminal 1: sandbox + seed + desk on :8080
//   npm run record:demo     # terminal 2: this
//
// Outputs (media/):
//   bisik-live-demo.webm    the video (1600×900, visible cursor, smooth motion)
//   bisik-live-demo.srt     subtitles, burn in or load alongside
//   bisik-live-demo.vtt     same, WebVTT
//   DEMO-LIVE-SCRIPT.md     the narration with real timecodes to read against
//
// Env: SPEED=1.2 stretch every hold (default 1) · WPM=150 assumed reading pace
//      DECK_URL to point the deck chapter somewhere else.
import { chromium } from 'playwright';
import { mkdir, writeFile, readdir, rename, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const MEDIA = join(ROOT, 'media');
const BASE = process.env.BISIK_URL ?? 'http://localhost:8080';
const DECK_URL = process.env.DECK_URL ?? 'https://bisik-eight.vercel.app/deck';
const SPEED = Number(process.env.SPEED ?? 1);
const WPM = Number(process.env.WPM ?? 150);
const W = 1600, H = 900;

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
const hold = (ms) => sleep(ms * SPEED);

// ── A visible, smoothly-animated cursor. Playwright's real mouse is invisible in
// the recording, so we draw one and move it in lockstep with the real pointer. ──
const CURSOR_JS = `
(() => {
  if (window.__cur) return;
  let el = null, x = ${Math.round(W / 2)}, y = ${Math.round(H * 0.62)};
  function ensure() {
    if (el && document.documentElement.contains(el)) return;
    el = document.createElement('div');
    el.setAttribute('data-demo-cursor', '');
    el.innerHTML =
      '<svg width="28" height="28" viewBox="0 0 26 26" aria-hidden="true">' +
      '<path d="M4 2 L4 20.5 L9.2 15.6 L12.6 23.2 L16.4 21.5 L13 14.2 L19.6 13.8 Z"' +
      ' fill="#ffffff" stroke="#06120d" stroke-width="1.7" stroke-linejoin="round"/></svg>';
    Object.assign(el.style, {
      position: 'fixed', left: '0px', top: '0px', zIndex: '2147483647',
      pointerEvents: 'none', willChange: 'transform',
      filter: 'drop-shadow(0 3px 6px rgba(0,0,0,.65))',
      transform: 'translate(' + x + 'px,' + y + 'px)'
    });
    (document.body || document.documentElement).appendChild(el);
  }
  const ease = (t) => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  window.__cur = {
    ensure,
    pos: () => ({ x, y }),
    move(tx, ty, ms) {
      ensure();
      const sx = x, sy = y, t0 = performance.now();
      return new Promise((done) => {
        (function step(now) {
          const k = ms <= 0 ? 1 : Math.min(1, (now - t0) / ms), e = ease(k);
          x = sx + (tx - sx) * e; y = sy + (ty - sy) * e;
          el.style.transform = 'translate(' + x + 'px,' + y + 'px)';
          k < 1 ? requestAnimationFrame(step) : done();
        })(t0);
      });
    },
    ping() {
      ensure();
      const r = document.createElement('div');
      Object.assign(r.style, {
        position: 'fixed', left: (x - 6) + 'px', top: (y - 6) + 'px', width: '12px', height: '12px',
        border: '2px solid #6ee7b7', borderRadius: '50%', zIndex: '2147483646', pointerEvents: 'none',
        transition: 'transform .5s ease-out, opacity .5s ease-out', opacity: '1'
      });
      (document.body || document.documentElement).appendChild(r);
      requestAnimationFrame(() => { r.style.transform = 'scale(4.5)'; r.style.opacity = '0'; });
      setTimeout(() => r.remove(), 600);
    },
    // Deterministic smooth scroll (native 'smooth' has no fixed duration).
    scroll(top, ms) {
      const sy = window.scrollY, t0 = performance.now();
      return new Promise((done) => {
        (function step(now) {
          const k = ms <= 0 ? 1 : Math.min(1, (now - t0) / ms);
          window.scrollTo(0, sy + (top - sy) * ease(k));
          k < 1 ? requestAnimationFrame(step) : done();
        })(t0);
      });
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensure);
  else ensure();
})();`;

// ── Timeline: every segment records when it actually started and ended, so the
// subtitles are generated from measured reality, not from guesses. ──
const timeline = [];
let T0 = 0;
const now = () => Date.now() - T0;
const words = (s) => s.trim().split(/\s+/).filter(Boolean).length;
const readMs = (lines) => (lines.reduce((n, l) => n + words(l), 0) / WPM) * 60000;

async function segment(chapter, lines, fn) {
  const start = now();
  const need = readMs(lines) * SPEED + 400; // give the narrator breathing room
  await fn();
  const spent = now() - start;
  if (spent < need) await sleep(need - spent);
  timeline.push({ chapter, lines, start, end: now() });
  console.log(`  ${fmt(start)} → ${fmt(now())}  ${chapter}`);
}
const fmt = (ms) => {
  const t = Math.max(0, ms);
  const m = Math.floor(t / 60000), s = Math.floor((t % 60000) / 1000);
  return `${m}:${String(s).padStart(2, '0')}`;
};
const srtTime = (ms) => {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3600000), m = Math.floor((t % 3600000) / 60000);
  const s = Math.floor((t % 60000) / 1000), x = t % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(x).padStart(3, '0')}`;
};

(async () => {
  await mkdir(MEDIA, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    recordVideo: { dir: MEDIA, size: { width: W, height: H } },
  });
  const videoT0 = Date.now(); // recording effectively starts with the context
  await ctx.addInitScript(CURSOR_JS);
  const page = await ctx.newPage();

  // ── cursor-aware primitives ────────────────────────────────────────────────
  const ensureCursor = () => page.evaluate(CURSOR_JS).catch(() => {});
  async function point(sel, { ms = 900, pad = 0 } = {}) {
    const el = page.locator(sel).first();
    // Never let a missing element abort a long recording — just skip the gesture.
    if (!(await el.count().catch(() => 0))) return null;
    await el.scrollIntoViewIfNeeded().catch(() => {});
    const b = await el.boundingBox().catch(() => null);
    if (!b) return null;
    const x = b.x + b.width / 2, y = b.y + b.height / 2 + pad;
    await ensureCursor();
    await page.evaluate(([tx, ty, d]) => window.__cur.move(tx, ty, d), [x, y, ms]);
    await page.mouse.move(x, y);
    return { x, y };
  }
  async function clickAt(sel, { ms = 900, settle = 500 } = {}) {
    const p = await point(sel, { ms });
    await page.evaluate(() => window.__cur.ping());
    await hold(220);
    await page.locator(sel).first().click({ timeout: 15000 });
    await hold(settle);
    return p;
  }
  async function typeInto(sel, text, { ms = 700, delay = 65 } = {}) {
    await point(sel, { ms });
    await page.evaluate(() => window.__cur.ping());
    const f = page.locator(sel).first();
    await f.click();
    await f.fill('');
    await f.type(String(text), { delay });
    await hold(250);
  }
  const smoothScroll = async (top, ms = 1400) => {
    await ensureCursor();
    await page.evaluate(([t, d]) => window.__cur.scroll(t, d), [top, ms]);
    await hold(ms * 0.15);
  };
  const scrollToSel = async (sel, ms = 1400, offset = 120) => {
    const y = await page.evaluate((s) => {
      const e = document.querySelector(s);
      return e ? e.getBoundingClientRect().top + window.scrollY : null;
    }, sel);
    if (y !== null) await smoothScroll(Math.max(0, y - offset), ms);
  };
  const view = async (name, ms = 900) => {
    await clickAt(`.side-nav a[data-view="${name}"]`, { ms, settle: 1400 });
  };

  // Deck slides are selected on load from location.hash — a hash-only goto would be
  // a same-document navigation and would NOT move the slide. Force a real load.
  let deckNav = 0;
  const deckGo = async (n) => {
    await page.goto(`${DECK_URL}?r=${++deckNav}#${n}`, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction((k) => {
      const on = document.querySelector('.slide.on');
      return on && Array.prototype.indexOf.call(document.querySelectorAll('.slide'), on) === k - 1;
    }, n, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(900);
  };

  console.log('\nrecording — chapters:\n');
  await page.goto(BASE + '/', { waitUntil: 'load', timeout: 60000 });
  await hold(1200);
  T0 = Date.now();
  const LEAD = T0 - videoT0; // video timestamps = timeline timestamps + LEAD

  // ══════════════ CHAPTER 1 · The problem, on the landing page ══════════════
  await segment('Landing · the hook', [
    'When an institution wants to move a large block of bonds, it cannot simply post it.',
    'The moment the order and the competing bids become visible, the market front-runs it.',
  ], async () => { await hold(2600); });

  await segment('Landing · what Bisik is', [
    'Bisik is a confidential over-the-counter desk built natively on Canton.',
    'You whisper quotes, and the market hears nothing.',
  ], async () => {
    await point('h1', { ms: 1100 });
    await hold(1400);
  });

  await segment('Landing · how it works', [
    'A buyer asks a chosen panel of dealers for a price. Each dealer answers with a sealed quote.',
    'The cheapest ask wins, but it is paid the second-cheapest price, so dealers can quote honestly.',
  ], async () => {
    await scrollToSel('#how', 1700);
    await hold(1500);
  });

  await segment('Landing · the model', [
    'The entire privacy layer is the data model itself. There are no circuits and no encryption stack.',
    'A quote is signed by the dealer and the buyer, and by nobody else.',
  ], async () => {
    await scrollToSel('#model', 1700);
    await hold(1800);
  });

  await segment('Landing · the lineage', [
    'We have built this same product four times before, on four different chains.',
    'Every time, most of the work was cryptography fighting the ledger. On Canton, that machinery disappears.',
  ], async () => {
    await scrollToSel('#lineage', 1700);
    await hold(2200);
  });

  await segment('Landing · into the desk', [
    'Let me show you the desk itself, running against a live Canton ledger.',
  ], async () => {
    await smoothScroll(0, 1200);
    await clickAt('a[href="app.html"]', { ms: 1000, settle: 900 });
    await page.waitForLoadState('load');
    await page.waitForTimeout(2500);
  });

  // ══════════════ CHAPTER 2 · The desk ══════════════
  await segment('Desk · three views of one ledger', [
    'These three columns are not three apps. They are one ledger, seen by three different parties:',
    'the buyer, and two competing dealers. Each column shows only what that party\'s own node actually received.',
  ], async () => {
    await point('section.panel[data-role="buyer"] .phead', { ms: 900 });
    await hold(900);
    await point('section.panel[data-role="dealerA"] .phead', { ms: 800 });
    await hold(800);
    await point('section.panel[data-role="dealerB"] .phead', { ms: 800 });
    await hold(900);
  });

  await segment('Desk · the request for quote', [
    'The buyer opens a request for quote: a thirty-year treasury, one thousand units, paid in tokenised dollars.',
    'The market never sees this. Only the invited dealers do.',
  ], async () => {
    await typeInto('#rfq-instrument', 'TBOND30');
    await typeInto('#rfq-qty', '1000');
    await clickAt('#btn-create-rfq', { ms: 800, settle: 2200 });
  });

  await segment('Desk · dealer A whispers a price', [
    'Dealer A now sees the request, and answers with a sealed quote — four million, two hundred and ten thousand.',
    'Watch what happens on the right.',
  ], async () => {
    await page.waitForSelector('button[data-quote="dealerA"]', { timeout: 20000 });
    await typeInto('input[id^="ask-dealerA-"]', '4210000');
    await clickAt('button[data-quote="dealerA"]', { ms: 700, settle: 2400 });
  });

  // ── THE MONEY SHOT ──
  await segment('Desk · THE MONEY SHOT', [
    'Dealer B\'s column is empty. Not a masked row. Not a hidden-bid placeholder. Nothing at all.',
    'Dealer A\'s quote was never transmitted to Dealer B\'s node. That is not the interface hiding it — it is the ledger never sending it.',
  ], async () => {
    await point('section.panel[data-role="dealerA"] .pbody', { ms: 900 });
    await hold(1200);
    await point('section.panel[data-role="dealerB"] .pbody', { ms: 1100 });
    await page.evaluate(() => window.__cur.ping());
    await hold(3200);
  });

  await segment('Desk · dealer B competes, blind', [
    'Dealer B quotes too — four million, two hundred and fifty thousand — completely blind to its rival.',
    'The buyer now holds both sealed quotes. Neither dealer can see the other.',
  ], async () => {
    await typeInto('input[id^="ask-dealerB-"]', '4250000');
    await clickAt('button[data-quote="dealerB"]', { ms: 700, settle: 2400 });
    await point('#buyer-quotes', { ms: 900 });
    await hold(1400);
  });

  await segment('Desk · selective disclosure', [
    'Either side can reveal one sealed quote to a regulator on demand — without ever showing it to a rival, or to the public.',
    'That is what makes the next part possible.',
  ], async () => {
    const d = page.locator('button[data-disclose]').first();
    if (await d.count()) await clickAt('button[data-disclose]', { ms: 900, settle: 1800 });
    else await hold(1500);
  });

  await segment('Desk · the Vickrey award', [
    'Now the buyer awards. The cheapest dealer wins — but is paid the second price, four million two hundred and fifty thousand.',
    'Cash and bond move in a single atomic transaction: both legs, or neither.',
  ], async () => {
    await page.waitForSelector('#btn-award:not([disabled])', { timeout: 20000 });
    await clickAt('#btn-award', { ms: 900, settle: 3000 });
    await point('#stat-settled', { ms: 900 });
    await page.evaluate(() => window.__cur.ping());
    await hold(1600);
  });

  // ══════════════ CHAPTER 3 · The read views ══════════════
  await segment('Verify privacy', [
    'You do not have to take the privacy on trust. This view queries what each party\'s node actually holds.',
    'Each dealer sees only its own quote. The regulator sees nothing at all before the trade settles.',
  ], async () => {
    await view('verify');
    await hold(1600);
    await scrollToSel('#verify-body', 1300);
    await hold(1800);
  });

  await segment('Verify privacy · the contrast', [
    'And here is what a transparent chain would have leaked at that exact moment — every live quote, every open order.',
    'On Canton, the number is zero.',
  ], async () => {
    await smoothScroll(9999, 1600);
    await hold(2400);
  });

  await segment('Best execution', [
    'This is the part institutions actually need. A public exchange proves best execution against a visible order book.',
    'Bisik has no order book — and still proves it. From the sealed asks disclosed to the regulator, every settled trade is checked: the winner quoted the lowest price, and the buyer paid no worse than any competitor.',
  ], async () => {
    await smoothScroll(0, 900);
    await view('bestexec');
    await hold(1800);
    await scrollToSel('#bestexec-body', 1300);
    await hold(2600);
  });

  await segment('Audit trail', [
    'The regulator\'s record shows executed trades, and only executed trades. Confidential before the trade, auditable after it.',
  ], async () => {
    await smoothScroll(0, 900);
    await view('audit');
    await hold(1600);
    await smoothScroll(600, 1500);
    await hold(1500);
  });

  await segment('Portfolio', [
    'And each party sees its own positions — the buyer now holds the bond, the winning dealer holds the cash.',
  ], async () => {
    await smoothScroll(0, 900);
    await view('portfolio');
    await hold(2200);
  });

  // ══════════════ CHAPTER 4 · The deck ══════════════
  await segment('Deck · why Canton', [
    'To close, the argument in one slide.',
  ], async () => {
    await deckGo(3);
    await page.waitForTimeout(1200);
  });

  await segment('Deck · the lineage table', [
    'Four previous builds, four cryptography stacks: trusted hardware, zero-knowledge circuits, threshold encryption, fully homomorphic encryption.',
    'On Canton: none of it. Sub-transaction privacy is simply the ledger model.',
  ], async () => {
    await point('table', { ms: 1200 });
    await hold(3200);
  });

  await segment('Deck · agentic settlement', [
    'The same desk runs autonomously: two market-maker agents quote blind to each other, a buyer agent awards, and a real trade settles on Devnet at the second price — with no human in the pricing loop.',
  ], async () => {
    await deckGo(8);
    await point('.slide.on .flow', { ms: 1100 });
    await hold(3000);
  });

  await segment('Deck · live on Devnet', [
    'None of this is a mock-up. Forty-one settled trades, five atomic baskets and sixteen best-execution attestations are live on Canton Devnet right now.',
  ], async () => {
    await deckGo(10);
    await point('.slide.on .grid3', { ms: 1100 });
    await hold(3000);
  });

  await segment('Close', [
    'Bisik: the confidential OTC desk that finally did not need a cryptography stack — because Canton already is one.',
    'You whisper quotes. The market hears nothing.',
  ], async () => {
    await deckGo(13);
    await hold(3200);
  });

  // ── finish + write artefacts ───────────────────────────────────────────────
  await hold(900);
  const videoPath = await page.video().path();
  await ctx.close();
  await browser.close();

  const out = join(MEDIA, 'bisik-live-demo.webm');
  await unlink(out).catch(() => {});
  await rename(videoPath, out).catch(async () => {
    const files = await readdir(MEDIA);
    const w = files.filter((f) => f.endsWith('.webm') && f !== 'bisik-live-demo.webm');
    if (w[0]) await rename(join(MEDIA, w[0]), out);
  });

  // Subtitles: split each segment's lines proportionally to their word count so
  // cues stay short and readable, using the measured start/end of that segment.
  const cues = [];
  for (const seg of timeline) {
    const total = seg.lines.reduce((n, l) => n + words(l), 0) || 1;
    let t = seg.start;
    seg.lines.forEach((line) => {
      const share = (seg.end - seg.start) * (words(line) / total);
      cues.push({ start: t + LEAD, end: t + share + LEAD, text: line });
      t += share;
    });
  }
  const srt = cues.map((c, i) =>
    `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join('\n');
  await writeFile(join(MEDIA, 'bisik-live-demo.srt'), srt, 'utf8');
  await writeFile(join(MEDIA, 'bisik-live-demo.vtt'),
    'WEBVTT\n\n' + srt.replace(/,(\d{3})/g, '.$1').replace(/^\d+\n/gm, ''), 'utf8');

  const dur = timeline.length ? timeline[timeline.length - 1].end : 0;
  const md = [
    '# Bisik — live demo narration (read this in your own voice)',
    '',
    `Recorded video: \`media/bisik-live-demo.webm\` · subtitles: \`media/bisik-live-demo.srt\``,
    `Total runtime: **${fmt(dur + LEAD)}**. Pace assumed: ${WPM} words/min.`,`Timecodes below are video-relative (they already include the ${LEAD}ms lead-in).`,
    '',
    'Encode requires a **real human voice** — record yourself reading the lines below,',
    'timed against the video. The timecodes are measured from the actual recording, so',
    'if you keep pace the words land on the right frames.',
    '',
    '---',
    '',
    ...timeline.flatMap((s) => [
      `### ${fmt(s.start + LEAD)} – ${fmt(s.end + LEAD)} · ${s.chapter}`,
      '',
      ...s.lines.map((l) => `> ${l}`),
      '',
    ]),
  ].join('\n');
  await writeFile(join(ROOT, 'DEMO-LIVE-SCRIPT.md'), md, 'utf8');

  console.log(`\n✓ video      media/bisik-live-demo.webm   (${fmt(dur)})`);
  console.log('✓ subtitles  media/bisik-live-demo.srt / .vtt');
  console.log('✓ narration  DEMO-LIVE-SCRIPT.md (timecoded)');
})().catch((e) => { console.error('record-demo failed:', e.message); process.exit(1); });
