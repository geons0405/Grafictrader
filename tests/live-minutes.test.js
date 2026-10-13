import test from 'node:test';
import assert from 'node:assert/strict';

delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;
let visionDown = false;
globalThis.fetch = async url => {
  if (String(url).includes('generativelanguage.googleapis.com')) {
    if (visionDown) return new Response(JSON.stringify({ error: { message: 'down' } }), { status: 500 });
    const reply = { graficoVisivel: true, ativo: 'EUR/USD', timeframe: 'M5', decisao: 'AGUARDAR', confianca: 50, explicacaoSimples: 'Espera.' };
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }] }), { status: 200 });
  }
  return new Response('offline', { status: 503 });
};
process.env.GEMINI_API_KEY = 'test';

const { liveMinutes, liveMinutesFor } = await import('../api/_lib/rate-limit.js');
const { default: watch } = await import('../api/watch.js');

const realNow = Date.now;
const at = minute => { Date.now = () => Date.UTC(2026, 9, 13, 12, 0) + minute * 60_000; };

test('the free plan gets 10 live minutes a day; paid plans have no minute limit', () => {
  assert.equal(liveMinutesFor(null), 10);
  assert.equal(liveMinutesFor({ plan: 'free' }), 10);
  assert.equal(liveMinutesFor({ plan: 'pro' }), 0);
  process.env.LIVE_MINUTES_FREE = '0';
  assert.equal(liveMinutesFor(null), 0, '0 turns the limit off');
  process.env.LIVE_MINUTES_FREE = '25';
  assert.equal(liveMinutesFor(null), 25);
  process.env.LIVE_MINUTES_PAID = '120';
  assert.equal(liveMinutesFor({ plan: 'pro' }), 120);
  delete process.env.LIVE_MINUTES_FREE;
  delete process.env.LIVE_MINUTES_PAID;
});

test('only minutes with an analysis count, and the day resets at midnight UTC', async () => {
  try {
    for (let m = 0; m < 10; m++) {
      at(m * 3);
      assert.equal((await liveMinutes('ana', 10)).allowed, true);
      assert.equal((await liveMinutes('ana', 10, { charge: true })).used, m + 1);
      // Several frames in the same minute count once.
      assert.equal((await liveMinutes('ana', 10, { charge: true })).used, m + 1);
    }
    at(40);
    const over = await liveMinutes('ana', 10);
    assert.equal(over.allowed, false);
    assert.equal(over.left, 0);
    // Someone else still has their own minutes.
    assert.equal((await liveMinutes('rui', 10)).allowed, true);
    // Only checking never uses a minute.
    for (let i = 0; i < 20; i++) await liveMinutes('rui', 10);
    assert.equal((await liveMinutes('rui', 10)).used, 0);
    at(24 * 60);
    assert.equal((await liveMinutes('ana', 10)).allowed, true, 'a new day');
  } finally {
    Date.now = realNow;
  }
});

test('the live endpoint stops after the free minutes, before any AI is spent, and says how many are left', async () => {
  const call = () => new Promise(resolve => {
    const res = {
      statusCode: 200,
      setHeader() {},
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, body: payload }); return this; }
    };
    watch({ method: 'POST', body: { image: 'data:image/jpeg;base64,' + 'A'.repeat(200) }, headers: { 'x-forwarded-for': '10.9.9.9' }, query: {} }, res);
  });
  try {
    let last;
    for (let m = 0; m < 10; m++) {
      at(2 * 24 * 60 + m);
      last = await call();
      assert.equal(last.status, 200);
    }
    assert.equal(last.body.minutesLeft, 0);
    at(2 * 24 * 60 + 11);
    const blocked = await call();
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.liveLimit, true);
    assert.match(blocked.body.error, /10 minutos/);
  } finally {
    Date.now = realNow;
  }
});

test('a failed analysis does not use a live minute', async () => {
  const call = () => new Promise(resolve => {
    const res = { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(payload) { resolve({ status: this.statusCode, body: payload }); return this; } };
    watch({ method: 'POST', body: { image: 'data:image/jpeg;base64,' + 'A'.repeat(200) }, headers: { 'x-forwarded-for': '10.7.7.7' }, query: {} }, res);
  });
  try {
    visionDown = true;
    for (let m = 0; m < 12; m++) {
      at(4 * 24 * 60 + m * 3);
      assert.equal((await call()).status, 502);
    }
    visionDown = false;
    at(4 * 24 * 60 + 50);
    const ok = await call();
    assert.equal(ok.status, 200);
    assert.equal(ok.body.minutesLeft, 9);
  } finally {
    visionDown = false;
    Date.now = realNow;
  }
});

test('an analysis that ends in the next minute is charged to the minute it was admitted in', async () => {
  const base = Date.UTC(2026, 9, 20, 12, 0);
  for (let m = 0; m < 9; m++) await liveMinutes('eva', 10, { charge: true, at: base + m * 60_000 });
  const admittedAt = base + 20 * 60_000 + 59_000;
  assert.equal((await liveMinutes('eva', 10, { at: admittedAt })).allowed, true);
  const charged = await liveMinutes('eva', 10, { charge: true, at: admittedAt });
  assert.equal(charged.used, 10);
  // A frame admitted in that same minute, finishing even later, is not charged again.
  assert.equal((await liveMinutes('eva', 10, { charge: true, at: admittedAt + 500 })).used, 10);
  assert.equal((await liveMinutes('eva', 10, { at: base + 22 * 60_000 })).allowed, false);
});
