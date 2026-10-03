import { createChart, CandlestickSeries, createSeriesMarkers, LineStyle } from 'lightweight-charts';
import { $, $$, api, escapeHtml, fmtPrice, fmtPriceShort, fmtPct, fmtCompact, pairLabel, fmtTime } from '../lib/dom.js';
import { chartOptions, seriesOptions, onThemeChange, resolvedTheme } from '../lib/theme.js';
import { market, setMarket, onMarketChange, intervalName, TV_SYMBOLS } from '../lib/store.js';
import { openSheet, closeSheet } from './sheet.js';

const POLL_MS = 5000;
const MT5_POLL_MS = 3000;
const INSTRUCTOR_MS = 15000;
const WS_BASE = 'wss://data-stream.binance.vision/ws/';
const TV_INTERVAL = { '1m': '1', '5m': '5', '15m': '15', '1h': '60', '4h': '240' };
const MT5_TF = { '1m': 'M1', '5m': 'M5', '15m': 'M15', '1h': 'H1', '4h': 'H4' };
const VIEW_KEY = 'grafictrader.instructorView';

let chart = null;
let series = null;
let markers = null;
let priceLines = [];
let candles = [];
let source = '';
let ticker = null;
let instructor = null;
let plan = null; // { chart: 'lw'|'tv', feed: 'binance'|'mt5'|null, symbol, mt5Symbol }
let mt5Symbols = [];
let mt5Meta = null;
let binanceList = null;
let ws = null;
let wsRetry = 0;
let reconnectTimer = null;
let pollTimer = null;
let instructorTimer = null;
let active = false;
let loadToken = 0;

const semantic = () => (resolvedTheme() === 'dark'
  ? { up: '#4ade80', down: '#f87171', neutral: '#d1d1d6' }
  : { up: '#15803d', down: '#dc2626', neutral: '#3a3a3d' });

const normalizeName = s => String(s || '').toUpperCase().replace(/^[A-Z0-9_]+:/, '').replace(/[^A-Z0-9]/g, '');

function setConnection(label, live = false) {
  $('#connection').textContent = label;
  $('#liveDot').classList.toggle('on', live);
}

function showNotice(html) {
  const el = $('#chartNotice');
  el.hidden = !html;
  el.innerHTML = html || '';
}

function ensureChart() {
  if (chart) return;
  chart = createChart($('#chart'), {
    ...chartOptions(resolvedTheme()),
    // The TradingView attribution required by the Lightweight Charts licence
    // is shown as a link under the chart and in Perfil > Créditos.
    layout: { ...chartOptions(resolvedTheme()).layout, attributionLogo: false },
    autoSize: true
  });
  series = chart.addSeries(CandlestickSeries, seriesOptions(resolvedTheme()));
  markers = createSeriesMarkers(series, []);
  onThemeChange(theme => {
    chart.applyOptions({ ...chartOptions(theme), layout: { ...chartOptions(theme).layout, attributionLogo: false } });
    series.applyOptions(seriesOptions(theme));
    renderOverlay();
    if (plan?.chart === 'tv') renderTradingView();
  });
}

/* ---------- which data feeds the current view ---------- */

function matchMt5(tvSymbol) {
  const want = normalizeName(tvSymbol);
  const aliases = { XAUUSD: ['GOLD'], XAGUSD: ['SILVER'], USOIL: ['WTI', 'XTIUSD', 'USOUSD'], UKOIL: ['BRENT', 'XBRUSD'], SPXUSD: ['US500', 'SPX500'], NSXUSD: ['USTEC', 'NAS100', 'US100'], DJI: ['US30'], DAX: ['GER40', 'DE40'] };
  const names = [want, ...(aliases[want] || [])];
  return mt5Symbols.find(s => names.some(n => normalizeName(s.symbol).startsWith(n)))?.symbol || null;
}

