import test from 'node:test';
import assert from 'node:assert/strict';

let visionReply = {};
const realFetch = globalThis.fetch;
globalThis.fetch = async url => {
  if (String(url).includes('generativelanguage.googleapis.com')) {
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(visionReply) }] } }] }), { status: 200 });
  }
  return new Response('offline', { status: 503 });
};
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;
process.env.GEMINI_API_KEY = 'test';
const { default: analyze } = await import('../api/analyze.js');

const image = 'data:image/jpeg;base64,' + 'A'.repeat(200);
function call(body) {
  return new Promise(resolve => {
    const res = {
      statusCode: 200,
      setHeader() {},
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, body: payload }); return this; }
    };
    analyze({ method: 'POST', body, headers: {}, query: {} }, res);
  });
}

test('FOTO of something that is not a chart never gives a trade', async () => {
  visionReply = { graficoVisivel: false, decisao: 'COMPRAR', confianca: 95, ativo: 'BTC/USDT', resumo: 'Uma fatura de supermercado.' };
  const r = await call({ image });
  assert.equal(r.status, 200);
  assert.equal(r.body.chartVisible, false);
  assert.equal(r.body.verdict.decision, 'AGUARDAR');
  assert.equal(r.body.verdict.confidence, 0);
  assert.equal(r.body.vision.asset, null);
  assert.equal(r.body.live, null);
  assert.match(r.body.guidance.why.join(' '), /fatura/);
});

test('FOTO where the model reads no chart detail is treated as no chart', async () => {
  visionReply = { graficoVisivel: true, decisao: 'VENDER', confianca: 80, resumo: 'Uma paisagem.' };
  const r = await call({ image });
  assert.equal(r.body.chartVisible, false);
  assert.equal(r.body.verdict.decision, 'AGUARDAR');
});

test('a blurry chart is read but not traded on', async () => {
  visionReply = { graficoVisivel: true, ativo: 'EUR/USD', timeframe: 'M15', tendencia: 'alta', decisao: 'COMPRAR', confianca: 80, qualidadeImagem: 'fraca' };
  const r = await call({ image });
  assert.equal(r.body.chartVisible, true);
  assert.equal(r.body.verdict.decision, 'AGUARDAR');
});

test('a clear chart still gets a reading', async () => {
  visionReply = { graficoVisivel: true, ativo: 'EUR/USD', timeframe: 'M15', tendencia: 'alta', precoAtual: 1.085, decisao: 'COMPRAR', confianca: 75, entrada: '1.0850', stop: '1.0830', alvos: ['1.0890'], qualidadeImagem: 'boa' };
  const r = await call({ image });
  assert.equal(r.body.chartVisible, true);
  assert.equal(r.body.verdict.decision, 'COMPRAR');
});

test.after(() => { globalThis.fetch = realFetch; });
