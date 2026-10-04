import { clamp, sign, ema, rsi, macd, roc, atr } from './math.js';

// The council's analysts. Each one reads the same market from a different angle
// and returns: score in [-1, 1] (positive favours buying), confidence in [0, 1],
// and plain-language reasons. Pure functions: same input, same answer.

const DIRECTION = s => (s > 0.15 ? 'COMPRAR' : s < -0.15 ? 'VENDER' : 'AGUARDAR');
const pct = v => (v * 100).toFixed(1) + '%';

function result(id, name, score, confidence, reasons, extra = {}) {
  const s = Number(clamp(score).toFixed(3));
  return { id, name, score: s, confidence: Number(clamp(confidence, 0, 1).toFixed(2)), lean: DIRECTION(s), reasons: reasons.filter(Boolean).slice(0, 3), ...extra };
}

/** News: recency-weighted headline tone (half-life 2 h, last 12 h). */
export function newsAnalyst(events = [], nowMs = Date.now()) {
  const HALF_LIFE = 2 * 3600_000;
  const recent = events
    .map(e => ({ ...e, age: nowMs - new Date(e.timestamp).getTime() }))
    .filter(e => Number.isFinite(e.age) && e.age >= 0 && e.age <= 12 * 3600_000);
  if (!recent.length) return result('noticiario', 'Noticiário', 0, 0, ['Sem notícias recentes sobre este ativo.']);
  let sum = 0;
  let weight = 0;
  for (const e of recent) {
    const w = Math.pow(0.5, e.age / HALF_LIFE);
    sum += w * (e.sentiment === 'bullish' ? 1 : e.sentiment === 'bearish' ? -1 : 0);
    weight += w;
  }
  const score = weight ? sum / weight : 0;
  const bull = recent.filter(e => e.sentiment === 'bullish').length;
  const bear = recent.filter(e => e.sentiment === 'bearish').length;
  const top = [...recent].sort((a, b) => a.age - b.age).find(e => e.sentiment !== 'neutral');
  return result('noticiario', 'Noticiário', score * 1.5, Math.min(1, recent.length / 15), [
    `${recent.length} notícias nas últimas 12 h: ${bull} positivas, ${bear} negativas.`,
    top ? `Mais recente com tom: "${String(top.headline).slice(0, 110)}" (${top.source}).` : null
  ], { headlines: recent.slice(0, 5).map(e => ({ title: e.headline, source: e.source, sentiment: e.sentiment, url: e.url })) });
}

/** Mathematics: momentum from ROC, MACD (in ATRs), RSI and EMA slope. */
export function mathAnalyst(candles = []) {
  const closes = candles.map(c => c.close);
  if (closes.length < 60) return result('matematico', 'Matemático', 0, 0, ['Velas insuficientes para os cálculos.']);
  const range = atr(candles, 14) || closes.at(-1) * 0.001;
  const m = macd(closes);
  const r = rsi(closes, 14);
  const roc10 = roc(closes, 10);
  const roc30 = roc(closes, 30);
  const e20 = ema(closes, 20);
  const slope = e20.length > 5 ? (e20.at(-1) - e20.at(-6)) / range / 5 : 0;
  const parts = [
    [Math.tanh((m?.histogram || 0) / range * 2), 0.3],
    [Math.tanh((roc10 || 0) * closes.at(-1) / range / 3), 0.25],
    [Math.tanh((roc30 || 0) * closes.at(-1) / range / 6), 0.2],
    [Math.tanh(slope * 3), 0.25]
  ];
  let score = parts.reduce((s, [v, w]) => s + v * w, 0);
  // Overbought/oversold RSI tempers a move that is already stretched.
  if (r != null && r > 75 && score > 0) score *= 0.6;
  if (r != null && r < 25 && score < 0) score *= 0.6;
  const agree = parts.filter(([v]) => sign(v) === sign(score) && Math.abs(v) > 0.1).length / parts.length;
  return result('matematico', 'Matemático', score, 0.35 + agree * 0.6, [
    `MACD ${m && m.histogram > 0 ? 'acima' : 'abaixo'} do sinal; RSI ${r != null ? r.toFixed(0) : '—'}.`,
    `Variação: ${roc10 != null ? pct(roc10) : '—'} nas últimas 10 velas, ${roc30 != null ? pct(roc30) : '—'} nas últimas 30.`
  ], { rsi: r != null ? Number(r.toFixed(1)) : null });
}

