import { apiKey } from './_lib/env.js';
import { redis, redisConfigured } from './_lib/redis.js';
import { rateLimit, sendRateLimited } from './_lib/rate-limit.js';
import { clientIp } from './_lib/validate.js';
import { PROVIDERS, chainFor, listModels, parseJson, parseStep, runStep, runVision, runText } from './_lib/vision.js';
import { getTwelveDataTicker } from './_lib/sources/twelvedata.js';
import { getMarketauxEvents } from './_lib/sources/marketaux.js';
import { getRssNews, getYahooNews } from './_lib/sources/news-feeds.js';

// Service status. Never returns key values: only whether each one is set and,
// with ?probe=1, whether a small real call to each service works.
//   ?models=groq            lists the models a provider exposes (q= filters)
//   ?compare=groq:model,... gives the same test chart to each model (accuracy + speed)

// 360x220 candlestick chart in a clear uptrend: checks that image analysis works and reads direction.
const PROBE_IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAWgAAADcCAIAAADSq6xVAAADoUlEQVR42u3dS0rDUBiA0a7ChXSclbgwF+YCAncT0qEdidBAe5v7/g+ckVSRQD7vK/Fyu/0AZLm4BIBwAMIBCAcgHIBwAAgHIByAcADCAQgHgHAAwgEIByAcgHAACAcgHIBwAEOHI6UdIIsRB2CqAggHIByAcADCASAcgHAAwgEIByAcAMIBCAcgHIBwAMIBIByAcADCAQgHIByAcLgKgHAAwgEIByAcgHAACAcgHIBwAMIBCAeAcADCAQgHIByAcAAIByAcQLtwpLQDZDHiAExVAOEAhAMQDkA4AIQDEA5AOADhAIQDQDggpm3bhAMQDkA4AOEApr/thQOE49UPfHx9PhIOEA7hAIQDOOPpbf99vT4SDhAO4QCEAxAOYLJwnF89FQ5YbdOk4HhBOCDKgEI4wICi4kxEOMDprBa3vXDAlAMK4QDhmGxPRDgg+hKGcIBwCAdMvrQ5wmaqcIA9EeEA4RAOEA7hEA54c4Wi74OnwgHCIRwQY69UOJ6HI6UdlnQPx+HXD2/7/x84DEfWT1ieEQfhZiLLnwc3VYHy4SjYBeEAx711QTgQjqiHLIQDz4n0XMJAOHBqUziEg6gTDQMK4cCAwoBCOLAV2vBQpnAIB8JhJiIcWKEQDuEAz48hHAgHwoHj3ggH8659CodwYEDRc0AhHMKBcCAcCIdwCAcIB8JBrS7YK0U4hMOAAuEIf9sLB8KBcCAcDBAO78hBOITDeXCEg6nCgXC4CotseXjVBcIhHD3DAcIhHMKBcCzq/JaHcCAcwuGJdYSDkfZKhQPhCBeOevu1IBxxwwHCIRwgHNY+veoC4cBxb4QD4QDhEA6oEY6Udv7cb9r3vvGwC1kfOP87QDNGHGX+2htQYKoiHGYiIBynxwtedQHCIRwgHPXD4TEQiBsOb/EF4eiwtFlvXwaEQzhAOFafiXjADJYNh0MWIBwjDiiEA4RDF0A4hAOEo9TpLOEA4XA6C4TDsU4QjqlPZwFzhMN/PAXhEA5AOICO4Xh7hUI4IFw4Wh6ysCcCk4VjhL1S4QDhKL+hC6wWDkA4hAOEo/7aJyAcFiBAOIQDEA5g3MVRQDgAhAMQDkA4AOEAhANAOADhAHqFI6UdIIsRB2CqAggHIByAcADCASAcgHAAwgEIByAcAMIBCAcgHIBwAMIBIByAcADCAQgHIByAcLgKgHAAwgEIByAcgHAACAcgHIBwAMIBCAeAcADCAQgHIByAcAAIByAcQDO/+8aIVKjLpFsAAAAASUVORK5CYII=';

const CHART_PROMPT = 'Este é um gráfico de velas. Responde APENAS com JSON: {"tendencia": "alta" | "baixa" | "lateral"}';
const REASONING_PROMPT = 'Um ativo tem tendência de alta forte (+2,1% hoje), mas há uma notícia de alto impacto daqui a 10 minutos e o volume está a cair. '
  + 'Responde APENAS com JSON: {"decisao": "COMPRAR" | "VENDER" | "AGUARDAR", "motivo": "uma frase"}';

