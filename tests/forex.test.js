import test from 'node:test';
import assert from 'node:assert/strict';
import { mapAsset } from '../api/_lib/quant/verdict.js';
import { toFourHours, isYahooMarket } from '../api/_lib/sources/yahoo.js';

test('real forex pairs and gold map to markets the engine can read; OTC and other quotes do not', () => {
  assert.equal(mapAsset('EUR/USD'), 'EURUSD');
  assert.equal(mapAsset('usdjpy'), 'USDJPY');
  assert.equal(mapAsset('GBP/JPY M5'), 'GBPJPY');
  assert.equal(mapAsset('XAU/USD'), 'XAUUSD');
  assert.equal(mapAsset('Ouro'), 'XAUUSD');
  assert.equal(mapAsset('EUR/USD OTC'), null, 'broker OTC price is synthetic');
  assert.equal(mapAsset('AUD/CAD'), null, 'a pair we do not read');
  assert.equal(mapAsset('BTC/EUR'), null);
  assert.equal(mapAsset('Bitcoin'), 'BTCUSDT');
  assert.ok(isYahooMarket('EURUSD') && isYahooMarket('XAUUSD') && !isYahooMarket('BTCUSDT'));
});

test('1-hour candles are grouped into 4-hour candles on UTC boundaries', () => {
  const base = Date.UTC(2026, 9, 20, 0, 0) / 1000;
  const hours = Array.from({ length: 8 }, (_, i) => ({ time: base + i * 3600, open: 10 + i, high: 11 + i, low: 9 + i, close: 10.5 + i, volume: 1 }));
  const four = toFourHours(hours);
  assert.equal(four.length, 2);
  assert.deepEqual(four[0], { time: base, open: 10, high: 14, low: 9, close: 13.5, volume: 4 });
  assert.equal(four[1].time, base + 14400);
});