function computePlan() {
  if (market.source === 'binance') return { chart: 'lw', feed: 'binance', symbol: market.symbol };
  if (market.source === 'mt5') return { chart: 'lw', feed: 'mt5', mt5Symbol: market.mt5Symbol };
  const crypto = market.tvSymbol.match(/^BINANCE:([A-Z0-9]+USDT)$/);
  if (crypto) return { chart: 'tv', feed: 'binance', symbol: crypto[1] };
  const mt5 = matchMt5(market.tvSymbol);
  return mt5 ? { chart: 'tv', feed: 'mt5', mt5Symbol: mt5 } : { chart: 'tv', feed: null };
}

function assetLabel() {
  if (market.source === 'binance') return pairLabel(market.symbol);
  if (market.source === 'mt5') return market.mt5Symbol || 'Escolher';
  return TV_SYMBOLS.find(s => s.symbol === market.tvSymbol)?.name || market.tvSymbol.replace(/^[A-Z0-9_]+:/, '');
}

/* ---------- chart + quote ---------- */

function upsertCandle(candle) {
  const last = candles.at(-1);
  if (last && last.time === candle.time) candles[candles.length - 1] = candle;
  else if (!last || candle.time > last.time) candles.push(candle);
  else return;
  if (candles.length > 600) candles.shift();
  series.update(candle);
}

function renderQuote() {
  const last = candles.at(-1);
  const change = $('#change');
  if (plan?.feed === 'mt5' && mt5Meta) {
    const mid = mt5Meta.bid && mt5Meta.ask ? (mt5Meta.bid + mt5Meta.ask) / 2 : last?.close;
    $('#price').textContent = Number.isFinite(mid) ? mid.toFixed(mt5Meta.digits ?? 5) : '—';
    change.textContent = mt5Meta.bid ? `bid ${mt5Meta.bid} · ask ${mt5Meta.ask}` : '—';
    change.dataset.sign = '';
  } else if (plan?.feed === 'binance') {
    $('#price').textContent = last ? fmtPrice(last.close) : '—';
    const pct = Number(ticker?.change24h);
    change.textContent = Number.isFinite(pct) ? fmtPct(pct) + ' 24h' : '—';
    change.dataset.sign = Number.isFinite(pct) ? (pct >= 0 ? 'up' : 'down') : '';
  } else {
    $('#price').textContent = '';
    change.textContent = 'TradingView';
    change.dataset.sign = '';
  }
  const feedName = plan?.chart === 'tv' ? 'TradingView' : plan?.feed === 'mt5' ? (mt5Meta?.broker || 'MetaTrader 5') : (source || 'Binance');
  $('#chartMeta').textContent = feedName + ' · ' + intervalName(market.interval);
  if (instructor?.summary?.open && last) renderPnl(last.close);
}

function renderTradingView() {
  const el = $('#tvChart');
  el.innerHTML = '';
  const holder = document.createElement('div');
  holder.className = 'tradingview-widget-container';
  const inner = document.createElement('div');
  inner.className = 'tradingview-widget-container__widget';
  holder.appendChild(inner);
  const script = document.createElement('script');
  script.type = 'text/javascript';
  script.async = true;
  script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
  script.text = JSON.stringify({
    autosize: true,
    symbol: market.tvSymbol,
    interval: TV_INTERVAL[market.interval] || '5',
    timezone: 'Etc/UTC',
    theme: resolvedTheme(),
    style: '1',
    locale: 'br',
    allow_symbol_change: true,
    hide_side_toolbar: true,
    save_image: false,
    support_host: 'https://www.tradingview.com'
  });
  holder.appendChild(script);
  el.appendChild(holder);
  const token = loadToken;
  setTimeout(() => {
    if (token === loadToken && plan?.chart === 'tv' && !el.querySelector('iframe')) {
      showNotice('O gráfico TradingView não carregou nesta ligação. Experimenta a fonte Binance ou MetaTrader 5.');
    }
  }, 9000);
}

