import test from 'node:test';
import assert from 'node:assert/strict';
import { toCcxtMarket } from '../api/_lib/sources/ccxt.js';

test('Binance symbols map to the unified market name other exchanges use', () => {
  assert.equal(toCcxtMarket('BTCUSDT'), 'BTC/USDT');
  assert.equal(toCcxtMarket('dogeusdt'), 'DOGE/USDT');
  assert.equal(toCcxtMarket('ETHUSDC'), 'ETH/USDC');
  assert.equal(toCcxtMarket('EURUSD=X'), null);
  assert.equal(toCcxtMarket(''), null);
});
