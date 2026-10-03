import test from 'node:test';
import assert from 'node:assert/strict';
import { explainPlain, buildPlan, photoGuidance } from '../api/_lib/quant/explain.js';
import { eventRisk, currenciesFor } from '../api/_lib/sources/calendar.js';
import { riskSentiment } from '../api/_lib/sources/global-markets.js';
import { decide } from '../api/_lib/quant/signal.js';
import { normalizeVision, mergeVerdict } from '../api/_lib/quant/verdict.js';

const snap = { regime: 'trend', kalmanZ: 3, flowImbalance: 0.3, price: 110, vwap: 100, entropy: 0.9, hurst: 0.62, volPercentile: 0.5, atr: 2, vwapZ: 0.5 };

test('calendar risk blocks around high-impact events for the right currencies', () => {
  const now = Date.UTC(2026, 9, 3, 12, 0);
  const events = [
    { title: 'Non-Farm Employment Change', currency: 'USD', impact: 'High', time: now + 10 * 60000 },
    { title: 'German CPI', currency: 'EUR', impact: 'High', time: now + 3 * 3600000 }
  ];
  assert.equal(eventRisk(events, 'BTCUSDT', now).blocked, true);
  assert.equal(eventRisk(events, 'BTCUSDT', now + 45 * 60000).blocked, false);
  assert.deepEqual(currenciesFor('EURUSD').sort(), ['EUR', 'USD']);
  assert.equal(eventRisk(events, 'EURUSD', now + 45 * 60000).next.title, 'German CPI');
});

test('a high-impact event vetoes new entries', () => {
  const blocked = { score: 0, eventRisk: { blocked: true, event: { currency: 'USD', title: 'CPI' } } };
  assert.equal(decide(snap).action, 'COMPRAR');
  assert.equal(decide(snap, blocked).action, 'AGUARDAR');
});

test('plain guidance explains a buy with concrete levels', () => {
  const decision = decide(snap);
  const plan = buildPlan(null, decision, snap, 110);
  const g = explainPlain({ decision, snapshot: snap, context: null, plan });
  assert.equal(g.action, 'COMPRAR');
  assert.ok(g.steps.some(s => s.includes('$107')), 'stop at entry - 1.5 ATR');
  assert.ok(g.steps.some(s => s.includes('$116')), 'target at 2R');
  assert.ok(g.why.length >= 2);
});

test('plain guidance says not to trade during news, in simple words', () => {
  const ctx = { eventRisk: { blocked: true, event: { currency: 'USD', title: 'CPI m/m' } } };
  const g = explainPlain({ decision: decide(snap, ctx), snapshot: snap, context: ctx, plan: null });
  assert.equal(g.action, 'NÃO OPERAR');
  assert.match(g.why.join(' '), /CPI m\/m/);
});

test('global risk sentiment reads equities and fear', () => {
  const on = riskSentiment([{ id: 'SPX', changePct: 1.2 }, { id: 'NDX', changePct: 1.5 }, { id: 'VIX', changePct: -8 }, { id: 'DXY', changePct: -0.3 }]);
  const off = riskSentiment([{ id: 'SPX', changePct: -1.8 }, { id: 'VIX', changePct: 15 }, { id: 'DXY', changePct: 0.6 }]);
  assert.ok(on.score > 0.15 && off.score < -0.15);
});

test('photo guidance explains divergence and unsupported assets', () => {
  const vision = normalizeVision({ decisao: 'COMPRAR', confianca: 70, explicacaoSimples: 'Parece querer subir.', entrada: '1.0850', stop: '1.0820', alvos: ['1.0910'] });
  const reading = { snapshot: snap, signal: { direction: -1, confidence: 70, regimeLabel: 'Tendência persistente', reasons: [] }, context: null, price: 110 };
  const diverge = mergeVerdict(vision, reading);
  assert.match(photoGuidance(diverge, vision, reading).why[0], /não concordam/);
  const fx = mergeVerdict(vision, null);
  const g = photoGuidance(fx, vision, null);
  assert.equal(g.action, 'COMPRAR');
  assert.ok(g.steps[1].includes('1.0820'));
});