/** Statistics: market regime (Hurst, variance ratio, entropy, VWAP z, Kalman). */
export function statsAnalyst(q) {
  if (!q) return result('estatistico', 'Estatístico', 0, 0, ['Histórico insuficiente para o regime estatístico.']);
  const hurst = q.hurst ?? 0.5;
  const entropyPenalty = q.entropy != null ? clamp((q.entropy - 0.9) / 0.1, 0, 1) : 0.5;
  let score = 0;
  let confidence = 0.3;
  const reasons = [`Hurst ${hurst.toFixed(2)}, razão de variância ${(q.varianceRatio ?? 1).toFixed(2)}, entropia ${(q.entropy ?? 0).toFixed(2)}.`];
  if (q.regime === 'trend') {
    score = Math.tanh((q.kalmanZ ?? 0) / 2);
    confidence = clamp(0.5 + (hurst - 0.5) * 2 - entropyPenalty * 0.3, 0.2, 0.95);
    reasons.push(`Regime de tendência persistente; deriva (Kalman z ${(q.kalmanZ ?? 0).toFixed(1)}) ${q.kalmanZ > 0 ? 'para cima' : 'para baixo'}.`);
  } else if (q.regime === 'reversion') {
    score = Math.abs(q.vwapZ ?? 0) > 1.5 ? -Math.tanh((q.vwapZ ?? 0) / 2) : 0;
    confidence = clamp(0.4 + (0.5 - hurst) * 2, 0.2, 0.9);
    reasons.push(`Regime de reversão à média; preço a ${(q.vwapZ ?? 0).toFixed(1)} desvios do VWAP.`);
  } else if (q.regime === 'chaotic') {
    confidence = 0.8;
    reasons.push('Volatilidade extrema: estatisticamente imprevisível.');
  } else {
    confidence = 0.4;
    reasons.push('Sem estrutura estatística: o preço comporta-se como ruído.');
  }
  return result('estatistico', 'Estatístico', score, confidence, reasons, { regime: q.regime });
}

/** Behaviour: crowd mood (Fear & Greed, contrarian at extremes) and order flow. */
export function behaviourAnalyst(q, context = {}, fearGreed = null) {
  const parts = [];
  const reasons = [];
  if (Number.isFinite(context.flow)) {
    parts.push([context.flow, 0.4]);
    reasons.push(`Ordens agressoras: ${context.flow > 0 ? 'mais compra' : 'mais venda'} (${(Math.abs(context.flow) * 100).toFixed(0)}% de desequilíbrio).`);
  } else if (Number.isFinite(q?.flowImbalanceShort)) {
    parts.push([q.flowImbalanceShort, 0.4]);
  }
  if (Number.isFinite(context.book)) parts.push([context.book, 0.25]);
  if (fearGreed && Number.isFinite(fearGreed.value)) {
    const v = fearGreed.value;
    // Contrarian only at extremes: the crowd is usually wrong when it panics or euphorises.
    const contrarian = v <= 20 ? 0.6 : v <= 30 ? 0.3 : v >= 80 ? -0.6 : v >= 70 ? -0.3 : 0;
    parts.push([contrarian, 0.35]);
    reasons.push(`Sentimento da multidão: ${v} (${fearGreed.label})${contrarian ? ', extremo: sinal contrário' : ''}.`);
  }
  if (!parts.length) return result('comportamental', 'Comportamental', 0, 0, ['Sem dados de fluxo nem de sentimento.']);
  const weight = parts.reduce((s, [, w]) => s + w, 0);
  const score = parts.reduce((s, [v, w]) => s + v * w, 0) / weight;
  // High VPIN = informed/toxic flow: less trust in the crowd reading.
  const toxic = Number.isFinite(q?.vpin) && q.vpin > 0.6;
  if (toxic) reasons.push(`VPIN ${q.vpin.toFixed(2)}: fluxo "tóxico", cautela.`);
  return result('comportamental', 'Comportamental', score * 1.4, (toxic ? 0.4 : 0.65) * Math.min(1, weight / 0.75), reasons);
}

function trendOf(candles) {
  const closes = candles.map(c => c.close);
  if (closes.length < 60) return null;
  const fast = ema(closes, 20);
  const slow = ema(closes, 50);
  const price = closes.at(-1);
  const slopeUp = fast.at(-1) > fast.at(-6);
  const score = (price > fast.at(-1) ? 1 : -1) * 0.3 + (fast.at(-1) > slow.at(-1) ? 1 : -1) * 0.4 + (slopeUp ? 1 : -1) * 0.3;
  return score;
}

/** Trend: EMA 20/50 alignment on the chart timeframe and two higher ones. */
export function trendAnalyst(byTimeframe = {}) {
  const frames = [['base', 0.3], ['mid', 0.35], ['high', 0.35]];
  const names = byTimeframe.labels || {};
  const read = frames.map(([key, w]) => [key, trendOf(byTimeframe[key] || []), w]).filter(([, v]) => v != null);
  if (!read.length) return result('tendencial', 'Tendencial', 0, 0, ['Sem velas para medir a tendência.']);
  const weight = read.reduce((s, [, , w]) => s + w, 0);
  const score = read.reduce((s, [, v, w]) => s + v * w, 0) / weight;
  const agree = read.filter(([, v]) => sign(v) === sign(score)).length / read.length;
  const word = v => (v > 0.3 ? 'alta' : v < -0.3 ? 'baixa' : 'indefinida');
  return result('tendencial', 'Tendencial', score, 0.3 + agree * 0.65, [
    read.map(([key, v]) => `${names[key] || key}: ${word(v)}`).join(' · '),
    agree === 1 ? 'Todos os tempos gráficos alinhados.' : 'Tempos gráficos em desacordo.'
  ]);
}

