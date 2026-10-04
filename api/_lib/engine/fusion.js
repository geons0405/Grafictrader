import { clamp, mean, correlation, sigmoid, round, std } from './core.js';
import { entropyLayer } from './entropy.js';
import { fractalLayer } from './fractal.js';
import { waveletLayer } from './wavelet.js';

// Signal fusion: each layer's weight depends on the regime AND on how well that
// layer actually predicted this market out of sample (walk-forward).

export const DIRECTIONAL = ['micro', 'entropy', 'regime', 'fractal', 'wavelet', 'anomaly', 'causality'];

// Prior importance of each layer per regime (A–G).
export const REGIME_WEIGHTS = {
  A: { micro: 1.0, entropy: 0.9, regime: 1.2, fractal: 1.4, wavelet: 1.3, anomaly: 0.6, causality: 1.0 },
  B: { micro: 1.1, entropy: 1.0, regime: 1.0, fractal: 1.0, wavelet: 1.0, anomaly: 0.8, causality: 1.0 },
  C: { micro: 1.5, entropy: 1.2, regime: 1.3, fractal: 0.7, wavelet: 0.8, anomaly: 0.9, causality: 1.0 },
  D: { micro: 1.5, entropy: 1.2, regime: 1.3, fractal: 0.7, wavelet: 0.8, anomaly: 0.9, causality: 1.0 },
  E: { micro: 1.3, entropy: 1.4, regime: 0.8, fractal: 0.8, wavelet: 0.9, anomaly: 0.8, causality: 1.1 },
  F: { micro: 1.4, entropy: 0.9, regime: 1.0, fractal: 0.9, wavelet: 1.1, anomaly: 1.0, causality: 1.0 },
  G: { micro: 1.6, entropy: 0.8, regime: 0.7, fractal: 0.5, wavelet: 0.6, anomaly: 1.3, causality: 0.8 }
};

/**
 * Walk-forward validation on history: at ~40 past points each candle-based layer
 * is computed with data up to that point only, and compared with the return that
 * followed. Information coefficient (IC) and hit rate become a weight multiplier.
 */
export function walkForward(candles, { horizon = 6, window = 300, points = 40 } = {}) {
  const n = candles.length;
  const start = window + 1;
  const end = n - horizon - 1;
  if (end - start < 60) return { validated: false, layers: {} };
  const step = Math.max(1, Math.floor((end - start) / points));
  // The regime layer needs live features (volatility state, volume, CVD) that cannot be
  // rebuilt for past windows, so it is not walk-forward scored and keeps its prior weight.
  const scores = { entropy: [], fractal: [], wavelet: [] };
  const forward = [];
  for (let t = start; t <= end; t += step) {
    const slice = candles.slice(t - window, t);
    const closes = slice.map(c => c.close);
    const returns = closes.slice(1).map((c, i) => Math.log(c / closes[i]));
    scores.entropy.push(entropyLayer(returns).score);
    scores.fractal.push(fractalLayer(slice).score);
    scores.wavelet.push(waveletLayer(slice).score);
    forward.push(Math.log(candles[t - 1 + horizon].close / candles[t - 1].close));
  }
  const layers = {};
  for (const [id, s] of Object.entries(scores)) {
    const ic = std(s) > 0 ? correlation(s, forward) : 0;
    const active = s.map((v, i) => [v, forward[i]]).filter(([v]) => Math.abs(v) > 0.1);
    const hit = active.length ? active.filter(([v, r]) => Math.sign(v) === Math.sign(r)).length / active.length : null;
    layers[id] = { ic: round(ic), hitRate: hit != null ? round(hit, 2) : null, samples: s.length, multiplier: round(clamp(1 + 3 * ic, 0.3, 1.8), 2) };
  }
  return { validated: true, horizon, points: forward.length, layers };
}

/** Combines the layers into a structural bias, probability and expected move. */
export function fuse(layers, { regimeCode = 'B', validation = null, volPerBar = 0.002, price = 0, horizon = 6 } = {}) {
  const priors = REGIME_WEIGHTS[regimeCode] || REGIME_WEIGHTS.B;
  const rows = layers.filter(l => DIRECTIONAL.includes(l.id)).map(l => {
    const validated = validation?.layers?.[l.id];
    const weight = (priors[l.id] || 1) * (validated ? validated.multiplier : 1);
    return { ...l, weight: round(weight, 2), validated: validated || null };
  });
  const totalW = rows.reduce((s, r) => s + r.weight, 0) || 1;
  const bias = rows.reduce((s, r) => s + r.weight * r.score * r.confidence, 0) / totalW;
  const confident = rows.filter(r => r.confidence >= 0.3 && Math.abs(r.score) > 0.1);
  const agreement = confident.length ? confident.filter(r => Math.sign(r.score) === Math.sign(bias)).length / confident.length : 0;
  const quality = validation?.validated ? clamp(mean(Object.values(validation.layers).map(v => Math.max(v.ic, 0))) * 5, 0, 1) : 0.3;
  const confidence = clamp(Math.abs(bias) * 1.8 * (0.4 + agreement * 0.6) * (0.6 + quality * 0.4) + 0.1, 0, 0.95);
  const probabilityUp = sigmoid(bias * 4);
  const sigmaH = volPerBar * Math.sqrt(horizon);
  const drift = bias * 0.5 * sigmaH;
  return {
    structuralBias: Math.round(bias * 100),
    confidence: Math.round(confidence * 100),
    agreement: round(agreement, 2),
    probabilityUp: round(probabilityUp, 3),
    direction: bias > 0.08 ? 'LONG' : bias < -0.08 ? 'SHORT' : 'NEUTRO',
    expectedMove: price ? {
      horizonBars: horizon,
      centerPct: round(drift * 100, 3),
      rangePct: round(sigmaH * 100, 3),
      low: round(price * Math.exp(drift - sigmaH), 6),
      high: round(price * Math.exp(drift + sigmaH), 6)
    } : null,
    weights: rows.map(r => ({ id: r.id, name: r.name, score: Math.round(r.score * 100), confidence: Math.round(r.confidence * 100), weight: r.weight, validated: r.validated }))
  };
}
