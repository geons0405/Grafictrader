import test from 'node:test';
import assert from 'node:assert/strict';

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

const { default: auth } = await import('../api/auth.js');
const { getSessionUser, rotateBridgeKey, resolveBridgeKey } = await import('../api/_lib/auth.js');
const { crossSite } = await import('../api/_lib/validate.js');

function call(handler, { method = 'POST', query = {}, body = null, headers = {} }) {
  return new Promise(resolve => {
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, body: payload, headers: this.headers }); return this; }
    };
    handler({ method, query, body, headers: { 'x-forwarded-for': '10.0.0.' + Math.floor(Math.random() * 250), ...headers } }, res);
  });
}
const cookieOf = res => String(res.headers['Set-Cookie'] || '').split(';')[0];
const signedIn = async cookie => Boolean(await getSessionUser({ headers: { cookie } }));

async function register(email) {
  const res = await call(auth, { query: { action: 'register' }, body: { name: 'Ana', email, password: 'segredo123', acceptTerms: true } });
  assert.equal(res.status, 201);
  return cookieOf(res);
}

test('sign out everywhere ends the sessions on every device', async () => {
  const phone = await register('ana@acc.test');
  const login = await call(auth, { query: { action: 'login' }, body: { email: 'ana@acc.test', password: 'segredo123' } });
  const laptop = cookieOf(login);
  assert.ok(await signedIn(phone) && await signedIn(laptop));
  const out = await call(auth, { query: { action: 'logout-all' }, headers: { cookie: phone } });
  assert.equal(out.status, 200);
  assert.equal(await signedIn(phone), false);
  assert.equal(await signedIn(laptop), false);
});

test('changing the password needs the current one and ends the other sessions', async () => {
  const phone = await register('rui@acc.test');
  const other = cookieOf(await call(auth, { query: { action: 'login' }, body: { email: 'rui@acc.test', password: 'segredo123' } }));
  const wrong = await call(auth, { query: { action: 'password' }, body: { password: 'errada000', newPassword: 'novasenha99' }, headers: { cookie: phone } });
  assert.equal(wrong.status, 401);
  const ok = await call(auth, { query: { action: 'password' }, body: { password: 'segredo123', newPassword: 'novasenha99' }, headers: { cookie: phone } });
  assert.equal(ok.status, 200);
  assert.equal(await signedIn(other), false);
  assert.ok(await signedIn(cookieOf(ok)));
  const oldLogin = await call(auth, { query: { action: 'login' }, body: { email: 'rui@acc.test', password: 'segredo123' } });
  assert.equal(oldLogin.status, 401);
  const newLogin = await call(auth, { query: { action: 'login' }, body: { email: 'rui@acc.test', password: 'novasenha99' } });
  assert.equal(newLogin.status, 200);
});

test('deleting the account removes it, its sessions and its MT5 key', async () => {
  const cookie = await register('eva@acc.test');
  const key = await rotateBridgeKey('eva@acc.test');
  assert.equal(await resolveBridgeKey(key), 'eva@acc.test');
  const refused = await call(auth, { query: { action: 'delete' }, body: { password: 'nao-e-esta' }, headers: { cookie } });
  assert.equal(refused.status, 401);
  const deleted = await call(auth, { query: { action: 'delete' }, body: { password: 'segredo123' }, headers: { cookie } });
  assert.equal(deleted.status, 200);
  assert.equal(await signedIn(cookie), false);
  assert.equal(await resolveBridgeKey(key), null);
  const login = await call(auth, { query: { action: 'login' }, body: { email: 'eva@acc.test', password: 'segredo123' } });
  assert.equal(login.status, 401);
});

test('requests from other sites and plain HTML forms are refused', async () => {
  assert.equal(crossSite({ method: 'POST', headers: { origin: 'https://evil.example', host: 'grafictrader.vercel.app' } }), true);
  assert.equal(crossSite({ method: 'POST', headers: { origin: 'https://grafictrader.vercel.app', host: 'grafictrader.vercel.app', 'content-type': 'application/json' } }), false);
  assert.equal(crossSite({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' } }), true);
  assert.equal(crossSite({ method: 'POST', headers: { 'content-type': 'application/json' } }), false);
  const forged = await call(auth, { query: { action: 'logout' }, headers: { origin: 'https://evil.example', host: 'grafictrader.vercel.app' } });
  assert.equal(forged.status, 403);
});
