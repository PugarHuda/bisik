// Re-time the demo footage so each shot is on screen while it is being talked about.
//
// The recorder paced the visuals to a scripted reading. A real narrator never matches
// that exactly, so we warp the footage: every cue is a control point — the shot that
// belonged to cue i is stretched or compressed to span exactly the time the narrator
// actually spent on cue i (from ASR word timestamps). Between control points the map
// is linear, so motion stays smooth and nothing jumps.
//
//   node scripts/video-fit-voice.mjs <body.webm> <orig.srt> <aligned.srt> <bodyEndSec> <delayMs> <out.mp4>
import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const [, , video, origSrt, alignedSrt, bodyEndArg, delayArg, outPath] = process.argv;
if (!outPath) {
  console.error('usage: video-fit-voice.mjs <body.webm> <orig.srt> <aligned.srt> <bodyEndSec> <delayMs> <out.mp4>');
  process.exit(1);
}
const BODY_END = Number(bodyEndArg);      // where the body was trimmed, seconds
const DELAY = Number(delayArg);           // intro-card offset baked into the aligned srt

const toMs = (t) => {
  const m = t.trim().match(/(\d+):(\d+):(\d+)[,.](\d+)/);
  return ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 + +m[4];
};
const parse = async (p) => (await readFile(p, 'utf8')).split(/\r?\n\r?\n/).map((b) => {
  const lines = b.split(/\r?\n/).filter(Boolean);
  const ti = lines.findIndex((l) => l.includes('-->'));
  if (ti < 0) return null;
  const [a, z] = lines[ti].split('-->');
  return { start: toMs(a), end: toMs(z) };
}).filter(Boolean);

const orig = await parse(origSrt);
const aligned = (await parse(alignedSrt)).map((c) => ({ start: c.start - DELAY, end: c.end - DELAY }));
const n = Math.min(orig.length, aligned.length);

// Control points inside the body only.
const pts = [];
for (let i = 0; i < n; i++) {
  if (orig[i].start / 1000 >= BODY_END) break;
  pts.push({ o: orig[i].start, a: aligned[i].start });
}
// Head (before the first cue) and tail (after the last usable cue).
const segs = [];
if (pts[0].o > 0) segs.push({ o0: 0, o1: pts[0].o, a0: 0, a1: pts[0].a });
for (let i = 0; i < pts.length - 1; i++)
  segs.push({ o0: pts[i].o, o1: pts[i + 1].o, a0: pts[i].a, a1: pts[i + 1].a });
// Last shot runs to the body trim; give it the narrator's remaining time.
const lastA = aligned[pts.length - 1] ? aligned[pts.length - 1].end : pts[pts.length - 1].a;
segs.push({ o0: pts[pts.length - 1].o, o1: BODY_END * 1000, a0: pts[pts.length - 1].a, a1: Math.max(lastA, pts[pts.length - 1].a + 500) });

const parts = [], concat = [];
let warp = 0, total = 0;
segs.forEach((s, i) => {
  const od = (s.o1 - s.o0) / 1000, ad = (s.a1 - s.a0) / 1000;
  if (od <= 0.04 || ad <= 0.04) return;
  const k = ad / od;
  warp = Math.max(warp, Math.abs(1 - k));
  total += ad;
  parts.push(`[0:v]trim=start=${s.o0 / 1000}:end=${s.o1 / 1000},setpts=(PTS-STARTPTS)*${k.toFixed(6)}[v${i}]`);
  concat.push(`[v${i}]`);
});
const filter = `${parts.join(';')};${concat.join('')}concat=n=${concat.length}:v=1:a=0[vout]`;
const filterFile = outPath + '.filter.txt';
await writeFile(filterFile, filter, 'utf8');

console.log(`warping ${concat.length} shots · new body length ${total.toFixed(1)}s · max stretch ${(warp * 100).toFixed(0)}%`);

await new Promise((res, rej) => {
  const ff = spawn('ffmpeg', ['-loglevel', 'error', '-i', video,
    '-filter_complex_script', filterFile, '-map', '[vout]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-r', '30', '-an', outPath, '-y'], { stdio: ['ignore', 'inherit', 'inherit'] });
  ff.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg exit ' + c))));
});
console.log('→', outPath);
