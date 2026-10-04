import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SHARED_RULES, CHART_GATE, rulesBlock } from '../api/_lib/ai-rules.js';
import { isChartVisible } from '../api/_lib/quant/verdict.js';
import { judgePrompt } from '../api/_lib/council/judge.js';

const guide = readFileSync(new URL('../AI_BEHAVIOR.md', import.meta.url), 'utf8');

test('AI_BEHAVIOR.md lists every rule the code sends to the models', () => {
  for (const rule of [...SHARED_RULES, ...CHART_GATE]) assert.ok(guide.includes('- ' + rule), `missing in AI_BEHAVIOR.md: ${rule}`);
});

test('every AI prompt carries the shared rules, and vision prompts the chart check', () => {
  const sources = {
    analyze: readFileSync(new URL('../api/analyze.js', import.meta.url), 'utf8'),
    watch: readFileSync(new URL('../api/watch.js', import.meta.url), 'utf8'),
    mechanics: readFileSync(new URL('../api/mechanics-ai.js', import.meta.url), 'utf8')
  };
  assert.match(sources.analyze, /rulesBlock\(\{ chart: true \}\)/);
  assert.match(sources.watch, /rulesBlock\(\{ chart: true \}\)/);
  assert.match(sources.mechanics, /rulesBlock\(\)/);
  const prompt = judgePrompt({ symbol: 'BTCUSDT', interval: '1h', price: 1, analysts: [], consensus: { score: 0, agreement: 0, decision: 'AGUARDAR', vetoes: [] } });
  for (const rule of SHARED_RULES) assert.ok(prompt.includes(rule));
  for (const rule of CHART_GATE) assert.ok(rulesBlock({ chart: true }).includes(rule));
});

test('chart check: the model flag alone is not enough', () => {
  assert.equal(isChartVisible({ graficoVisivel: false, ativo: 'EUR/USD', tendencia: 'alta' }), false);
  assert.equal(isChartVisible({ graficoVisivel: true }), false);
  assert.equal(isChartVisible({ graficoVisivel: true, ativo: 'null', timeframe: '' }), false);
  assert.equal(isChartVisible({ graficoVisivel: true, precoAtual: null, tendencia: 'indefinida', ativo: 'BTC' }), false);
  assert.equal(isChartVisible({ graficoVisivel: true, ativo: 'BTC/USDT', tendencia: 'baixa' }), true);
  assert.equal(isChartVisible({ timeframe: 'M5', estrutura: 'topos mais baixos' }), true);
});
