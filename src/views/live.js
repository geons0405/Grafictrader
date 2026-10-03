import { createChart, CandlestickSeries, createSeriesMarkers, LineStyle } from 'lightweight-charts';
import { $, $$, api, escapeHtml, fmtPrice, fmtPriceShort, fmtPct, pairLabel, fmtTime } from '../lib/dom.js';
import { chartOptions, seriesOptions, onThemeChange, resolvedTheme } from '../lib/theme.js';
import { market, setMarket, onMarketChange, intervalName } from '../lib/store.js';

const POLL_MS = 5000;
const INSTRUCTOR_MS = 15000;
const WS_BASE = 'wss://data-stream.binance.vision/ws/';

let chart = null;
let series = null;
let markers = null;
let priceLines = [];
let candles = [];
let source = '';
let ticker = null;
let instructor = null;
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

function setConnection(label, live = false) {
  $('#connection').textContent = label;
  $('#liveDot').classList.toggle('on', live);
}

function ensureChart() {
  if (chart) return;
  chart = createChart($('#chart'), { ...chartOptions(resolvedTheme()), autoSize: true });
  series = chart.addSeries(CandlestickSeries, seriesOptions(resolvedTheme()));
  markers = createSeriesMarkers(series, []);
  onThemeChange(theme => {
    chart.applyOptions(chartOptions(theme));
    series.applyOptions(seriesOptions(theme));
    renderOverlay();
  });
}

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
  $('#price').textContent = last ? fmtPrice(last.close) : '—';
  const pct = Number(ticker?.change24h);
  const change = $('#change');
  change.textContent = Number.isFinite(pct) ? fmtPct(pct) + ' 24h' : '—';
  change.dataset.sign = Number.isFinite(pct) ? (pct >= 0 ? 'up' : 'down') : '';
  $('#chartMeta').textContent = (source || 'Mercado') + ' · ' + intervalName(market.interval);
  if (instructor?.summary?.open && last) renderPosition(last.close);
}

/* ---------- AI instructor overlay ---------- */

function renderOverlay() {
  if (!series || !instructor) return;
  const c = semantic();
  // Only the most recent operations, inside the visible window, to keep the chart readable.
  const first = candles.at(-90)?.time ?? candles[0]?.time ?? 0;
  const list = [];
  for (const t of (instructor.trades || []).slice(-8)) {
    if (t.openedAt >= first) {
      list.push({ time: t.openedAt, position: t.side === 'BUY' ? 'belowBar' : 'aboveBar', shape: t.side === 'BUY' ? 'arrowUp' : 'arrowDown', color: t.side === 'BUY' ? c.up : c.down });
    }
    if (t.closedAt >= first) {
      list.push({ time: t.closedAt, position: t.side === 'BUY' ? 'aboveBar' : 'belowBar', shape: 'circle', color: t.r >= 0 ? c.up : c.down, text: (t.r >= 0 ? '+' : '') + t.r + 'R' });
    }
  }
  const open = instructor.summary?.open;
  if (open && open.openedAt >= first) {
    list.push({ time: open.openedAt, position: open.side === 'BUY' ? 'belowBar' : 'aboveBar', shape: open.side === 'BUY' ? 'arrowUp' : 'arrowDown', color: open.side === 'BUY' ? c.up : c.down, text: (open.side === 'BUY' ? 'COMPRA' : 'VENDA') + ' (aberta)' });
  }
  list.sort((a, b) => a.time - b.time);
  markers.setMarkers(list);

  priceLines.forEach(line => series.removePriceLine(line));
  priceLines = [];
  if (open) {
    priceLines.push(series.createPriceLine({ price: open.entry, color: c.neutral, lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: 'Entrada' }));
    priceLines.push(series.createPriceLine({ price: open.stop, color: c.down, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'Stop' }));
    priceLines.push(series.createPriceLine({ price: open.target, color: c.up, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'Alvo' }));
  }
}

