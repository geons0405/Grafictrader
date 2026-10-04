import { apiKey } from './_lib/env.js';
import { redis, redisConfigured } from './_lib/redis.js';
import { rateLimit, sendRateLimited } from './_lib/rate-limit.js';
import { clientIp } from './_lib/validate.js';
import { chatUnoRouter, listUnoRouterModels, runVision } from './_lib/vision.js';
import { getTwelveDataTicker } from './_lib/sources/twelvedata.js';
import { getMarketauxEvents } from './_lib/sources/marketaux.js';
import { getRssNews, getYahooNews } from './_lib/sources/news-feeds.js';

// Service status. Never returns key values: only whether each one is set and,
// with ?probe=1, whether a small real call to each service works.

// 360x220 candlestick chart in a clear uptrend: checks that image analysis works and reads direction.
const PROBE_IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAWgAAADcCAIAAADSq6xVAAADoUlEQVR42u3dS0rDUBiA0a7ChXSclbgwF+YCAncT0qEdidBAe5v7/g+ckVSRQD7vK/Fyu/0AZLm4BIBwAMIBCAcgHIBwAAgHIByAcADCAQgHgHAAwgEIByAcgHAACAcgHIBwAEOHI6UdIIsRB2CqAggHIByAcADCASAcgHAAwgEIByAcAMIBCAcgHIBwAMIBIByAcADCAQgHIByAcLgKgHAAwgEIByAcgHAACAcgHIBwAMIBCAeAcADCAQgHIByAcAAIByAcQLtwpLQDZDHiAExVAOEAhAMQDkA4AIQDEA5AOADhAIQDQDggpm3bhAMQDkA4AOEApr/thQOE49UPfHx9PhIOEA7hAIQDOOPpbf99vT4SDhAO4QCEAxAOYLJwnF89FQ5YbdOk4HhBOCDKgEI4wICi4kxEOMDprBa3vXDAlAMK4QDhmGxPRDgg+hKGcIBwCAdMvrQ5wmaqcIA9EeEA4RAOEA7hEA54c4Wi74OnwgHCIRwQY69UOJ6HI6UdlnQPx+HXD2/7/x84DEfWT1ieEQfhZiLLnwc3VYHy4SjYBeEAx711QTgQjqiHLIQDz4n0XMJAOHBqUziEg6gTDQMK4cCAwoBCOLAV2vBQpnAIB8JhJiIcWKEQDuEAz48hHAgHwoHj3ggH8659CodwYEDRc0AhHMKBcCAcCIdwCAcIB8JBrS7YK0U4hMOAAuEIf9sLB8KBcCAcDBAO78hBOITDeXCEg6nCgXC4CotseXjVBcIhHD3DAcIhHMKBcCzq/JaHcCAcwuGJdYSDkfZKhQPhCBeOevu1IBxxwwHCIRwgHNY+veoC4cBxb4QD4QDhEA6oEY6Udv7cb9r3vvGwC1kfOP87QDNGHGX+2htQYKoiHGYiIBynxwtedQHCIRwgHPXD4TEQiBsOb/EF4eiwtFlvXwaEQzhAOFafiXjADJYNh0MWIBwjDiiEA4RDF0A4hAOEo9TpLOEA4XA6C4TDsU4QjqlPZwFzhMN/PAXhEA5AOICO4Xh7hUI4IFw4Wh6ysCcCk4VjhL1S4QDhKL+hC6wWDkA4hAOEo/7aJyAcFiBAOIQDEA5g3MVRQDgAhAMQDkA4AOEAhANAOADhAHqFI6UdIIsRB2CqAggHIByAcADCASAcgHAAwgEIByAcAMIBCAcgHIBwAMIBIByAcADCAQgHIByAcLgKgHAAwgEIByAcgHAACAcgHIBwAMIBCAeAcADCAQgHIByAcAAIByAcQDO/+8aIVKjLpFsAAAAASUVORK5CYII=';

const KEYS = ['UNOROUTER_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'TWELVE_DATA_API_KEY', 'MARKETAUX_API_KEY', 'FINNHUB_API_KEY'];

async function check(run) {
  const started = Date.now();
  try {
    const detail = await run();
    return { ok: true, ms: Date.now() - started, detail };
  } catch (error) {
    return { ok: false, ms: Date.now() - started, error: String(error?.message || error).slice(0, 200) };
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Método não permitido.' });
  res.setHeader('Cache-Control', 'no-store');

  const configured = Object.fromEntries(KEYS.map(name => [name, Boolean(apiKey(name))]));
  configured.KV_REST_API_URL = Boolean(process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL);
  configured.KV_REST_API_TOKEN = Boolean(process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN);

  const body = { ok: true, at: new Date().toISOString(), configured };
  if (req.query?.probe !== '1') return res.status(200).json(body);

  // Real calls cost quota: a few per IP every 10 minutes.
  const limit = await rateLimit('health-probe', clientIp(req), { limit: 5, windowSeconds: 600 });
  if (!limit.allowed) return sendRateLimited(res, limit);

  const unoKey = apiKey('UNOROUTER_API_KEY');
  const geminiKey = apiKey('GEMINI_API_KEY');
  const [database, unorouter, unorouterModels, gemini, vision, twelveData, marketaux, rss, yahoo] = await Promise.all([
    redisConfigured() ? check(async () => ({ reply: await redis(['PING']) })) : { ok: false, error: 'não configurada' },
    unoKey ? check(async () => {
      const { text, model } = await chatUnoRouter(unoKey, 'Responde só com a palavra OK.', { maxTokens: 200, temperature: 0 });
      return { model, reply: String(text).trim().slice(0, 20) };
    }) : { ok: false, error: 'não configurada' },
    unoKey ? check(async () => {
      const list = await listUnoRouterModels(unoKey);
      return { total: list.total, free: list.free.length };
    }) : { ok: false, error: 'não configurada' },
    geminiKey ? check(async () => {
      const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Responde só com a palavra OK.' }] }], generationConfig: { maxOutputTokens: 200 } })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error?.message || `HTTP ${response.status}`);
      return { model, reply: (data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim().slice(0, 20) };
    }) : { ok: false, error: 'não configurada' },
    check(async () => {
      const result = await runVision(PROBE_IMAGE, 'Este é um gráfico de velas. Responde APENAS com JSON: {"tendencia": "alta" | "baixa" | "lateral"}', { maxOutputTokens: 1000 });
      return { provider: result.provider, answer: result.raw };
    }),
    apiKey('TWELVE_DATA_API_KEY') ? check(async () => {
      const quotes = (await getTwelveDataTicker(['EUR/USD'])).filter(Boolean);
      if (!quotes.length) throw new Error('Sem cotação: chave inválida ou limite atingido.');
      return { quotes: quotes.length };
    }) : { ok: false, error: 'não configurada' },
    apiKey('MARKETAUX_API_KEY') ? check(async () => ({ articles: (await getMarketauxEvents('BTCUSDT')).length })) : { ok: false, error: 'não configurada' },
    check(async () => ({ headlines: (await getRssNews('BTCUSDT')).length })),
    check(async () => ({ headlines: (await getYahooNews('BTCUSDT')).length }))
  ]);
  body.services = { database, vision, unorouter, gemini, twelveData, marketaux, rss, yahoo };
  body.ok = Object.values(body.services).every(s => s.ok);
  body.unorouterModels = unorouterModels;
  return res.status(200).json(body);
}
