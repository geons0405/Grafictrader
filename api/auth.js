import {
  authConfigured, normalizeEmail, validEmail, createUser,
  createSession, destroySession, sessionToken, getSessionUser, setSessionCookie,
  clearSessionCookie, publicUser, rotateBridgeKey, acceptTerms,
  checkCredentials, changePassword, deleteAccount, destroyAllSessions, sessionGeneration,
  rememberPlace, knownPlace,
  startPause, pausedUntil, PAUSE_DAYS
} from './_lib/auth.js';
import { rateLimit, sendRateLimited, peekLimit, liveMinutes, liveMinutesFor } from './_lib/rate-limit.js';
import { clientIp, crossSite } from './_lib/validate.js';
import { journalHandler } from './_lib/journal.js';
import { termsAccepted } from './_lib/terms.js';
import { vapidKeys, validSubscription, subscribe, unsubscribe, subscribeApp, unsubscribeApp, alertsFeed, readPrefs, ALERT_MARKETS, ALERT_INTERVALS } from './_lib/push.js';

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

    // Trading journal (GET, POST, DELETE) lives here: Vercel Hobby allows 12 functions.
    if (action === 'journal') return journalHandler(req, res);

    // Opportunity alerts (Web Push): the server's public key and this account's choice.
    // Minutes of live analysis left today, checked before the app opens the bubble.
    if (action === 'live-status' && req.method === 'GET') {
      if (!authConfigured()) return notConfigured(res);
      const user = await getSessionUser(req);
      if (!user) return res.status(401).json({ ok: false, error: 'Inicia sessão primeiro.' });
      const limit = liveMinutesFor(user);
      const live = await liveMinutes(user.email, limit);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ ok: true, limit: limit > 0 ? limit : null, left: live.left, plan: user.plan || 'free' });
    }

    if (action === 'push-status' && req.method === 'GET') {
      if (!authConfigured()) return notConfigured(res);
      const user = await getSessionUser(req);
      if (!user) return res.status(401).json({ ok: false, error: 'Inicia sessão primeiro.' });
      const keys = await vapidKeys();
      const prefs = await readPrefs(user.email);
      return res.status(200).json({ ok: true, publicKey: keys?.publicKey || null, markets: prefs.markets, interval: prefs.interval, devices: prefs.devices.map(d => d.endpoint), app: prefs.app === true, choices: { markets: ALERT_MARKETS, intervals: ALERT_INTERVALS } });
    }

    // The Android app asks every 15 minutes for the alerts raised since its last look.
    if (action === 'alerts-feed' && req.method === 'GET') {
      if (!authConfigured()) return notConfigured(res);
      const user = await getSessionUser(req);
      if (!user) return res.status(401).json({ ok: false, error: 'Inicia sessão primeiro.' });
      const since = Number(req.query?.since) || 0;
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ ok: true, now: Date.now(), alerts: await alertsFeed(user.email, since) });
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
      const token = await createSession(user, { generation: current.generation });
      if (!token) return res.status(401).json({ ok: false, error: 'A sessão terminou. Inicia sessão outra vez.' });
      setSessionCookie(res, req, token);
      return res.status(200).json({ ok: true, user: publicUser(user) });
    }

    if (action === 'push' || action === 'push-off' || action === 'push-app' || action === 'push-app-off') {
      const user = await getSessionUser(req);
      if (!user) return res.status(401).json({ ok: false, error: 'Inicia sessão primeiro.' });
      if (action === 'push-off') {
        await unsubscribe(user.email, typeof req.body?.endpoint === 'string' ? req.body.endpoint : null);
        return res.status(200).json({ ok: true });
      }
      if (action === 'push-app-off') {
        await unsubscribeApp(user.email);
        return res.status(200).json({ ok: true });
      }
      if (!termsAccepted(user)) return res.status(403).json({ ok: false, termsRequired: true, error: 'Aceita os Termos de Uso e o Aviso de Risco para ativar os alertas.' });
      if (action === 'push-app') {
        const prefs = await subscribeApp(user.email, req.body || {});
        return res.status(200).json({ ok: true, markets: prefs.markets, interval: prefs.interval });
      }
      if (!validSubscription(req.body?.subscription)) return res.status(400).json({ ok: false, error: 'Este navegador não deu uma subscrição de alertas válida.' });
      const prefs = await subscribe(user.email, req.body);
      return res.status(200).json({ ok: true, markets: prefs.markets, interval: prefs.interval });
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
        const changed = await changePassword(current.email, next);
        if (!changed) return res.status(401).json({ ok: false, error: 'Inicia sessão primeiro.' });
        const token = await createSession(changed.user, { generation: changed.generation });
        if (!token) return res.status(401).json({ ok: false, error: 'A sessão terminou entretanto. Inicia sessão com a nova palavra-passe.' });
        setSessionCookie(res, req, token);
        return res.status(200).json({ ok: true, user: publicUser(changed.user) });
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
      await rememberPlace(email, clientIp(req));
      setSessionCookie(res, req, await createSession(user));
      return res.status(201).json({ ok: true, user: publicUser(user) });
    }

    if (action === 'login') {
      // Only failed passwords count, so nobody can lock a user out just by knowing the email:
      // 10 failures per account and IP; after 50 per account from everywhere (spread
      // guessing) only places this account already signed in from may still try.
      const who = email || 'none';
      const ip = clientIp(req);
      const failures = { here: { limit: 10, windowSeconds: 900 }, everywhere: { limit: 50, windowSeconds: 900 } };
      const here = await peekLimit('login-fail', who + ':' + ip, failures.here);
      if (!here.allowed) return sendRateLimited(res, here);
      const everywhere = await peekLimit('login-fail-all', who, failures.everywhere);
      if (!everywhere.allowed && !(validEmail(email) && await knownPlace(email, ip))) return sendRateLimited(res, everywhere);
      // Read before the password check: a password change or account deletion
      // that lands while this login is in flight means no session.
      const generation = validEmail(email) ? await sessionGeneration(email) : 0;
      const user = await checkCredentials(email, password);
      if (!user) {
        await rateLimit('login-fail', who + ':' + ip, failures.here);
        await rateLimit('login-fail-all', who, failures.everywhere);
        return res.status(401).json({ ok: false, error: 'Email ou palavra-passe incorretos.' });
      }
      const token = await createSession(user, { generation });
      if (!token) return res.status(401).json({ ok: false, error: 'A palavra-passe mudou entretanto. Tenta outra vez.' });
      await rememberPlace(email, ip);
      setSessionCookie(res, req, token);
      return res.status(200).json({ ok: true, user: publicUser(user) });
    }

    return res.status(400).json({ ok: false, error: 'Ação inválida.' });
  } catch (error) {
    console.error('[Auth]', error?.message || error);
    return res.status(503).json({ ok: false, error: 'Serviço de contas indisponível.' });
  }
}