function renderPosition(livePrice) {
  const open = instructor?.summary?.open;
  if (!open) return;
  // Targets sit at 2R, so the initial risk is half the entry→target distance
  // (the stop may already have moved to break-even).
  const initialRisk = Math.abs(open.target - open.entry) / 2;
  const r = initialRisk > 0 ? ((livePrice - open.entry) * (open.side === 'BUY' ? 1 : -1)) / initialRisk : 0;
  const pct = ((livePrice - open.entry) / open.entry) * 100 * (open.side === 'BUY' ? 1 : -1);
  const pnl = $('#positionPnl');
  pnl.textContent = (r >= 0 ? '+' : '') + r.toFixed(2) + 'R';
  pnl.dataset.sign = r >= 0 ? 'up' : 'down';
  $('#positionPnlSub').textContent = fmtPct(pct) + ' ao vivo';
}

function renderInstructor() {
  const data = instructor;
  if (!data) return;
  const s = data.summary;
  const open = s.open;
  $('#instructorMode').textContent = (data.mode === 'persistent' ? 'ao vivo · conta persistente' : 'ao vivo') + ' · ' + fmtTime(data.updatedAt);

  const badge = $('#positionBadge');
  if (open) {
    badge.textContent = open.side === 'BUY' ? 'COMPRA' : 'VENDA';
    badge.dataset.side = open.side === 'BUY' ? 'up' : 'down';
    $('#positionTitle').textContent = `${open.side === 'BUY' ? 'Comprou' : 'Vendeu'} ${pairLabel(data.symbol)} a ${fmtPrice(open.entry)}`;
    $('#positionSub').textContent = `Aberta às ${fmtTime(open.openedAt * 1000)} · ${open.bars} vela(s) · confiança ${open.confidence}%`;
    $('#positionLevels').hidden = false;
    $('#lvEntry').textContent = fmtPriceShort(open.entry);
    $('#lvStop').textContent = fmtPriceShort(open.stop);
    $('#lvTarget').textContent = fmtPriceShort(open.target);
    $('#instructorReasons').innerHTML = (open.reasons || []).map(r => `<li>${escapeHtml(r)}</li>`).join('');
    renderPosition(candles.at(-1)?.close ?? open.livePrice);
  } else {
    const sig = data.signal || {};
    badge.textContent = sig.action === 'COMPRAR' ? 'COMPRAR' : sig.action === 'VENDER' ? 'VENDER' : 'AGUARDAR';
    badge.dataset.side = sig.action === 'COMPRAR' ? 'up' : sig.action === 'VENDER' ? 'down' : '';
    $('#positionTitle').textContent = sig.action === 'AGUARDAR' || !sig.action ? 'Sem posição · a observar o mercado' : `Sinal de ${sig.action.toLowerCase()} a formar-se`;
    $('#positionSub').textContent = `Regime: ${sig.regimeLabel || '—'}`;
    $('#positionLevels').hidden = true;
    $('#positionPnl').textContent = '';
    $('#positionPnlSub').textContent = '';
    $('#instructorReasons').innerHTML = (sig.reasons || []).slice(0, 3).map(r => `<li>${escapeHtml(r)}</li>`).join('');
  }

  $('#stWin').textContent = s.winRate == null ? '—' : s.winRate + '%';
  $('#stTrades').textContent = `${s.trades} (${s.wins}W/${s.losses}L)`;
  const stPnl = $('#stPnl');
  stPnl.textContent = (s.pnl >= 0 ? '+' : '') + '$' + Math.abs(s.pnl).toFixed(2);
  stPnl.dataset.sign = s.pnl >= 0 ? 'up' : 'down';

  $('#recentOps').innerHTML = (data.trades || []).slice(-4).reverse().map(t => `
    <div class="op">
      <span class="op-side" data-side="${t.side === 'BUY' ? 'up' : 'down'}">${t.side === 'BUY' ? 'COMPRA' : 'VENDA'}</span>
      <span class="op-prices">${fmtPrice(t.entry)} → ${fmtPrice(t.exit)}<small>${escapeHtml(t.exitReason)} · ${fmtTime(t.closedAt * 1000)}</small></span>
      <b data-sign="${t.r >= 0 ? 'up' : 'down'}">${t.r >= 0 ? '+' : ''}${t.r}R</b>
    </div>`).join('') || '<p class="muted-line">Ainda sem operações fechadas neste timeframe.</p>';

  renderOverlay();
}

