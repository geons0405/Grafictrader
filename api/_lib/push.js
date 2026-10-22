import webpush from 'web-push';
import { redis, redisConfigured } from './redis.js';
import { marketReading } from './quant/service.js';
import { pausedUntil } from './auth.js';
import { isYahooMarket } from './sources/yahoo.js';

// Opportunity alerts sent to the phone or computer even with the app closed,
// through the browser's Web Push (github.com/web-push-libs/web-push, MPL-2.0).
// The Android app has no Web Push in its WebView: it asks for the recent alerts
// every 15 minutes instead (alertsFeed) and shows them as its own notifications.
// Only the engine's calculations run here: no AI is spent on alerts.

export const ALERT_MARKETS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD'];
export const ALERT_INTERVALS = ['15m', '1h', '4h'];
const MIN_CONFIDENCE = 65;
const MAX_DEVICES = 5;
const MAX_PAIRS = 12;

const vapidKey = 'grafictrader:vapid';
const prefsKey = email => 'grafictrader:push:' + email;
const indexKey = 'grafictrader:push:index';
const recentKey = 'grafictrader:alerts:recent';
const RECENT = 100;

const NAMES = { BTCUSDT: 'BTC/USDT', ETHUSDT: 'ETH/USDT', SOLUSDT: 'SOL/USDT', BNBUSDT: 'BNB/USDT', XRPUSDT: 'XRP/USDT', EURUSD: 'EUR/USD', GBPUSD: 'GBP/USD', USDJPY: 'USD/JPY', XAUUSD: 'Ouro (XAU/USD)' };
const INTERVAL_NAMES = { '15m': '15 min', '1h': '1 hora', '4h': '4 horas' };
export const marketName = symbol => NAMES[symbol] || symbol;

const parse = raw => { try { return JSON.parse(raw); } catch { return null; } };

/**
 * The server's VAPID key pair: from VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY when set,
 * otherwise created once and kept in storage, so the owner has nothing to configure.
 */
export async function vapidKeys() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  }
  if (!redisConfigured()) return null;
  let keys = parse(await redis(['GET', vapidKey]));
  if (!keys?.publicKey) {
    await redis(['SET', vapidKey, JSON.stringify(webpush.generateVAPIDKeys()), 'NX']);
    keys = parse(await redis(['GET', vapidKey]));
  }
  return keys?.publicKey ? keys : null;
}

/** Checks a subscription object from the browser: an https endpoint and its two keys. */
export function validSubscription(sub) {
  return Boolean(sub && typeof sub.endpoint === 'string' && /^https:\/\//.test(sub.endpoint) && sub.endpoint.length < 1000
    && typeof sub.keys?.p256dh === 'string' && typeof sub.keys?.auth === 'string' && sub.keys.p256dh.length < 200 && sub.keys.auth.length < 100);
}

export async function readPrefs(email) {
  const prefs = parse(await redis(['GET', prefsKey(email)]));
  return prefs && Array.isArray(prefs.devices) ? prefs : { devices: [], app: false, markets: ['BTCUSDT'], interval: '1h' };
}

const wants = prefs => prefs.devices.length > 0 || prefs.app === true;

async function savePrefs(email, prefs, { markets, interval }) {
  const chosen = [...new Set((Array.isArray(markets) ? markets : []).filter(m => ALERT_MARKETS.includes(m)))].slice(0, 5);
  const next = {
    devices: prefs.devices.slice(-MAX_DEVICES),
    app: prefs.app === true,
    markets: chosen.length ? chosen : ['BTCUSDT'],
    interval: ALERT_INTERVALS.includes(interval) ? interval : '1h'
  };
  await redis(['SET', prefsKey(email), JSON.stringify(next)]);
  const index = parse(await redis(['GET', indexKey])) || [];
  if (!index.includes(email)) await redis(['SET', indexKey, JSON.stringify([...index, email].slice(-5000))]);
  return next;
}

/** Saves this browser and the user's choice of markets and timeframe. */
export async function subscribe(email, { subscription, markets, interval }) {
  const prefs = await readPrefs(email);
  const devices = prefs.devices.filter(d => d.endpoint !== subscription.endpoint);
  devices.push({ endpoint: subscription.endpoint, keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth } });
  return savePrefs(email, { ...prefs, devices }, { markets, interval });
}

/** Turns alerts on for the Android app, which collects them itself (alertsFeed). */
export async function subscribeApp(email, { markets, interval }) {
  return savePrefs(email, { ...(await readPrefs(email)), app: true }, { markets, interval });
}

/** Turns the Android app's alerts off; browsers keep theirs. */
export async function unsubscribeApp(email) {
  const prefs = await readPrefs(email);
  if (prefs.devices.length) {
    await redis(['SET', prefsKey(email), JSON.stringify({ ...prefs, app: false })]);
    return;
  }
  await unsubscribe(email);
}

