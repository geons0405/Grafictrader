import { requireUserIfConfigured } from './_lib/auth.js';
import { rateLimit, sendRateLimited } from './_lib/rate-limit.js';
import { clientIp, parseMarketQuery } from './_lib/validate.js';
import { marketReading } from './_lib/quant/service.js';
import { mapAsset, mapTimeframe, normalizeVision, mergeVerdict } from './_lib/quant/verdict.js';

// Vercel rejects bodies above 4.5 MB; the client downsizes captures well below this.
const MAX_IMAGE_CHARS = 4_000_000;
const IMAGE_PATTERN = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

const ANALYSIS_PROMPT = `És um analista técnico experiente. Analisa a imagem de um gráfico de trading.
Lê apenas o que é visível: ativo, timeframe, preço atual, estrutura (topos/fundos), suportes e resistências, padrões de velas e gráficos, indicadores visíveis, volume.
Decide uma orientação para a próxima fase do gráfico:
- "COMPRAR" se a estrutura e o momentum favorecem subida;
- "VENDER" se favorecem descida;
- "AGUARDAR" se o gráfico está lateral, confuso, sem confirmação ou se a imagem não chega para decidir.
Não inventes valores que não estejam visíveis. Não prometas resultados. Responde em português de Angola.
Responde APENAS com JSON válido neste formato:
{
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
  "qualidadeImagem": "boa" | "média" | "fraca"
}`;

function parseJson(text) {
  if (!text) return null;
  const cleaned = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(cleaned); } catch { /* fall through */ }
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

async function postJson(url, headers, body, timeoutMs = 45_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data?.error?.message || `HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function visionGemini(image, key) {
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const [, mime, data] = image.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s) || [];
  const result = await postJson(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    { 'x-goog-api-key': key },
    {
      contents: [{ role: 'user', parts: [{ text: ANALYSIS_PROMPT }, { inline_data: { mime_type: mime, data } }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 1400, responseMimeType: 'application/json' }
    }
  );
  const text = result?.candidates?.flatMap(c => c?.content?.parts?.map(p => p?.text).filter(Boolean) || []).join('\n');
  const parsed = parseJson(text);
  if (!parsed) throw new Error('Gemini não devolveu uma análise válida.');
  return { raw: parsed, provider: 'Gemini' };
}

async function visionOpenAI(image, key) {
  const result = await postJson('https://api.openai.com/v1/responses', { Authorization: `Bearer ${key}` }, {
    model: process.env.OPENAI_MODEL || 'gpt-5.6-luna',
    input: [{ role: 'user', content: [{ type: 'input_text', text: ANALYSIS_PROMPT }, { type: 'input_image', image_url: image }] }]
  });
  const text = result?.output_text || result?.output?.flatMap(item => item?.content?.filter(p => p?.type === 'output_text').map(p => p?.text) || []).join('\n');
  const parsed = parseJson(text);
  if (!parsed) throw new Error('OpenAI não devolveu uma análise válida.');
  return { raw: parsed, provider: 'OpenAI' };
}

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

  const geminiKey = process.env.GEMINI_API_KEY;
  const openAIKey = process.env.OPENAI_API_KEY;
  if (!geminiKey && !openAIKey) {
    return res.status(503).json({ ok: false, setupRequired: true, error: 'Nenhuma IA de análise está configurada (GEMINI_API_KEY ou OPENAI_API_KEY).' });
  }

  let vision = null;
  for (const [key, run] of [[geminiKey, visionGemini], [openAIKey, visionOpenAI]]) {
    if (!key || vision) continue;
    try {
      vision = await run(image, key);
    } catch (error) {
      console.error('[Analyze]', error?.message || error);
    }
  }
  if (!vision) return res.status(502).json({ ok: false, error: 'A IA não conseguiu analisar a imagem. Tenta outra foto, mais nítida.' });

  const normalized = normalizeVision(vision.raw);
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
    vision: normalized,
    verdict,
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
