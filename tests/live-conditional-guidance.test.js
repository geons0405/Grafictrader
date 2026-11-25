import test from 'node:test';
import assert from 'node:assert/strict';
import { buildConditionalScenarios } from '../api/_lib/quant/explain.js';

const money = value => Number(value).toFixed(5);

test('WAIT guidance gives BUY and SELL only after breakout close and retest', () => {
  const scenarios = buildConditionalScenarios(
    { rangeHigh: 1.0948, rangeLow: 1.0936, regime: 'trend' },
    { eventRisk: { blocked: false } },
    { agreement: 'neutro' },
    money
  );
  assert.equal(scenarios.available, true);
  assert.match(scenarios.buy.condition, /1\.09480/);
  assert.match(scenarios.buy.condition, /reteste/);
  assert.match(scenarios.sell.condition, /1\.09360/);
  assert.match(scenarios.sell.condition, /reteste/);
  assert.match(scenarios.buy.invalidation, /abaixo/);
  assert.match(scenarios.sell.invalidation, /acima/);
  assert.match(scenarios.wait, /NÃO OPERAR/);
});

test('WAIT scenarios are suspended during event risk, chaotic volatility, or disagreement', () => {
  const base = { rangeHigh: 1.1, rangeLow: 1.0, regime: 'trend' };
  assert.equal(buildConditionalScenarios(base, { eventRisk: { blocked: true } }, {}).available, false);
  assert.equal(buildConditionalScenarios({ ...base, regime: 'chaotic' }, {}, {}).available, false);
  assert.equal(buildConditionalScenarios(base, {}, { agreement: 'diverge' }).available, false);
});

test('without verified levels, guidance never invents a numeric entry price', () => {
  const scenarios = buildConditionalScenarios(null, null, {});
  assert.equal(scenarios.available, false);
  assert.equal(scenarios.buy.trigger, undefined);
  assert.equal(scenarios.sell.trigger, undefined);
  assert.match(scenarios.wait, /NÃO OPERAR/);
});
