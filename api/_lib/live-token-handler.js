import { redisConfigured } from './redis.js';
import { requireUserIfConfigured } from './auth.js';
import { rateLimit, sendRateLimited, aiQuota } from './rate-limit.js';
import { apiKey } from './env.js';
import { parseMarketQuery, clientIp } from './validate.js';
import { runInstructor } from './quant/service.js';
import { buildLiveSystemInstruction, buildLiveTokenRequest, resolveLiveModel } from './live-token.js';

export async function handleLiveToken(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Método não permitido.' });
  if (!redisConfigured()) return res.status(503).json({ ok: false, error: 'O serviço de sessões seguras ainda não está disponível.' });

  const access = await requireUserIfConfigured(req, res);
  if (!access.ok) return;
  const owner = access.user?.email || clientIp(req);
  const limit = await rateLimit('live-token', owner, { limit: 12, windowSeconds: 600, failClosed: true });
  if (!limit.allowed) return sendRateLimited(res, limit);
  const quota = await aiQuota(owner);
  if (!quota.allowed) return sendRateLimited(res, quota);

  const key = apiKey('GEMINI_API_KEY');
  if (!key) return res.status(503).json({ ok: false, error: 'A chave Gemini não está configurada no servidor.' });

  const body = req.body || {};
  let market = null;
  if (body.symbol !== undefined && body.symbol !== null && body.symbol !== '') {
    const parsed = parseMarketQuery({ symbol: body.symbol, interval: body.interval || '5m' });
    if (!parsed) return res.status(400).json({ ok: false, error: 'Ativo ou período inválido.' });
    try {
      const data = await runInstructor(parsed.symbol, parsed.interval);
      market = {
        symbol: data.symbol || parsed.symbol,
        interval: data.interval || parsed.interval,
        updatedAt: data.updatedAt || new Date().toISOString(),
        price: data.price ?? null,
        signal: data.signal ? {
          action: data.signal.action,
          confidence: data.signal.confidence,
          regimeLabel: data.signal.regimeLabel
        } : null,
        summary: typeof data.summary === 'string' ? data.summary.slice(0, 1200) : null,
        guidance: data.guidance || null
      };
    } catch {
      market = { symbol: parsed.symbol, interval: parsed.interval, unavailable: true };
    }
  }

  const model = resolveLiveModel(process.env.GEMINI_LIVE_MODEL);
  const tokenRequest = buildLiveTokenRequest(model);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch('https://generativelanguage.googleapis.com/v1alpha/auth_tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(tokenRequest),
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || typeof data.name !== 'string' || !data.name.startsWith('auth_tokens/')) {
      console.error('[live-token] Gemini token request failed:', response.status, data?.error?.message || 'unknown error');
      const status = response.status === 429 ? 429 : response.status === 403 ? 503 : 502;
      return res.status(status).json({
        ok: false,
        error: response.status === 429
          ? 'O serviço de voz está ocupado. Tenta novamente dentro de instantes.'
          : response.status === 403
            ? 'A chave Gemini não tem acesso à API Live. Verifica o acesso ao modelo no Google AI Studio.'
            : 'Não foi possível iniciar a sessão de voz. Tenta novamente.'
      });
    }

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    return res.status(200).json({
      ok: true,
      token: data.name,
      model,
      systemInstruction: buildLiveSystemInstruction(market),
      market: market ? { symbol: market.symbol, interval: market.interval, updatedAt: market.updatedAt, available: !market.unavailable } : null,
      expiresAt: tokenRequest.expireTime
    });
  } catch (error) {
    console.error('[live-token]', error?.name || 'Error');
    return res.status(502).json({ ok: false, error: 'Não foi possível contactar o serviço de voz da Gemini.' });
  } finally {
    clearTimeout(timeout);
  }
}
