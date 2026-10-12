import {
  authConfigured, normalizeEmail, validEmail, createUser,
  createSession, destroySession, sessionToken, getSessionUser, setSessionCookie,
  clearSessionCookie, publicUser, rotateBridgeKey, acceptTerms,
  checkCredentials, changePassword, deleteAccount, destroyAllSessions,
  startPause, pausedUntil, PAUSE_DAYS
} from './_lib/auth.js';
import { rateLimit, sendRateLimited } from './_lib/rate-limit.js';
import { clientIp, crossSite } from './_lib/validate.js';

const notConfigured = res => res.status(503).json({
  ok: false,
  setupRequired: true,
  error: 'As contas ainda não estão configuradas no servidor (KV_REST_API_URL / KV_REST_API_TOKEN).'
});

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const action = String(req.query?.action || '');

  try {
    if (action === 'me' && req.method === 'GET') {
      if (!authConfigured()) return notConfigured(res);
      const user = await getSessionUser(req);
      if (!user) return res.status(401).json({ ok: false, user: null });
      return res.status(200).json({ ok: true, user: { ...user, pausedUntil: await pausedUntil(user.email) } });
    }

    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Método não permitido.' });
    if (crossSite(req)) return res.status(403).json({ ok: false, error: 'Pedido recusado.' });

    if (action === 'logout') {
      if (authConfigured()) await destroySession(sessionToken(req));
      clearSessionCookie(res, req);
      return res.status(200).json({ ok: true });
    }

    if (!authConfigured()) return notConfigured(res);

    if (action === 'mt5key') {
      const user = await getSessionUser(req);
      if (!user) return res.status(401).json({ ok: false, error: 'Inicia sessão primeiro.' });
      return res.status(200).json({ ok: true, key: await rotateBridgeKey(user.email) });
    }

    if (action === 'terms') {
      const current = await getSessionUser(req);
      if (!current) return res.status(401).json({ ok: false, error: 'Inicia sessão primeiro.' });
      if (req.body?.accept !== true) return res.status(400).json({ ok: false, error: 'Marca a caixa para aceitar os Termos de Uso e o Aviso de Risco.' });
      const user = await acceptTerms(current.email);
      if (!user) return res.status(401).json({ ok: false, error: 'Inicia sessão primeiro.' });
      // The session keeps a copy of the user: replace it so the acceptance counts at once.
      await destroySession(sessionToken(req));
      setSessionCookie(res, req, await createSession(user));
      return res.status(200).json({ ok: true, user: publicUser(user) });
    }

    if (action === 'pause') {
      const current = await getSessionUser(req);
      if (!current) return res.status(401).json({ ok: false, error: 'Inicia sessão primeiro.' });
      const days = Number(req.body?.days);
      if (!PAUSE_DAYS.includes(days)) return res.status(400).json({ ok: false, error: 'Escolhe 1, 7 ou 30 dias.' });
      return res.status(200).json({ ok: true, pausedUntil: await startPause(current.email, days) });
    }

    if (action === 'logout-all' || action === 'password' || action === 'delete') {
      const current = await getSessionUser(req);
      if (!current) return res.status(401).json({ ok: false, error: 'Inicia sessão primeiro.' });
      const guard = await rateLimit('account', current.email, { limit: 10, windowSeconds: 900 });
      if (!guard.allowed) return sendRateLimited(res, guard);

      if (action === 'logout-all') {
        await destroyAllSessions(current.email);
        clearSessionCookie(res, req);
        return res.status(200).json({ ok: true });
      }
      // Changing the password or deleting the account always asks for the current password.
      const user = await checkCredentials(current.email, String(req.body?.password || ''));
      if (!user) return res.status(401).json({ ok: false, error: 'A palavra-passe atual não está correta.' });

      if (action === 'password') {
        const next = String(req.body?.newPassword || '');
        if (next.length < 8 || next.length > 200) return res.status(400).json({ ok: false, error: 'A nova palavra-passe deve ter pelo menos 8 caracteres.' });
        const updated = await changePassword(current.email, next);
        setSessionCookie(res, req, await createSession(updated));
        return res.status(200).json({ ok: true, user: publicUser(updated) });
      }
      await deleteAccount(current.email);
      clearSessionCookie(res, req);
      return res.status(200).json({ ok: true, deleted: true });
    }

    const body = req.body || {};
    const email = normalizeEmail(body.email);
    const password = String(body.password || '');

    const limit = await rateLimit('auth', clientIp(req), { limit: 20, windowSeconds: 900 });
    if (!limit.allowed) return sendRateLimited(res, limit);

    if (action === 'register') {
      const name = String(body.name || '').trim().slice(0, 60);
      if (!name) return res.status(400).json({ ok: false, error: 'Indica o teu nome.' });
      if (!validEmail(email)) return res.status(400).json({ ok: false, error: 'Email inválido.' });
      if (password.length < 8 || password.length > 200) {
        return res.status(400).json({ ok: false, error: 'A palavra-passe deve ter pelo menos 8 caracteres.' });
      }
      if (body.acceptTerms !== true) {
        return res.status(400).json({ ok: false, error: 'Para criar conta tens de aceitar os Termos de Uso e o Aviso de Risco.' });
      }
      if (body.adult !== true) {
        return res.status(400).json({ ok: false, error: 'O Grafictrader é só para maiores de 18 anos.' });
      }
      const user = await createUser({ name, email, password, acceptTerms: true });
      if (!user) return res.status(409).json({ ok: false, error: 'Já existe uma conta com este email.' });
      setSessionCookie(res, req, await createSession(user));
      return res.status(201).json({ ok: true, user: publicUser(user) });
    }

    if (action === 'login') {
      // Per account too: guessing one account's password from many IPs is also limited.
      const perAccount = await rateLimit('login', email || 'none', { limit: 10, windowSeconds: 900 });
      if (!perAccount.allowed) return sendRateLimited(res, perAccount);
      const user = await checkCredentials(email, password);
      if (!user) return res.status(401).json({ ok: false, error: 'Email ou palavra-passe incorretos.' });
      setSessionCookie(res, req, await createSession(user));
      return res.status(200).json({ ok: true, user: publicUser(user) });
    }

    return res.status(400).json({ ok: false, error: 'Ação inválida.' });
  } catch (error) {
    console.error('[Auth]', error?.message || error);
    return res.status(503).json({ ok: false, error: 'Serviço de contas indisponível.' });
  }
}
