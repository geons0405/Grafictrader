import { patternChain, allPatterns } from 'candlestick';

// Candlestick patterns on the last closed candle (github.com/cm45t3r/candlestick, MIT).
// A reversal pattern only counts after a move the other way: a hammer means
// little in the middle of a rally.

const PATTERNS = {
  bullishEngulfing: { label: 'Engolfo de alta', side: 1, size: 2, reversal: true },
  bearishEngulfing: { label: 'Engolfo de baixa', side: -1, size: 2, reversal: true },
  hammer: { label: 'Martelo', side: 1, size: 1, reversal: true },
  invertedHammer: { label: 'Martelo invertido', side: 1, size: 1, reversal: true },
  hangingMan: { label: 'Enforcado', side: -1, size: 1, reversal: true },
  shootingStar: { label: 'Estrela cadente', side: -1, size: 1, reversal: true },
  morningStar: { label: 'Estrela da manhã', side: 1, size: 3, reversal: true },
  eveningStar: { label: 'Estrela da tarde', side: -1, size: 3, reversal: true },
  piercingLine: { label: 'Linha de penetração', side: 1, size: 2, reversal: true },
  darkCloudCover: { label: 'Nuvem negra', side: -1, size: 2, reversal: true },
  bullishHarami: { label: 'Harami de alta', side: 1, size: 2, reversal: true },
  bearishHarami: { label: 'Harami de baixa', side: -1, size: 2, reversal: true },
  tweezersBottom: { label: 'Pinça de fundo', side: 1, size: 2, reversal: true },
  tweezersTop: { label: 'Pinça de topo', side: -1, size: 2, reversal: true },
  bullishKicker: { label: 'Kicker de alta', side: 1, size: 2, reversal: false },
  bearishKicker: { label: 'Kicker de baixa', side: -1, size: 2, reversal: false },
  threeWhiteSoldiers: { label: 'Três soldados brancos', side: 1, size: 3, reversal: false },
  threeBlackCrows: { label: 'Três corvos negros', side: -1, size: 3, reversal: false },
  doji: { label: 'Doji (indecisão)', side: 0, size: 1, reversal: false }
};

/** Direction of the move before the pattern: +1 up, -1 down, 0 flat. */
function priorMove(candles, end) {
  const window = candles.slice(Math.max(0, end - 6), end);
  if (window.length < 3) return 0;
  const change = (window.at(-1).close - window[0].close) / window[0].close;
  const range = Math.max(...window.map(c => c.high)) - Math.min(...window.map(c => c.low));
  if (!(range > 0)) return 0;
  const moved = Math.abs(window.at(-1).close - window[0].close) / range;
  return moved < 0.4 ? 0 : Math.sign(change);
}

/**
 * Patterns that end on the last candle of `candles` (closed candles only).
 * Returns [{ id, label, side }] with side +1 (alta), -1 (baixa) or 0 (indecisão).
 */
export function lastCandlePatterns(candles) {
  if (!Array.isArray(candles) || candles.length < 3) return [];
  const recent = candles.slice(-10).map(({ open, high, low, close }) => ({ open, high, low, close }));
  const last = recent.length - 1;
  const found = new Map();
  let matches = [];
  try { matches = patternChain(recent, allPatterns); } catch { return []; }
  for (const { index, pattern } of matches) {
    const info = PATTERNS[pattern];
    if (!info || index + info.size - 1 !== last || found.has(pattern)) continue;
    // A reversal needs something to reverse.
    if (info.reversal && priorMove(recent, index) !== -info.side) continue;
    found.set(pattern, { id: pattern, label: info.label, side: info.side });
  }
  const list = [...found.values()];
  // A doji next to a stronger pattern adds nothing.
  return list.length > 1 ? list.filter(p => p.side !== 0) : list;
}

/** One plain sentence about the patterns for a reading in direction `dir` (+1 buy, -1 sell, 0 wait). */
export function patternSentence(patterns, dir) {
  if (!patterns?.length) return null;
  const names = patterns.map(p => p.label).join(' e ');
  const sides = new Set(patterns.map(p => p.side));
  if (sides.size === 1 && sides.has(0)) return `A última vela é um ${names}: o mercado está indeciso.`;
  const side = patterns.find(p => p.side !== 0)?.side ?? 0;
  if (dir && side === dir) return `A última vela formou um padrão que confirma: ${names}.`;
  if (dir && side === -dir) return `Atenção: a última vela formou um padrão contrário (${names}). Espera mais uma vela antes de entrar.`;
  return `Padrão na última vela: ${names} (${side > 0 ? 'sinal de alta' : 'sinal de baixa'}).`;
}
