import React from 'react';
import { AbsoluteFill, Sequence, useCurrentFrame, interpolate, spring, useVideoConfig } from 'remotion';

export const FPS = 30;
export const TOTAL_FRAMES = 1170; // 39s

// ---- Bisik palette ----
const BG = '#0b0d10';
const PANEL = '#14181d';
const LINE = '#262d36';
const INK = '#e7ecf2';
const MUTED = '#8b97a6';
const ACCENT = '#6ee7b7';
const BUYER = '#7dd3fc';
const A_COL = '#c4b5fd';
const B_COL = '#fca5a5';
const SANS = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';

// fade a value in over [start, start+dur]
const fade = (frame: number, start: number, dur = 15) =>
  interpolate(frame, [start, start + dur], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

const rise = (frame: number, fps: number, delay: number) =>
  spring({ frame: frame - delay, fps, config: { damping: 200 } });

const centered: React.CSSProperties = {
  justifyContent: 'center', alignItems: 'center', textAlign: 'center', padding: '0 8%',
};

// ---------- Scene 1 · Intro ----------
const Intro: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = rise(f, fps, 4);
  return (
    <AbsoluteFill style={centered}>
      <div style={{ opacity: fade(f, 4), transform: `translateY(${(1 - s) * 24}px)` }}>
        <div style={{ fontSize: 150, fontWeight: 800, color: INK, letterSpacing: '-0.03em' }}>
          bisik<span style={{ color: ACCENT }}>.</span>
        </div>
        <div style={{ fontSize: 46, color: MUTED, fontStyle: 'italic', marginTop: 18, opacity: fade(f, 22) }}>
          You whisper quotes. The market hears nothing.
        </div>
        <div style={{ fontSize: 28, color: ACCENT, marginTop: 40, letterSpacing: '0.14em', textTransform: 'uppercase', opacity: fade(f, 40) }}>
          A confidential RFQ desk · native on Canton
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ---------- Scene 2 · Problem ----------
const Problem: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={centered}>
      <div style={{ fontSize: 34, color: ACCENT, letterSpacing: '0.18em', textTransform: 'uppercase', opacity: fade(f, 2) }}>The problem</div>
      <div style={{ fontSize: 66, color: INK, fontWeight: 700, marginTop: 24, maxWidth: 1400, lineHeight: 1.15, opacity: fade(f, 12) }}>
        You can’t trade size in the open.
      </div>
      <div style={{ fontSize: 40, color: MUTED, marginTop: 34, maxWidth: 1300, lineHeight: 1.4, opacity: fade(f, 34) }}>
        Post a $4M block on a public venue and the order — and the competing bids — leak.
        Front-running, market impact, leaked alpha the moment it hits the mempool.
      </div>
    </AbsoluteFill>
  );
};

// ---------- Scene 3 · The money shot (3 columns) ----------
const Col: React.FC<{ title: string; color: string; children?: React.ReactNode; opacity: number }> = ({ title, color, children, opacity }) => (
  <div style={{
    flex: 1, background: PANEL, border: `1px solid ${LINE}`, borderTop: `4px solid ${color}`,
    borderRadius: 14, padding: 30, minHeight: 480, opacity,
  }}>
    <div style={{ fontSize: 34, fontWeight: 700, color: INK, marginBottom: 24 }}>{title}</div>
    {children}
  </div>
);

const QuoteCard: React.FC<{ dealer: string; price: string; s: number }> = ({ dealer, price, s }) => (
  <div style={{
    background: '#1b2027', border: `1px solid ${LINE}`, borderRadius: 10, padding: '18px 20px',
    opacity: s, transform: `translateX(${(1 - s) * -30}px)`,
  }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <span style={{ fontSize: 26, color: MUTED }}>{dealer}</span>
      <span style={{ fontSize: 34, fontWeight: 800, color: INK, fontFamily: MONO }}>{price}</span>
    </div>
    <div style={{ fontSize: 22, color: MUTED, marginTop: 8 }}>TBOND30 · 1,000 · sealed</div>
  </div>
);

const MoneyShot: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const aQuote = rise(f, fps, 70);          // Dealer A's quote slides in
  const blankPulse = 0.5 + 0.5 * Math.sin((f - 120) / 8); // Dealer B "nothing" gentle pulse
  return (
    <AbsoluteFill style={{ padding: '90px 7% 70px', justifyContent: 'flex-start' }}>
      <div style={{ fontSize: 32, color: ACCENT, letterSpacing: '0.16em', textTransform: 'uppercase', opacity: fade(f, 2) }}>One ledger · three lenses</div>
      <div style={{ display: 'flex', gap: 26, marginTop: 34 }}>
        <Col title="Buyer" color={BUYER} opacity={fade(f, 10)}>
          <div style={{ fontSize: 26, color: MUTED, lineHeight: 1.5 }}>Requests quotes from a chosen dealer panel.<br />No price on the RFQ — the market never sees it.</div>
        </Col>
        <Col title="Dealer A" color={A_COL} opacity={fade(f, 20)}>
          {f > 60 && <QuoteCard dealer="whispers" price="4,210,000" s={aQuote} />}
        </Col>
        <Col title="Dealer B" color={B_COL} opacity={fade(f, 30)}>
          <div style={{
            border: `1px dashed ${LINE}`, borderRadius: 10, padding: 28, textAlign: 'center',
            color: MUTED, fontStyle: 'italic', fontSize: 25, opacity: f > 90 ? 0.55 + 0.45 * blankPulse : 0.4,
          }}>
            nothing.<br />Dealer A’s quote was never sent to this node.
          </div>
        </Col>
      </div>
      <div style={{ fontSize: 40, color: INK, marginTop: 44, opacity: fade(f, 150), maxWidth: 1500, lineHeight: 1.35 }}>
        The rival’s quote isn’t hidden in the UI — <span style={{ color: ACCENT }}>it is never transmitted.</span> That’s Canton sub-transaction privacy.
      </div>
    </AbsoluteFill>
  );
};