/* ---------- AI instructor ---------- */

function renderOverlay() {
  if (!series) return;
  const c = semantic();
  priceLines.forEach(line => series.removePriceLine(line));
  priceLines = [];
  if (!instructor || plan?.chart !== 'lw') {
    markers.setMarkers([]);
    return;
  }
  // Only the most recent operations inside the visible window keep the chart readable.
  const first = candles.at(-90)?.time ?? candles[0]?.time ?? 0;
  const list = [];
  for (const t of (instructor.trades || []).slice(-8)) {
    if (t.openedAt >= first) list.push({ time: t.openedAt, position: t.side === 'BUY' ? 'belowBar' : 'aboveBar', shape: t.side === 'BUY' ? 'arrowUp' : 'arrowDown', color: t.side === 'BUY' ? c.up : c.down });
    if (t.closedAt >= first) list.push({ time: t.closedAt, position: t.side === 'BUY' ? 'aboveBar' : 'belowBar', shape: 'circle', color: t.r >= 0 ? c.up : c.down, text: (t.r >= 0 ? '+' : '') + t.r + 'R' });
  }
  const open = instructor.summary?.open;
  if (open && open.openedAt >= first) {
    list.push({ time: open.openedAt, position: open.side === 'BUY' ? 'belowBar' : 'aboveBar', shape: open.side === 'BUY' ? 'arrowUp' : 'arrowDown', color: open.side === 'BUY' ? c.up : c.down, text: open.side === 'BUY' ? 'COMPRA' : 'VENDA' });
  }
  markers.setMarkers(list.sort((a, b) => a.time - b.time));
  const levels = instructor.plan;
  if (levels) {
    priceLines.push(series.createPriceLine({ price: levels.entry, color: c.neutral, lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: 'Entrada' }));
    priceLines.push(series.createPriceLine({ price: levels.stop, color: c.down, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'Stop' }));
    priceLines.push(series.createPriceLine({ price: levels.target, color: c.up, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'Alvo' }));
  }
}

function renderPnl(livePrice) {
  const open = instructor?.summary?.open;
  const pnl = $('#positionPnl');
  if (!open) {
    pnl.textContent = '';
    $('#positionPnlSub').textContent = '';
    return;
  }
  const risk = Math.abs(open.entry - (open.initialStop ?? open.stop)) || Math.abs(open.target - open.entry) / 2;
  const dir = open.side === 'BUY' ? 1 : -1;
  const r = risk > 0 ? ((livePrice - open.entry) * dir) / risk : 0;
  pnl.textContent = (r >= 0 ? '+' : '') + r.toFixed(2) + 'R';
  pnl.dataset.sign = r >= 0 ? 'up' : 'down';
  $('#positionPnlSub').textContent = fmtPct(((livePrice - open.entry) / open.entry) * 100 * dir) + ' ao vivo';
}

const fmtLevel = v => (plan?.feed === 'mt5' && mt5Meta?.digits != null ? Number(v).toFixed(mt5Meta.digits) : fmtPriceShort(v));

