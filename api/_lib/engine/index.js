import { getBinanceCandles, getBinanceAggTrades, getBinanceOrderBook } from '../sources/binance.js';
import { fetchJson } from '../sources/http.js';
import { closedCandles } from '../mechanics/pattern-library.js';
import { median, mad, std, mean, round, last, logReturns } from './core.js';
import { microLayer } from './micro.js';
import { entropyLayer } from './entropy.js';
import { regimeLayer } from './regime.js';
import { volatilityLayer } from './volatility.js';
import { fractalLayer } from './fractal.js';
import { waveletLayer } from './wavelet.js';
import { anomalyLayer } from './anomaly.js';
import { causalityLayer } from './causality.js';
import { getDerivatives } from './derivatives.js';
import { fuse, walkForward } from './fusion.js';
import { earlyWarning, moveIntent } from './early.js';
import { hurstExponent } from '../quant/stats.js';

// Market Intelligence Engine: microstructure + information theory + regimes +
// volatility + fractals + wavelets + anomalies + causality → one probabilistic
// reading. Cached 2 minutes per market.

const CACHE_MS = 120_000;
const cache = new Map();
const YAHOO_INTERVAL = { '5m': ['5m', '5d'], '15m': ['15m', '1mo'], '1h': ['60m', '3mo'] };

const rows = raw => raw.map(c => ({ time: +c.time, open: +c.open, high: +c.high, low: +c.low, close: +c.close, volume: +c.volume || 0 }))
  .filter(c => [c.time, c.open, c.high, c.low, c.close].every(Number.isFinite));