/** Removes one browser, or every browser and the app when `endpoint` is not given. */
export async function unsubscribe(email, endpoint = null) {
  const prefs = await readPrefs(email);
  const devices = endpoint ? prefs.devices.filter(d => d.endpoint !== endpoint) : [];
  if (endpoint && (devices.length || prefs.app)) {
    await redis(['SET', prefsKey(email), JSON.stringify({ ...prefs, devices })]);
    return;
  }
  await redis(['DEL', prefsKey(email)]);
  const index = parse(await redis(['GET', indexKey])) || [];
  await redis(['SET', indexKey, JSON.stringify(index.filter(e => e !== email))]);
}

/** Text of an alert. */
export function alertMessage(symbol, interval, direction, confidence) {
  return {
    title: direction > 0 ? 'Boa oportunidade de compra' : 'Boa oportunidade de venda',
    body: `${marketName(symbol)} · ${INTERVAL_NAMES[interval] || interval}: a IA vê uma boa oportunidade de ${direction > 0 ? 'compra' : 'venda'} (${confidence}%). Toca para ver a análise. Não é aconselhamento financeiro.`,
    url: `/?m=${symbol}&i=${interval}#mercado`,
    tag: `${symbol}-${interval}`
  };
}

/**
 * One alert round: reads each market people follow, and when a new opportunity
 * appears on a closed candle, tells those people once. Runs at most every 4
 * minutes whoever calls it, so the public trigger cannot be used to spam.
 */
export async function runAlerts({ now = Date.now(), read = marketReading, send = (sub, body) => webpush.sendNotification(sub, body, { TTL: 1800 }) } = {}) {
  if (!redisConfigured()) return { ok: false, reason: 'sem armazenamento' };
  if (await redis(['SET', 'grafictrader:alerts:lock', String(now), 'NX', 'EX', '240']) !== 'OK') return { ok: true, skipped: true };
  const keys = await vapidKeys();
  if (!keys) return { ok: false, reason: 'sem chaves' };
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'https://grafictrader.vercel.app', keys.publicKey, keys.privateKey);

  const emails = parse(await redis(['GET', indexKey])) || [];
  const people = [];
  for (const email of emails) {
    const prefs = await readPrefs(email);
    if (!wants(prefs)) continue;
    if (await pausedUntil(email)) continue; // self-exclusion: no alerts during a pause
    people.push({ email, prefs });
  }
  const pairs = [...new Set(people.flatMap(p => p.prefs.markets.map(m => m + '|' + p.prefs.interval)))].slice(0, MAX_PAIRS);

  let sent = 0;
  const gone = [];
  for (const pair of pairs) {
    const [symbol, interval] = pair.split('|');
    let reading;
    try {
      reading = await read(symbol, interval, { withContext: !isYahooMarket(symbol) });
    } catch {
      continue;
    }
    const signal = reading?.signal;
    if (!signal?.direction || (signal.confidence || 0) < MIN_CONFIDENCE || !reading.snapshot?.time) continue;
    // Once per market, timeframe, candle and side, whoever triggers the round.
    const once = `grafictrader:alerted:${symbol}:${interval}:${reading.snapshot.time}:${signal.direction}`;
    if (await redis(['SET', once, '1', 'NX', 'EX', '86400']) !== 'OK') continue;
    const body = JSON.stringify(alertMessage(symbol, interval, signal.direction, signal.confidence));
    // Kept for the Android app, which collects its alerts instead of receiving a push.
    // Rounds never overlap (the lock above), so a plain read-and-write is safe here.
    const recent = parse(await redis(['GET', recentKey])) || [];
    recent.unshift({ id: `${symbol}-${interval}-${reading.snapshot.time}-${signal.direction}`, symbol, interval, direction: signal.direction, confidence: signal.confidence, at: now });
    await redis(['SET', recentKey, JSON.stringify(recent.slice(0, RECENT))]);
    for (const person of people) {
      if (person.prefs.interval !== interval || !person.prefs.markets.includes(symbol)) continue;
      for (const device of person.prefs.devices) {
        try {
          await send(device, body);
          sent += 1;
        } catch (error) {
          // The browser dropped this subscription: forget the device.
          if (error?.statusCode === 404 || error?.statusCode === 410) gone.push([person.email, device.endpoint]);
        }
      }
    }
  }
  for (const [email, endpoint] of gone) await unsubscribe(email, endpoint);
  return { ok: true, markets: pairs.length, sent, removed: gone.length };
}

/**
 * The alerts for one person's markets and timeframe raised after `since` (ms), newest first,
 * for the Android app to show. Empty when the app's alerts are off or the person is paused.
 */
export async function alertsFeed(email, since = 0) {
  const prefs = await readPrefs(email);
  if (!prefs.app || await pausedUntil(email)) return [];
  const rows = parse(await redis(['GET', recentKey])) || [];
  return rows
    .filter(r => r.at > since && r.interval === prefs.interval && prefs.markets.includes(r.symbol))
    .slice(0, 5)
    .map(r => ({ id: r.id, at: r.at, ...alertMessage(r.symbol, r.interval, r.direction, r.confidence) }));
}