function renderInstructor() {
  const data = instructor;
  if (!data) return;
  const g = data.guidance || {};
  const s = data.summary;
  const open = s?.open;
  const label = plan?.feed === 'mt5' ? (plan.mt5Symbol || '') : pairLabel(data.symbol);
  $('#instructorMode').textContent = (data.mode === 'mt5' ? 'MT5 · ' : 'ao vivo · ') + fmtTime(data.updatedAt);

  const badge = $('#positionBadge');
  badge.textContent = g.action || '—';
  badge.dataset.side = g.tone === 'up' ? 'up' : g.tone === 'down' ? 'down' : '';
  $('#positionTitle').textContent = open
    ? `A IA ${open.side === 'BUY' ? 'comprou' : 'vendeu'} ${label} a ${fmtLevel(open.entry)}`
    : g.headline || 'A analisar…';
  $('#positionSub').textContent = open
    ? `Desde ${fmtTime(open.openedAt * 1000)} · ${open.bars} vela(s) · confiança ${open.confidence}%`
    : `${data.signal?.regimeLabel || '—'}${data.signal?.confidence ? ' · confiança ' + data.signal.confidence + '%' : ''}`;
  renderPnl(candles.at(-1)?.close ?? data.price);

  const levels = data.plan;
  $('#positionLevels').hidden = !levels;
  if (levels) {
    $('#lvEntry').textContent = fmtLevel(levels.entry);
    $('#lvStop').textContent = fmtLevel(levels.stop);
    $('#lvTarget').textContent = fmtLevel(levels.target);
  }

  $('#guideNow').textContent = g.now || '—';
  $('#guideWhy').innerHTML = (g.why || []).map(p => `<p>${escapeHtml(p)}</p>`).join('');
  $('#guideSteps').innerHTML = (g.steps || []).map(p => `<li>${escapeHtml(p)}</li>`).join('');
  $('#instructorReasons').innerHTML = (open?.reasons || data.signal?.reasons || []).map(r => `<li>${escapeHtml(r)}</li>`).join('');

  if (s) {
    $('#stWin').textContent = s.winRate == null ? '—' : s.winRate + '%';
    $('#stTrades').textContent = `${s.trades} (${s.wins}W/${s.losses}L)`;
    const stPnl = $('#stPnl');
    stPnl.textContent = (s.pnl >= 0 ? '+' : '-') + '$' + Math.abs(s.pnl).toFixed(2);
    stPnl.dataset.sign = s.pnl >= 0 ? 'up' : 'down';
  }
  $('#recentOps').innerHTML = (data.trades || []).slice(-12).reverse().map(t => `
    <div class="op">
      <span class="op-side" data-side="${t.side === 'BUY' ? 'up' : 'down'}">${t.side === 'BUY' ? 'COMPRA' : 'VENDA'}</span>
      <span class="op-prices">${fmtLevel(t.entry)} → ${fmtLevel(t.exit)}<small>${escapeHtml(t.exitReason)} · ${fmtTime(t.closedAt * 1000)}</small></span>
      <b data-sign="${t.r >= 0 ? 'up' : 'down'}">${t.r >= 0 ? '+' : ''}${t.r}R</b>
    </div>`).join('') || '<p class="muted-line">Ainda sem operações fechadas neste timeframe.</p>';
  renderOverlay();
}

function renderNoGuidance(message) {
  instructor = null;
  const badge = $('#positionBadge');
  badge.textContent = 'SEM DADOS';
  badge.dataset.side = '';
  $('#positionTitle').textContent = 'A IA ainda não tem dados deste ativo';
  $('#positionSub').textContent = '';
  $('#positionPnl').textContent = '';
  $('#positionPnlSub').textContent = '';
  $('#positionLevels').hidden = true;
  $('#guideNow').textContent = message;
  $('#guideWhy').innerHTML = '';
  $('#guideSteps').innerHTML = '';
  $('#instructorReasons').innerHTML = '';
  $('#instructorMode').textContent = 'TradingView';
  renderOverlay();
}

async function loadInstructor() {
  clearTimeout(instructorTimer);
  if (plan?.feed !== 'binance') return;
  const token = loadToken;
  try {
    const data = await api(`/api/instructor?symbol=${plan.symbol}&interval=${market.interval}`);
    if (token !== loadToken) return;
    instructor = data;
    renderInstructor();
  } catch (error) {
    if (token === loadToken) $('#instructorMode').textContent = 'IA indisponível · ' + error.message;
  }
  if (active) instructorTimer = setTimeout(loadInstructor, INSTRUCTOR_MS);
}

/* ---------- Binance feed ---------- */

function closeSocket() {
  clearTimeout(reconnectTimer);
  if (ws) {
    ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
    ws.close();
    ws = null;
  }
}

