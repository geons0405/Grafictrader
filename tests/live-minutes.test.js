import test from 'node:test';
import assert from 'node:assert/strict';

delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;
globalThis.fetch = async url => {
  if (String(url).includes('generativelanguage.googleapis.com')) {
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
});

test('only minutes with an analysis count, and the day resets at midnight UTC', async () => {
  try {
    for (let m = 0; m < 10; m++) {
      at(m * 3);
      assert.equal((await liveMinutes('ana', 10)).allowed, true);
      // Several frames in the same minute count once.
      assert.equal((await liveMinutes('ana', 10)).used, m + 1);
    }
    at(40);
    const over = await liveMinutes('ana', 10);
    assert.equal(over.allowed, false);
    assert.equal(over.left, 0);
    // Someone else still has their own minutes.
    assert.equal((await liveMinutes('rui', 10)).allowed, true);
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
