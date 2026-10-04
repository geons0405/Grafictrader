import { apiKey } from './_lib/env.js';
import { redis, redisConfigured } from './_lib/redis.js';
import { rateLimit, sendRateLimited } from './_lib/rate-limit.js';
import { clientIp } from './_lib/validate.js';
import { chatUnoRouter, listUnoRouterModels } from './_lib/vision.js';
import { getTwelveDataTicker } from './_lib/sources/twelvedata.js';
import { getMarketauxEvents } from './_lib/sources/marketaux.js';
import { getRssNews, getYahooNews } from './_lib/sources/news-feeds.js';

// Service status. Never returns key values: only whether each one is set and,
// with ?probe=1, whether a small real call to each service works.

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
  const [database, unorouter, unorouterModels, gemini, twelveData, marketaux, rss, yahoo] = await Promise.all([
    redisConfigured() ? check(async () => ({ reply: await redis(['PING']) })) : { ok: false, error: 'não configurada' },
    unoKey ? check(async () => {
      const { text, model } = await chatUnoRouter(unoKey, 'Responde só com a palavra OK.', { maxTokens: 5, temperature: 0 });
      return { model, reply: String(text).trim().slice(0, 20) };
    }) : { ok: false, error: 'não configurada' },
    unoKey ? check(async () => listUnoRouterModels(unoKey)) : { ok: false, error: 'não configurada' },
    geminiKey ? check(async () => {
      const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Responde só com a palavra OK.' }] }], generationConfig: { maxOutputTokens: 5 } })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error?.message || `HTTP ${response.status}`);
      return { model, reply: (data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim().slice(0, 20) };
    }) : { ok: false, error: 'não configurada' },
    apiKey('TWELVE_DATA_API_KEY') ? check(async () => {
      const quotes = (await getTwelveDataTicker(['EUR/USD'])).filter(Boolean);
      if (!quotes.length) throw new Error('Sem cotação: chave inválida ou limite atingido.');
      return { quotes: quotes.length };
    }) : { ok: false, error: 'não configurada' },
    apiKey('MARKETAUX_API_KEY') ? check(async () => ({ articles: (await getMarketauxEvents('BTCUSDT')).length })) : { ok: false, error: 'não configurada' },
    check(async () => ({ headlines: (await getRssNews('BTCUSDT')).length })),
    check(async () => ({ headlines: (await getYahooNews('BTCUSDT')).length }))
  ]);
  body.services = { database, unorouter, gemini, twelveData, marketaux, rss, yahoo };
  body.ok = Object.values(body.services).every(s => s.ok);
  body.unorouterModels = unorouterModels;
  return res.status(200).json(body);
}