function connectSocket() {
  closeSocket();
  if (!active || plan?.feed !== 'binance' || !source.toLowerCase().includes('binance')) return;
  const symbol = plan.symbol;
  const socket = new WebSocket(`${WS_BASE}${symbol.toLowerCase()}@kline_${market.interval}`);
  ws = socket;
  socket.onopen = () => {
    wsRetry = 0;
    clearTimeout(pollTimer);
    setConnection(plan.chart === 'tv' ? 'Ao vivo · TradingView' : 'Ao vivo · Binance', true);
  };
  socket.onmessage = event => {
    const k = JSON.parse(event.data)?.k;
    if (!k || k.s !== symbol || k.i !== market.interval) return;
    upsertCandle({ time: k.t / 1000, open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v });
    renderQuote();
    if (k.x) setTimeout(loadInstructor, 1500);
  };
  socket.onclose = () => {
    if (ws !== socket) return;
    ws = null;
    setConnection('A reconectar…');
    scheduleBinancePoll();
    reconnectTimer = setTimeout(connectSocket, Math.min(30000, 2000 * 2 ** wsRetry++));
  };
}

function scheduleBinancePoll() {
  clearTimeout(pollTimer);
  if (!active) return;
  pollTimer = setTimeout(async () => {
    if (ws?.readyState === WebSocket.OPEN) return;
    const token = loadToken;
    try {
      const data = await api(`/api/market?symbol=${plan.symbol}&interval=${market.interval}`);
      if (token !== loadToken) return;
      ticker = data.ticker;
      source = data.source || source;
      for (const k of data.candles.slice(-10)) upsertCandle({ ...k });
      renderQuote();
      if (!ws) setConnection('Atualizado · ' + source, true);
    } catch {
      if (token === loadToken) setConnection('Instável · a tentar novamente');
    }
    scheduleBinancePoll();
  }, POLL_MS);
}

async function startBinance(token) {
  const data = await api(`/api/market?symbol=${plan.symbol}&interval=${market.interval}`);
  if (token !== loadToken) return;
  candles = data.candles.map(k => ({ time: k.time, open: +k.open, high: +k.high, low: +k.low, close: +k.close, volume: +k.volume || 0 }));
  ticker = data.ticker;
  source = data.source || 'Binance';
  series.setData(candles);
  chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, candles.length - 90), to: candles.length + 4 });
  renderQuote();
  setConnection(plan.chart === 'tv' ? 'TradingView' : 'Carregado · ' + source, true);
  connectSocket();
  scheduleBinancePoll();
  loadInstructor();
}

/* ---------- MetaTrader 5 feed ---------- */

async function refreshMt5Symbols() {
  try {
    const data = await api('/api/mt5?symbols=1');
    mt5Symbols = data.symbols || [];
  } catch {
    mt5Symbols = [];
  }
  return mt5Symbols;
}

async function pollMt5(first = false) {
  clearTimeout(pollTimer);
  const token = loadToken;
  try {
    const data = await api(`/api/mt5?symbol=${encodeURIComponent(plan.mt5Symbol)}&timeframe=${MT5_TF[market.interval]}`);
    if (token !== loadToken) return;
    mt5Meta = data;
    const rows = data.candles.map(c => ({ ...c }));
    if (first || !candles.length) {
      candles = rows;
      series.setData(candles);
      chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, candles.length - 90), to: candles.length + 4 });
    } else {
      for (const c of rows.slice(-3)) upsertCandle(c);
    }
    showNotice(data.needMoreHistory ? 'A receber histórico do teu MT5… a IA começa quando houver pelo menos 260 velas.' : '');
    setConnection(data.live ? `Ao vivo · ${data.broker || 'MT5'}` : 'MT5 sem ticks recentes', data.live);
    renderQuote();
    if (data.instructor) {
      instructor = data.instructor;
      renderInstructor();
    }
  } catch (error) {
    if (token !== loadToken) return;
    setConnection('MT5 indisponível');
    showNotice(escapeHtml(error.message) + ' <button type="button" class="link-btn" data-route="perfil">Ligar o MetaTrader 5</button>');
    if (!instructor) renderNoGuidance('Liga o teu MetaTrader 5 no Perfil para a IA analisar os preços da tua corretora.');
  }
  if (active && token === loadToken) pollTimer = setTimeout(() => pollMt5(false), MT5_POLL_MS);
}

