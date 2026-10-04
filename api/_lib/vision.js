import { apiKey } from './env.js';
// Vision model helpers shared by photo analysis and live broker analysis.

export const MAX_IMAGE_CHARS = 4_000_000;
export const IMAGE_PATTERN = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

export function parseJson(text) {
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

export async function visionGemini(image, key, prompt, maxOutputTokens = 1800) {
  const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
  const [, mime, data] = image.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s) || [];
  const result = await postJson(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    { 'x-goog-api-key': key },
    {
      contents: [{ role: 'user', parts: [{ text: prompt }, { inline_data: { mime_type: mime, data } }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens, responseMimeType: 'application/json' }
    }
  );
  const text = result?.candidates?.flatMap(c => c?.content?.parts?.map(p => p?.text).filter(Boolean) || []).join('\n');
  const parsed = parseJson(text);
  if (!parsed) throw new Error('Gemini não devolveu uma análise válida.');
  return { raw: parsed, provider: 'Gemini' };
}

export async function visionOpenAI(image, key, prompt) {
  const result = await postJson('https://api.openai.com/v1/responses', { Authorization: `Bearer ${key}` }, {
    model: process.env.OPENAI_MODEL || 'gpt-5.6-luna',
    input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }, { type: 'input_image', image_url: image }] }]
  });
  const text = result?.output_text || result?.output?.flatMap(item => item?.content?.filter(p => p?.type === 'output_text').map(p => p?.text) || []).join('\n');
  const parsed = parseJson(text);
  if (!parsed) throw new Error('OpenAI não devolveu uma análise válida.');
  return { raw: parsed, provider: 'OpenAI' };
}

// UnoRouter: one key for many models behind an OpenAI-compatible API.
const UNOROUTER_BASE = 'https://api.unorouter.com/v1';
// Free models first (no balance needed), then paid ones.
const UNOROUTER_VISION_MODELS = [
  'gemini-3.6-flash:free', 'gpt-4o:free', 'gemini-3.5-flash-lite:free', 'llama-4-maverick-17b-128e-instruct:free',
  'qwen2.5-vl-7b-instruct-awq:free', 'llama-3.2-11b-vision:free', 'gemini-3.5-flash'
];

function unoRouterModels() {
  const configured = (process.env.UNOROUTER_MODEL || '').split(',').map(m => m.trim()).filter(Boolean);
  return [...new Set([...configured, ...UNOROUTER_VISION_MODELS])];
}

/** Model ids visible to the key, with pricing when the API reports it (free ones first). */
export async function listUnoRouterModels(key) {
  const base = (process.env.UNOROUTER_BASE_URL || UNOROUTER_BASE).replace(/\/$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${key}` }, signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error?.message || `HTTP ${response.status}`);
    const models = (data?.data || []).map(m => ({
      id: m.id,
      free: /free/i.test(m.id) || Number(m?.pricing?.prompt) === 0 || m?.is_free === true,
      vision: /image|vision/i.test(JSON.stringify(m?.architecture || m?.modalities || m?.capabilities || '')) || undefined,
      pricing: m?.pricing || undefined
    }));
    return { total: models.length, free: models.filter(m => m.free), sample: models.slice(0, 40).map(m => m.id) };
  } finally {
    clearTimeout(timer);
  }
}

// Worth trying the next model: model missing, no balance for a paid model, a busy
// free model, or a model that does not take images.
const isModelError = error => [402, 404, 429, 503].includes(error?.status)
  || (error?.status === 400 && /model|image|vision|multimodal/i.test(error.message || ''))
  || /balance|credit|billing|quota/i.test(error?.message || '');

/** Chat completion through UnoRouter, trying the next model when one is unavailable. */
export async function chatUnoRouter(key, content, { maxTokens = 1800, temperature = 0.2 } = {}) {
  const base = (process.env.UNOROUTER_BASE_URL || UNOROUTER_BASE).replace(/\/$/, '');
  let lastError = null;
  for (const model of unoRouterModels()) {
    try {
      const result = await postJson(`${base}/chat/completions`, { Authorization: `Bearer ${key}` }, {
        model,
        temperature,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content }]
      });
      const message = result?.choices?.[0]?.message?.content;
      const text = Array.isArray(message) ? message.map(p => p?.text || '').join('\n') : message;
      if (text) return { text, model };
      lastError = new Error('UnoRouter devolveu uma resposta vazia.');
    } catch (error) {
      lastError = error;
      if (!isModelError(error)) throw error;
    }
  }
  throw lastError || new Error('Nenhum modelo do UnoRouter respondeu.');
}

export async function visionUnoRouter(image, key, prompt, maxOutputTokens = 1800) {
  const { text, model } = await chatUnoRouter(key, [
    { type: 'text', text: prompt },
    { type: 'image_url', image_url: { url: image } }
  ], { maxTokens: maxOutputTokens });
  const parsed = parseJson(text);
  if (!parsed) throw new Error('UnoRouter não devolveu uma análise válida.');
  return { raw: parsed, provider: `UnoRouter (${model})` };
}

/** Runs the configured vision providers in order: UnoRouter, then Gemini, then OpenAI. */
export async function runVision(image, prompt, { maxOutputTokens } = {}) {
  const unoKey = apiKey('UNOROUTER_API_KEY');
  const geminiKey = apiKey('GEMINI_API_KEY');
  const openAIKey = apiKey('OPENAI_API_KEY');
  if (!unoKey && !geminiKey && !openAIKey) {
    const error = new Error('Nenhuma IA de análise está configurada (UNOROUTER_API_KEY, GEMINI_API_KEY ou OPENAI_API_KEY).');
    error.status = 503;
    error.setupRequired = true;
    throw error;
  }
  let lastError = null;
  const providers = [
    [unoKey, (img, k) => visionUnoRouter(img, k, prompt, maxOutputTokens)],
    [geminiKey, (img, k) => visionGemini(img, k, prompt, maxOutputTokens)],
    [openAIKey, (img, k) => visionOpenAI(img, k, prompt)]
  ];
  for (const [key, run] of providers) {
    if (!key) continue;
    try {
      return await run(image, key);
    } catch (error) {
      lastError = error;
      console.error('[Vision]', error?.message || error);
    }
  }
  const error = new Error('A IA não conseguiu analisar a imagem. Tenta uma imagem mais nítida.');
  error.status = 502;
  error.cause = lastError;
  throw error;
}
