import { requireUserIfConfigured } from './_lib/auth.js';
import { rateLimit, sendRateLimited, aiQuota, liveMinutes, liveMinutesFor } from './_lib/rate-limit.js';
import { clientIp, crossSite } from './_lib/validate.js';
import { MAX_IMAGE_CHARS, IMAGE_PATTERN, runVision } from './_lib/vision.js';
import { marketReading } from './_lib/quant/service.js';
import { mapAsset, mapTimeframe, normalizeVision, mergeVerdict, isChartVisible, noChartVision, noChartVerdict, noChartGuidance, guardImageQuality } from './_lib/quant/verdict.js';
import { rulesBlock } from './_lib/ai-rules.js';
import { recordSignal } from './_lib/signals.js';
import { photoGuidance } from './_lib/quant/explain.js';

// Live analysis of the user's broker: the app sends one frame of the shared
// screen (or camera) every few seconds, only when the chart changed.

const WATCH_PROMPT = `És um analista técnico a acompanhar AO VIVO o ecrã da corretora de um utilizador.
Esta imagem é um frame de uma sessão contínua. Lê só o que é visível: o ativo, o timeframe, o preço atual, as últimas velas, a estrutura (topos e fundos), suportes e resistências, padrões e indicadores visíveis.
Foca-te no que está a acontecer AGORA, nas velas mais recentes à direita.
Decide a orientação para a próxima fase:
- "COMPRAR" se a estrutura e o momentum favorecem subida;
- "VENDER" se favorecem descida;
- "AGUARDAR" se está lateral, confuso, sem confirmação, ou se não há um gráfico visível.
O ecrã de uma corretora (Pocket Option, Quotex, IQ Option, MetaTrader…) tem o gráfico rodeado de saldo, botões, menus e foto de perfil: isso é um gráfico visível.
Só indica graficoVisivel false se não houver velas, barras nem linha de preço (outra app, menu sem gráfico, ecrã preto, imagem tão tremida que não se vêem as velas).
${rulesBlock({ chart: true })}
{CONTINUITY}
Responde em português de Angola.
Responde APENAS com JSON válido:
{
  "graficoVisivel": true | false,
  "ativo": "ex.: EUR/USD ou null",
  "timeframe": "ex.: M5, 15m ou null",
  "precoAtual": número ou null,
  "tendencia": "alta" | "baixa" | "lateral" | "indefinida",
  "decisao": "COMPRAR" | "VENDER" | "AGUARDAR",
  "confianca": 0-100,
  "entrada": "zona ou condição de entrada",
  "stop": "nível de stop loss",
  "alvos": ["take profit"],
  "estrutura": "descrição curta",
  "padroes": ["padrões visíveis"],
  "indicadores": "o que os indicadores visíveis mostram",
  "motivos": ["até 3 motivos objetivos"],
  "riscos": ["até 2 riscos"],
  "mudanca": "o que mudou desde a leitura anterior, numa frase",
  "resumo": "uma frase",
  "explicacaoSimples": "2 a 4 frases informais para quem nunca operou: o que fazer agora e porquê",
  "qualidadeImagem": "boa" | "média" | "fraca"
}`;

// Engine readings are shared between frames of the same market for a few seconds.
const READING_TTL_MS = 20_000;
const readings = new Map();

async function cachedReading(symbol, interval) {
  const key = symbol + ':' + interval;
  const hit = readings.get(key);
  if (hit && Date.now() - hit.at < READING_TTL_MS) return hit.promise;
  const promise = marketReading(symbol, interval, { withContext: false });
  readings.set(key, { at: Date.now(), promise });
  promise.catch(() => readings.delete(key));
  return promise;
}

function continuity(previous) {
  if (!previous?.decision) return '';
  const parts = [`Leitura anterior desta sessão: ${String(previous.decision).slice(0, 12)}`];
  if (previous.asset) parts.push(`ativo ${String(previous.asset).slice(0, 20)}`);
  if (previous.timeframe) parts.push(`timeframe ${String(previous.timeframe).slice(0, 8)}`);
  return parts.join(', ') + '. Só muda a decisão se o gráfico mostrar uma razão clara.';
}