async function startMt5(token) {
  if (!plan.mt5Symbol) {
    await refreshMt5Symbols();
    if (token !== loadToken) return;
    if (mt5Symbols.length && market.source === 'mt5') {
      setMarket({ mt5Symbol: mt5Symbols[0].symbol });
      return;
    }
    setConnection('MT5 não ligado');
    showNotice('Ainda não há dados do teu MetaTrader 5. <button type="button" class="link-btn" data-route="perfil">Ver como ligar</button>');
    renderNoGuidance('Liga o teu MetaTrader 5 no Perfil (EA GrafictraderBridge). Depois escolhe o ativo aqui.');
    return;
  }
  await pollMt5(true);
}

/* ---------- lifecycle ---------- */

async function load() {
  const token = ++loadToken;
  closeSocket();
  clearTimeout(pollTimer);
  clearTimeout(instructorTimer);
  candles = [];
  instructor = null;
  mt5Meta = null;
  series.setData([]);
  markers.setMarkers([]);
  priceLines.forEach(line => series.removePriceLine(line));
  priceLines = [];
  showNotice('');
  if (market.source === 'tradingview' && !mt5Symbols.length) await refreshMt5Symbols();
  if (token !== loadToken) return;
  plan = computePlan();

  $('#assetLabel').textContent = assetLabel();
  $('#chart').hidden = plan.chart !== 'lw';
  $('#tvChart').hidden = plan.chart !== 'tv';
  if (plan.chart === 'tv') renderTradingView();
  setConnection('A ligar…');
  renderQuote();

  try {
    if (plan.feed === 'binance') await startBinance(token);
    else if (plan.feed === 'mt5') await startMt5(token);
    else {
      setConnection('TradingView', true);
      renderNoGuidance('Neste ativo a IA precisa dos preços da tua corretora: liga o MetaTrader 5 no Perfil e abre o mesmo ativo no MT5. Para cripto, a IA usa os dados da Binance.');
    }
  } catch (error) {
    if (token === loadToken) setConnection('Sem dados · ' + (error.message || 'fontes indisponíveis'));
  }
}

function syncControls() {
  $$('#sources [data-source]').forEach(btn => btn.classList.toggle('active', btn.dataset.source === market.source));
  $$('#timeframes [data-interval]').forEach(btn => {
    const on = btn.dataset.interval === market.interval;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
  });
  $('#assetLabel').textContent = assetLabel();
}

/* ---------- asset picker ---------- */

function item(value, title, sub, meta = '') {
  return `<button type="button" class="asset-item" data-pick="${escapeHtml(value)}"><span><b>${escapeHtml(title)}</b><small>${escapeHtml(sub)}</small></span>${meta}</button>`;
}

