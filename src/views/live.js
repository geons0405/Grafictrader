import { createChart, CandlestickSeries } from 'lightweight-charts';
import { $, $$, api, fmtPrice, fmtPct, pairLabel } from '../lib/dom.js';
import { chartOptions, seriesOptions, onThemeChange, resolvedTheme } from '../lib/theme.js';
import { technicalReading } from '../lib/indicators.js';
import { market, setMarket, onMarketChange, intervalName } from '../lib/store.js';

const POLL_MS = 5000;
const WS_BASE = 'wss://data-stream.binance.vision/ws/';

let chart = null;
let series = null;
let candles = [];
let source = '';
let ticker = null;
let ws = null;
let wsRetry = 0;
let reconnectTimer = null;
let pollTimer = null;
let active = false;
let loadToken = 0;

function setConnection(label, detail, live = false) {
  $('#connection').textContent = label;
  $('#streamState').textContent = detail;
  $('.status-card').classList.toggle('is-live', live);
}

function ensureChart() {
  if (chart) return;
  const el = $('#chart');
  chart = createChart(el, { ...chartOptions(resolvedTheme()), autoSize: true });
  series = chart.addSeries(CandlestickSeries, seriesOptions(resolvedTheme()));
  onThemeChange(theme => {
    chart.applyOptions(chartOptions(theme));
    series.applyOptions(seriesOptions(theme));
  });
}

function upsertCandle(candle) {
  const last = candles.at(-1);
  if (last && last.time === candle.time) candles[candles.length - 1] = candle;
  else if (!last || candle.time > last.time) candles.push(candle);
  else return;
  if (candles.length > 500) candles.shift();
  series.update(candle);
}

function renderSummary() {
  const last = candles.at(-1);
  $('#pairLabel').textContent = pairLabel(market.symbol);
  $('#price').textContent = last ? fmtPrice(last.close) : '—';
  const change = $('#change');
  const pct = Number(ticker?.change24h);
  change.textContent = Number.isFinite(pct) ? fmtPct(pct) + ' · 24h' : '—';
  change.dataset.sign = Number.isFinite(pct) ? (pct >= 0 ? 'up' : 'down') : '';
  $('#chartMeta').textContent = (source || 'Mercado') + ' · ' + intervalName(market.interval);
  renderReading();
}

function renderReading() {
  const reading = technicalReading(candles);
  const trend = $('#trend');
  if (!reading) {
    trend.dataset.dir = '';
    trend.querySelector('span').textContent = '—';
    $('#structure').textContent = '—';
    $('#rsi').textContent = '—';
    $('#rsiState').textContent = 'Sem dados';
    $('#confidence').textContent = '—';
    $('#confidenceRing').style.setProperty('--value', 0);
    return;
  }
  trend.dataset.dir = reading.direction > 0 ? 'up' : reading.direction < 0 ? 'down' : 'flat';
  trend.querySelector('span').textContent = reading.trend;
  $('#structure').textContent = reading.structure.label;
  $('#rsi').textContent = reading.rsi == null ? '—' : reading.rsi.toFixed(1);
  $('#rsiState').textContent = reading.rsiState;
  $('#confidence').textContent = reading.confidence + '%';
  $('#confidenceRing').style.setProperty('--value', reading.confidence);
  $('#readingSummary').textContent = reading.summary;
  $('#support').textContent = fmtPrice(reading.support);
  $('#resistance').textContent = fmtPrice(reading.resistance);

  const max = Math.max(...reading.volumes, 1);
  $('#volumeBars').innerHTML = reading.volumes.map(v => `<i style="--h:${Math.max(8, Math.round((v / max) * 100))}%"></i>`).join('');
}

function closeSocket() {
  clearTimeout(reconnectTimer);
  if (ws) {
    ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
    ws.close();
    ws = null;
  }
}

// Real-time candles come from Binance's public market-data stream. While it is
// not open, REST polling through /api/market keeps the chart updated.
function connectSocket() {
  closeSocket();
  if (!active || !source.toLowerCase().includes('binance')) return;
  const socket = new WebSocket(`${WS_BASE}${market.symbol.toLowerCase()}@kline_${market.interval}`);
  ws = socket;
  socket.onopen = () => {
    wsRetry = 0;
    clearTimeout(pollTimer);
    setConnection('Ao vivo', 'Stream Binance', true);
  };
  socket.onmessage = event => {
    const k = JSON.parse(event.data)?.k;
    if (!k || k.s !== market.symbol || k.i !== market.interval) return;
    upsertCandle({ time: k.t / 1000, open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v });
    renderSummary();
  };
  socket.onclose = () => {
    if (ws !== socket) return;
    ws = null;
    setConnection('A reconectar', 'Polling ativo');
    schedulePoll();
    const delay = Math.min(30000, 2000 * 2 ** wsRetry++);
    reconnectTimer = setTimeout(connectSocket, delay);
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
      renderSummary();
      if (!ws) setConnection(source.includes('Binance') ? 'Atualizado' : 'Fallback', `${source} · ${POLL_MS / 1000}s`);
    } catch {
      if (token === loadToken) setConnection('Instável', 'A tentar novamente');
    }
    schedulePoll();
  }, POLL_MS);
}

async function load() {
  const token = ++loadToken;
  closeSocket();
  clearTimeout(pollTimer);
  candles = [];
  series.setData([]);
  setConnection('A ligar', 'A carregar ' + pairLabel(market.symbol));
  renderSummary();
  try {
    const data = await api(`/api/market?symbol=${market.symbol}&interval=${market.interval}`);
    if (token !== loadToken) return;
    candles = data.candles.map(k => ({ time: k.time, open: +k.open, high: +k.high, low: +k.low, close: +k.close, volume: +k.volume || 0 }));
    ticker = data.ticker;
    source = data.source || 'Mercado';
    series.setData(candles);
    chart.timeScale().fitContent();
    renderSummary();
    setConnection('Carregado', source);
    connectSocket();
  } catch (error) {
    if (token !== loadToken) return;
    setConnection('Sem dados', error.message || 'Fontes de mercado indisponíveis');
  }
  schedulePoll();
}

function syncControls() {
  $$('#assetChips .chip').forEach(chip => chip.classList.toggle('active', chip.dataset.symbol === market.symbol));
  $$('[data-interval]').forEach(btn => {
    const on = btn.dataset.interval === market.interval;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
  });
}

export function initLive() {
  $$('#assetChips .chip').forEach(chip => {
    chip.onclick = () => setMarket({ symbol: chip.dataset.symbol });
  });
  $$('[data-interval]').forEach(btn => {
    btn.onclick = () => setMarket({ interval: btn.dataset.interval });
  });

  const search = $('#assetSearch');
  const matches = () => {
    const q = search.value.trim().toLowerCase();
    return $$('#assetChips .chip').filter(chip => !q || chip.dataset.search.toLowerCase().includes(q));
  };
  search.oninput = () => {
    const visible = new Set(matches());
    $$('#assetChips .chip').forEach(chip => { chip.hidden = !visible.has(chip); });
  };
  search.onkeydown = event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const first = matches()[0];
    if (first) setMarket({ symbol: first.dataset.symbol });
    search.value = '';
    search.oninput();
    search.blur();
  };

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
}
