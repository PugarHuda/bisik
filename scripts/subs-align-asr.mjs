// Align the known narration script to a REAL take using ASR word timestamps.
// The transcript is lossy ("bonds" → "bones", "Bisik" → "Basic"), so we don't trust
// its text — we only trust its clock. Each cue's opening words are matched against
// the transcript with a fuzzy score, searching forward from the previous anchor, and
// the matched word's timestamp becomes that cue's start.
//
//   node scripts/subs-align-asr.mjs <script.srt> <transcript.json> <out.srt> [delayMs]
import { readFile, writeFile } from 'node:fs/promises';

const [, , srtPath, asrPath, outPath, delayArg] = process.argv;
if (!srtPath || !asrPath || !outPath) {
  console.error('usage: subs-align-asr.mjs <script.srt> <transcript.json> <out.srt> [delayMs]');
  process.exit(1);
}
const DELAY = Number(delayArg ?? 0);

const srtTime = (ms) => {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3600000), m = Math.floor((t % 3600000) / 60000);
  const s = Math.floor((t % 60000) / 1000), x = t % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(x).padStart(3, '0')}`;
};
const norm = (w) => w.toLowerCase().replace(/[^a-z0-9]/g, '');

// Similarity 0..1 — normalised edit distance, so an ASR slip still scores high.
function sim(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return 1 - dp[m][n] / Math.max(m, n);
}

const cues = (await readFile(srtPath, 'utf8')).split(/\r?\n\r?\n/).map((b) => {
  const lines = b.split(/\r?\n/).filter(Boolean);
  const ti = lines.findIndex((l) => l.includes('-->'));
  return ti < 0 ? null : { text: lines.slice(ti + 1).join(' ').trim() };
}).filter((c) => c && c.text);

const asr = JSON.parse(await readFile(asrPath, 'utf8'));
const words = asr.flatMap((s) => s.words.map((w) => ({ w: norm(w.w), s: w.s * 1000, e: w.e * 1000 })))
  .filter((w) => w.w);
const speechStart = words.length ? words[0].s : 0;
const speechEnd = words.length ? words[words.length - 1].e : 0;

// Anchor each cue to where its opening phrase is actually spoken.
const totalWords = cues.reduce((n, c) => n + c.text.split(/\s+/).length, 0);
let cursor = 0, seen = 0;
const anchors = [];
cues.forEach((c, i) => {
  const head = c.text.split(/\s+/).map(norm).filter(Boolean).slice(0, 4);
  if (i === 0) { anchors.push({ t: speechStart, score: 1 }); seen += c.text.split(/\s+/).length; return; }
  // Expected position if the take were perfectly even — the centre of the search.
  const guess = speechStart + (speechEnd - speechStart) * (seen / totalWords);
  let best = null;
  for (let j = cursor; j < words.length; j++) {
    if (words[j].s < guess - 22000) continue;
    if (words[j].s > guess + 22000) break;
    let sc = 0;
    for (let k = 0; k < head.length && j + k < words.length; k++) sc += sim(head[k], words[j + k].w);
    sc /= head.length;
    if (!best || sc > best.score) best = { t: words[j].s, score: sc, idx: j };
  }
  if (best && best.score >= 0.62) { anchors.push(best); cursor = best.idx + 1; }
  else anchors.push({ t: guess, score: best ? best.score : 0, weak: true });
  seen += c.text.split(/\s+/).length;
});

// Enforce monotonic, non-degenerate boundaries.
for (let i = 1; i < anchors.length; i++)
  if (anchors[i].t <= anchors[i - 1].t + 400) anchors[i].t = anchors[i - 1].t + 400;

const out = cues.map((c, i) => {
  const start = anchors[i].t;
  const end = i + 1 < anchors.length ? anchors[i + 1].t : speechEnd;
  return `${i + 1}\n${srtTime(start + DELAY)} --> ${srtTime(end + DELAY)}\n${c.text}\n`;
}).join('\n');
await writeFile(outPath, out, 'utf8');

const strong = anchors.filter((a) => !a.weak).length;
console.log(`aligned ${cues.length} cues to the take (speech ${(speechStart / 1000).toFixed(2)}s → ${(speechEnd / 1000).toFixed(2)}s)`);
console.log(`  ${strong}/${cues.length} anchored on a matched spoken phrase, ${cues.length - strong} estimated`);
console.log(`  delay ${DELAY}ms → ${outPath}`);
// Emit the anchor table so the video can be re-timed to the same boundaries.
await writeFile(outPath.replace(/\.srt$/, '.anchors.json'),
  JSON.stringify(anchors.map((a, i) => ({ cue: i + 1, tMs: Math.round(a.t), score: +(a.score ?? 0).toFixed(2), weak: !!a.weak })), null, 1));
