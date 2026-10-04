import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// In-memory Upstash REST emulation behind a fetch stub.
const store = new Map();
globalThis.fetch = async (url, init = {}) => {
  if (String(url).startsWith('http://kv.test')) {
    const [cmd, key, value, ...opts] = JSON.parse(init.body);
    let result = null;
    if (cmd === 'GET') result = store.get(key) ?? null;
    else if (cmd === 'SET') {
      if (opts.includes('NX') && store.has(key)) result = null;
      else { store.set(key, value); result = 'OK'; }
    } else if (cmd === 'DEL') result = store.delete(key) ? 1 : 0;
    else if (cmd === 'INCR') { const v = Number(store.get(key) || 0) + 1; store.set(key, String(v)); result = v; }
    else if (cmd === 'EXPIRE') result = 1;
    return new Response(JSON.stringify({ result }), { status: 200 });
  }
  return new Response('offline', { status: 503 });
};
process.env.KV_REST_API_URL = 'http://kv.test';
process.env.KV_REST_API_TOKEN = 'x';

const { TERMS_VERSION } = await import('../api/_lib/terms.js');
const { TERMS_VERSION: CLIENT_VERSION } = await import('../src/lib/terms.js');
const { createUser, createSession, requireUserIfConfigured } = await import('../api/_lib/auth.js');
const { default: auth } = await import('../api/auth.js');

const page = readFileSync(new URL('../public/termos.html', import.meta.url), 'utf8');

function call(handler, { method = 'GET', query = {}, body = null, headers = {} }) {
  return new Promise(resolve => {
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, body: payload, headers: this.headers }); return this; }
    };
    handler({ method, query, body, headers }, res);
  });
}

const sessionCookie = res => String(res.headers['Set-Cookie'] || '').split(';')[0];

async function gate(cookie) {
  let response = null;
  const res = {
    status(code) { response = { status: code }; return this; },
    json(payload) { response.body = payload; return this; }
  };
  const access = await requireUserIfConfigured({ headers: { cookie } }, res);
  return access.ok ? { status: 200 } : response;
}

test('server, app and terms page share one terms version', () => {
  assert.equal(CLIENT_VERSION, TERMS_VERSION);
  assert.match(page, new RegExp(`data-terms-version="${TERMS_VERSION}"`));
  assert.ok(page.includes('versão ' + TERMS_VERSION));
});

test('terms page states that the app only assists and the user owns every decision and result', () => {
  const text = page.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  assert.match(text, /servem apenas para auxiliar/);
  assert.match(text, /é da tua extrema e exclusiva responsabilidade/);
  assert.match(text, /sejam negativos ou positivos, são da tua exclusiva responsabilidade/);
  assert.match(text, /Não é aconselhamento financeiro/);
  assert.match(text, /18 anos ou mais/);
  for (let i = 1; i <= 24; i++) assert.ok(page.includes(`id="t${i}"`), `missing section ${i}`);
});

test('an account can only be created after accepting the terms', async () => {
  const refused = await call(auth, { method: 'POST', query: { action: 'register' }, body: { name: 'Ana', email: 'ana@terms.test', password: 'segredo123' } });
  assert.equal(refused.status, 400);
  assert.match(refused.body.error, /Termos de Uso/);

  const created = await call(auth, { method: 'POST', query: { action: 'register' }, body: { name: 'Ana', email: 'ana@terms.test', password: 'segredo123', acceptTerms: true } });
  assert.equal(created.status, 201);
  assert.equal(created.body.user.termsVersion, TERMS_VERSION);
  assert.ok(created.body.user.termsAcceptedAt);
  assert.equal((await gate(sessionCookie(created))).status, 200);
});

test('an older account must accept the current terms before using the analyses', async () => {
  const user = await createUser({ name: 'Rui', email: 'rui@terms.test', password: 'segredo123' });
  const cookie = 'gt_session=' + encodeURIComponent(await createSession(user));

  const blocked = await gate(cookie);
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.termsRequired, true);

  const unchecked = await call(auth, { method: 'POST', query: { action: 'terms' }, body: {}, headers: { cookie } });
  assert.equal(unchecked.status, 400);

  const accepted = await call(auth, { method: 'POST', query: { action: 'terms' }, body: { accept: true }, headers: { cookie } });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.user.termsVersion, TERMS_VERSION);
  // The new session carries the acceptance; the old one is gone.
  assert.equal((await gate(sessionCookie(accepted))).status, 200);
  assert.equal((await gate(cookie)).status, 401);

  const anonymous = await call(auth, { method: 'POST', query: { action: 'terms' }, body: { accept: true } });
  assert.equal(anonymous.status, 401);
});
