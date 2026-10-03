import { $, $$, api, escapeHtml, safeUrl, fmtPrice, fmtPriceShort, fmtPct, fmtCompact, fmtTime, pairLabel } from '../lib/dom.js';
import { market, onMarketChange, intervalName } from '../lib/store.js';
import { openSheet, closeSheet } from './sheet.js';

const TICKER_MS = 15000;
const MECHANICS_MS = 15000;
const FEED_MS = 30000;
const AI_MIN_INTERVAL_MS = 120000;

const METRICS = [
  ['priceEfficiency', 'Eficiência'],
  ['movementEnergy', 'Energia'],
  ['absorption', 'Absorção'],
  ['displacementCost', 'Custo de deslocação'],
  ['liquidityResistance', 'Resistência de liquidez'],
  ['marketOrderliness', 'Organização'],
  ['regimeStability', 'Estabilidade de regime'],
  ['structuralPressure', 'Pressão estrutural'],
  ['tradeFlow', 'Fluxo de trades', 'signed'],
  ['orderBookImbalance', 'Order book', 'signed'],
  ['spreadBps', 'Spread', 'bps'],
  ['executionSignature', 'Assinatura de execução']
];

const STATE_NOTES = {
  DIRECTIONAL_EXPANSION: 'Movimento eficiente e persistente, com expansão de energia direcional.',
  ABSORPTION: 'Atividade elevada com deslocamento contido. É um proxy OHLCV, não fluxo direto.',
  LIQUIDITY_CONFLICT: 'O preço está numa zona com muitas reações recentes: liquidez histórica a travar o movimento.',
  REGIME_TRANSITION: 'O comportamento estatístico recente diverge da janela anterior. Regime em transição.',
  RANGE_ROTATION: 'Baixa organização direcional e rotação entre estados.',
  MICRO_ABSORPTION: 'Fluxo agressor desequilibrado com pouco deslocamento na vela atual: compatível com absorção.',
  ORDER_BOOK_IMBALANCE: 'A profundidade imediata do livro está desequilibrada. Descreve liquidez agora, não intenção garantida.',
  LOW_INFORMATION: 'A evidência disponível ainda não chega para classificar um mecanismo dominante.'
};

let active = false;
let timers = {};
let events = [];
let tag = 'ALL';
let lastAi = { key: '', state: '', at: 0 };
let aiLoading = false;
const loading = {};

const humanState = state => String(state || 'LOW_INFORMATION').replaceAll('_', ' ').toLowerCase().replace(/^./, c => c.toUpperCase());

function schedule(name, fn, ms) {
  clearTimeout(timers[name]);
  if (active) timers[name] = setTimeout(fn, ms);
}

async function guarded(name, fn) {
  if (loading[name]) return;
  loading[name] = true;
  try { await fn(); } finally { loading[name] = false; }
}

function setDelta(el, value) {
  const n = Number(value);
  el.textContent = Number.isFinite(n) ? fmtPct(n) : '—';
  el.dataset.sign = Number.isFinite(n) ? (n >= 0 ? 'up' : 'down') : '';
}

async function loadTicker() {
  await guarded('ticker', async () => {
    try {
      const { data = [] } = await api('/api/ticker');
      const btc = data.find(x => x.symbol === 'BTCUSDT');
      const eth = data.find(x => x.symbol === 'ETHUSDT');
      $('#pulseBtcPrice').textContent = btc ? fmtPriceShort(btc.price) : '—';
      setDelta($('#pulseBtcChange'), btc?.change24h);
      $('#pulseEthPrice').textContent = eth ? fmtPriceShort(eth.price) : '—';
      setDelta($('#pulseEthChange'), eth?.change24h);
      const avg = data.length ? data.reduce((s, x) => s + Number(x.change24h || 0), 0) / data.length : 0;
      $('#pulseState').textContent = !data.length ? '—' : avg > 0.15 ? 'Risk on' : avg < -0.15 ? 'Risk off' : 'Misto';
    } catch {
      $('#pulseState').textContent = 'Offline';
    }
  });
  schedule('ticker', loadTicker, TICKER_MS);
}

async function loadMarketBoard() {
  try {
    const { ticker } = await api(`/api/market?symbol=${market.symbol}&interval=${market.interval}`);
    $('#intelAssetLabel').textContent = pairLabel(market.symbol);
    setDelta($('#intelMarketChange'), ticker.change24h);
    $('#intelMarketPrice').textContent = fmtPrice(ticker.price);
    $('#intelVolume').textContent = fmtCompact(ticker.volume24h);
    $('#intelHigh').textContent = fmtPrice(ticker.high24h);
    $('#intelLow').textContent = fmtPrice(ticker.low24h);
  } catch {
    $('#intelMarketPrice').textContent = 'Sem dados';
  }
}