async function loadInstructor() {
  clearTimeout(instructorTimer);
  const token = loadToken;
  try {
    const data = await api(`/api/instructor?symbol=${market.symbol}&interval=${market.interval}`);
    if (token !== loadToken) return;
    instructor = data;
    renderInstructor();
  } catch (error) {
    if (token === loadToken) $('#instructorMode').textContent = 'instrutor indisponível · ' + error.message;
  }
  if (active) instructorTimer = setTimeout(loadInstructor, INSTRUCTOR_MS);
}

/* ---------- market data ---------- */

function closeSocket() {
  clearTimeout(reconnectTimer);
  if (ws) {
    ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
    ws.close();
    ws = null;
  }
}

// Real-time candles from Binance's public market-data stream; REST polling
// through /api/market covers the gaps while the stream is not open.
function connectSocket() {
  closeSocket();
  if (!active || !source.toLowerCase().includes('binance')) return;
  const socket = new WebSocket(`${WS_BASE}${market.symbol.toLowerCase()}@kline_${market.interval}`);
  ws = socket;
  socket.onopen = () => {
    wsRetry = 0;
    clearTimeout(pollTimer);
    setConnection('Ao vivo · Binance', true);
  };
  socket.onmessage = event => {
    const k = JSON.parse(event.data)?.k;
    if (!k || k.s !== market.symbol || k.i !== market.interval) return;
    upsertCandle({ time: k.t / 1000, open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v });
    renderQuote();
    // A closed candle is when the instructor can act: refresh right away.
    if (k.x) setTimeout(loadInstructor, 1500);
  };
  socket.onclose = () => {
    if (ws !== socket) return;
    ws = null;
    setConnection('A reconectar…');
    schedulePoll();
    reconnectTimer = setTimeout(connectSocket, Math.min(30000, 2000 * 2 ** wsRetry++));
  };
}

function schedulePoll() {
  clearTimeout(pollTimer);
  if (!active) return;
  pollTimer = setTimeout(async () => {
    if (ws?.readyState === WebSocket.OPEN) return;
    const token = loadToken;
    try {
      const data = await api(`/api/market?symbol=${market.symbol}&interval=${market.interval}`);
      if (token !== loadToken) return;
      ticker = data.ticker;
      source = data.source || source;
      for (const k of data.candles.slice(-10)) upsertCandle({ ...k });
      renderQuote();
      if (!ws) setConnection(source.includes('Binance') ? 'Atualizado · Binance' : 'Atualizado · ' + source, true);
    } catch {
      if (token === loadToken) setConnection('Instável · a tentar novamente');
    }
    schedulePoll();
  }, POLL_MS);
}

async function load() {
  const token = ++loadToken;
  closeSocket();
  clearTimeout(pollTimer);
  candles = [];
  instructor = null;
  series.setData([]);
  markers.setMarkers([]);
  priceLines.forEach(line => series.removePriceLine(line));
  priceLines = [];
  setConnection('A ligar…');
  try {
    const data = await api(`/api/market?symbol=${market.symbol}&interval=${market.interval}`);
    if (token !== loadToken) return;
    candles = data.candles.map(k => ({ time: k.time, open: +k.open, high: +k.high, low: +k.low, close: +k.close, volume: +k.volume || 0 }));
    ticker = data.ticker;
    source = data.source || 'Mercado';
    series.setData(candles);
    chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, candles.length - 90), to: candles.length + 4 });
    renderQuote();
    setConnection('Carregado · ' + source, true);
    connectSocket();
  } catch (error) {
    if (token !== loadToken) return;
    setConnection('Sem dados · ' + (error.message || 'fontes indisponíveis'));
  }
  schedulePoll();
  loadInstructor();
}

function syncControls() {
  $('#assetSelect').value = market.symbol;
  $$('#timeframes [data-interval]').forEach(btn => {
    const on = btn.dataset.interval === market.interval;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
  });
}

export function initLive() {
  $('#assetSelect').onchange = event => setMarket({ symbol: event.target.value });
  $$('#timeframes [data-interval]').forEach(btn => {
    btn.onclick = () => setMarket({ interval: btn.dataset.interval });
  });
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
