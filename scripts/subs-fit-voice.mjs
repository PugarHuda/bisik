// Re-time an .srt onto a REAL voice take, so the subtitles follow the narrator
// instead of the narrator chasing the subtitles.
//
// Strategy: map cue boundaries across the take's speech region proportionally to
// word count, then snap each boundary to the nearest real pause (a breath), so cues
// break where the narrator actually breathed. Start and end are anchored, so there
// is no cumulative drift.
//
//   node scripts/subs-fit-voice.mjs <in.srt> <voice.(aac|m4a|wav)> <out.srt> [delayMs]
import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const [, , srtPath, audioPath, outPath, delayArg] = process.argv;
if (!srtPath || !audioPath || !outPath) {
  console.error('usage: subs-fit-voice.mjs <in.srt> <voice-file> <out.srt> [delayMs]');
  process.exit(1);
}
const DELAY = Number(delayArg ?? 0);

const toMs = (t) => {
  const m = t.trim().match(/(\d+):(\d+):(\d+)[,.](\d+)/);
  return ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 + +m[4];
};
const srtTime = (ms) => {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3600000), m = Math.floor((t % 3600000) / 60000);
  const s = Math.floor((t % 60000) / 1000), x = t % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(x).padStart(3, '0')}`;
};

// ── 1. cues (text + relative weight) ──
const cues = (await readFile(srtPath, 'utf8')).split(/\r?\n\r?\n/).map((b) => {
  const lines = b.split(/\r?\n/).filter(Boolean);
  const ti = lines.findIndex((l) => l.includes('-->'));
  if (ti < 0) return null;
  return { text: lines.slice(ti + 1).join(' ').trim() };
}).filter((c) => c && c.text);
cues.forEach((c) => { c.words = c.text.split(/\s+/).filter(Boolean).length; });

// ── 2. the take's silence map ──
const log = await new Promise((res, rej) => {
  const ff = spawn('ffmpeg', ['-i', audioPath, '-af', 'silencedetect=noise=-33dB:d=0.22', '-f', 'null', '-']);
  let buf = '';
  ff.stderr.on('data', (d) => { buf += d.toString(); });
  ff.on('close', () => res(buf));
  ff.on('error', rej);
});
const dur = Number((log.match(/Duration: (\d+):(\d+):([\d.]+)/) || []).slice(1)
  .reduce((a, v, i) => a + Number(v) * [3600, 60, 1][i], 0)) || 0;

const silences = [];
const re = /silence_start:\s*([\d.-]+)[\s\S]*?silence_end:\s*([\d.]+)/g;
let m;
while ((m = re.exec(log))) silences.push({ start: Math.max(0, +m[1]) * 1000, end: +m[2] * 1000 });

// Speech region: after any leading silence, up to the start of the trailing silence.
const lead = silences.find((s) => s.start <= 60);
const speechStart = lead ? lead.end : 0;
const tail = silences[silences.length - 1];
const speechEnd = tail && tail.end >= dur * 1000 - 400 ? tail.start : dur * 1000;

// Mid-take pauses are the candidate break points (a breath between sentences).
const pauses = silences
  .filter((s) => s.start > speechStart + 500 && s.end < speechEnd - 500)
  .map((s) => (s.start + s.end) / 2);

// ── 3. proportional boundaries, snapped to real breaths ──
const totalWords = cues.reduce((n, c) => n + c.words, 0) || 1;
const span = speechEnd - speechStart;
const bounds = [speechStart];
let acc = 0;
for (let i = 0; i < cues.length - 1; i++) {
  acc += cues[i].words;
  const ideal = speechStart + span * (acc / totalWords);
  // Snap only if a breath is genuinely close, and never cross the previous boundary.
  const window = Math.min(2600, span / cues.length * 0.85);
  let best = ideal, bestD = Infinity;
  for (const p of pauses) {
    const d = Math.abs(p - ideal);
    if (d < bestD && d <= window && p > bounds[bounds.length - 1] + 700) { best = p; bestD = d; }
  }
  bounds.push(best);
}
bounds.push(speechEnd);

const out = cues.map((c, i) =>
  `${i + 1}\n${srtTime(bounds[i] + DELAY)} --> ${srtTime(bounds[i + 1] + DELAY)}\n${c.text}\n`).join('\n');
await writeFile(outPath, out, 'utf8');

const snapped = bounds.slice(1, -1).filter((b) => pauses.some((p) => Math.abs(p - b) < 1)).length;
console.log(`fitted ${cues.length} cues to the take: speech ${(speechStart / 1000).toFixed(2)}s → ${(speechEnd / 1000).toFixed(2)}s`);
console.log(`  ${snapped}/${cues.length - 1} boundaries snapped to a real breath · delay ${DELAY}ms → ${outPath}`);