async function renderAssetList() {
  const q = $('#assetSearch').value.trim().toUpperCase();
  const list = $('#assetList');
  if (market.source === 'binance') {
    if (!binanceList) {
      list.innerHTML = '<p class="muted-line">A carregar os mercados da Binance…</p>';
      try { binanceList = (await api('/api/market?list=1')).markets; } catch { binanceList = []; }
    }
    const rows = binanceList.filter(m => !q || m.symbol.includes(q)).slice(0, 120);
    list.innerHTML = rows.map(m => item(m.symbol, m.base + '/USDT', 'Vol. 24h ' + fmtCompact(m.volume24h),
      `<span class="asset-meta"><b>${fmtPrice(m.price)}</b><small data-sign="${m.change24h >= 0 ? 'up' : 'down'}">${fmtPct(m.change24h)}</small></span>`)).join('')
      || (/^[A-Z0-9]{2,16}$/.test(q) ? item(q + 'USDT', q + '/USDT', 'Abrir este par') : '<p class="muted-line">Nenhum mercado encontrado.</p>');
  } else if (market.source === 'tradingview') {
    const rows = TV_SYMBOLS.filter(s => !q || s.symbol.includes(q) || s.name.toUpperCase().includes(q));
    let html = '';
    let group = '';
    for (const s of rows) {
      if (s.group !== group) { group = s.group; html += `<small class="asset-group">${escapeHtml(group)}</small>`; }
      html += item(s.symbol, s.name, s.symbol);
    }
    if (q && /^[A-Z0-9_]+:[A-Z0-9._!]+$/.test(q)) html = item(q, q, 'Abrir no TradingView') + html;
    else if (q) html += item(`FX:${q.replace(/[^A-Z0-9]/g, '')}`, q, 'Procurar no TradingView');
    list.innerHTML = html;
  } else {
    list.innerHTML = '<p class="muted-line">A procurar os símbolos do teu MT5…</p>';
    await refreshMt5Symbols();
    const rows = mt5Symbols.filter(s => !q || s.symbol.toUpperCase().includes(q));
    list.innerHTML = rows.map(s => item(s.symbol, s.symbol, `${s.broker || 'MT5'} · ${s.timeframes.join(', ')}`,
      `<span class="asset-meta"><small>${Date.now() - s.updatedAt < 60000 ? 'ao vivo' : 'atualizado ' + fmtTime(s.updatedAt)}</small></span>`)).join('')
      || '<p class="muted-line">O teu MT5 ainda não enviou símbolos. Vai a Perfil > MetaTrader 5 para ligar.</p>';
  }
  $$('#assetList [data-pick]').forEach(btn => {
    btn.onclick = () => {
      const value = btn.dataset.pick;
      if (market.source === 'binance') setMarket({ symbol: value });
      else if (market.source === 'tradingview') setMarket({ tvSymbol: value });
      else setMarket({ mt5Symbol: value });
      closeSheet('#assetSheet');
    };
  });
}

export function initLive() {
  $('#assetPicker').onclick = () => {
    $('#assetSearch').value = '';
    $('#assetSheetTitle').textContent = market.source === 'binance' ? 'Mercados Binance' : market.source === 'tradingview' ? 'Ativos TradingView' : 'Símbolos do teu MT5';
    openSheet('#assetSheet');
    renderAssetList();
  };
  let searchTimer = null;
  $('#assetSearch').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(renderAssetList, 150); };

  $$('#sources [data-source]').forEach(btn => { btn.onclick = () => setMarket({ source: btn.dataset.source }); });
  $$('#timeframes [data-interval]').forEach(btn => { btn.onclick = () => setMarket({ interval: btn.dataset.interval }); });

  let view = 'guide';
  try { view = localStorage.getItem(VIEW_KEY) || 'guide'; } catch { /* default */ }
  const setView = name => {
    $$('#instructor [data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === name));
    $$('#instructor [data-pane]').forEach(p => { p.hidden = p.dataset.pane !== name; });
    try { localStorage.setItem(VIEW_KEY, name); } catch { /* ignore */ }
  };
  $$('#instructor [data-view]').forEach(btn => { btn.onclick = () => setView(btn.dataset.view); });
  setView(view === 'results' ? 'results' : 'guide');

  onMarketChange(() => {
    syncControls();
    if (active) load();
  });
  syncControls();
}

export function activateLive() {
  if (active) return;
  active = true;
  ensureChart();
  load();
}

export function deactivateLive() {
  active = false;
  loadToken++;
  closeSocket();
  clearTimeout(pollTimer);
  clearTimeout(instructorTimer);
}