/** Algorithm: the quant engine's live signal, trusted according to its own track record. */
export function algorithmAnalyst(signal = {}, summary = {}) {
  const dir = signal.direction || 0;
  const base = dir * (signal.confidence || 0) / 100;
  const trades = summary.trades || 0;
  let trust = 0.5;
  if (trades >= 5) trust = clamp(0.3 + (summary.winRate || 0) / 100 * 0.5 + Math.min(summary.profitFactor || 0, 3) / 3 * 0.3, 0.2, 0.95);
  const reasons = [
    dir ? `Motor quant: ${signal.action} (força ${signal.confidence}%, ${signal.setup === 'reversion' ? 'reversão' : 'tendência'}).` : `Motor quant: ${(signal.reasons || ['sem sinal'])[0]}`,
    trades >= 5 ? `Historial: ${trades} operações, ${Math.round(summary.winRate || 0)}% certas, fator de lucro ${(summary.profitFactor || 0).toFixed(2)}.` : 'Ainda com poucas operações para medir o historial.'
  ];
  return result('algoritmico', 'Algorítmico', base, dir ? trust : Math.max(trust, 0.5), reasons);
}

/** Macro & risk: world risk appetite and high-impact news (can veto any trade). */
export function macroAnalyst(context = {}, isRiskAsset = true) {
  const g = context.global;
  const risk = context.eventRisk || {};
  const reasons = [];
  let score = 0;
  if (g && Number.isFinite(g.score)) {
    score = isRiskAsset ? g.score : 0;
    reasons.push(`Mercados mundiais: ${g.label} (${g.score > 0 ? '+' : ''}${g.score.toFixed(2)}).`);
  }
  let veto = false;
  let confidence = 0.4;
  if (risk.blocked && risk.event) {
    veto = true;
    confidence = 1;
    reasons.unshift(`Notícia de alto impacto agora: ${risk.event.title} (${risk.event.currency}).`);
  } else if (risk.next && risk.minutesToNext != null && risk.minutesToNext < 60) {
    confidence = 0.7;
    reasons.push(`Notícia forte daqui a ${risk.minutesToNext} min: ${risk.next.title}.`);
  }
  return result('macro', 'Macro e risco', score, confidence, reasons.length ? reasons : ['Sem sinais macro relevantes.'], { veto });
}

/** Structure: the Market Intelligence Engine's fused reading (8 quantitative layers). */
export function structureAnalyst(engine) {
  if (!engine?.fusion) return result('estrutural', 'Estrutural (motor)', 0, 0, ['Motor de inteligência indisponível.']);
  const f = engine.fusion;
  const ew = engine.earlyWarning;
  return result('estrutural', 'Estrutural (motor)', f.structuralBias / 100 * 1.5, f.confidence / 100, [
    `Viés estrutural ${f.structuralBias > 0 ? '+' : ''}${f.structuralBias} · regime ${engine.regime.code} (${engine.regime.label}) · P(subir) ${Math.round(f.probabilityUp * 100)}%.`,
    ew && ew.state !== 'NEUTRO' ? `Alerta antecipado: ${ew.state} (${Math.round(ew.probability * 100)}%, direção ${ew.direction}).` : null,
    engine.intent?.shares?.[0] ? `Movimento recente: ${engine.intent.shares[0].pct}% ${engine.intent.shares[0].name.toLowerCase()}.` : null
  ]);
}

// How much each analyst counts in the numeric consensus.
export const WEIGHTS = { estrutural: 0.22, algoritmico: 0.14, tendencial: 0.16, estatistico: 0.1, matematico: 0.12, comportamental: 0.1, noticiario: 0.09, macro: 0.07 };

/** Weighted consensus of the analysts, with vetoes. */
export function consensus(analysts) {
  const total = analysts.reduce((s, a) => s + (WEIGHTS[a.id] || 0.1), 0);
  const score = analysts.reduce((s, a) => s + (WEIGHTS[a.id] || 0.1) * a.score * a.confidence, 0) / total;
  const voting = analysts.filter(a => Math.abs(a.score) > 0.15 && a.confidence >= 0.3);
  const agree = voting.length ? voting.filter(a => sign(a.score) === sign(score)).length / voting.length : 0;
  const vetoes = analysts.filter(a => a.veto).map(a => a.reasons[0]);
  const chaotic = analysts.some(a => a.regime === 'chaotic');
  if (chaotic) vetoes.push('Volatilidade extrema (regime caótico).');
  let decision = 'AGUARDAR';
  if (!vetoes.length && Math.abs(score) >= 0.2 && agree >= 0.6) decision = score > 0 ? 'COMPRAR' : 'VENDER';
  const confidence = decision === 'AGUARDAR' ? 0 : Math.round(clamp(Math.abs(score) * 1.6, 0, 1) * agree * 100);
  return { score: Number(score.toFixed(3)), agreement: Number(agree.toFixed(2)), decision, confidence, vetoes };
}
