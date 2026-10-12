import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { redis, redisConfigured } from './redis.js';
import { TERMS_VERSION, termsAccepted } from './terms.js';

const scrypt = promisify(scryptCb);
const SESSION_COOKIE = 'gt_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const KEY_LENGTH = 64;

export const authConfigured = redisConfigured;

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 254;
}

export async function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const derived = await scrypt(String(password), salt, KEY_LENGTH);
  return { salt, hash: derived.toString('hex') };
}

export async function verifyPassword(password, salt, expectedHex) {
  if (!salt || !expectedHex) return false;
  const derived = await scrypt(String(password), salt, KEY_LENGTH);
  const expected = Buffer.from(expectedHex, 'hex');
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

const userKey = email => 'grafictrader:user:' + email;
const sessionKey = token => 'grafictrader:session:' + createHash('sha256').update(token).digest('hex');

export function publicUser(user) {
  return user ? {
    name: user.name,
    email: user.email,
    createdAt: user.createdAt || null,
    termsVersion: user.termsVersion || null,
    termsAcceptedAt: user.termsAcceptedAt || null
  } : null;
}

export async function findUser(email) {
  const raw = await redis(['GET', userKey(email)]);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/** Returns the created user, or null when the email is already registered. */
export async function createUser({ name, email, password, acceptTerms = false }) {
  const { salt, hash } = await hashPassword(password);
  const now = new Date().toISOString();
  const user = { name, email, salt, hash, createdAt: now, ...(acceptTerms ? { termsVersion: TERMS_VERSION, termsAcceptedAt: now } : {}) };
  const created = await redis(['SET', userKey(email), JSON.stringify(user), 'NX']);
  return created === 'OK' ? user : null;
}

/** Records that the user accepted the current terms. Returns the updated user, or null. */
export async function acceptTerms(email) {
  const user = await findUser(email);
  if (!user) return null;
  const updated = { ...user, termsVersion: TERMS_VERSION, termsAcceptedAt: new Date().toISOString() };
  await redis(['SET', userKey(email), JSON.stringify(updated)]);
  return updated;
}

const sessionsKey = email => 'grafictrader:sessions:' + email;
// Sessions issued before this time (ms) are no longer valid: "sign out
// everywhere" also covers sessions missing from the index (older ones, or
// lost to two logins at the same instant).
const revokedKey = email => 'grafictrader:revoked:' + email;
const MAX_SESSIONS = 50;

async function readSessionList(email) {
  // Storage errors must surface (never treat "could not read" as "no sessions").
  const value = await redis(['GET', sessionsKey(email)]);
  try { return JSON.parse(value || '[]'); } catch { return []; }
}

export async function createSession(user) {
  const token = randomBytes(32).toString('base64url');
  const key = sessionKey(token);
  // Always issued after the last revocation, even within the same millisecond.
  const revokedAt = Number(await redis(['GET', revokedKey(user.email)])) || 0;
  const issuedAt = Math.max(Date.now(), revokedAt + 1);
  await redis(['SET', key, JSON.stringify({ ...publicUser(user), issuedAt }), 'EX', String(SESSION_TTL_SECONDS)]);
  // Index of the account's sessions, so "sign out everywhere" can end them all.
  const list = (await readSessionList(user.email)).filter(k => k !== key);
  list.push(key);
  await redis(['SET', sessionsKey(user.email), JSON.stringify(list.slice(-MAX_SESSIONS)), 'EX', String(SESSION_TTL_SECONDS)]);
  return token;
}

/** Ends every session of the account (all devices). */
export async function destroyAllSessions(email) {
  await redis(['SET', revokedKey(email), String(Date.now()), 'EX', String(SESSION_TTL_SECONDS)]);
  for (const key of await readSessionList(email)) await redis(['DEL', key]);
  await redis(['DEL', sessionsKey(email)]);
}

/** Checks the password; runs scrypt even for unknown accounts so timing does not reveal which emails exist. */
export async function checkCredentials(email, password) {
  const user = validEmail(email) ? await findUser(email) : null;
  if (!user) {
    await hashPassword(password, DUMMY_SALT);
    return null;
  }
  return (await verifyPassword(password, user.salt, user.hash)) ? user : null;
}
const DUMMY_SALT = 'grafictrader-dummy-salt';

/** New password for the account. Ends all sessions; the caller starts a fresh one. */
export async function changePassword(email, password) {
  const user = await findUser(email);
  if (!user) return null;
  const { salt, hash } = await hashPassword(password);
  const updated = { ...user, salt, hash, passwordChangedAt: new Date().toISOString() };
  await redis(['SET', userKey(email), JSON.stringify(updated)]);
  await destroyAllSessions(email);
  return updated;
}

/** Deletes the account, its sessions and its MetaTrader 5 key. Market data it sent expires on its own. */
export async function deleteAccount(email) {
  const user = await findUser(email);
  if (!user) return false;
  await destroyAllSessions(email);
  if (user.mt5KeyHash) await redis(['DEL', 'grafictrader:mt5key:' + user.mt5KeyHash]);
  await redis(['DEL', 'grafictrader:journal:' + email]);
  await redis(['DEL', userKey(email)]);
  return true;
}

export async function destroySession(token) {
  if (token) await redis(['DEL', sessionKey(token)]);
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    if (name) out[name] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

export function sessionToken(req) {
  return parseCookies(req.headers?.cookie)[SESSION_COOKIE] || null;
}

export async function getSessionUser(req) {
  if (!authConfigured()) return null;
  const token = sessionToken(req);
  if (!token) return null;
  const raw = await redis(['GET', sessionKey(token)]);
  if (!raw) return null;
  let session;
  try { session = JSON.parse(raw); } catch { return null; }
  const revokedAt = Number(await redis(['GET', revokedKey(session.email)]));
  if (revokedAt && (session.issuedAt || 0) <= revokedAt) {
    await redis(['DEL', sessionKey(token)]);
    return null;
  }
  const { issuedAt, ...user } = session;
  return user;
}

function cookie(value, maxAge, req) {
  const secure = String(req.headers?.['x-forwarded-proto'] || '').includes('https') || process.env.VERCEL ? '; Secure' : '';
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function setSessionCookie(res, req, token) {
  res.setHeader('Set-Cookie', cookie(encodeURIComponent(token), SESSION_TTL_SECONDS, req));
}

export function clearSessionCookie(res, req) {
  res.setHeader('Set-Cookie', cookie('', 0, req));
}

/**
 * Gate for endpoints that spend paid AI credits.
 * When accounts are configured a valid session is required; otherwise the
 * endpoint stays open and relies on rate limiting (local mode).
 */
export async function requireUserIfConfigured(req, res) {
  if (!authConfigured()) {
    // Local mode is for development. In production paid AI never runs without accounts.
    if (process.env.VERCEL_ENV === 'production') {
      res.status(503).json({ ok: false, setupRequired: true, error: 'As contas não estão configuradas no servidor.' });
      return { ok: false };
    }
    return { ok: true, user: null };
  }
  try {
    const user = await getSessionUser(req);
    if (user && termsAccepted(user)) {
      const until = await pausedUntil(user.email);
      if (until) {
        res.status(423).json({ ok: false, paused: true, pausedUntil: until, error: `Estás em pausa até ${new Date(until).toLocaleDateString('pt-PT')}. As análises voltam nesse dia.` });
        return { ok: false };
      }
      return { ok: true, user };
    }
    if (user) {
      res.status(403).json({ ok: false, termsRequired: true, error: 'Aceita os Termos de Uso e o Aviso de Risco na app Grafictrader para continuar a usar as análises.' });
      return { ok: false };
    }
  } catch {
    res.status(503).json({ ok: false, error: 'Serviço de contas indisponível.' });
    return { ok: false };
  }
  res.status(401).json({ ok: false, error: 'Inicia sessão para usar a análise por IA.', authRequired: true });
  return { ok: false };
}

/* ---------- MetaTrader 5 bridge keys ---------- */

const bridgeKey = hash => 'grafictrader:mt5key:' + hash;
const sha = value => createHash('sha256').update(String(value)).digest('hex');

/** Creates a new bridge key for the user (revoking the previous one). Returned only once. */
export async function rotateBridgeKey(email) {
  const user = await findUser(email);
  if (!user) throw new Error('Utilizador não encontrado.');
  if (user.mt5KeyHash) await redis(['DEL', bridgeKey(user.mt5KeyHash)]);
  const key = 'gtb_' + randomBytes(24).toString('base64url');
  const hash = sha(key);
  await redis(['SET', bridgeKey(hash), email]);
  await redis(['SET', 'grafictrader:user:' + email, JSON.stringify({ ...user, mt5KeyHash: hash })]);
  return key;
}

/** Email that owns a bridge key, or null. */
export async function resolveBridgeKey(key) {
  if (!key || !/^gtb_[A-Za-z0-9_-]{20,64}$/.test(key)) return null;
  return redis(['GET', bridgeKey(sha(key))]);
}

/* ---------- pause / self-exclusion ---------- */

// One key per length: a shorter pause never overwrites a longer one, even
// when two requests arrive together; the pause in force is the latest end.
const pauseKey = (email, days) => `grafictrader:pause:${days}:${email}`;
export const PAUSE_DAYS = [1, 7, 30];

/** Blocks the account's analyses for some days. It cannot be undone early: that is the point. */
export async function startPause(email, days) {
  const until = Date.now() + days * 86_400_000;
  await redis(['SET', pauseKey(email, days), String(until), 'EX', String(days * 86_400)]);
  return (await pausedUntil(email)) || until;
}

/** End of the account's pause (ms), or null. */
export async function pausedUntil(email) {
  const ends = await Promise.all(PAUSE_DAYS.map(days => redis(['GET', pauseKey(email, days)])));
  const latest = Math.max(0, ...ends.map(Number).filter(Number.isFinite));
  return latest > Date.now() ? latest : null;
}