function metricValue(value, kind) {
  if (value == null) return '—';
  if (kind === 'signed') return (value > 0 ? '+' : '') + value + '%';
  if (kind === 'bps') return value + ' bps';
  return value + '%';
}

function renderMechanics(data) {
  const m = data.metrics || {};
  $('#mechanicsGrid').innerHTML = METRICS.map(([key, label, kind]) => {
    const value = m[key];
    const bar = kind ? '' : `<span class="meter"><i style="--w:${Math.max(0, Math.min(100, Number(value) || 0))}%"></i></span>`;
    return `<div class="metric"><small>${label}</small><b>${metricValue(value, kind)}</b>${bar}</div>`;
  }).join('');

  $('#mechanicsState').textContent = humanState(data.state);
  const q = data.dataQuality || {};
  $('#mechanicsQuality').textContent = [
    `${q.candles || 0} velas`,
    q.trades ? `${q.tradeCount} trades` : 'sem trades',
    q.orderBook ? 'order book' : 'sem order book',
    intervalName(data.interval)
  ].join(' · ');
  $('#mechanicsNote').textContent = STATE_NOTES[data.state] || STATE_NOTES.LOW_INFORMATION;

  const memory = data.memory;
  if (!memory?.available) {
    $('#mechanicsMemory').textContent = 'Memória · histórico insuficiente';
  } else {
    const parts = [
      memory.transition ? `${humanState(memory.transition.from)} → ${humanState(memory.transition.to)}` : 'sem transição de estado',
      `${memory.durationBars} velas no estado atual`,
      `mudança ${memory.changeScore}%`
    ];
    if (memory.pattern?.sequence?.length) parts.push(`padrão repetido ${memory.pattern.occurrences}×`);
    if (memory.patternFamily) parts.push(`família ${memory.patternFamily.occurrences}× · ${memory.patternFamily.avgSimilarity}% semelhante`);
    const library = data.patternLibrary;
    if (library?.available) parts.push(`biblioteca ${library.patternCount ?? library.patterns?.length ?? 0} famílias`);
    $('#mechanicsMemory').textContent = 'Memória · ' + parts.join(' · ');
  }
}

async function loadMechanicsAi() {
  const key = market.symbol + ':' + market.interval;
  if (aiLoading) return;
  aiLoading = true;
  const el = $('#mechanicsAi');
  el.textContent = 'A IA está a interpretar o mecanismo…';
  try {
    const result = await api('/api/mechanics-ai', { method: 'POST', body: { symbol: market.symbol, interval: market.interval } });
    if (key !== market.symbol + ':' + market.interval) return;
    el.textContent = result.interpretation || 'Sem interpretação disponível.';
    $('#mechanicsAiMeta').textContent = `${result.provider} · ${fmtTime(result.updatedAt)}`;
    lastAi = { key, state: result.state, at: Date.now() };
  } catch (error) {
    el.textContent = error.status === 401 ? 'Inicia sessão para ver a interpretação por IA.'
      : error.status === 503 ? 'A IA mecânica não está configurada no servidor.'
      : error.status === 429 ? 'Limite de interpretações atingido. Tenta daqui a pouco.'
      : 'Interpretação IA indisponível neste momento.';
    lastAi = { key, state: '', at: Date.now() };
  } finally {
    aiLoading = false;
  }
}

async function loadMechanics() {
  await guarded('mechanics', async () => {
    try {
      const data = await api(`/api/mechanics?symbol=${market.symbol}&interval=${market.interval}`);
      renderMechanics(data);
      // Ask the AI again only when the market or mechanism changes, or when
      // the last interpretation is stale. This keeps Gemini usage bounded.
      const key = market.symbol + ':' + market.interval;
      const stale = Date.now() - lastAi.at > AI_MIN_INTERVAL_MS;
      if (lastAi.key !== key || lastAi.state !== data.state || stale) loadMechanicsAi();
    } catch {
      $('#mechanicsState').textContent = 'Offline';
      $('#mechanicsNote').textContent = 'Motor mecânico indisponível neste momento.';
    }
  });
  schedule('mechanics', loadMechanics, MECHANICS_MS);
}

const eventTags = event => (Array.isArray(event.tags) ? event.tags : event.tag ? [event.tag] : []);
const visibleEvents = () => (tag === 'ALL' ? events : events.filter(e => eventTags(e).includes(tag)));
const sentimentLabel = s => (s === 'bullish' ? 'Positivo' : s === 'bearish' ? 'Negativo' : 'Neutro');

