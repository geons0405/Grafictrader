import { redis, redisConfigured } from './redis.js';
import { requireUserIfConfigured } from './auth.js';
import { rateLimit, sendRateLimited, aiQuota } from './rate-limit.js';
import { apiKey } from './env.js';
import { parseMarketQuery, clientIp } from './validate.js';
import { runInstructor } from './quant/service.js';
import {
  LIVE_CHAT_TTL_SECONDS, LIVE_CHAT_MAX_TURNS, normalizeLiveChatMessage,
  validLiveChatSession, liveChatKey, trimLiveChatHistory
} from './live-chat.js';

const SYSTEM_INSTRUCTION = `És o GraficTrader Live, um assistente conversacional em português claro.
Fala de forma natural, breve e acessível. Responde diretamente à pergunta e mantém o contexto da conversa.
Quando houver dados de mercado fornecidos pelo motor GraficTrader, usa-os como fonte principal e indica o ativo e o período.
Nunca inventes preços, cotações, indicadores, notícias, sinais ou resultados. Se não houver dados recentes suficientes, diz claramente que não consegues confirmar.
Só podes sugerir COMPRA ou VENDA quando os dados do motor incluídos nesta mensagem indicarem uma decisão confirmada; caso contrário recomenda AGUARDAR / NÃO OPERAR.
Não prometas lucros nem percentagens de acerto. Não executes ordens nem afirmes que monitorizas o mercado em segundo plano.
Se o utilizador pedir para ser avisado mais tarde, explica que esta primeira versão ainda não envia alertas conversacionais automáticos.
Não peças nem reveles palavras-passe, chaves de API ou credenciais da corretora.`;

async function askGemini(history, message, market) {
  const key = apiKey('GEMINI_API_KEY');
  if (!key) {
    const error = new Error('A chave Gemini não está configurada no servidor.');
    error.status = 503;
    throw error;
  }
  const model = String(process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim();
  const extra = market
    ? '\\n\\nDADOS ATUAIS DO MOTOR GRAFICTRADER (não alteres nem inventes estes dados):\\n' + JSON.stringify(market).slice(0, 9000)
    : '\\n\\nNão foram fornecidos dados de mercado nesta pergunta.';
  const contents = [
    ...history,
    { role: 'user', parts: [{ text: message + extra }] }
  ];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 18000);
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        contents,
        generationConfig: { temperature: 0.55, maxOutputTokens: 420 }
      }),
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(response.status === 429 ? 'O Gemini está temporariamente ocupado. Tenta novamente dentro de instantes.' : 'Não foi possível obter resposta da IA.');
      error.status = response.status === 429 ? 429 : 502;
      throw error;
    }
    const answer = (data?.candidates?.[0]?.content?.parts || []).map(part => part.text || '').join('').trim();
    if (!answer) {
      const error = new Error('O Gemini não devolveu uma resposta. Tenta novamente.');
      error.status = 502;
      throw error;
    }
    return answer.slice(0, 3500);
  } finally {
    clearTimeout(timer);
  }
}

export async function handleLiveChat(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Método não permitido.' });
  if (!redisConfigured()) return res.status(503).json({ ok: false, error: 'A memória de conversação ainda não está disponível.' });

  const access = await requireUserIfConfigured(req, res);
  if (!access.ok) return;
  const owner = access.user?.email || clientIp(req);
  const limit = await rateLimit('live-chat', owner, { limit: 30, windowSeconds: 600, failClosed: true });
  if (!limit.allowed) return sendRateLimited(res, limit);
  const quota = await aiQuota(owner);
  if (!quota.allowed) return sendRateLimited(res, quota);

  const body = req.body || {};
  const message = normalizeLiveChatMessage(body.message);
  const sessionId = body.sessionId;
  if (!message) return res.status(400).json({ ok: false, error: 'Escreve ou dita uma pergunta.' });
  if (!validLiveChatSession(sessionId)) return res.status(400).json({ ok: false, error: 'Sessão de conversa inválida.' });

  let market = null;
  if (body.symbol !== undefined && body.symbol !== null && body.symbol !== '') {
    const parsed = parseMarketQuery({ symbol: body.symbol, interval: body.interval || '5m' });
    if (!parsed) return res.status(400).json({ ok: false, error: 'Ativo ou período inválido.' });
    try {
      const data = await runInstructor(parsed.symbol, parsed.interval);
      market = {
        symbol: data.symbol, interval: data.interval, updatedAt: data.updatedAt,
        price: data.price, decision: data.signal?.action,
        confidence: data.signal?.confidence, regime: data.signal?.regimeLabel,
        guidance: data.guidance, plan: data.plan
      };
    } catch {
      market = { symbol: parsed.symbol, interval: parsed.interval, unavailable: true, note: 'O motor não conseguiu obter dados de mercado recentes.' };
    }
  }

  const key = liveChatKey(access.user?.email || owner, sessionId);
  let history = [];
  try {
    const stored = await redis(['GET', key]);
    if (stored) history = JSON.parse(stored);
  } catch {
    return res.status(503).json({ ok: false, error: 'Não foi possível recuperar a conversa guardada.' });
  }
  history = trimLiveChatHistory(history);
  try {
    const answer = await askGemini(history, message, market);
    const next = [...history, { role: 'user', text: message }, { role: 'model', text: answer }].slice(-LIVE_CHAT_MAX_TURNS * 2);
    await redis(['SET', key, JSON.stringify(next), 'EX', String(LIVE_CHAT_TTL_SECONDS)]);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true, answer, sessionId, market: market ? { symbol: market.symbol, updatedAt: market.updatedAt || null, available: !market.unavailable } : null });
  } catch (error) {
    console.error('[live-chat]', error?.message || error);
    return res.status(error.status || 502).json({ ok: false, error: error.message || 'Assistente temporariamente indisponível.' });
  }
}