// ---------- Scene 4 · Settlement ----------
const Settlement: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={centered}>
      <div style={{ fontSize: 32, color: ACCENT, letterSpacing: '0.18em', textTransform: 'uppercase', opacity: fade(f, 2) }}>Fair settlement</div>
      <div style={{ fontSize: 62, color: INK, fontWeight: 700, marginTop: 22, opacity: fade(f, 12) }}>
        Cheapest ask wins — paid the <span style={{ color: ACCENT }}>second price.</span>
      </div>
      <div style={{ fontSize: 38, color: MUTED, marginTop: 30, maxWidth: 1300, lineHeight: 1.4, opacity: fade(f, 34) }}>
        A reverse-Vickrey auction: dealers quote honestly, no shading. One atomic transaction settles it —
        cash to the dealer, the bond to the buyer. Both legs, or neither.
      </div>
      <div style={{ fontSize: 30, color: MUTED, marginTop: 34, opacity: fade(f, 60) }}>
        …or hit one dealer directly, or fill part of the lot. Same sealed rails.
      </div>
    </AbsoluteFill>
  );
};

// ---------- Scene 5 · Why Canton ----------
const Row: React.FC<{ name: string; chain: string; tech: string; you?: boolean; opacity: number }> = ({ name, chain, tech, you, opacity }) => (
  <div style={{
    display: 'flex', gap: 18, padding: '16px 24px', borderRadius: 10, opacity,
    background: you ? 'rgba(110,231,183,0.08)' : 'transparent', border: `1px solid ${you ? '#2b5a48' : LINE}`,
  }}>
    <div style={{ width: 260, fontSize: 30, fontWeight: 700, color: you ? ACCENT : INK }}>{name}</div>
    <div style={{ width: 260, fontSize: 28, color: MUTED }}>{chain}</div>
    <div style={{ flex: 1, fontSize: 28, color: you ? ACCENT : MUTED }}>{tech}</div>
  </div>
);

const WhyCanton: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ padding: '80px 8%', justifyContent: 'center' }}>
      <div style={{ fontSize: 32, color: ACCENT, letterSpacing: '0.16em', textTransform: 'uppercase', opacity: fade(f, 2) }}>Why Canton</div>
      <div style={{ fontSize: 58, color: INK, fontWeight: 700, margin: '18px 0 34px', opacity: fade(f, 10) }}>
        I built this exact desk four times before.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Row name="Diam" chain="iExec (TEE)" tech="trusted hardware enclaves" opacity={fade(f, 24)} />
        <Row name="Segel" chain="Stellar" tech="two Groth16 ZK circuits" opacity={fade(f, 34)} />
        <Row name="Sealed Pair" chain="Sui" tech="Walrus + Seal encryption" opacity={fade(f, 44)} />
        <Row name="Samar" chain="Ethereum" tech="fully-homomorphic encryption" opacity={fade(f, 54)} />
        <Row name="Bisik" chain="Canton" tech="none — it is the ledger’s data model" you opacity={fade(f, 70)} />
      </div>
      <div style={{ fontSize: 34, color: MUTED, marginTop: 34, opacity: fade(f, 96), lineHeight: 1.4 }}>
        “Dealer B can’t see Dealer A’s quote” is one line — <span style={{ color: INK }}>signatory / observer.</span>
      </div>
    </AbsoluteFill>
  );
};

// ---------- Scene 6 · Close ----------
const Close: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = rise(f, fps, 4);
  return (
    <AbsoluteFill style={centered}>
      <div style={{ opacity: fade(f, 4), transform: `translateY(${(1 - s) * 20}px)` }}>
        <div style={{ fontSize: 120, fontWeight: 800, color: INK, letterSpacing: '-0.03em' }}>bisik<span style={{ color: ACCENT }}>.</span></div>
        <div style={{ fontSize: 42, color: MUTED, marginTop: 14, fontStyle: 'italic', maxWidth: 1300 }}>
          The confidential OTC desk that finally didn’t need a cryptography stack — because Canton already is one.
        </div>
        <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 46, opacity: fade(f, 40) }}>
          {['live on Canton Devnet', 'bisik-eight.vercel.app', 'github.com/PugarHuda/bisik'].map((t) => (
            <span key={t} style={{ border: `1px solid ${LINE}`, borderRadius: 999, padding: '12px 26px', color: MUTED, fontSize: 28 }}>{t}</span>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const BisikPitch: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: BG, fontFamily: SANS }}>
    <Sequence durationInFrames={120}><Intro /></Sequence>
    <Sequence from={120} durationInFrames={150}><Problem /></Sequence>
    <Sequence from={270} durationInFrames={300}><MoneyShot /></Sequence>
    <Sequence from={570} durationInFrames={180}><Settlement /></Sequence>
    <Sequence from={750} durationInFrames={240}><WhyCanton /></Sequence>
    <Sequence from={990} durationInFrames={180}><Close /></Sequence>
  </AbsoluteFill>
);
