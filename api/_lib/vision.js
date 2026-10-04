import { apiKey } from './env.js';

// AI models for Grafictrader. Every provider is reached the same way and models
// are tried in a fixed order ("chain") per role:
//   vision - reads a chart image (FOTO, Minha corretora, Android bubble)
//   judge  - reads the analysts' results and gives the final verdict (text)
// A model that fails is skipped; one that hits a rate limit is paused for a minute.

export const MAX_IMAGE_CHARS = 4_000_000;
export const IMAGE_PATTERN = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

export const PROVIDERS = {
  unorouter: { label: 'UnoRouter', env: 'UNOROUTER_API_KEY', base: 'https://api.unorouter.com/v1' },
  groq: { label: 'Groq', env: 'GROQ_API_KEY', base: 'https://api.groq.com/openai/v1' },
  nvidia: { label: 'NVIDIA', env: 'NVIDIA_API_KEY', base: 'https://integrate.api.nvidia.com/v1' },
  gemini: { label: 'Gemini', env: 'GEMINI_API_KEY' },
  openai: { label: 'OpenAI', env: 'OPENAI_API_KEY' }
};

// Order chosen from the benchmark of 4 Oct 2026 (/api/health?compare=...):
//   charts - up, down and sideways test charts; reasoning - a "strong rally but
//   high-impact news in 10 minutes" case where the right call is to wait.
// Groq qwen3.8-27b read all three charts right in under 1 s; Llama 3.2 Vision 90B
// (NVIDIA) and Gemini 3.8 Flash also got them right but slower or often busy.
// Groq gpt-oss-120b and qwen3.8-27b reasoned correctly in about 0.5 s.
const DEFAULT_CHAINS = {
  vision: [
    'groq:qwen/qwen3.8-27b',
    'nvidia:meta/llama-3.2-90b-vision-instruct',
    'gemini:gemini-3.8-flash',
    'unorouter:gpt-4o:free',
    'openai:gpt-5.6-luna',
    'nvidia:nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
    'unorouter:qwen2.5-vl-7b-instruct-awq:free'
  ],
  judge: [
    'groq:openai/gpt-oss-120b',
    'groq:qwen/qwen3.8-27b',
    'gemini:gemini-3.8-flash',
    'nvidia:nvidia/nemotron-3-super-120b-a12b',
    'groq:openai/gpt-oss-20b',
    'unorouter:gpt-4o:free',
    'openai:gpt-5.6-luna'
  ]
};

const ENV_CHAINS = { vision: 'AI_VISION_MODELS', judge: 'AI_JUDGE_MODELS' };
const STEP_TIMEOUT_MS = 20_000;
const COOLDOWN_MS = 60_000;
const cooldown = new Map();

