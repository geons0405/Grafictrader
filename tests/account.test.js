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
  const res = await call(auth, { query: { action: 'register' }, body: { name: 'Ana', email, password: 'segredo123', acceptTerms: true, adult: true } });
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

test('sign-up needs the 18+ confirmation', async () => {
  const res = await call(auth, { query: { action: 'register' }, body: { name: 'Teo', email: 'teo@acc.test', password: 'segredo123', acceptTerms: true } });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /18 anos/);
});

test('a pause blocks the AI analyses until it ends and cannot be shortened', async () => {
  const { requireUserIfConfigured } = await import('../api/_lib/auth.js');
  const cookie = await register('zoe@acc.test');
  const gate = () => new Promise(resolve => {
    let status = 200;
    const res = { status(c) { status = c; return this; }, json(b) { resolve({ status, body: b }); return this; } };
    requireUserIfConfigured({ headers: { cookie } }, res).then(a => { if (a.ok) resolve({ status: 200 }); });
  });
  assert.equal((await gate()).status, 200);
  const bad = await call(auth, { query: { action: 'pause' }, body: { days: 3 }, headers: { cookie } });
  assert.equal(bad.status, 400);
  const week = await call(auth, { query: { action: 'pause' }, body: { days: 7 }, headers: { cookie } });
  assert.equal(week.status, 200);
  const blocked = await gate();
  assert.equal(blocked.status, 423);
  assert.equal(blocked.body.paused, true);
  const shorter = await call(auth, { query: { action: 'pause' }, body: { days: 1 }, headers: { cookie } });
  assert.equal(shorter.body.pausedUntil, week.body.pausedUntil, 'a shorter pause does not replace a longer one');
});

test('the trading journal keeps the user own trades and compares following the app with not', async () => {
  const cookie = await register('ivo@acc.test');
  const journal = (req, res) => auth({ ...req, query: { action: 'journal', ...req.query } }, res);
  const post = body => call(journal, { body, headers: { cookie, 'content-type': 'application/json' } });
  assert.equal((await post({ asset: '', side: 'BUY', amount: 10, result: 5 })).status, 400);
  assert.equal((await post({ asset: 'BTC', side: 'BUY', amount: '', result: '' })).status, 400, 'blank is not a break-even trade');
  await post({ asset: 'EUR/USD OTC', side: 'BUY', amount: 10, result: 8.5, followedApp: true });
  await post({ asset: 'EUR/USD OTC', side: 'SELL', amount: 10, result: -10, followedApp: false });
  const last = await post({ asset: 'BTC/USDT', side: 'SELL', amount: 20, result: -20, followedApp: true });
  assert.equal(last.body.entries.length, 3);
  assert.deepEqual(last.body.totals.followedApp, { trades: 2, wins: 1, losses: 1, winRate: 50, net: -11.5 });
  assert.equal(last.body.totals.ownCall.net, -10);
  const removed = await call(journal, { method: 'DELETE', query: { id: last.body.entries[0].id }, headers: { cookie } });
  assert.equal(removed.body.entries.length, 2);
  const other = await register('ana2@acc.test');
  const empty = await call(journal, { method: 'GET', headers: { cookie: other } });
  assert.equal(empty.body.entries.length, 0, 'each account only sees its own journal');
});

test('sign out everywhere also ends sessions that were never indexed', async () => {
  const cookie = await register('old@acc.test');
  // A session from before the index existed: present in storage, absent from the list.
  const legacy = 'legacy-token-' + Math.random();
  const { createHash } = await import('node:crypto');
  store.set('grafictrader:session:' + createHash('sha256').update(legacy).digest('hex'), JSON.stringify({ name: 'Old', email: 'old@acc.test' }));
  const legacyCookie = 'gt_session=' + encodeURIComponent(legacy);
  assert.ok(await signedIn(legacyCookie));
  await call(auth, { query: { action: 'logout-all' }, headers: { cookie } });
  assert.equal(await signedIn(legacyCookie), false);
  const again = cookieOf(await call(auth, { query: { action: 'login' }, body: { email: 'old@acc.test', password: 'segredo123' } }));
  assert.ok(await signedIn(again), 'a new login after that works');
});

test('knowing an email is not enough to lock its owner out of login', async () => {
  await register('lia@acc.test');
  for (let i = 0; i < 12; i++) {
    await call(auth, { query: { action: 'login' }, body: { email: 'lia@acc.test', password: 'errada' + i }, headers: { 'x-forwarded-for': '9.9.9.9' } });
  }
  const attacker = await call(auth, { query: { action: 'login' }, body: { email: 'lia@acc.test', password: 'outra' }, headers: { 'x-forwarded-for': '9.9.9.9' } });
  assert.equal(attacker.status, 429, 'the guessing IP is stopped');
  const owner = await call(auth, { query: { action: 'login' }, body: { email: 'lia@acc.test', password: 'segredo123' }, headers: { 'x-forwarded-for': '8.8.8.8' } });
  assert.equal(owner.status, 200, 'the owner still signs in from elsewhere');
});

test('a login whose password check races a password change or deletion never signs in', async () => {
  const { createSession, revokedSince, destroyAllSessions, findUser } = await import('../api/_lib/auth.js');
  await register('race@acc.test');
  const user = await findUser('race@acc.test');

  // The old password was checked, then the password changed before the session was written.
  let checkedAt = Date.now();
  let seen = await revokedSince(user.email);
  await destroyAllSessions(user.email);
  assert.equal(await createSession(user, { checkedAt, revokedAt: seen }), null);

  // The session was written first, then the revocation landed: it is void at once.
  await new Promise(resolve => setTimeout(resolve, 2));
  checkedAt = Date.now();
  seen = await revokedSince(user.email);
  const token = await createSession(user, { checkedAt, revokedAt: seen });
  assert.ok(token);
  await destroyAllSessions(user.email);
  assert.equal(await signedIn('gt_session=' + encodeURIComponent(token)), false);

  // Nothing in between: the login works.
  const ok = await call(auth, { query: { action: 'login' }, body: { email: 'race@acc.test', password: 'segredo123' } });
  assert.equal(ok.status, 200);
  assert.ok(await signedIn(cookieOf(ok)));
});

test('guessing from many IPs cannot lock the owner out of the place they usually sign in from', async () => {
  await register('eva@acc.test');
  const home = await call(auth, { query: { action: 'login' }, body: { email: 'eva@acc.test', password: 'segredo123' }, headers: { 'x-forwarded-for': '7.7.7.7' } });
  assert.equal(home.status, 200);
  for (let i = 0; i < 55; i++) {
    await call(auth, { query: { action: 'login' }, body: { email: 'eva@acc.test', password: 'errada' + i }, headers: { 'x-forwarded-for': '6.6.' + Math.floor(i / 8) + '.' + i } });
  }
  const stranger = await call(auth, { query: { action: 'login' }, body: { email: 'eva@acc.test', password: 'outra' }, headers: { 'x-forwarded-for': '5.5.5.5' } });
  assert.equal(stranger.status, 429, 'a new place is stopped once the account is under attack');
  const owner = await call(auth, { query: { action: 'login' }, body: { email: 'eva@acc.test', password: 'segredo123' }, headers: { 'x-forwarded-for': '7.7.7.7' } });
  assert.equal(owner.status, 200, 'the owner still signs in from home');
});
