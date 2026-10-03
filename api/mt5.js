import { redis, redisConfigured } from './_lib/redis.js';
import { getSessionUser, resolveBridgeKey } from './_lib/auth.js';
import { rateLimit, sendRateLimited } from './_lib/rate-limit.js';
import { instructorFromCandles } from './_lib/quant/service.js';

// MetaTrader 5 bridge.
//  POST /api/mt5  (from the GrafictraderBridge EA, header X-Bridge-Key)
//       body: { symbol, timeframe, kind: full|bar|tick, candles: [[timeUtc, o, h, l, c, tickVolume], ...],
//               bid, ask, digits, broker, server }
//  GET  /api/mt5?symbols=1                     → symbols the user's terminal is sending
//  GET  /api/mt5?symbol=XAUUSD&timeframe=M5    → candles + AI instructor on the broker's own feed
const TIMEFRAMES = { M1: '1m', M5: '5m', M15: '15m', H1: '1h', H4: '4h' };
const MAX_CANDLES = 600;
const TTL = String(2 * 24 * 3600);
const histKey = (email, symbol, tf) => `grafictrader:mt5:${email}:${symbol}:${tf}:hist`;
const liveKey = (email, symbol, tf) => `grafictrader:mt5:${email}:${symbol}:${tf}:live`;
const indexKey = email => `grafictrader:mt5syms:${email}`;
const validSymbol = s => /^[A-Za-z0-9._#+\-]{1,30}$/.test(s);

function cleanCandles(rows) {
  return (Array.isArray(rows) ? rows : []).slice(-1000).map(r => ({
    time: Number(r[0]), open: Number(r[1]), high: Number(r[2]), low: Number(r[3]), close: Number(r[4]), volume: Number(r[5]) || 0
  })).filter(c => [c.time, c.open, c.high, c.low, c.close].every(Number.isFinite) && c.time > 1e9);
}

function mergeCandles(base, incoming) {
  const byTime = new Map(base.map(c => [c.time, c]));
  for (const c of incoming) byTime.set(c.time, c);
  return [...byTime.values()].sort((a, b) => a.time - b.time).slice(-MAX_CANDLES);
}

async function readJson(key) {
  const raw = await redis(['GET', key]);
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

// Writes are kept small: "tick" posts only touch a tiny live record (1
// command); a new bar appends to the history; a "full" post (on start and
// every 10 minutes) rewrites the history and the symbol index.
async function ingest(req, res) {
  const email = await resolveBridgeKey(String(req.headers['x-bridge-key'] || ''));
  if (!email) return res.status(401).json({ ok: false, error: 'Chave da ponte inválida.' });
  const limit = await rateLimit('mt5', email, { limit: 120, windowSeconds: 60 });
  if (!limit.allowed) return sendRateLimited(res, limit);

  const body = req.body || {};
  const symbol = String(body.symbol || '');
  const tf = String(body.timeframe || '').toUpperCase();
  const kind = ['full', 'bar', 'tick'].includes(body.kind) ? body.kind : 'tick';
  if (!validSymbol(symbol) || !TIMEFRAMES[tf]) return res.status(400).json({ ok: false, error: 'Símbolo ou timeframe inválido.' });

  const incoming = cleanCandles(body.candles);
  const meta = {
    bid: Number(body.bid) || null,
    ask: Number(body.ask) || null,
    digits: Number(body.digits) || null,
    broker: String(body.broker || '').slice(0, 80),
    server: String(body.server || '').slice(0, 80),
    updatedAt: Date.now()
  };

  if (kind === 'full') {
    await redis(['SET', histKey(email, symbol, tf), JSON.stringify({ candles: mergeCandles([], incoming) }), 'EX', TTL]);
    const index = (await readJson(indexKey(email))) || {};
    const entry = index[symbol] || { timeframes: [] };
    if (!entry.timeframes.includes(tf)) entry.timeframes.push(tf);
    index[symbol] = { ...entry, broker: meta.broker, server: meta.server, updatedAt: meta.updatedAt };
    await redis(['SET', indexKey(email), JSON.stringify(index), 'EX', TTL]);
  } else if (kind === 'bar') {
    const hist = (await readJson(histKey(email, symbol, tf))) || { candles: [] };
    await redis(['SET', histKey(email, symbol, tf), JSON.stringify({ candles: mergeCandles(hist.candles, incoming) }), 'EX', TTL]);
  }
  await redis(['SET', liveKey(email, symbol, tf), JSON.stringify({ ...meta, last: incoming.slice(-3) }), 'EX', TTL]);
  return res.status(200).json({ ok: true });
}

async function read(req, res) {
  const user = await getSessionUser(req);
  if (!user) return res.status(401).json({ ok: false, error: 'Inicia sessão para ver os gráficos do teu MetaTrader 5.' });
  const index = (await readJson(indexKey(user.email))) || {};

  if (req.query?.symbols) {
    const symbols = Object.entries(index).map(([symbol, v]) => ({ symbol, ...v }));
    return res.status(200).json({ ok: true, symbols: symbols.sort((a, b) => b.updatedAt - a.updatedAt) });
  }

  const symbol = String(req.query?.symbol || '');
  const tf = String(req.query?.timeframe || 'M5').toUpperCase();
  if (!validSymbol(symbol) || !TIMEFRAMES[tf]) return res.status(400).json({ ok: false, error: 'Símbolo ou timeframe inválido.' });
  const [hist, live] = await Promise.all([readJson(histKey(user.email, symbol, tf)), readJson(liveKey(user.email, symbol, tf))]);
  const record = live ? { ...live, candles: mergeCandles(hist?.candles || [], live.last || []) } : null;
  if (!record?.candles?.length) {
    return res.status(404).json({ ok: false, error: `O teu MT5 ainda não enviou ${symbol} ${tf}. Abre esse gráfico no MT5 com o EA GrafictraderBridge.` });
  }
  const mid = record.bid && record.ask ? (record.bid + record.ask) / 2 : record.candles.at(-1).close;
  let instructor = null;
  if (record.candles.length >= 260) {
    try { instructor = await instructorFromCandles(symbol, TIMEFRAMES[tf], record.candles, mid); } catch { instructor = null; }
  }
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    ok: true,
    symbol,
    timeframe: tf,
    interval: TIMEFRAMES[tf],
    broker: record.broker,
    server: record.server,
    bid: record.bid,
    ask: record.ask,
    digits: record.digits,
    updatedAt: record.updatedAt,
    live: Date.now() - record.updatedAt < 60000,
    candles: record.candles.slice(-300),
    instructor,
    needMoreHistory: record.candles.length < 260
  });
}

export default async function handler(req, res) {
  if (!redisConfigured()) {
    return res.status(503).json({ ok: false, setupRequired: true, error: 'A ponte MetaTrader 5 precisa de contas no servidor (KV_REST_API_URL / KV_REST_API_TOKEN).' });
  }
  try {
    if (req.method === 'POST') return await ingest(req, res);
    if (req.method === 'GET') return await read(req, res);
    return res.status(405).json({ ok: false, error: 'Método não permitido.' });
  } catch (error) {
    console.error('[MT5]', error?.message || error);
    return res.status(503).json({ ok: false, error: 'Ponte MT5 indisponível.' });
  }
}
