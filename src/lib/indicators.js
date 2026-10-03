// Pure technical-reading helpers (no DOM) so they can be unit tested in Node.

export function ema(values, period) {
  if (!values.length) return [];
  const k = 2 / (period + 1);
  const out = [values[0]];
  for (let i = 1; i < values.length; i++) out.push(values[i] * k + out[i - 1] * (1 - k));
  return out;
}

/** RSI with Wilder smoothing. Returns null until there are period + 1 closes. */
export function wilderRsi(closes, period = 14) {
  if (!Array.isArray(closes) || closes.length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    gain += Math.max(d, 0);
    loss += Math.max(-d, 0);
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

/** Pivot highs/lows confirmed by `wing` candles on each side. */
export function swingPoints(candles, wing = 2) {
  const highs = [];
  const lows = [];
  for (let i = wing; i < candles.length - wing; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - wing; j <= i + wing; j++) {
      if (j === i) continue;
      if (candles[j].high >= candles[i].high) isHigh = false;
      if (candles[j].low <= candles[i].low) isLow = false;
    }
    if (isHigh) highs.push({ index: i, price: candles[i].high });
    if (isLow) lows.push({ index: i, price: candles[i].low });
  }
  return { highs, lows };
}

/** Market structure from the last two swing highs and lows. */
export function marketStructure(candles) {
  const { highs, lows } = swingPoints(candles);
  const lastHigh = highs.at(-1) || null;
  const lastLow = lows.at(-1) || null;
  if (highs.length < 2 || lows.length < 2) {
    return { key: 'undefined', label: 'Indefinida', direction: 0, lastHigh, lastLow };
  }
  const hh = highs.at(-1).price > highs.at(-2).price;
  const hl = lows.at(-1).price > lows.at(-2).price;
  if (hh && hl) return { key: 'bullish', label: 'Topos e fundos ascendentes', direction: 1, lastHigh, lastLow };
  if (!hh && !hl) return { key: 'bearish', label: 'Topos e fundos descendentes', direction: -1, lastHigh, lastLow };
  if (!hh && hl) return { key: 'compression', label: 'Compressão', direction: 0, lastHigh, lastLow };
  return { key: 'expansion', label: 'Expansão', direction: 0, lastHigh, lastLow };
}

function rsiState(rsi) {
  if (rsi == null) return 'Sem dados';
  if (rsi >= 70) return 'Sobrecompra';
  if (rsi <= 30) return 'Sobrevenda';
  return rsi >= 50 ? 'Zona positiva' : 'Zona negativa';
}

/**
 * Rule-based technical reading. Confidence is the share of independent
 * signals (EMA trend, structure, RSI side, 20-bar momentum) agreeing with the
 * dominant direction; it is not a probability of success.
 */
export function technicalReading(candles) {
  const rows = (Array.isArray(candles) ? candles : [])
    .map(c => ({ time: c.time, open: +c.open, high: +c.high, low: +c.low, close: +c.close, volume: +c.volume || 0 }))
    .filter(c => [c.open, c.high, c.low, c.close].every(Number.isFinite));
  if (rows.length < 30) return null;

  const closes = rows.map(c => c.close);
  const last = closes.at(-1);
  const fast = ema(closes, 20).at(-1);
  const slow = ema(closes, 50).at(-1);
  const rsi = wilderRsi(closes);
  const structure = marketStructure(rows.slice(-80));
  const momentum = last - closes.at(-21);

  const signals = [
    Math.sign(fast - slow),
    structure.direction,
    rsi == null ? 0 : Math.sign(rsi - 50),
    Math.sign(momentum)
  ];
  const score = signals.reduce((a, b) => a + b, 0);
  const direction = score > 0 ? 1 : score < 0 ? -1 : 0;
  const agreeing = direction === 0 ? 0 : signals.filter(s => s === direction).length;
  const confidence = Math.round((agreeing / signals.length) * 100);

  const support = structure.lastLow?.price ?? Math.min(...rows.slice(-20).map(c => c.low));
  const resistance = structure.lastHigh?.price ?? Math.max(...rows.slice(-20).map(c => c.high));

  const trend = direction > 0 ? 'Alta' : direction < 0 ? 'Baixa' : 'Lateral';
  const stretched = rsi != null && (rsi >= 70 || rsi <= 30);

  let summary;
  if (direction > 0) summary = 'Média de 20 acima da de 50 e sinais maioritariamente de alta.';
  else if (direction < 0) summary = 'Média de 20 abaixo da de 50 e sinais maioritariamente de baixa.';
  else summary = 'Sinais divididos: sem direção dominante neste timeframe.';
  if (stretched) summary += ' O RSI está esticado, o que torna a continuação menos limpa.';

  return {
    trend,
    direction,
    rsi,
    rsiState: rsiState(rsi),
    structure,
    confidence,
    support,
    resistance,
    summary,
    signals: { ema: signals[0], structure: signals[1], rsi: signals[2], momentum: signals[3] },
    volumes: rows.slice(-14).map(c => c.volume)
  };
}
