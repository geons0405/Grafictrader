import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.fetch = async (url, init = {}) => {
  if (String(url).startsWith('http://kv.test')) {
    const [cmd, key, value, ...opts] = JSON.parse(init.body);
    let result = null;
    if (cmd === 'GET') result = store.get(key) ?? null;
    else if (cmd === 'SET') {
      if (opts.includes('NX') && store.has(key)) result = null;
      else { store.set(key, value); result = 'OK'; }
    } else if (cmd === 'DEL') result = store.delete(key) ? 1 : 0;
    else if (cmd === 'INCR') { const v = Number(store.get(key) || 0) + 1; store.set(key, String(v)); result = v; }
    else if (cmd === 'EXPIRE') result = 1;
    return new Response(JSON.stringify({ result }), { status: 200 });
  }
  return new Response('offline', { status: 503 });
};
process.env.KV_REST_API_URL = 'http://kv.test';
process.env.KV_REST_API_TOKEN = 'x';

const { vapidKeys, validSubscription, subscribe, unsubscribe, subscribeApp, unsubscribeApp, alertsFeed, readPrefs, runAlerts, alertMessage } = await import('../api/_lib/push.js');

const device = n => ({ endpoint: `https://push.example/${n}`, keys: { p256dh: 'p'.repeat(80), auth: 'a'.repeat(20) } });

test('the server makes its own push keys once and keeps them', async () => {
  const first = await vapidKeys();
  assert.ok(first.publicKey && first.privateKey);
  assert.deepEqual(await vapidKeys(), first);
});

test('subscriptions are checked and markets limited to the ones we read', async () => {
  assert.equal(validSubscription(device(1)), true);
  assert.equal(validSubscription({ endpoint: 'http://insecure', keys: { p256dh: 'x', auth: 'y' } }), false);
  const prefs = await subscribe('ana@push.test', { subscription: device(1), markets: ['BTCUSDT', 'EURUSD', 'FAKE'], interval: '15m' });
  assert.deepEqual(prefs.markets, ['BTCUSDT', 'EURUSD']);
  assert.equal(prefs.interval, '15m');
  await subscribe('ana@push.test', { subscription: device(2), markets: ['BTCUSDT'], interval: '15m' });
  assert.equal((await readPrefs('ana@push.test')).devices.length, 2);
  await unsubscribe('ana@push.test', device(2).endpoint);
  assert.equal((await readPrefs('ana@push.test')).devices.length, 1);
});

test('an opportunity is sent once to the people who follow that market, then not again', async () => {
  await subscribe('rui@push.test', { subscription: device(3), markets: ['ETHUSDT'], interval: '15m' });
  const sent = [];
  const reading = { signal: { direction: 1, confidence: 72 }, snapshot: { time: 1000 } };
  const read = async symbol => (symbol === 'BTCUSDT' ? reading : { signal: { direction: 0, confidence: 0 }, snapshot: { time: 1000 } });
  const send = async (sub, body) => sent.push([sub.endpoint, JSON.parse(body)]);

  const first = await runAlerts({ now: 1, read, send });
  assert.equal(first.sent, 1);
  assert.equal(sent[0][0], device(1).endpoint, 'only Ana follows BTC');
  assert.equal(sent[0][1].title, 'Boa oportunidade de compra');
  assert.match(sent[0][1].body, /BTC\/USDT · 15 min/);

  store.delete('grafictrader:alerts:lock');
  const again = await runAlerts({ now: 2, read, send });
  assert.equal(again.sent, 0, 'same candle: no second alert');

  const busy = await runAlerts({ now: 3, read, send });
  assert.equal(busy.skipped, true, 'a round just ran');
});

test('weak signals get no alert; dropped devices are forgotten', async () => {
  store.delete('grafictrader:alerts:lock');
  const sent = [];
  const weak = await runAlerts({ now: 4, read: async () => ({ signal: { direction: -1, confidence: 50 }, snapshot: { time: 2000 } }), send: async (s, b) => sent.push(b) });
  assert.equal(weak.sent, 0);

  store.delete('grafictrader:alerts:lock');
  const gone = Object.assign(new Error('gone'), { statusCode: 410 });
  const result = await runAlerts({ now: 5, read: async () => ({ signal: { direction: -1, confidence: 80 }, snapshot: { time: 3000 } }), send: async () => { throw gone; } });
  assert.ok(result.removed >= 1);
  assert.equal((await readPrefs('ana@push.test')).devices.length, 0);
  assert.match(alertMessage('XAUUSD', '1h', -1, 70).body, /Ouro \(XAU\/USD\) · 1 hora: .*venda \(70%\)/);
});

test('an account on pause gets no alerts', async () => {
  const { startPause } = await import('../api/_lib/auth.js');
  await subscribe('eva@push.test', { subscription: device(9), markets: ['SOLUSDT'], interval: '1h' });
  await startPause('eva@push.test', 1);
  store.delete('grafictrader:alerts:lock');
  const sent = [];
  await runAlerts({ now: 6, read: async () => ({ signal: { direction: 1, confidence: 90 }, snapshot: { time: 4000 } }), send: async sub => sent.push(sub.endpoint) });
  assert.ok(!sent.includes(device(9).endpoint));
});

test('the Android app collects the alerts for its markets, without a browser subscription', async () => {
  const prefs = await subscribeApp('leo@push.test', { markets: ['XAUUSD', 'EURUSD'], interval: '4h' });
  assert.deepEqual(prefs.markets, ['XAUUSD', 'EURUSD']);
  assert.equal((await readPrefs('leo@push.test')).app, true);
  store.delete('grafictrader:alerts:lock');
  const sent = [];
  const read = async symbol => (symbol === 'XAUUSD' ? { signal: { direction: -1, confidence: 77 }, snapshot: { time: 5000 } } : { signal: { direction: 0 }, snapshot: { time: 5000 } });
  await runAlerts({ now: 7000, read, send: async sub => sent.push(sub.endpoint) });
  assert.equal(sent.length, 0, 'no browser to push to');

  const feed = await alertsFeed('leo@push.test', 0);
  assert.equal(feed.length, 1);
  assert.equal(feed[0].title, 'Boa oportunidade de venda');
  assert.match(feed[0].body, /Ouro \(XAU\/USD\) · 4 horas/);
  assert.equal((await alertsFeed('leo@push.test', 7000)).length, 0, 'nothing newer than the last look');
  assert.equal((await alertsFeed('rui@push.test', 0)).length, 0, 'browser-only accounts have no app feed');

  await unsubscribeApp('leo@push.test');
  assert.equal((await alertsFeed('leo@push.test', 0)).length, 0);
  assert.equal(store.has('grafictrader:push:leo@push.test'), false, 'nothing left to keep');
});