/** "BTCUSDT|5m" from whatever spelling the model used; null when the asset or timeframe is missing. */
export function marketKey(vision) {
  const asset = mapAsset(vision.asset) || String(vision.asset || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const timeframe = mapTimeframe(vision.timeframe) || String(vision.timeframe || '').toLowerCase().replace(/\s+/g, '');
  return asset && timeframe ? asset + '|' + timeframe : null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Método não permitido.' });
  if (crossSite(req)) return res.status(403).json({ ok: false, error: 'Pedido recusado.' });
  res.setHeader('Cache-Control', 'no-store');

  const { image, previous } = req.body || {};
  if (typeof image !== 'string' || image.length > MAX_IMAGE_CHARS) {
    return res.status(413).json({ ok: false, error: 'Imagem demasiado grande ou inválida.' });
  }
  if (!IMAGE_PATTERN.test(image)) return res.status(400).json({ ok: false, error: 'Imagem inválida.' });

  const access = await requireUserIfConfigured(req, res);
  if (!access.ok) return;

  // Daily minutes of live analysis for the plan (free: 10): checked before any AI is spent.
  const who = access.user?.email || clientIp(req);
  let live;
  try {
    live = await liveMinutes(who, liveMinutesFor(access.user));
  } catch {
    return res.status(503).json({ ok: false, error: 'Serviço indisponível. Tenta de novo dentro de instantes.' });
  }
  if (!live.allowed) {
    res.setHeader('Retry-After', String(live.retryAfter));
    return res.status(429).json({
      ok: false,
      liveLimit: true,
      minutesLeft: 0,
      error: `Usaste os ${liveMinutesFor(access.user)} minutos de análise ao vivo de hoje (plano gratuito). Voltam amanhã; até lá podes usar o FOTO.`
    });
  }

  // About one analysis every 10 s on average per user.
  const limit = await rateLimit('watch', who, { limit: 60, windowSeconds: 600, failClosed: true });
  if (!limit.allowed) return sendRateLimited(res, limit);
  const quota = await aiQuota(who);
  if (!quota.allowed) return sendRateLimited(res, quota);

  let vision;
  try {
    vision = await runVision(image, WATCH_PROMPT.replace('{CONTINUITY}', continuity(previous)), { maxOutputTokens: 1000 });
  } catch (error) {
    return res.status(error.status || 502).json({ ok: false, setupRequired: Boolean(error.setupRequired), error: error.message });
  }
  // Only a minute with an answer counts towards the daily live minutes.
  try {
    live = await liveMinutes(who, liveMinutesFor(access.user), { charge: true });
  } catch { /* the answer is ready: give it, the minute is just not counted */ }

  const chartVisible = isChartVisible(vision.raw);
  if (!chartVisible) {
    // Only the model and its flag: what the model saw may be private screen content.
    console.info('[watch] sem gráfico', vision.provider, JSON.stringify({ flag: vision.raw?.graficoVisivel ?? null }));
  }
  const normalized = chartVisible ? guardImageQuality(normalizeVision(vision.raw)) : noChartVision(vision.raw);
  const symbol = chartVisible ? mapAsset(normalized.asset) : null;
  // A timeframe the engine does not run (30m, D1…) gets no live cross-check rather than a different one.
  const readTimeframe = mapTimeframe(normalized.timeframe);
  const interval = readTimeframe || '5m';
  let reading = null;
  if (symbol && (readTimeframe || !normalized.timeframe)) {
    try { reading = await cachedReading(symbol, interval); } catch { reading = null; }
  }
  // Not a chart: neutral verdict, no levels, no live market mixed in.
  const verdict = chartVisible ? mergeVerdict(normalized, reading) : noChartVerdict();
  // Track record: at most one BUY/SELL per market and candle is checked later against the real price.
  if (reading && verdict.direction) {
    await recordSignal({ source: 'corretora', symbol, interval, side: verdict.direction, price: reading.price, atr: reading.snapshot?.atr, confidence: verdict.confidence });
  }
  const guidance = chartVisible ? photoGuidance(verdict, normalized, reading) : { ...noChartGuidance(normalized, 'ecrã'), headline: 'Não vejo um gráfico no ecrã' };

  return res.status(200).json({
    ok: true,
    provider: vision.provider,
    at: new Date().toISOString(),
    // Live minutes left today (null: no limit on this plan).
    minutesLeft: live.left,
    chartVisible,
    // Stable name of the market on screen, so "BTC/USDT M5" and "BTCUSDT 5m" are the same one.
    market: chartVisible ? marketKey(normalized) : null,
    change: chartVisible && vision.raw?.mudanca ? String(vision.raw.mudanca).slice(0, 200) : null,
    vision: normalized,
    verdict,
    guidance,
    live: reading && {
      symbol,
      interval,
      price: reading.price,
      signal: { action: reading.signal.action, confidence: reading.signal.confidence, regimeLabel: reading.signal.regimeLabel },
      eventRisk: reading.context?.eventRisk || null
    }
  });
}
