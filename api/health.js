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

const PROBE_DOWN = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAWgAAADcCAIAAADSq6xVAAAD1ElEQVR42u3dzWnDQBCA0VSRQnx2JSkshaUAwTZhdIxPwWAFI7y/Mw/eKQgfBP7YXY2cj32/AZzy4RYAwgEIByAcgHAAwgEgHIBwAMIBCAcgHADCAQgHIByAcADCASAcgHAAwgFMHY5SNoBTrDgAWxVAOADhAIQDEA4A4QCEAxAOQDgA4QAQDkA4AOEAhAMQjtv1enWzAOEAhAMQDmDVcPxcLs/cNRCOOuGwJAHhEA5AOIB5wtHzEESbIMhTFeEA4WgYjve/9i8/QVkgXTg6XAAIh3BA0HC8vODz++uZJzsQIRztytIzHMoCwmFJAsLxTzimerID7D1/Aazd2adwgHAMOKAFVg1Hu/QIB+QNxxLjrSAci1liLh6EI104jIrAnuT/qvScBBEOUoSjlC2P+7f68O+H4Xi84HDY5NQnQCS5/pPbEnPxYKsSZC8jHCAcpldBOFZYswgHwoGxd4SDmWZJQDiEw14G4UA4QDiEA4TD6SkIhyWJJQnCgXAgHAgHwoHZUxAO4QDh8NjFYxeEA0PrCAdOTxEOIh+CKAvCIRz1w6EsCEeWcPh9Q4QD4UA4EA6Eg5DhUBaEI93z2vcvEA6EQziEA+Gg3pdWOBAO4RAOhIOJp9q9L4Nw0HBJgnAgHMKBcNBslqTDQQzCQd5weNFOOBAO4RAOEA6Eg3nCUfFNPISDIOHo+QovwkGW57XCIRwwMhwOQUaGo5QNajn82j9ecBiOU5/w5x4ON3wUKw667mUqDqdacdiqkC4c7c5fEQ7ShcOSRDhgQDgsSYQDGi5JEA6EQziEA4RDOCBkONKevwoHwlF/GkU4INrYe8UuCAdkCUfPsggHZNnLeIVXOBAO4RAO6PhMxNi7cEC/cIRfkggHwjFySSIcEC0cpleFA/odQAgHMHIITThAOIQDaD+9KhzgGCXIkkQ4QDiEA0KEY/K9jHDA2ksS4QDhEA4g6CGIcEDwcLQoi3DAkuEY+6MhwgFLjpAJByAcQPu9zNjnMsIBwiEcIBzCAcIhHMB06REOQDgA4QCChKOUDQjsHo7qn2nFAdiqAMIBCAcgHIBwAAgHIByAcADCAQgHgHAAwgEIByAcgHAACAcgHIBwAMIBCAcgHO4CIByAcADCAQgHIBwAwgEIByAcgHAAwgEgHIBwAMIBCAcgHADCAQgH0C8cpWwAp1hxALYqgHAAwgEIByAcAMIBCAcgHIBwAMIBIByAcADCAQgHIBwAwgEIByAcgHAAwgEIh7sACAcgHIBwAMIBCAeAcADCAQgHIByAcAAIByAcgHAAwgEIB4BwAMIBdPMLqdgvpzOfjk0AAAAASUVORK5CYII=';
const PROBE_SIDEWAYS = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAWgAAADcCAIAAADSq6xVAAAD0UlEQVR42u3dy23rMBBAUVeRQrxWJSkshaUAAWwi8DJZBrADRT9yZnSAszScZ4q6pOTPuz0eXwCr3AwBIByAcADCAQgHIBwAwgEIByAcgHAAwgEgHIBwAMIBCAcgHADCAQgHIBxA6HC0NgOsYscBuFQBhAMQDkA4AOEAEA5AOADhAIQDEA4A4QCEAxAOQDgA4QAQDkA4AOEAhAMQDkA4jAIgHIBwAMIBCAcgHADCAQgHIByAcADCASAcgHAAwgEIByAcAMIBCAfQLxytzQCr2HEALlUA4QCEAxAOQDgAhAMQDkA4AOEAhANAOADhAIQDEA5AOACEAxAOQDgA4QCEAxAOowAIByAcgHAAwgEIB4BwAMIBCAcgHIBwZDNNkyMKwnFwOPY/AEgWjg5dUBYQDuHAxa9wnHbav328P/v9gM/7/ZnZk30+CMelw7H/tBeOjGu1HeglwrF5iBfP6lDhsEadPQ4Ot3Acs6FYfAYzqf9pf95anSscVXc9t9bmPn5e3rYHvDzMq57h5TxY9ScWn+H/LzOF/a9i8+FetP9g7X+GA+dDhAdscPqOo8P6EGHHUewmyMDtQI0Z1WHKjb0xJxyd/oT3pyqFI8JaJRyZwvEX4bhmODbPB+EIdJjPO4o1wtHhpmCxcGwmHOOXoGLhGPi2i3AIh3AIh3AIh3AIR4aPTkWYzcKRIBwRXl6NcETYkuT6KJ1wCEf9cBz4fu3Az1ym+AyucFQIR4R3vGuEo8OWJMJICod7HMLRdRyEQziEQziEQziEY+gQC8fh3zOOfD4Ih3AUDMd549BhrU5xPkTYw9YYqBy/x5F6OxDhiyQd1mrhiPO1IOGosB2oEY4a390SDuEQjjEDJRxxZpRwCIdw5PixjItcmRYPR67DLBzxPyhcbEYF/c1RA3TBcNR4s6DDlHNeJAhHjcMsHMIhHAhH5XDUWC+FgzR3kSN/w+Bq4RhCOCxBQf+R/k+8yIRDOIKuk8IhHLhJjHAgHAgHwgHCAQgHIByAcADCASAcgHAAwgEIByAcAMIBHBKO1maAVew4AJcqgHAAwgEIByAcAMIBCAcgHIBwAMIBIByAcADCAQgHIBwAwgEIByAcgHAAwgEIh1EAhAMQDkA4AOEAhANAOADhAIQDEA5AOACEAxAOQDgA4QCEA0A4AOEA+oWjtRlgFTsOwKUKIByAcADCAQgHgHAAwgEIByAcgHAACAcgHIBwAMIBCAeAcADCAQgHIByAcADCYRQA4QCEAxAOQDgA4QAQDkA4AOEAhAMQDgDhAIQDEA5AOADhABAOQDiAbr4BjooYCaATpPsAAAAASUVORK5CYII=';
const CHARTS = { up: PROBE_IMAGE, down: PROBE_DOWN, side: PROBE_SIDEWAYS };

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
    const image = CHARTS[req.query?.chart] || PROBE_IMAGE;
    body.compare = Object.fromEntries(await Promise.all(compare.map(async step => [`${step.provider}:${step.model}`, await check(async () => {
      if (!apiKey(PROVIDERS[step.provider].env)) throw new Error(`${PROVIDERS[step.provider].env} não configurada`);
      const text = task === 'chart'
        ? await runStep(step, CHART_PROMPT, image, { maxTokens: 1000 })
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
