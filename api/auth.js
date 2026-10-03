import {
  authConfigured, normalizeEmail, validEmail, findUser, createUser, verifyPassword,
  createSession, destroySession, sessionToken, getSessionUser, setSessionCookie,
  clearSessionCookie, publicUser
} from './_lib/auth.js';
import { rateLimit, sendRateLimited } from './_lib/rate-limit.js';
import { clientIp } from './_lib/validate.js';

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
      return user ? res.status(200).json({ ok: true, user }) : res.status(401).json({ ok: false, user: null });
    }

    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Método não permitido.' });

    if (action === 'logout') {
      if (authConfigured()) await destroySession(sessionToken(req));
      clearSessionCookie(res, req);
      return res.status(200).json({ ok: true });
    }

    if (!authConfigured()) return notConfigured(res);

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
      const user = await createUser({ name, email, password });
      if (!user) return res.status(409).json({ ok: false, error: 'Já existe uma conta com este email.' });
      setSessionCookie(res, req, await createSession(user));
      return res.status(201).json({ ok: true, user: publicUser(user) });
    }

    if (action === 'login') {
      const user = validEmail(email) ? await findUser(email) : null;
      const valid = user ? await verifyPassword(password, user.salt, user.hash) : false;
      if (!valid) return res.status(401).json({ ok: false, error: 'Email ou palavra-passe incorretos.' });
      setSessionCookie(res, req, await createSession(user));
      return res.status(200).json({ ok: true, user: publicUser(user) });
    }

    return res.status(400).json({ ok: false, error: 'Ação inválida.' });
  } catch (error) {
    console.error('[Auth]', error?.message || error);
    return res.status(503).json({ ok: false, error: 'Serviço de contas indisponível.' });
  }
}