function sparkline(values) {
  const nums = (Array.isArray(values) ? values : []).map(Number).filter(Number.isFinite);
  if (nums.length < 2) return '';
  const min = Math.min(...nums);
  const range = Math.max(...nums) - min || 1;
  const points = nums.map((v, i) => `${((i / (nums.length - 1)) * 100).toFixed(1)},${(28 - ((v - min) / range) * 24).toFixed(1)}`).join(' ');
  return `<svg class="sparkline" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>`;
}

function renderFeed() {
  const list = visibleEvents();
  $('#intelCount').textContent = list.length + (list.length === 1 ? ' evento' : ' eventos');
  if (!list.length) {
    $('#intelFeed').innerHTML = '<div class="card empty"><b>Nenhum evento</b><small>Experimenta outra tag ou atualiza.</small></div>';
    return;
  }
  $('#intelFeed').innerHTML = list.map((event, index) => `
    <button class="card event" type="button" data-index="${index}">
      <span class="event-top"><b>${escapeHtml(event.source || 'Fonte')}</b><small>${fmtTime(event.timestamp)}</small><span class="sentiment" data-sentiment="${escapeHtml(event.sentiment || 'neutral')}">${sentimentLabel(event.sentiment)}</span></span>
      <span class="event-body">
        <span class="event-title">${escapeHtml(event.headline || 'Evento de mercado')}</span>
        ${sparkline(event.sparkline)}
      </span>
      <span class="event-tags">${eventTags(event).map(t => `<span>#${escapeHtml(t)}</span>`).join('')}</span>
    </button>`).join('');
  $$('#intelFeed .event').forEach(button => {
    button.onclick = () => openEvent(visibleEvents()[Number(button.dataset.index)]);
  });
}

function openEvent(event) {
  if (!event) return;
  const url = safeUrl(event.url);
  const metrics = event.metrics
    ? Object.entries(event.metrics).filter(([k, v]) => k !== 'timestamp' && Number.isFinite(Number(v)))
      .map(([k, v]) => `<div><small>${escapeHtml(k)}</small><b>${escapeHtml(Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 }))}</b></div>`).join('')
    : '';
  $('#eventDetail').innerHTML = `
    <small class="muted-line">${escapeHtml(event.source || 'Fonte')} · ${sentimentLabel(event.sentiment)} · ${fmtTime(event.timestamp)}</small>
    <h2 class="event-headline">${escapeHtml(event.headline || 'Evento')}</h2>
    ${event.summary && event.summary !== event.headline ? `<p class="reading-summary">${escapeHtml(event.summary)}</p>` : ''}
    ${metrics ? `<div class="kv-grid">${metrics}</div>` : ''}
    ${url ? `<a class="btn btn-primary" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Abrir fonte original</a>` : ''}`;
  openSheet('#eventSheet');
}

async function loadFeed() {
  await guarded('feed', async () => {
    $('#intelStatus').textContent = 'A atualizar…';
    try {
      const data = await api('/api/intelligence?symbol=' + market.symbol);
      events = Array.isArray(data.events) ? data.events : [];
      renderFeed();
      const failed = data.failedSources || [];
      $('#intelStatus').textContent = `${data.activeSources?.length || 0}/${data.sourceCount || 4} fontes · ${fmtTime(data.updatedAt)}`;
      $('#intelStatus').title = failed.length ? failed.map(x => `${x.source}: ${x.error}`).join(' | ') : 'Todas as fontes responderam.';
    } catch (error) {
      $('#intelStatus').textContent = 'Agregador offline';
      $('#intelStatus').title = error.message;
    }
  });
  schedule('feed', loadFeed, FEED_MS);
}

function refreshAll() {
  loadTicker();
  loadMarketBoard();
  loadMechanics();
  loadFeed();
}

export function initIntel() {
  $('#intelRefresh').onclick = () => {
    lastAi.at = 0; // force a fresh interpretation (server still caches for 60s)
    refreshAll();
  };
  $$('#intelTags .chip').forEach(button => {
    button.onclick = () => {
      tag = button.dataset.tag;
      $$('#intelTags .chip').forEach(x => x.classList.toggle('active', x === button));
      renderFeed();
    };
  });
  onMarketChange(() => {
    $('#intelSubtitle').textContent = `${pairLabel(market.symbol)} · ${intervalName(market.interval)}`;
    if (active) refreshAll();
  });
  $('#intelSubtitle').textContent = `${pairLabel(market.symbol)} · ${intervalName(market.interval)}`;
  renderFeed();
}

export function activateIntel() {
  if (active) return;
  active = true;
  refreshAll();
}

export function deactivateIntel() {
  active = false;
  Object.values(timers).forEach(clearTimeout);
  timers = {};
  closeSheet('#eventSheet');
}