export function parseJson(text) {
  if (!text) return null;
  const cleaned = String(text).replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim();
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
      const error = new Error(data?.error?.message || data?.detail || data?.message || `HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

/** "provider:model" → { provider, model }. The model id may itself contain ":". */
export function parseStep(spec) {
  const index = String(spec).indexOf(':');
  if (index < 1) return null;
  const provider = spec.slice(0, index).trim();
  const model = spec.slice(index + 1).trim();
  return PROVIDERS[provider] && model ? { provider, model } : null;
}

/** Steps for a role that have a key configured, honouring AI_VISION_MODELS / AI_JUDGE_MODELS. */
export function chainFor(role) {
  const custom = (process.env[ENV_CHAINS[role]] || '').split(',').map(s => s.trim()).filter(Boolean);
  const specs = [...new Set([...custom, ...(DEFAULT_CHAINS[role] || [])])];
  return specs.map(parseStep).filter(step => step && apiKey(PROVIDERS[step.provider].env));
}

/** One OpenAI-style chat call (UnoRouter, Groq, NVIDIA). `content` is a string or content parts. */
async function chatCompatible(provider, model, content, { maxTokens, temperature, json }) {
  const { base, env } = PROVIDERS[provider];
  const result = await postJson(`${base}/chat/completions`, { Authorization: `Bearer ${apiKey(env)}` }, {
    model,
    temperature,
    max_tokens: maxTokens,
    ...(json && provider === 'groq' && typeof content === 'string' ? { response_format: { type: 'json_object' } } : {}),
    messages: [{ role: 'user', content }]
  }, STEP_TIMEOUT_MS);
  const message = result?.choices?.[0]?.message?.content;
  return Array.isArray(message) ? message.map(p => p?.text || '').join('\n') : message;
}

async function chatGemini(model, text, image, { maxTokens, temperature, json }) {
  const parts = [{ text }];
  if (image) {
    const [, mime, data] = image.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s) || [];
    parts.push({ inline_data: { mime_type: mime, data } });
  }
  const result = await postJson(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    { 'x-goog-api-key': apiKey('GEMINI_API_KEY') },
    { contents: [{ role: 'user', parts }], generationConfig: { temperature, maxOutputTokens: maxTokens, ...(json ? { responseMimeType: 'application/json' } : {}) } },
    STEP_TIMEOUT_MS
  );
  return result?.candidates?.flatMap(c => c?.content?.parts?.map(p => p?.text).filter(Boolean) || []).join('\n');
}

async function chatOpenAI(model, text, image, { maxTokens }) {
  const content = [{ type: 'input_text', text }];
  if (image) content.push({ type: 'input_image', image_url: image });
  const result = await postJson('https://api.openai.com/v1/responses', { Authorization: `Bearer ${apiKey('OPENAI_API_KEY')}` },
    { model, max_output_tokens: maxTokens, input: [{ role: 'user', content }] }, STEP_TIMEOUT_MS);
  return result?.output_text || result?.output?.flatMap(item => item?.content?.filter(p => p?.type === 'output_text').map(p => p?.text) || []).join('\n');
}

/** Runs one step: a prompt (and optional image) to one provider/model. Returns the text answer. */
export async function runStep(step, text, image, { maxTokens = 1800, temperature = 0.2, json = true } = {}) {
  const opts = { maxTokens, temperature, json };
  if (step.provider === 'gemini') return chatGemini(step.model, text, image, opts);
  if (step.provider === 'openai') return chatOpenAI(step.model, text, image, opts);
  const content = image ? [{ type: 'text', text }, { type: 'image_url', image_url: { url: image } }] : text;
  return chatCompatible(step.provider, step.model, content, opts);
}

const label = step => `${PROVIDERS[step.provider].label} (${step.model})`;

/**
 * Tries the role's chain until a model returns a usable answer.
 * `accept(text)` decides if an answer is usable (default: valid JSON).
 */
export async function runChain(role, text, image, { accept = t => Boolean(parseJson(t)), steps, ...opts } = {}) {
  const chain = steps || chainFor(role);
  if (!chain.length) {
    const error = new Error('Nenhuma IA está configurada (UNOROUTER_API_KEY, GROQ_API_KEY, NVIDIA_API_KEY, GEMINI_API_KEY ou OPENAI_API_KEY).');
    error.status = 503;
    error.setupRequired = true;
    throw error;
  }
  const errors = [];
  for (const step of chain) {
    const id = `${step.provider}:${step.model}`;
    if ((cooldown.get(id) || 0) > Date.now()) continue;
    try {
      const answer = await runStep(step, text, image, opts);
      if (answer && accept(answer)) return { text: answer, provider: label(step), step };
      errors.push(`${id}: resposta inválida`);
    } catch (error) {
      errors.push(`${id}: ${error?.message || error}`);
      if (error?.status === 429 || /rate|too many|capacity|quota|high demand/i.test(error?.message || '')) cooldown.set(id, Date.now() + COOLDOWN_MS);
      console.error('[AI]', id, error?.message || error);
    }
  }
  const error = new Error('Nenhum modelo de IA conseguiu responder agora. Tenta novamente dentro de instantes.');
  error.status = 502;
  error.details = errors.slice(-6);
  throw error;
}

/** Chart image → parsed JSON from the first vision model that answers well. */
export async function runVision(image, prompt, { maxOutputTokens = 1800 } = {}) {
  try {
    const { text, provider } = await runChain('vision', prompt, image, { maxTokens: maxOutputTokens });
    return { raw: parseJson(text), provider };
  } catch (error) {
    if (error.setupRequired) throw error;
    const wrapped = new Error('A IA não conseguiu analisar a imagem. Tenta uma imagem mais nítida ou espera um minuto.');
    wrapped.status = 502;
    wrapped.cause = error;
    throw wrapped;
  }
}

/** Text prompt → answer from the judge chain. */
export async function runText(prompt, { json = false, maxTokens = 900, temperature = 0.15 } = {}) {
  return runChain('judge', prompt, null, { json, maxTokens, temperature, accept: json ? undefined : t => Boolean(String(t).trim()) });
}

/** Model ids a provider exposes to the configured key. */
export async function listModels(provider) {
  const config = PROVIDERS[provider];
  if (!config?.base) throw new Error('Este provedor não tem lista de modelos.');
  const key = apiKey(config.env);
  if (!key) throw new Error(`${config.env} não configurada`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`${config.base}/models`, { headers: { Authorization: `Bearer ${key}` }, signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error?.message || `HTTP ${response.status}`);
    return (data?.data || []).map(m => m.id).filter(Boolean).sort();
  } finally {
    clearTimeout(timer);
  }
}
