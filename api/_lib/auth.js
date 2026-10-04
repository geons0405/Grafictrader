import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { redis, redisConfigured } from './redis.js';

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
  return user ? { name: user.name, email: user.email, createdAt: user.createdAt || null } : null;
}

export async function findUser(email) {
  const raw = await redis(['GET', userKey(email)]);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/** Returns the created user, or null when the email is already registered. */
export async function createUser({ name, email, password }) {
  const { salt, hash } = await hashPassword(password);
  const user = { name, email, salt, hash, createdAt: new Date().toISOString() };
  const created = await redis(['SET', userKey(email), JSON.stringify(user), 'NX']);
  return created === 'OK' ? user : null;
}

export async function createSession(user) {
  const token = randomBytes(32).toString('base64url');
  await redis(['SET', sessionKey(token), JSON.stringify(publicUser(user)), 'EX', String(SESSION_TTL_SECONDS)]);
  return token;
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
  try { return JSON.parse(raw); } catch { return null; }
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
  if (!authConfigured()) return { ok: true, user: null };
  try {
    const user = await getSessionUser(req);
    if (user) return { ok: true, user };
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
