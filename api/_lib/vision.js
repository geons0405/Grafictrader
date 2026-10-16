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
  // Paid credits; set its privacy settings to providers that keep no data (screens are private).
  openrouter: { label: 'OpenRouter', env: 'OPENROUTER_API_KEY', base: 'https://openrouter.ai/api/v1' },
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
// Images (photos and whole-screen captures) never go to free proxy tiers: they
// may keep or reuse what they receive. Add them back with AI_VISION_MODELS.
const DEFAULT_CHAINS = {
  vision: [
    'groq:qwen/qwen3.8-27b',
    // Used only when OPENROUTER_API_KEY is set: steady when the free quotas run out.
    'openrouter:meta-llama/llama-3.2-90b-vision-instruct',
    'openrouter:qwen/qwen3.8-27b',
    'nvidia:meta/llama-3.2-90b-vision-instruct',
    'gemini:gemini-3.8-flash',
    'openai:gpt-5.6-luna',
    'nvidia:nvidia/nemotron-3-nano-omni-30b-a3b-reasoning'
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
// Images: after this long without an answer the next model starts in parallel.
const VISION_HEDGE_MS = 6_000;
// Whole chain, all models together: the user (and Vercel) should not wait longer.
const CHAIN_BUDGET_MS = 45_000;
const cooldown = new Map();

/** How long to skip a model after this error: busy for a minute, slow or down for two, refused for ten. */
export function cooldownFor(error) {
  const message = String(error?.message || error || '');
  const status = error?.status;
  if (status === 401 || status === 403 || /denied|unauthori[sz]ed|forbidden|invalid api key|permission/i.test(message)) return 10 * 60_000;
  if (status === 429 || /rate|too many|capacity|quota|high demand/i.test(message)) return 60_000;
  if (status >= 500 || error?.name === 'AbortError' || /abort|timeout|timed out/i.test(message)) return 2 * 60_000;
  return 0;
}

export function parseJson(text) {
  if (!text) return null;
  const cleaned = String(text).replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(cleaned); } catch { /* fall through */ }
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

async function postJson(url, headers, body, timeoutMs = 45_000, signal = null) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // A caller that no longer needs the answer (another model already gave one) cancels it.
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel);
  if (signal?.aborted) controller.abort();
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
    signal?.removeEventListener('abort', cancel);
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
async function chatCompatible(provider, model, content, { maxTokens, temperature, json, timeoutMs = STEP_TIMEOUT_MS, signal }) {
  const { base, env } = PROVIDERS[provider];
  const result = await postJson(`${base}/chat/completions`, { Authorization: `Bearer ${apiKey(env)}` }, {
    model,
    temperature,
    max_tokens: maxTokens,
    ...(json && provider === 'groq' && typeof content === 'string' ? { response_format: { type: 'json_object' } } : {}),
    messages: [{ role: 'user', content }]
  }, timeoutMs, signal);
  const message = result?.choices?.[0]?.message?.content;
  return Array.isArray(message) ? message.map(p => p?.text || '').join('\n') : message;
}

async function chatGemini(model, text, image, { maxTokens, temperature, json, timeoutMs = STEP_TIMEOUT_MS, signal }) {
  const parts = [{ text }];
  if (image) {
    const [, mime, data] = image.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s) || [];
    parts.push({ inline_data: { mime_type: mime, data } });
  }
  const result = await postJson(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    { 'x-goog-api-key': apiKey('GEMINI_API_KEY') },
    { contents: [{ role: 'user', parts }], generationConfig: { temperature, maxOutputTokens: maxTokens, ...(json ? { responseMimeType: 'application/json' } : {}) } },
    timeoutMs,
    signal
  );
  return result?.candidates?.flatMap(c => c?.content?.parts?.map(p => p?.text).filter(Boolean) || []).join('\n');
}

async function chatOpenAI(model, text, image, { maxTokens, timeoutMs = STEP_TIMEOUT_MS, signal }) {
  const content = [{ type: 'input_text', text }];
  if (image) content.push({ type: 'input_image', image_url: image });
  const result = await postJson('https://api.openai.com/v1/responses', { Authorization: `Bearer ${apiKey('OPENAI_API_KEY')}` },
    { model, max_output_tokens: maxTokens, input: [{ role: 'user', content }] }, timeoutMs, signal);
  return result?.output_text || result?.output?.flatMap(item => item?.content?.filter(p => p?.type === 'output_text').map(p => p?.text) || []).join('\n');
}

