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
const { default: watch } = await import('../api/watch.js');

const image = 'data:image/jpeg;base64,' + 'A'.repeat(200);
function call(body) {
  return new Promise(resolve => {
    const res = {
      statusCode: 200,
      setHeader() {},
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, body: payload }); return this; }
    };
    watch({ method: 'POST', body, headers: {}, query: {} }, res);
  });
}

test('live frame of a forex chart returns a decision with informal guidance', async () => {
  visionReply = {
    graficoVisivel: true, ativo: 'EUR/USD', timeframe: 'M5', decisao: 'VENDER', confianca: 72,
    entrada: '1.0855', stop: '1.0870', alvos: ['1.0825'], motivos: ['Topo mais baixo'], riscos: [],
    explicacaoSimples: 'O euro está a perder força contra o dólar.', mudanca: 'Rompeu o suporte.'
  };
  const r = await call({ image, previous: { decision: 'AGUARDAR' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.verdict.decision, 'VENDER');
  assert.equal(r.body.guidance.action, 'VENDER');
  assert.match(r.body.guidance.why.join(' '), /euro/);
  assert.equal(r.body.change, 'Rompeu o suporte.');
});

test('a frame without a chart never produces a trade', async () => {
  visionReply = { graficoVisivel: false, decisao: 'COMPRAR', confianca: 90 };
  const r = await call({ image });
  assert.equal(r.body.chartVisible, false);
  assert.equal(r.body.verdict.decision, 'AGUARDAR');
  assert.match(r.body.guidance.headline, /Não vejo um gráfico/);
});

test('a model that claims a chart but reads nothing from it gives no trade', async () => {
  visionReply = { graficoVisivel: true, decisao: 'COMPRAR', confianca: 85, resumo: 'Um gato no sofá.', entrada: '100', stop: '90', alvos: ['120'] };
  const r = await call({ image, previous: { decision: 'COMPRAR' } });
  assert.equal(r.body.chartVisible, false);
  assert.equal(r.body.verdict.decision, 'AGUARDAR');
  assert.equal(r.body.verdict.confidence, 0);
  assert.equal(r.body.guidance.levels, null);
  assert.equal(r.body.live, null);
});

test('a reply without the chart flag and without chart details is not a chart', async () => {
  visionReply = { decisao: 'VENDER', confianca: 70 };
  const r = await call({ image });
  assert.equal(r.body.chartVisible, false);
  assert.equal(r.body.verdict.decision, 'AGUARDAR');
});

test('a blurry live frame is read but not traded on', async () => {
  visionReply = { graficoVisivel: true, ativo: 'EUR/USD', timeframe: 'M5', tendencia: 'baixa', decisao: 'VENDER', confianca: 80, qualidadeImagem: 'fraca' };
  const r = await call({ image });
  assert.equal(r.body.chartVisible, true);
  assert.equal(r.body.verdict.decision, 'AGUARDAR');
});

test('invalid images are rejected', async () => {
  const r = await call({ image: 'data:text/html;base64,AAAA' });
  assert.equal(r.status, 400);
});

test.after(() => { globalThis.fetch = realFetch; });
