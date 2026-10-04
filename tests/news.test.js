import test from 'node:test';
import assert from 'node:assert/strict';
import { headlineSentiment } from '../api/_lib/sources/headline-sentiment.js';
import { newsQueryFor, getRssNews } from '../api/_lib/sources/news-feeds.js';

test('headline sentiment reads market vocabulary', () => {
  assert.equal(headlineSentiment('Bitcoin surges to a record high as ETF inflows jump').sentiment, 'bullish');
  assert.equal(headlineSentiment('Crypto market crashes after exchange hack').sentiment, 'bearish');
  assert.equal(headlineSentiment('Central bank meets on Thursday').sentiment, 'neutral');
});

test('news query maps crypto, forex, metals and stocks', () => {
  assert.deepEqual(newsQueryFor('BTCUSDT'), { query: 'bitcoin', yahoo: 'BTC-USD', crypto: true });
  assert.equal(newsQueryFor('EURUSD').yahoo, 'EURUSD=X');
  assert.equal(newsQueryFor('XAUUSD').yahoo, 'GC=F');
  assert.equal(newsQueryFor('AAPL').yahoo, 'AAPL');
});

test('RSS headlines become dated, scored events and old items are dropped', async () => {
  const fresh = new Date().toUTCString();
  const old = new Date(Date.now() - 3 * 86400000).toUTCString();
  const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>
    <item><title>Bitcoin rallies to record high</title><link>https://example.com/a</link><pubDate>${fresh}</pubDate></item>
    <item><title>Old story</title><link>https://example.com/b</link><pubDate>${old}</pubDate></item>
  </channel></rss>`;
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(xml, { status: 200 });
  try {
    const events = await getRssNews('BTCUSDT');
    assert.ok(events.length >= 1);
    assert.ok(events.every(e => e.headline !== 'Old story'));
    const first = events.find(e => e.url === 'https://example.com/a');
    assert.equal(first.sentiment, 'bullish');
    assert.equal(first.symbol, 'BTCUSDT');
  } finally {
    globalThis.fetch = original;
  }
});

test('Marketaux filter uses the CC: prefix for crypto', async () => {
  const { marketauxFilter } = await import('../api/_lib/sources/marketaux.js');
  assert.deepEqual(marketauxFilter('ETHUSDT'), { symbols: 'CC:ETH', entity_types: 'cryptocurrency' });
  assert.deepEqual(marketauxFilter('AAPL'), { symbols: 'AAPL', entity_types: 'equity' });
});
