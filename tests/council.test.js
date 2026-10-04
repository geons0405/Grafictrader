import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newsAnalyst, mathAnalyst, statsAnalyst, behaviourAnalyst, trendAnalyst, algorithmAnalyst, macroAnalyst, consensus
} from '../api/_lib/council/analysts.js';
import { settleVerdict, judge } from '../api/_lib/council/judge.js';
import { rsi, ema, macd } from '../api/_lib/council/math.js';

function series(n, step, noise = 0) {
  let price = 100;
  return Array.from({ length: n }, (_, i) => {
    const open = price;
    price = price * (1 + step) + (i % 2 ? noise : -noise);
    return { time: i * 300, open, high: Math.max(open, price) * 1.001, low: Math.min(open, price) * 0.999, close: price, volume: 10 };
  });
}

test('math helpers', () => {
  assert.equal(ema([1, 2, 3, 4], 5).length, 0);
  assert.ok(rsi(series(60, 0.01).map(c => c.close)) > 90);
  assert.ok(macd(series(80, 0.01).map(c => c.close)).histogram !== undefined);
});

test('math and trend analysts follow a clean uptrend and a downtrend', () => {
  const up = series(200, 0.003);
  const down = series(200, -0.003);
  assert.equal(mathAnalyst(up).lean, 'COMPRAR');
  assert.equal(mathAnalyst(down).lean, 'VENDER');
  const t = trendAnalyst({ base: up, mid: up, high: up });
  assert.equal(t.lean, 'COMPRAR');
  assert.ok(t.confidence > 0.9);
  assert.equal(trendAnalyst({ base: down, mid: down, high: down }).lean, 'VENDER');
});

test('news analyst weighs recent headlines more', () => {
  const now = Date.parse('2026-10-04T12:00:00Z');
  const events = [
    { headline: 'Bitcoin surges', sentiment: 'bullish', timestamp: '2026-10-04T11:50:00Z', source: 'A' },
    { headline: 'Bitcoin rallies', sentiment: 'bullish', timestamp: '2026-10-04T11:30:00Z', source: 'B' },
    { headline: 'Old crash', sentiment: 'bearish', timestamp: '2026-10-04T02:00:00Z', source: 'C' }
  ];
  const a = newsAnalyst(events, now);
  assert.equal(a.lean, 'COMPRAR');
  assert.equal(newsAnalyst([], now).confidence, 0);
});

test('statistics analyst reads the regime', () => {
  assert.equal(statsAnalyst({ regime: 'trend', hurst: 0.62, kalmanZ: 2.5, entropy: 0.9 }).lean, 'COMPRAR');
  assert.equal(statsAnalyst({ regime: 'reversion', hurst: 0.4, vwapZ: 2.6 }).lean, 'VENDER');
  assert.equal(statsAnalyst({ regime: 'noise', hurst: 0.5 }).score, 0);
});

test('behaviour analyst is contrarian at extreme fear', () => {
  const a = behaviourAnalyst({}, { flow: 0, book: 0 }, { value: 10, label: 'Extreme Fear' });
  assert.ok(a.score > 0);
});

test('algorithm analyst trusts the engine by its track record', () => {
  const good = algorithmAnalyst({ direction: 1, action: 'COMPRAR', confidence: 70, setup: 'trend' }, { trades: 20, winRate: 65, profitFactor: 2 });
  const bad = algorithmAnalyst({ direction: 1, action: 'COMPRAR', confidence: 70, setup: 'trend' }, { trades: 20, winRate: 20, profitFactor: 0.4 });
  assert.ok(good.confidence > bad.confidence);
});

test('macro analyst vetoes during high-impact news and consensus respects it', () => {
  const macro = macroAnalyst({ eventRisk: { blocked: true, event: { title: 'CPI', currency: 'USD' } }, global: { score: 0.2, label: 'Apetite ao risco' } });
  assert.equal(macro.veto, true);
  const bulls = ['algoritmico', 'tendencial', 'estatistico', 'matematico'].map(id => ({ id, score: 0.8, confidence: 0.9, reasons: ['x'] }));
  assert.equal(consensus(bulls).decision, 'COMPRAR');
  assert.equal(consensus([...bulls, macro]).decision, 'AGUARDAR');
});

test('consensus waits when strong analysts disagree', () => {
  const split = [
    { id: 'algoritmico', score: 0.8, confidence: 0.9, reasons: [] },
    { id: 'tendencial', score: -0.8, confidence: 0.9, reasons: [] },
    { id: 'estatistico', score: 0.6, confidence: 0.8, reasons: [] },
    { id: 'matematico', score: -0.7, confidence: 0.8, reasons: [] }
  ];
  assert.equal(consensus(split).decision, 'AGUARDAR');
});

test('judge cannot override a veto or flip a strong consensus', () => {
  const vetoed = { score: 0.5, agreement: 1, decision: 'AGUARDAR', confidence: 0, vetoes: ['CPI'] };
  assert.equal(settleVerdict({ decisao: 'COMPRAR', confianca: 90 }, vetoed).decision, 'AGUARDAR');
  const bullish = { score: 0.5, agreement: 0.9, decision: 'COMPRAR', confidence: 70, vetoes: [] };
  assert.equal(settleVerdict({ decisao: 'VENDER', confianca: 80 }, bullish).decision, 'AGUARDAR');
  const ok = settleVerdict({ decisao: 'COMPRAR', confianca: 77, resumo: 'Sobe', porque: ['a', 'b'] }, bullish);
  assert.equal(ok.decision, 'COMPRAR');
  assert.equal(ok.confidence, 77);
  assert.equal(settleVerdict({ decisao: 'AGUARDAR' }, bullish).decision, 'AGUARDAR');
});

test('judge falls back to the numeric consensus without any AI key', async () => {
  const saved = { ...process.env };
  for (const k of Object.keys(process.env)) if (/_API_K|_PAI_KEY|AI_JUDGE/.test(k)) delete process.env[k];
  try {
    const consensusResult = { score: 0.4, agreement: 0.8, decision: 'COMPRAR', confidence: 50, vetoes: [] };
    const v = await judge({ symbol: 'BTCUSDT', interval: '5m', price: 1, analysts: [], consensus: consensusResult });
    assert.equal(v.decision, 'COMPRAR');
    assert.equal(v.judge, 'Consenso numérico');
  } finally {
    process.env = saved;
  }
});
