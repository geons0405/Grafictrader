import { requireUserIfConfigured } from './_lib/auth.js';
import { rateLimit, sendRateLimited } from './_lib/rate-limit.js';
import { clientIp, parseMarketQuery } from './_lib/validate.js';
import { marketReading } from './_lib/quant/service.js';
import { mapAsset, mapTimeframe, normalizeVision, mergeVerdict, isChartVisible, noChartVision, noChartVerdict, noChartGuidance } from './_lib/quant/verdict.js';
import { rulesBlock } from './_lib/ai-rules.js';
import { photoGuidance } from './_lib/quant/explain.js';

import { MAX_IMAGE_CHARS, IMAGE_PATTERN, runVision } from './_lib/vision.js';

const ANALYSIS_PROMPT = `És um analista técnico experiente. Recebes uma imagem que o utilizador diz ser um gráfico de trading.
${rulesBlock({ chart: true })}
Se for um gráfico, lê apenas o que é visível: ativo, timeframe, preço atual, estrutura (topos/fundos), suportes e resistências, padrões de velas e gráficos, indicadores visíveis, volume.
Decide uma orientação para a próxima fase do gráfico:
- "COMPRAR" se a estrutura e o momentum favorecem subida;
- "VENDER" se favorecem descida;
- "AGUARDAR" se o gráfico está lateral, confuso, sem confirmação ou se a imagem não chega para decidir.
Não inventes valores que não estejam visíveis. Não prometas resultados. Responde em português de Angola.
Responde APENAS com JSON válido neste formato:
{
  "graficoVisivel": true | false,
  "ativo": "ex.: BTC/USDT ou null",
  "timeframe": "ex.: 5m, 15m, 1h ou null",
  "precoAtual": número ou null,
  "tendencia": "alta" | "baixa" | "lateral" | "indefinida",
  "decisao": "COMPRAR" | "VENDER" | "AGUARDAR",
  "confianca": 0-100,
  "entrada": "zona ou condição de entrada",
  "stop": "nível ou condição de invalidação",
  "alvos": ["alvo 1", "alvo 2"],
  "estrutura": "descrição curta da estrutura",
  "padroes": ["padrões visíveis"],
  "indicadores": "o que os indicadores visíveis mostram",
  "motivos": ["até 4 motivos objetivos"],
  "riscos": ["até 3 riscos"],
  "resumo": "uma frase",
  "explicacaoSimples": "3 a 5 frases informais, como se falasses com um amigo que nunca operou: o que fazer agora, porquê, onde entrar, onde pôr o stop loss e onde tirar o lucro (ou porque é melhor não operar)",
  "qualidadeImagem": "boa" | "média" | "fraca"
}`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Método não permitido.' });
  res.setHeader('Cache-Control', 'no-store');

  const { image, symbol: hintSymbol, interval: hintInterval } = req.body || {};
  if (typeof image !== 'string' || image.length > MAX_IMAGE_CHARS) {
    return res.status(413).json({ ok: false, error: 'Imagem demasiado grande ou inválida.' });
  }
  if (!IMAGE_PATTERN.test(image)) return res.status(400).json({ ok: false, error: 'Imagem inválida.' });

  const access = await requireUserIfConfigured(req, res);
  if (!access.ok) return;

  const limit = await rateLimit('analyze', access.user?.email || clientIp(req), { limit: 10, windowSeconds: 600 });
  if (!limit.allowed) return sendRateLimited(res, limit);

  let vision;
  try {
    vision = await runVision(image, ANALYSIS_PROMPT);
  } catch (error) {
    return res.status(error.status || 502).json({ ok: false, setupRequired: Boolean(error.setupRequired), error: error.message });
  }

  const chartVisible = isChartVisible(vision.raw);
  if (!chartVisible) {
    // Not a chart: never a trade, never mixed with a live market reading.
    const normalized = noChartVision(vision.raw);
    return res.status(200).json({
      ok: true,
      provider: vision.provider,
      chartVisible: false,
      vision: normalized,
      verdict: noChartVerdict(),
      guidance: noChartGuidance(normalized, 'foto'),
      live: null,
      disclaimer: 'Orientação educativa gerada por IA. Não é aconselhamento financeiro nem garantia de resultado.'
    });
  }

  const normalized = normalizeVision(vision.raw);
  if (normalized.imageQuality === 'fraca') {
    // A blurry or cut chart is read, but never traded on.
    normalized.direction = 0;
    normalized.confidence = Math.min(normalized.confidence, 30);
  }
  // Cross-check with the live engine when the chart is a market we track.
  const hint = parseMarketQuery({ symbol: hintSymbol, interval: hintInterval });
  const symbol = mapAsset(normalized.asset) || null;
  const interval = mapTimeframe(normalized.timeframe) || hint?.interval || '15m';
  let reading = null;
  if (symbol) {
    try {
      reading = await marketReading(symbol, interval);
    } catch (error) {
      console.warn('[Analyze] leitura ao vivo indisponível:', error?.message || error);
    }
  }
  const verdict = mergeVerdict(normalized, reading);

  return res.status(200).json({
    ok: true,
    provider: vision.provider,
    chartVisible: true,
    vision: normalized,
    verdict,
    guidance: photoGuidance(verdict, normalized, reading),
    live: reading && {
      symbol,
      interval,
      price: reading.price,
      signal: { action: reading.signal.action, confidence: reading.signal.confidence, regimeLabel: reading.signal.regimeLabel, reasons: reading.signal.reasons },
      context: reading.context,
      quant: reading.snapshot && {
        hurst: reading.snapshot.hurst,
        varianceRatio: reading.snapshot.varianceRatio,
        kalmanZ: reading.snapshot.kalmanZ,
        entropy: reading.snapshot.entropy,
        vpin: reading.snapshot.vpin,
        volPercentile: reading.snapshot.volPercentile
      }
    },
    disclaimer: 'Orientação educativa gerada por IA. Não é aconselhamento financeiro nem garantia de resultado.'
  });
}