/** Runs one step: a prompt (and optional image) to one provider/model. Returns the text answer. */
export async function runStep(step, text, image, { maxTokens = 1800, temperature = 0.2, json = true, timeoutMs = STEP_TIMEOUT_MS, signal = null } = {}) {
  const opts = { maxTokens, temperature, json, timeoutMs, signal };
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
export async function runChain(role, text, image, { accept = t => Boolean(parseJson(t)), steps, budgetMs = CHAIN_BUDGET_MS, hedgeMs = 0, ...opts } = {}) {
  const chain = steps || chainFor(role);
  if (!chain.length) {
    const error = new Error('Nenhuma IA está configurada (UNOROUTER_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY, NVIDIA_API_KEY, GEMINI_API_KEY ou OPENAI_API_KEY).');
    error.status = 503;
    error.setupRequired = true;
    throw error;
  }
  if (hedgeMs > 0) return runHedged(chain, text, image, { accept, budgetMs, hedgeMs, ...opts });
  const errors = [];
  const deadline = Date.now() + budgetMs;
  for (const step of chain) {
    const id = `${step.provider}:${step.model}`;
    if ((cooldown.get(id) || 0) > Date.now()) continue;
    const left = deadline - Date.now();
    if (left < 3000) {
      errors.push('sem tempo para mais modelos');
      break;
    }
    try {
      const answer = await runStep(step, text, image, { ...opts, timeoutMs: Math.min(STEP_TIMEOUT_MS, left) });
      if (answer && accept(answer)) return { text: answer, provider: label(step), step };
      errors.push(`${id}: resposta inválida`);
      console.error('[AI]', id, 'resposta inválida');
    } catch (error) {
      errors.push(`${id}: ${error?.message || error}`);
      const pause = cooldownFor(error);
      if (pause) cooldown.set(id, Date.now() + pause);
      console.error('[AI]', id, error?.message || error);
    }
  }
  const error = new Error('Nenhum modelo de IA conseguiu responder agora. Tenta novamente dentro de instantes.');
  error.status = 502;
  error.details = errors.slice(-6);
  throw error;
}

function chainFailed(errors) {
  const error = new Error('Nenhum modelo de IA conseguiu responder agora. Tenta novamente dentro de instantes.');
  error.status = 502;
  error.details = errors.slice(-6);
  // Every model out of quota or refused: the free allowances are used up for now.
  error.exhausted = errors.length > 0 && errors.every(e => /rate|limit|quota|exhausted|denied|too many|sem tempo|aborted|timeout/i.test(e));
  return error;
}

/**
 * Same order as the plain chain, but a slow model does not hold everyone up:
 * if it has not answered after `hedgeMs` the next one starts alongside it, and
 * the first usable answer wins (the others are cancelled). A model that fails
 * hands over at once.
 */
function runHedged(chain, text, image, { accept, budgetMs, hedgeMs, ...opts }) {
  const deadline = Date.now() + budgetMs;
  const steps = chain.filter(step => (cooldown.get(`${step.provider}:${step.model}`) || 0) <= Date.now());
  const errors = [];
  const controllers = [];
  return new Promise((resolve, reject) => {
    let next = 0;
    let running = 0;
    let done = false;
    let timer = null;
    const finish = (result, error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      controllers.forEach(c => c.abort());
      if (result) resolve(result);
      else reject(error);
    };
    const launch = () => {
      clearTimeout(timer);
      if (done) return;
      const left = deadline - Date.now();
      if (next >= steps.length || left < 3000) {
        if (next < steps.length) errors.push('sem tempo para mais modelos');
        if (!running) finish(null, chainFailed(errors));
        return;
      }
      const step = steps[next++];
      const id = `${step.provider}:${step.model}`;
      // Paused meanwhile by another request (busy, refused): skip it.
      if ((cooldown.get(id) || 0) > Date.now()) return launch();
      const controller = new AbortController();
      controllers.push(controller);
      running += 1;
      runStep(step, text, image, { ...opts, timeoutMs: Math.min(STEP_TIMEOUT_MS, left), signal: controller.signal })
        .then(answer => {
          if (answer && accept(answer)) return finish({ text: answer, provider: label(step), step });
          errors.push(`${id}: resposta inválida`);
          console.error('[AI]', id, 'resposta inválida');
        }, error => {
          if (done) return; // cancelled because another model already answered
          errors.push(`${id}: ${error?.message || error}`);
          const pause = cooldownFor(error);
          if (pause) cooldown.set(id, Date.now() + pause);
          console.error('[AI]', id, error?.message || error);
        })
        .finally(() => {
          running -= 1;
          if (!done) launch();
        });
      // Still waiting after hedgeMs: start the next model alongside.
      timer = setTimeout(launch, hedgeMs);
    };
    launch();
  });
}

/** A usable vision answer is a JSON object with the chart flag or a decision, not just any JSON. */
export function isVisionAnswer(text) {
  const parsed = parseJson(text);
  return Boolean(parsed) && typeof parsed === 'object' && !Array.isArray(parsed) && ('graficoVisivel' in parsed || 'decisao' in parsed);
}

/** Chart image → parsed JSON from the first vision model that answers well. */
export async function runVision(image, prompt, { maxOutputTokens = 1800 } = {}) {
  try {
    const { text, provider } = await runChain('vision', prompt, image, { maxTokens: maxOutputTokens, accept: isVisionAnswer, hedgeMs: VISION_HEDGE_MS });
    return { raw: parseJson(text), provider };
  } catch (error) {
    if (error.setupRequired) throw error;
    const wrapped = new Error(error.exhausted
      ? 'As IAs gratuitas atingiram o limite de uso por agora. A análise volta sozinha quando o limite renovar (de minutos a algumas horas).'
      : 'A IA não conseguiu analisar a imagem. Tenta uma imagem mais nítida ou espera um minuto.');
    wrapped.exhausted = Boolean(error.exhausted);
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
