import { buildMechanicsSnapshot } from './_lib/mechanics/snapshot.js';
import { parseMarketQuery, clientIp } from './_lib/validate.js';
import { requireUserIfConfigured } from './_lib/auth.js';
import { rateLimit, sendRateLimited } from './_lib/rate-limit.js';
import { apiKey } from './_lib/env.js';

const SYSTEM_PROMPT = `És o motor de interpretação do Grafictrader.
Recebes métricas calculadas pelo código a partir de OHLCV, trades e/ou order book.
O código calcula; tu interpretas. Não recalcules indicadores comuns e não inventes dados ausentes.

Objetivo: explicar qual mecanismo parece dominar o mercado AGORA, usando apenas a evidência recebida.
Não identifiques um algoritmo, instituição ou trader específico. Podes dizer que um padrão é "compatível com" fragmentação, absorção ou pressão de execução.
Não trates o resultado como certeza nem como recomendação financeira.
Distingue claramente:
- OBSERVAÇÃO: o que os dados mostram;
- MECANISMO: a explicação estrutural mais compatível;
- CONFLITO: evidências que contradizem essa leitura;
- IMPLICAÇÃO: o que precisa ser confirmado no próximo fluxo;
- MEMÓRIA: descreve a evolução recente; usa-a para explicar transições, duração do estado e mudanças de mecanismo.
- PADRÃO RECORRENTE: se existir uma sequência repetida, trata-a apenas como recorrência histórica; não assumes que o desfecho será igual. Se houver bestSimilarity, explica-o como semelhança quantitativa entre assinaturas OHLCV das janelas, não como probabilidade ou previsão.
- FAMÍLIA DE PADRÃO: se existir patternFamily, trata-a como agrupamento de janelas mecanicamente semelhantes. A família pode conter sequências de estados diferentes; usa avgSimilarity/bestSimilarity apenas como medida de semelhança estrutural, nunca como probabilidade ou previsão.
- HISTÓRICO DA FAMÍLIA: se patternLibrary trouxer outcomes históricos, descreve-os como comportamento observado nas ocorrências já resolvidas. Mostra amostra/horizonte quando relevante; nunca transforma taxa histórica em probabilidade futura, sinal ou recomendação.
- LIMITAÇÃO: dados que faltam.

Responde em português de Angola, curto e técnico, neste formato:
MECANISMO: ...
OBSERVAÇÃO: ...
CONFLITO: ...
IMPLICAÇÃO: ...
LIMITAÇÃO: ...
CONFIANÇA: baixa/média/alta.`;

function extractText(data) {
  return data?.candidates?.flatMap(c => c?.content?.parts?.map(p => p?.text).filter(Boolean) || []).join('\n').trim() || '';
}

const CACHE_MS = 60_000;
const cache = new Map();

async function askGemini(payload, key) {
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: SYSTEM_PROMPT + '\n\nDADOS DO MERCADO:\n' + JSON.stringify(payload) }] }],
          generationConfig: { temperature: 0.15, maxOutputTokens: 700 }
        })
      }
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || 'Falha no Gemini.');
    const text = extractText(data);
    if (!text) throw new Error('Gemini não devolveu interpretação.');
    return text;
  } finally {
    clearTimeout(timer);
  }
}

function compactPayload(snapshot) {
  const { memory = {}, patternLibrary = {} } = snapshot;
  return {
    symbol: snapshot.symbol,
    interval: snapshot.interval,
    state: snapshot.state,
    metrics: snapshot.metrics,
    evidence: snapshot.evidence,
    dataQuality: snapshot.dataQuality,
    limitations: snapshot.limitations,
    memory: {
      available: memory.available,
      currentState: memory.currentState,
      previousState: memory.previousState,
      transition: memory.transition,
      durationBars: memory.durationBars,
      changeScore: memory.changeScore,
      transitions: memory.transitions,
      pattern: memory.pattern && {
        sequence: memory.pattern.sequence,
        occurrences: memory.pattern.occurrences,
        bestSimilarity: memory.pattern.bestSimilarity
      },
      patternFamily: memory.patternFamily && {
        label: memory.patternFamily.label,
        occurrences: memory.patternFamily.occurrences,
        avgSimilarity: memory.patternFamily.avgSimilarity,
        bestSimilarity: memory.patternFamily.bestSimilarity,
        familySignature: memory.patternFamily.familySignature
      }
    },
    patternLibrary: {
      available: patternLibrary.available,
      outcomeHorizonsBars: patternLibrary.outcomeHorizonsBars,
      patterns: (patternLibrary.patterns || []).slice(0, 5)
    }
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Método não permitido.' });
  res.setHeader('Cache-Control', 'no-store');

  const key = apiKey('GEMINI_API_KEY');
  if (!key) return res.status(503).json({ ok: false, error: 'GEMINI_API_KEY não configurada.', setupRequired: true });

  // The client only names the market; the metrics are recomputed here so the
  // prompt never carries client-controlled text.
  const market = parseMarketQuery(req.body || {});
  if (!market) return res.status(400).json({ ok: false, error: 'Parâmetros inválidos.' });

  const access = await requireUserIfConfigured(req, res);
  if (!access.ok) return;

  const cacheKey = market.symbol + ':' + market.interval;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_MS) return res.status(200).json(cached.body);

  const limit = await rateLimit('mechanics-ai', access.user?.email || clientIp(req), { limit: 20, windowSeconds: 600 });
  if (!limit.allowed) return sendRateLimited(res, limit);

  try {
    const snapshot = await buildMechanicsSnapshot(market.symbol, market.interval);
    const interpretation = await askGemini(compactPayload(snapshot), key);
    const body = {
      ok: true,
      provider: 'Gemini',
      symbol: market.symbol,
      interval: market.interval,
      state: snapshot.state,
      updatedAt: new Date().toISOString(),
      interpretation
    };
    cache.set(cacheKey, { at: Date.now(), body });
    return res.status(200).json(body);
  } catch (error) {
    console.error('[Mechanics AI]', error?.message || error);
    return res.status(502).json({ ok: false, error: 'A interpretação mecânica por IA está indisponível.' });
  }
}
