import { clamp, correlation, round, sum, alignPair } from './core.js';

// Layer 6 — Wavelets: the move split into frequency bands (Haar multiresolution
// analysis), so a short-term dip inside a long-term rise is visible as such.

/** Haar DWT down to `levels`. Returns detail coefficients per level and the final approximation. */
export function haarDwt(x, levels) {
  let approx = [...x];
  const details = [];
  for (let l = 0; l < levels; l++) {
    const a = [], d = [];
    for (let i = 0; i + 1 < approx.length; i += 2) {
      a.push((approx[i] + approx[i + 1]) / Math.SQRT2);
      d.push((approx[i] - approx[i + 1]) / Math.SQRT2);
    }
    details.push(d);
    approx = a;
  }
  return { details, approx };
}

function inverse(approx, details) {
  let a = [...approx];
  for (let l = details.length - 1; l >= 0; l--) {
    const d = details[l];
    const out = [];
    for (let i = 0; i < a.length; i++) {
      out.push((a[i] + d[i]) / Math.SQRT2);
      out.push((a[i] - d[i]) / Math.SQRT2);
    }
    a = out;
  }
  return a;
}

/** Reconstruct each band separately (multiresolution analysis): D1..DL and A_L, all full length. */
export function mra(x, levels) {
  const { details, approx } = haarDwt(x, levels);
  const zeros = d => d.map(() => 0);
  const bands = details.map((_, l) => inverse(approx.map(() => 0), details.map((d, k) => (k === l ? d : zeros(d)))));
  const smooth = inverse(approx, details.map(zeros));
  return { bands, smooth };
}

const slope = (y, n = 8) => {
  const s = y.slice(-n);
  return (s[s.length - 1] - s[0]) / (n - 1);
};

/**
 * Layer score. Bands: D1–D2 ≈ 2–4 bars (noise/short), D3–D4 ≈ 8–16 bars (swing),
 * D5–D6 + approximation ≈ 32+ bars (structural).
 */
export function waveletLayer(candles, peer = null, intervalLabel = '') {
  const N = 256;
  if (candles.length < N) return { id: 'wavelet', name: 'Wavelets multiescala', score: 0, confidence: 0, metrics: {}, notes: ['Dados insuficientes.'] };
  const logP = candles.slice(-N).map(c => Math.log(c.close));
  const levels = 6;
  const { bands, smooth } = mra(logP, levels);
  const energy = bands.map(b => sum(b.map(v => v * v)));
  const total = sum(energy) || 1;
  const scale = (logP[N - 1] - logP[0]) / N || 1e-9;
  const dirOf = arr => slope(arr) / Math.abs(scale || 1e-9);
  const short = dirOf(bands[0].map((v, i) => v + bands[1][i]));
  const swing = dirOf(bands[2].map((v, i) => v + bands[3][i]));
  const structural = dirOf(smooth.map((v, i) => v + bands[4][i] + bands[5][i]));
  const t = v => Math.tanh(v / 2);
  const score = clamp(t(structural) * 0.55 + t(swing) * 0.3 + t(short) * 0.15);
  const word = v => (v > 0.15 ? 'compradora' : v < -0.15 ? 'vendedora' : 'neutra');
  let coherence = null;
  const [mine, theirs] = peer ? alignPair(candles, peer) : [[], []];
  if (theirs.length >= N) {
    const peerLog = theirs.slice(-N).map(c => Math.log(c.close));
    const pd = haarDwt(peerLog, levels).details;
    const md = haarDwt(mine.slice(-N).map(c => Math.log(c.close)), levels).details;
    coherence = md.map((d, l) => round(correlation(d, pd[l]), 2));
  }
  const notes = [
    `Curto prazo (2–4 velas): pressão ${word(t(short))}; swing (8–16): ${word(t(swing))}; estrutural (32+): ${word(t(structural))}.`,
    t(short) * t(structural) < -0.02 ? `O curto prazo contradiz a estrutura${intervalLabel ? ' do ' + intervalLabel : ''}: o componente estrutural pesa mais.` : null,
    `Energia por escala: ${energy.map((e, i) => `D${i + 1} ${Math.round((e / total) * 100)}%`).join(' · ')}.`
  ].filter(Boolean);
  return {
    id: 'wavelet', name: 'Wavelets multiescala', score: round(score),
    confidence: round(clamp(0.35 + Math.abs(t(structural)) * 0.5 - (t(short) * t(structural) < 0 ? 0.1 : 0), 0.1, 0.9)),
    metrics: { short: round(t(short)), swing: round(t(swing)), structural: round(t(structural)), energyShare: energy.map(e => round(e / total)), coherence },
    notes
  };
}
