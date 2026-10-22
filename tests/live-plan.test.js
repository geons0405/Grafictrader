import test from 'node:test';
import assert from 'node:assert/strict';
import { trendState, manageOpen, pullbackAdvice } from '../api/_lib/quant/live-plan.js';
import { photoGuidance, moneyFor } from '../api/_lib/quant/explain.js';
import { normalizeVision } from '../api/_lib/quant/verdict.js';
import { tradeCost } from '../api/_lib/quant/instructor.js';

// EUR/USD M1 like the user's screen: a steady fall, a pause, then one big red candle.
function fallingThenSpike() {
  const rows = [];
  let p = 1.1250;
  for (let i = 0; i < 120; i++) {
    const o = p;
    p -= 0.000012 + (i % 5 === 0 ? -0.00002 : 0.000006);
    rows.push({ time: 60 * i, open: o, high: Math.max(o, p) + 0.00002, low: Math.min(o, p) - 0.00002, close: p, volume: 1 });
  }
  const o = p;
  p -= 0.0009;
  rows.push({ time: 60 * 120, open: o, high: o + 0.00002, low: p - 0.00003, close: p, volume: 1 });
  return rows;
}

const money = moneyFor('EURUSD');

test('a clear downtrend after a big drop is "stretched": wait for a pullback, with zone and stop', () => {
  const state = trendState(fallingThenSpike());
  assert.equal(state.trend, -1);
  assert.equal(state.stretched, true);
  assert.ok(state.zone > state.price && state.stop > state.zone, 'sell zone above price, stop above zone');
  const advice = pullbackAdvice(state, money);
  assert.match(advice.text, /O preço vem a cair.*volte a subir um pouco, até perto de 1\.12\d{3}, e aí vende\. Põe o stop \(onde sais se correr mal\) acima de 1\.12\d{3}/);
  assert.doesNotMatch(advice.text, /\$/);
});

test('an open sell gets a stop above the last top, then break-even, and "close" when the market turns', () => {
  const state = trendState(fallingThenSpike());
  const hold = manageOpen({ side: -1, price: state.price + 0.0001 }, state, 0, money);
  assert.equal(hold.action, 'manter');
  assert.ok(hold.stop > state.price);
  assert.match(hold.text, /VENDA a 1\.12\d{3}: põe o stop em 1\.12\d{3} \(logo acima do ponto mais alto recente\)/);

  const winning = manageOpen({ side: -1, price: state.price + 0.0005 }, state, 0, money);
  assert.equal(winning.action, 'proteger');
  assert.match(winning.text, /Muda o stop para 1\.12\d{3}, o preço a que entraste/);

  const turned = manageOpen({ side: 1, price: state.price + 0.0005 }, state, 0, money);
  assert.equal(turned.action, 'fechar', 'a buy against a downtrend');
  assert.match(turned.text, /virou contra ti.*O mais seguro é fechar já/);
  assert.equal(manageOpen({ side: -1, price: null }, state, 1, money).action, 'fechar', 'the reading now says buy');
});

test('the live guidance explains the wait and manages the open trade', () => {
  const candles = fallingThenSpike();
  const state = trendState(candles);
  const vision = normalizeVision({ decisao: 'VENDER', confianca: 40, posicaoAberta: { lado: 'VENDA', preco: state.price + 0.0002 } });
  assert.equal(vision.position.side, -1);
  const reading = { symbol: 'EURUSD', price: state.price, snapshot: { regime: 'trend', atr: state.atr }, signal: { direction: 0, reasons: [] }, context: {}, patterns: [], trendState: state };
  const verdict = { direction: 0, decision: 'AGUARDAR', agreement: 'neutro', reasons: ['Confiança final abaixo de 50%.'] };
  const g = photoGuidance(verdict, vision, reading);
  assert.match(g.now, /volte a subir um pouco/);
  assert.ok(g.wait.zone && g.wait.stop);
  assert.equal(g.manage.action, 'manter');
  assert.match(g.manage.stop, /^1\.12\d{3}$/);
});

test('without live candles the model\'s own advice for the open trade is shown', () => {
  const vision = normalizeVision({ decisao: 'AGUARDAR', posicaoAberta: { lado: 'call' }, gestaoPosicao: 'Fecha se a vela fechar abaixo de 1.0850.', esperarPor: 'rompimento de 1.0870' });
  const g = photoGuidance({ direction: 0, reasons: [], headline: 'x' }, vision, null);
  assert.match(g.manage.text, /Tens uma COMPRA\. Fecha se a vela fechar abaixo de 1\.0850\./);
  assert.match(g.now, /Espera: rompimento de 1\.0870/);
  assert.equal(normalizeVision({ posicaoAberta: null, esperarPor: 'null' }).position, null);
});

test('forex pays about one pip of spread in the demo robot, crypto its exchange fees', () => {
  assert.equal(tradeCost('EURUSD'), 0.00012);
  assert.equal(tradeCost('EURGBP'), 0.0002);
  assert.equal(tradeCost('BTCUSDT'), 0.0008);
});

test('a trade already at its target is told to take the profit', () => {
  const state = trendState(fallingThenSpike());
  const done = manageOpen({ side: -1, price: state.price + 0.004 }, state, 0, money);
  assert.equal(done.action, 'fechar');
  assert.match(done.text, /já chegou ao alvo/);
});

test('no pullback entry is offered when the market says stay out; a stretched signal enters at the zone', () => {
  const state = trendState(fallingThenSpike());
  const vision = normalizeVision({ decisao: 'VENDER', confianca: 70 });
  const reading = { symbol: 'EURUSD', price: state.price, snapshot: { regime: 'trend', atr: state.atr }, signal: { direction: -1, reasons: [] }, context: {}, patterns: [], trendState: state };
  const diverge = photoGuidance({ direction: 0, agreement: 'diverge', reasons: [] }, vision, reading);
  assert.doesNotMatch(diverge.now, /volte a subir/);
  assert.equal(diverge.wait, undefined);

  const sell = photoGuidance({ direction: -1, agreement: 'confirma', reasons: [] }, vision, reading);
  assert.equal(sell.levels.entry, money(state.zone), 'entry at the pullback zone, not the current price');
  assert.match(sell.steps[0], new RegExp(money(state.zone).replace('.', '\\.')));
});

test('a big candle on the wrong side of the average is not "stretched"', () => {
  const rows = fallingThenSpike();
  // Upside version: mirror the prices around 2.25 so the market rises, then ends with a big up candle below its average.
  const up = rows.map(c => ({ ...c, open: 2.25 - c.open, close: 2.25 - c.close, high: 2.25 - c.low, low: 2.25 - c.high }));
  const last = up.at(-1);
  const state0 = trendState(up.slice(0, -1));
  // A strong up candle that still closes just under the 20 average (and above the 50).
  const close = state0.ema20 - 0.00008;
  up[up.length - 1] = { ...last, open: close - 0.0004, close, high: close + 0.00002, low: close - 0.00042 };
  const state = trendState(up);
  assert.equal(state.trend, 1);
  assert.equal(state.stretched, false);
});