const KEYS = ['UNOROUTER_API_KEY', 'GROQ_API_KEY', 'NVIDIA_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'TWELVE_DATA_API_KEY', 'MARKETAUX_API_KEY', 'FINNHUB_API_KEY'];

async function check(run) {
  const started = Date.now();
  try {
    const detail = await run();
    return { ok: true, ms: Date.now() - started, detail };
  } catch (error) {
    return { ok: false, ms: Date.now() - started, error: String(error?.message || error).slice(0, 220) };
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Método não permitido.' });
  res.setHeader('Cache-Control', 'no-store');

  const configured = Object.fromEntries(KEYS.map(name => [name, Boolean(apiKey(name))]));
  configured.KV_REST_API_URL = Boolean(process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL);
  configured.KV_REST_API_TOKEN = Boolean(process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN);
  const body = {
    ok: true,
    at: new Date().toISOString(),
    configured,
    chains: { vision: chainFor('vision').map(s => `${s.provider}:${s.model}`), judge: chainFor('judge').map(s => `${s.provider}:${s.model}`) }
  };
  const wantsWork = req.query?.probe === '1' || req.query?.models || req.query?.compare;
  if (!wantsWork) return res.status(200).json(body);

  // Real calls cost quota: a few per IP every 10 minutes.
  const limit = await rateLimit('health-probe', clientIp(req), { limit: 8, windowSeconds: 600 });
  if (!limit.allowed) return sendRateLimited(res, limit);

  if (req.query?.models) {
    const q = String(req.query.q || '').toLowerCase();
    body.models = await check(async () => (await listModels(String(req.query.models))).filter(id => !q || id.toLowerCase().includes(q)));
  }

  const compare = String(req.query?.compare || '').split(',').map(s => parseStep(s.trim())).filter(Boolean).slice(0, 8);
  if (compare.length) {
    const task = req.query?.task === 'reasoning' ? 'reasoning' : 'chart';
    body.compare = Object.fromEntries(await Promise.all(compare.map(async step => [`${step.provider}:${step.model}`, await check(async () => {
      if (!apiKey(PROVIDERS[step.provider].env)) throw new Error(`${PROVIDERS[step.provider].env} não configurada`);
      const text = task === 'chart'
        ? await runStep(step, CHART_PROMPT, PROBE_IMAGE, { maxTokens: 1000 })
        : await runStep(step, REASONING_PROMPT, null, { maxTokens: 1000 });
      return parseJson(text) || String(text).replace(/\s+/g, ' ').slice(0, 160);
    })])));
  }

  if (req.query?.probe === '1') {
    const [database, vision, judge, twelveData, marketaux, rss, yahoo, ...providerLists] = await Promise.all([
      redisConfigured() ? check(async () => ({ reply: await redis(['PING']) })) : { ok: false, error: 'não configurada' },
      check(async () => {
        const result = await runVision(PROBE_IMAGE, CHART_PROMPT, { maxOutputTokens: 1000 });
        return { provider: result.provider, answer: result.raw };
      }),
      check(async () => {
        const result = await runText(REASONING_PROMPT, { json: true, maxTokens: 1000 });
        return { provider: result.provider, answer: parseJson(result.text) };
      }),
      apiKey('TWELVE_DATA_API_KEY') ? check(async () => {
        const quotes = (await getTwelveDataTicker(['EUR/USD'])).filter(Boolean);
        if (!quotes.length) throw new Error('Sem cotação: chave inválida ou limite atingido.');
        return { quotes: quotes.length };
      }) : { ok: false, error: 'não configurada' },
      apiKey('MARKETAUX_API_KEY') ? check(async () => ({ articles: (await getMarketauxEvents('BTCUSDT')).length })) : { ok: false, error: 'não configurada' },
      check(async () => ({ headlines: (await getRssNews('BTCUSDT')).length })),
      check(async () => ({ headlines: (await getYahooNews('BTCUSDT')).length })),
      ...['unorouter', 'groq', 'nvidia'].map(p => apiKey(PROVIDERS[p].env)
        ? check(async () => ({ models: (await listModels(p)).length }))
        : Promise.resolve({ ok: false, error: 'não configurada' }))
    ]);
    const [unorouter, groq, nvidia] = providerLists;
    body.services = { database, vision, judge, unorouter, groq, nvidia, twelveData, marketaux, rss, yahoo };
    body.ok = Object.values(body.services).every(s => s.ok);
  }
  return res.status(200).json(body);
}