async function yahooCandles(symbol, interval) {
  const cfg = YAHOO_INTERVAL[interval];
  if (!cfg) return [];
  const data = await fetchJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${cfg[0]}&range=${cfg[1]}`, { timeout: 6000 });
  const r = data?.chart?.result?.[0];
  const q = r?.indicators?.quote?.[0] || {};
  return (r?.timestamp || []).map((t, i) => ({ time: t, open: q.open?.[i], high: q.high?.[i], low: q.low?.[i], close: q.close?.[i], volume: q.volume?.[i] || 0 }))
    .filter(c => [c.open, c.high, c.low, c.close].every(Number.isFinite));
}

function emaSlopeStrength(candles) {
  const closes = candles.map(c => c.close);
  const k = 2 / 21;
  let e = closes[0];
  const ema = closes.map(v => (e = v * k + e * (1 - k)));
  const atr = mean(candles.slice(-14).map(c => c.high - c.low)) || 1e-9;
  return (last(ema) - ema[ema.length - 11]) / atr / 10 * 5; // ATRs per 10 bars, scaled
}

async function compute(symbol, interval) {
  const refs = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'].filter(s => s !== symbol);
  const [rawBase, trades, book, ...refRaw] = await Promise.all([
    getBinanceCandles(symbol, interval, 1000),
    getBinanceAggTrades(symbol, 1000),
    getBinanceOrderBook(symbol, 500),
    ...refs.map(s => getBinanceCandles(s, interval, 500).catch(() => []))
  ]);
  const [dxyRaw, derivatives] = await Promise.all([
    yahooCandles('DX-Y.NYB', interval).catch(() => []),
    getDerivatives(symbol, interval).catch(() => null)
  ]);
  const candles = closedCandles(rows(rawBase), interval);
  if (candles.length < 300) {
    const error = new Error('Histórico insuficiente para o motor de inteligência.');
    error.status = 502;
    throw error;
  }
  const price = rows(rawBase).at(-1)?.close ?? last(candles).close;
  const returns = logReturns(candles.map(c => c.close));
  // Reference for cross-asset checks: BTC, or ETH when the target is BTC itself.
  const reference = rows(refRaw[0] || []);
  const referenceName = refs[0].replace('USDT', '');

  // Layers 1, 2, 4–8.
  const micro = microLayer({ candles, trades, book });
  const entropy = entropyLayer(returns);
  const vols = candles.slice(-40).map(c => c.volume);
  const volumeTrend = (mean(vols.slice(-10)) / (mean(vols.slice(0, 30)) || 1)) - 1;
  const volatility = volatilityLayer(candles, { volumeTrend, entropyTrend: entropy.metrics.entropyTrend });
  const fractal = fractalLayer(candles);
  const wavelet = waveletLayer(candles, reference, interval);
  const anomaly = anomalyLayer(candles, { reference, referenceName, cvdSlope: micro.metrics.flow?.cvdSlope ?? null });
  const series = { [symbol.replace('USDT', '')]: candles.slice(-500) };
  refs.forEach((s, i) => { if (refRaw[i]?.length) series[s.replace('USDT', '')] = rows(refRaw[i]); });
  if (dxyRaw.length > 80) series.DXY = dxyRaw;
  const causality = causalityLayer(series, symbol.replace('USDT', ''));

  // Layer 3 uses the other layers' features.
  const sigma = std(returns.slice(-200)) || 1e-9;
  const move20 = Math.log(last(candles).close / candles[candles.length - 21].close);
  const hRecent = hurstExponent(returns.slice(-128));
  const hBefore = hurstExponent(returns.slice(-256, -128));
  const features = {
    trendStrength: emaSlopeStrength(candles),
    trendDirection: Math.sign(move20),
    hurst: fractal.metrics.hurst,
    volPercentile: volatility.metrics.percentile,
    recentMove: move20 / (sigma * Math.sqrt(20)),
    volumeZ: mad(vols) ? (last(vols) - median(vols)) / mad(vols) : 0,
    compression: volatility.metrics.compression,
    expansion: volatility.metrics.expansion,
    cvdSlope: micro.metrics.flow?.cvdSlope ?? 0
  };
  const regime = regimeLayer(returns, features);
  const layers = [micro, entropy, regime, volatility, fractal, wavelet, anomaly, causality];

  // Fusion with regime weights and walk-forward validation.
  const validation = walkForward(candles, { horizon: 6 });
  const fusion = fuse(layers, { regimeCode: regime.metrics.code, validation, volPerBar: sigma, price, horizon: 6 });

  // Early warning and intent of the last move.
  const flow = micro.metrics.flow;
  const near = micro.metrics.liquidity?.bands?.[2];
  const k = 12;
  const movePct = (last(candles).close / candles[candles.length - 1 - k].close - 1) * 100;
  const recentVol = candles.slice(-k).reduce((s, c) => s + c.volume, 0);
  const impacts = [];
  for (let i = candles.length - 200; i + k <= candles.length; i += k) {
    const seg = candles.slice(i, i + k);
    const v = seg.reduce((s, c) => s + c.volume, 0);
    if (v > 0) impacts.push(Math.abs(Math.log(last(seg).close / seg[0].open)) / v);
  }
  const impactNow = recentVol > 0 ? Math.abs(Math.log(last(candles).close / candles[candles.length - k].open)) / recentVol : 0;
  const cross = anomaly.metrics.crossAsset;
  const early = earlyWarning({
    readiness: volatility.metrics.readiness,
    entropyTrend: entropy.metrics.entropyTrend,
    hurstChange: hRecent != null && hBefore != null ? hRecent - hBefore : 0,
    ofiTrend: flow?.ofiTrend ?? 0,
    cvdSlope: flow?.cvdSlope ?? 0,
    bookImbalance: near?.imbalance ?? 0,
    volumeTrend,
    changePointRecent: Boolean(regime.metrics.changePoint?.significant && regime.metrics.changePoint.barsAgo <= 15),
    expansion: volatility.metrics.expansion,
    compression: volatility.metrics.compression,
    exhaustion: regime.metrics.code === 'A' && (entropy.metrics.entropyTrend || 0) > 0.01 && (flow?.absorption || 0) > 0.3,
    waveletStructural: wavelet.metrics.structural ?? 0,
    pricePct: round(movePct, 2),
    volumePct: round(volumeTrend * 100, 1),
    cvdPct: flow ? round(flow.cvdSlope * 100, 1) : null,
    liquidityPct: near ? round(near.imbalance * 100, 1) : null,
    ofiPct: flow ? round(flow.ofiTrend * 100, 1) : null
  });
  const intent = moveIntent({
    movePct: round(movePct, 3),
    bars: k,
    moveSigma: Math.log(1 + movePct / 100) / (sigma * Math.sqrt(k)),
    cvdSlope: flow?.cvdSlope ?? 0,
    oiChangePct: derivatives?.oiChangePct ?? null,
    impactZ: impacts.length && mad(impacts) ? (impactNow - median(impacts)) / mad(impacts) : 0,
    correlatedShare: cross && Math.sign(cross.impliedPct) === Math.sign(movePct) && Math.abs(movePct) > 0 ? Math.min(1, Math.abs(cross.impliedPct / movePct)) : 0,
    sweep: Boolean(micro.metrics.sweep),
    absorption: flow?.absorption ?? 0
  });

  return {
    ok: true,
    symbol,
    interval,
    price,
    updatedAt: new Date().toISOString(),
    regime: { code: regime.metrics.code, label: regime.metrics.label },
    fusion,
    earlyWarning: early,
    intent,
    derivatives,
    validation,
    layers: layers.map(l => ({ id: l.id, name: l.name, score: Math.round(l.score * 100), confidence: Math.round(l.confidence * 100), notes: l.notes, metrics: l.metrics })),
    disclaimer: 'Leitura probabilística e educativa. Nenhum cálculo garante resultados; os pesos são validados no histórico deste mercado.'
  };
}

export function runEngine(symbol, interval) {
  const key = symbol + ':' + interval;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.promise;
  const promise = compute(symbol, interval);
  cache.set(key, { at: Date.now(), promise });
  promise.catch(() => cache.delete(key));
  return promise;
}
