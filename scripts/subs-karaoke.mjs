// Turn an .srt into a karaoke .ass: each word lights up as it should be spoken, so
// the narrator can match pace exactly (a teleprompter, burned into the picture).
// Word timings are distributed inside each cue proportionally to word length —
// consistent with how the recorder sized the cues in the first place.
//
//   node scripts/subs-karaoke.mjs media/bisik-demo-3min.srt media/bisik-demo-3min.ass [W] [H]
import { readFile, writeFile } from 'node:fs/promises';

const [, , inPath, outPath, wArg, hArg] = process.argv;
if (!inPath || !outPath) { console.error('usage: subs-karaoke.mjs <in.srt> <out.ass> [width] [height]'); process.exit(1); }
const W = Number(wArg ?? 1600), H = Number(hArg ?? 900);

const toMs = (t) => {
  const m = t.trim().match(/(\d+):(\d+):(\d+)[,.](\d+)/);
  return ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 + +m[4];
};
const assTime = (ms) => {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3600000), m = Math.floor((t % 3600000) / 60000);
  const s = Math.floor((t % 60000) / 1000), cs = Math.round((t % 1000) / 10);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
};
// ASS escapes: braces delimit override blocks, so they must not appear raw.
const esc = (s) => s.replace(/[{}]/g, '').replace(/\\/g, '/');

const srt = await readFile(inPath, 'utf8');
const cues = srt.split(/\r?\n\r?\n/).map((b) => {
  const lines = b.split(/\r?\n/).filter(Boolean);
  const ti = lines.findIndex((l) => l.includes('-->'));
  if (ti < 0) return null;
  const [a, z] = lines[ti].split('-->');
  return { start: toMs(a), end: toMs(z), text: lines.slice(ti + 1).join(' ').trim() };
}).filter((c) => c && c.text);

const head = `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Kar,Arial,34,&H00FFFFFF,&H007F8A96,&H00120C06,&HA0000000,1,0,0,0,100,100,0,0,1,3,1,2,90,90,44,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

const events = cues.map((c) => {
  const words = c.text.split(/\s+/).filter(Boolean);
  const totalCs = Math.max(1, Math.round((c.end - c.start) / 10));
  const weights = words.map((w) => w.replace(/[^\w']/g, '').length + 1);
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  let used = 0;
  const parts = words.map((w, i) => {
    let cs = i === words.length - 1 ? totalCs - used : Math.max(1, Math.round(totalCs * weights[i] / sum));
    used += cs;
    return `{\\kf${Math.max(1, cs)}}${esc(w)}`;
  });
  return `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Kar,,0,0,0,,${parts.join(' ')}`;
});

await writeFile(outPath, head + events.join('\n') + '\n', 'utf8');
console.log(`karaoke subtitles → ${outPath}  (${cues.length} cues, ${W}×${H})`);
