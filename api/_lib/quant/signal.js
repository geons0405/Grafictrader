import {
  clamp, logReturns, hurstExponent, varianceRatio, kalmanTrend, permutationEntropy,
  volatilityRegime, bulkVolume, vwapDeviation, autocorrelation, atr
} from './stats.js';

const WINDOW = 256;

/**
 * Statistical snapshot of the market at the last candle of `candles`.
 * Uses at most the last WINDOW candles so live and replayed decisions see
 * the same amount of history.
 */
export function quantSnapshot(candles) {
  const rows = candles.slice(-WINDOW);
  if (rows.length < 80) return null;
  const returns = logReturns(rows);
  const hurst = hurstExponent(returns);
  const vr = varianceRatio(returns.slice(-160), 4);
  const kalman = kalmanTrend(rows.slice(-200));
  const entropy = permutationEntropy(rows.slice(-120).map(c => c.close));
  const vol = volatilityRegime(rows, 20);
  const flow = bulkVolume(rows, 20);
  const flowShort = bulkVolume(rows, 5);
  const vwap = vwapDeviation(rows, 50);
  const ac1 = autocorrelation(returns.slice(-100), 1);
  const range = atr(rows, 14);
  const last = rows.at(-1);
  // What a person sees on the chart: the recent box the price moves in and the last hour's move.
  const recent = rows.slice(-20);
  const rangeHigh = Math.max(...recent.map(c => c.high));
  const rangeLow = Math.min(...recent.map(c => c.low));
  const hourAgo = rows.at(-Math.min(rows.length, 61));
  const movePct = hourAgo ? (last.close / hourAgo.close - 1) * 100 : null;

  let regime = 'noise';
  if (hurst != null && vr.value != null) {
    if ((hurst > 0.55 && vr.value > 1) || (hurst > 0.52 && vr.value > 1.1)) regime = 'trend';
    else if ((hurst < 0.45 && vr.value < 1) || (hurst < 0.48 && vr.value < 0.9)) regime = 'reversion';
  }
  if (vol.percentile != null && vol.percentile > 0.95) regime = 'chaotic';

  return {
    time: last.time,
    price: last.close,
    regime,
    hurst,
    varianceRatio: vr.value,
    varianceRatioZ: vr.z,
    kalmanSlope: kalman.slope,
    kalmanZ: kalman.z,
    entropy,
    volatility: vol.value,
    volPercentile: vol.percentile,
    flowImbalance: flow.imbalance,
    flowImbalanceShort: flowShort.imbalance,
    vpin: flow.vpin,
    vwap: vwap.vwap,
    vwapZ: vwap.z,
    autocorr: ac1,
    atr: range,
    rangeHigh,
    rangeLow,
    movePct
  };
}

const REGIME_LABEL = {
  trend: 'Tendência persistente',
  reversion: 'Reversão à média',
  noise: 'Ruído / sem estrutura',
  chaotic: 'Volatilidade extrema'
};
export const regimeLabel = regime => REGIME_LABEL[regime] || 'Indefinido';

/**
 * Turns a snapshot (and optional live context) into a trading decision.
 * direction: 1 buy, -1 sell, 0 wait. Confidence is a 0–100 strength score
 * of the setup, not a probability of profit.
 */
