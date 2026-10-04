import { clamp, sigmoid, round, sum } from './core.js';

// Early Warning Engine: structural change before the breakout is obvious, and
// the "why" behind the last move (intent).

/**
 * @param f features: compression readiness, entropy trend, Hurst change, OFI trend,
 *   CVD slope, book imbalance (±1%), volume trend, change point, expansion, wavelet structural.
 */
export function earlyWarning(f) {
  const conditions = [
    ['Volatilidade comprimida', f.readiness || 0, 1.2],
    ['Entropia a descer', clamp(-(f.entropyTrend || 0) * 20, 0, 1), 0.9],
    ['Hurst a subir', clamp((f.hurstChange || 0) * 10, 0, 1), 0.7],
    ['Fluxo agressor a crescer', clamp(Math.abs(f.ofiTrend || 0) * 2, 0, 1), 0.9],
    ['Volume a acumular', clamp((f.volumeTrend || 0) * 2, 0, 1), 0.7],
    ['Liquidez desequilibrada', clamp(Math.abs(f.bookImbalance || 0) * 2, 0, 1), 0.6],
    ['Mudança estrutural recente', f.changePointRecent ? 1 : 0, 0.5]
  ];
  const wsum = sum(conditions.map(c => c[2]));
  const strength = sum(conditions.map(([, v, w]) => v * w)) / wsum;
  const probability = sigmoid(-2.2 + strength * 6);
  const dirRaw = (f.cvdSlope || 0) * 0.45 + (f.bookImbalance || 0) * 0.25 + (f.waveletStructural || 0) * 0.3;
  const direction = dirRaw > 0.05 ? 'LONG' : dirRaw < -0.05 ? 'SHORT' : 'INDEFINIDA';
  let state = 'NEUTRO';
  if (f.expansion) state = 'EXPANSÃO EM CURSO';
  else if (f.compression && probability > 0.55) state = 'PRÉ-ROMPIMENTO';
  else if (f.exhaustion) state = 'EXAUSTÃO';
  else if (probability > 0.6) state = 'MUDANÇA ESTRUTURAL';
  return {
    state,
    probability: round(probability, 2),
    direction,
    active: conditions.filter(([, v]) => v >= 0.5).map(([name]) => name),
    readings: {
      precoPct: f.pricePct, volumePct: f.volumePct, cvdPct: f.cvdPct, liquidezPct: f.liquidityPct,
      entropia: (f.entropyTrend || 0) < -0.005 ? '↓' : (f.entropyTrend || 0) > 0.005 ? '↑' : '→',
      hurst: (f.hurstChange || 0) > 0.02 ? '↑' : (f.hurstChange || 0) < -0.02 ? '↓' : '→',
      ofiPct: f.ofiPct,
      volatilidade: f.expansion ? '↑' : f.compression ? '↓' : '→'
    }
  };
}

/**
 * Splits the recent move into its likely drivers (estimates, not certainties).
 * Each share is a magnitude in the move's direction; they are normalized to 100%.
 */
export function moveIntent(f) {
  const dir = Math.sign(f.movePct || 0) || 1;
  const parts = [];
  const add = (name, v) => { if (v > 0.02) parts.push([name, v]); };
  add('Compradores/vendedores agressivos', Math.max(0, dir * (f.cvdSlope || 0)) * 1.5);
  if (f.oiChangePct != null) {
    const covering = dir > 0 && f.oiChangePct < 0 ? -f.oiChangePct : dir < 0 && f.oiChangePct < 0 ? -f.oiChangePct : 0;
    add(dir > 0 ? 'Fecho de vendas a descoberto (short covering)' : 'Liquidação de posições compradas', covering / 2);
    add('Novas posições alavancadas', f.oiChangePct > 0 ? f.oiChangePct / 2 : 0);
  }
  add('Falta de liquidez (preço move-se com pouco volume)', Math.max(0, (f.impactZ || 0) - 0.5) / 2);
  add('Arrasto de outro ativo correlacionado', Math.max(0, f.correlatedShare || 0));
  add('Notícias', Math.max(0, dir * (f.newsScore || 0)) * 0.6);
  add('Varrimento de liquidez (caça a stops)', f.sweep ? 0.5 : 0);
  const noise = clamp(1 - Math.abs(f.moveSigma || 0) / 2, 0, 1);
  add('Ruído / volatilidade aleatória', noise);
  const total = sum(parts.map(p => p[1])) || 1;
  const shares = parts.map(([name, v]) => ({ name, pct: Math.round((v / total) * 100) })).sort((a, b) => b.pct - a.pct);
  const risks = [];
  if ((f.absorption || 0) > 0.3) risks.push(`Absorção forte contra o movimento (${Math.round(f.absorption * 100)}%): pode perder força.`);
  if (shares[0]?.name.startsWith('Fecho de vendas')) risks.push('Movimento puxado por short covering: costuma perder força quando as liquidações acabam.');
  if (shares[0]?.name.startsWith('Falta de liquidez')) risks.push('Preço a mover-se em liquidez fina: fácil de reverter.');
  return { movePct: f.movePct, bars: f.bars, shares, risks };
}