export function decide(snap, context = null) {
  if (!snap) return { direction: 0, action: 'AGUARDAR', confidence: 0, setup: null, reasons: ['Histórico insuficiente.'] };
  const reasons = [];
  let direction = 0;
  let setup = null;
  let strength = 0;

  if (snap.regime === 'chaotic') {
    reasons.push('Volatilidade no percentil ' + Math.round(snap.volPercentile * 100) + ': mercado instável.');
  } else if (snap.regime === 'trend') {
    const predictable = snap.entropy == null || snap.entropy < 0.985;
    if (snap.kalmanZ > 1.2 && snap.flowImbalance > 0.05 && snap.price > snap.vwap && predictable) {
      direction = 1;
      setup = 'trend';
      strength = clamp((snap.kalmanZ - 1.2) / 2, 0, 1) * 0.5 + clamp(snap.flowImbalance / 0.4, 0, 1) * 0.3 + clamp((snap.hurst - 0.5) / 0.2, 0, 1) * 0.2;
      reasons.push('Deriva do filtro de Kalman positiva (z ' + snap.kalmanZ.toFixed(1) + ').', 'Fluxo de volume comprador (BVC ' + (snap.flowImbalance * 100).toFixed(0) + '%).', 'Hurst ' + snap.hurst.toFixed(2) + ': movimento persistente.');
    } else if (snap.kalmanZ < -1.2 && snap.flowImbalance < -0.05 && snap.price < snap.vwap && predictable) {
      direction = -1;
      setup = 'trend';
      strength = clamp((-snap.kalmanZ - 1.2) / 2, 0, 1) * 0.5 + clamp(-snap.flowImbalance / 0.4, 0, 1) * 0.3 + clamp((snap.hurst - 0.5) / 0.2, 0, 1) * 0.2;
      reasons.push('Deriva do filtro de Kalman negativa (z ' + snap.kalmanZ.toFixed(1) + ').', 'Fluxo de volume vendedor (BVC ' + (snap.flowImbalance * 100).toFixed(0) + '%).', 'Hurst ' + snap.hurst.toFixed(2) + ': movimento persistente.');
    } else {
      reasons.push('Regime de tendência, mas deriva e fluxo ainda não estão alinhados.');
    }
  } else if (snap.regime === 'reversion') {
    if (snap.vwapZ < -2 && snap.flowImbalanceShort > 0) {
      direction = 1;
      setup = 'reversion';
      strength = clamp((-snap.vwapZ - 2) / 1.5, 0, 1) * 0.6 + clamp((0.5 - snap.hurst) / 0.2, 0, 1) * 0.4;
      reasons.push('Preço ' + Math.abs(snap.vwapZ).toFixed(1) + ' desvios abaixo do VWAP.', 'Fluxo curto já a virar comprador: venda a perder força.', 'Hurst ' + snap.hurst.toFixed(2) + ': o mercado tende a reverter.');
    } else if (snap.vwapZ > 2 && snap.flowImbalanceShort < 0) {
      direction = -1;
      setup = 'reversion';
      strength = clamp((snap.vwapZ - 2) / 1.5, 0, 1) * 0.6 + clamp((0.5 - snap.hurst) / 0.2, 0, 1) * 0.4;
      reasons.push('Preço ' + snap.vwapZ.toFixed(1) + ' desvios acima do VWAP.', 'Fluxo curto já a virar vendedor: compra a perder força.', 'Hurst ' + snap.hurst.toFixed(2) + ': o mercado tende a reverter.');
    } else {
      reasons.push('Regime de reversão, mas o preço não está esticado o suficiente face ao VWAP.');
    }
  } else {
    reasons.push('Sem estrutura estatística clara (Hurst ' + (snap.hurst ?? 0).toFixed(2) + ', VR ' + (snap.varianceRatio ?? 1).toFixed(2) + ').');
  }

  if (direction !== 0 && context?.eventRisk?.blocked) {
    const e = context.eventRisk.event;
    reasons.push(`Notícia de alto impacto agora (${e?.currency || ''} ${e?.title || ''}): entrada cancelada.`);
    direction = 0;
    setup = null;
    strength = 0;
  }

  if (direction !== 0 && context && Number.isFinite(context.score)) {
    if (context.score * direction < -0.35) {
      reasons.push('Contexto ao vivo contra o sinal (fluxo/book/notícias ' + Math.round(context.score * 100) + '%): entrada cancelada.');
      direction = 0;
      setup = null;
      strength = 0;
    } else if (context.score * direction > 0.2) {
      strength = clamp(strength + 0.1, 0, 1);
      reasons.push('Contexto ao vivo a favor (' + Math.round(context.score * 100) + '%).');
    }
  }

  const confidence = direction === 0 ? 0 : Math.round(45 + strength * 50);
  return {
    direction,
    action: direction > 0 ? 'COMPRAR' : direction < 0 ? 'VENDER' : 'AGUARDAR',
    setup,
    confidence,
    reasons
  };
}
