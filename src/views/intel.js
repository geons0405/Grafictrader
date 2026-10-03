import { createChart, LineSeries } from 'lightweight-charts';
import { $, $$, api, escapeHtml, safeUrl, fmtPrice, fmtPct, fmtTime, pairLabel } from '../lib/dom.js';
import { market, setMarket, onMarketChange, intervalName, ASSETS } from '../lib/store.js';
import { chartOptions, onThemeChange, resolvedTheme, chartPalette } from '../lib/theme.js';
import { renderIcons } from '../lib/icons.js';
import { openSheet, closeSheet } from './sheet.js';

const INSTRUCTOR_MS = 15000;
const DESK_MS = 30000;
const MECHANICS_MS = 20000;
const FEED_MS = 30000;
const GLOBAL_MS = 60000;
const AI_MIN_INTERVAL_MS = 120000;

// Muted per-asset hues, used only on the bot cards (as in the reference terminal).
const BOT_HUES = { BTCUSDT: '#c27c3a', ETHUSDT: '#6f73c9', SOLUSDT: '#3c9c88', BNBUSDT: '#b8962e', XRPUSDT: '#5f6b7a', ADAUSDT: '#4a72b0', DOGEUSDT: '#a8844f' };

const MECH_METRICS = [
  ['priceEfficiency', 'Eficiência do preço'],
  ['movementEnergy', 'Energia do movimento'],
  ['absorption', 'Absorção'],
  ['displacementCost', 'Custo de deslocação'],
  ['liquidityResistance', 'Resistência de liquidez'],
  ['marketOrderliness', 'Organização'],
  ['regimeStability', 'Estabilidade de regime'],
  ['executionSignature', 'Assinatura de execução']
];

const STATE_NOTES = {
  DIRECTIONAL_EXPANSION: 'Movimento eficiente e persistente, com expansão de energia direcional.',
  ABSORPTION: 'Atividade elevada com deslocamento contido: compatível com absorção.',
  LIQUIDITY_CONFLICT: 'Preço numa zona com muitas reações recentes: liquidez histórica a travar o movimento.',
  REGIME_TRANSITION: 'O comportamento estatístico recente diverge da janela anterior. Regime em transição.',
  RANGE_ROTATION: 'Baixa organização direcional e rotação entre estados.',
  MICRO_ABSORPTION: 'Fluxo agressor desequilibrado com pouco deslocamento: compatível com absorção.',
  ORDER_BOOK_IMBALANCE: 'Profundidade imediata do livro desequilibrada.',
  LOW_INFORMATION: 'A evidência ainda não chega para classificar um mecanismo dominante.'
};

let active = false;
let timers = {};
let events = [];
let tag = 'ALL';
let lastAi = { key: '', state: '', at: 0 };
let aiLoading = false;
let equityChart = null;
let equitySeries = null;
let startedAt = null;
let uptimeTimer = null;
let calendar = [];
const loading = {};

const sign = v => (v > 0 ? 'up' : v < 0 ? 'down' : '');
const humanState = state => String(state || 'LOW_INFORMATION').replaceAll('_', ' ');

function schedule(name, fn, ms) {
  clearTimeout(timers[name]);
  if (active) timers[name] = setTimeout(fn, ms);
}

async function guarded(name, fn) {
  if (loading[name]) return;
  loading[name] = true;
  try { await fn(); } finally { loading[name] = false; }
}

function sparkline(values, cls = 'spark') {
  const nums = (Array.isArray(values) ? values : []).map(Number).filter(Number.isFinite);
  if (nums.length < 2) return '';
  const min = Math.min(...nums);
  const range = Math.max(...nums) - min || 1;
  const pts = nums.map((v, i) => `${((i / (nums.length - 1)) * 100).toFixed(1)},${(28 - ((v - min) / range) * 24).toFixed(1)}`).join(' ');
  return `<svg class="${cls}" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>`;
}

function duration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const d = Math.floor(seconds / 86400);
  const h = String(Math.floor((seconds % 86400) / 3600)).padStart(2, '0');
  const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
  const s = String(Math.floor(seconds % 60)).padStart(2, '0');
  return (d ? d + 'd ' : '') + `${h}:${m}:${s}`;
}

function tickUptime() {
  $('#tUptime').textContent = startedAt ? duration(Date.now() / 1000 - startedAt) : '—';
  $$('#gCalendar [data-at]').forEach(el => { el.textContent = countdown(Number(el.dataset.at)); });
}

function countdown(at) {
  const diff = Math.round((at - Date.now()) / 1000);
  if (diff <= -1800) return 'saiu';
  if (diff <= 0) return 'agora';
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const sec = diff % 60;
  return h > 23 ? `${Math.floor(h / 24)}d ${h % 24}h` : h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(sec).padStart(2, '0')}s`;
}

/* ---------- international context ---------- */

function renderGlobal(data) {
  const risk = $('#gRisk');
  risk.textContent = data.risk?.label || '—';
  risk.dataset.sign = sign(data.risk?.score ?? 0);
  const groups = {};
  for (const m of data.markets || []) (groups[m.group] ||= []).push(m);
  $('#gMarkets').innerHTML = Object.entries(groups).map(([group, rows]) => `
    <div class="g-group"><small>${escapeHtml(group)}</small>
      ${rows.map(m => `<div class="g-row"><span class="g-name">${escapeHtml(m.name)}</span><span class="g-spark" data-sign="${sign(m.changePct ?? 0)}">${sparkline(m.spark)}</span><b>${m.price == null ? '—' : m.price.toLocaleString('en-US', { maximumFractionDigits: m.price < 10 ? 4 : 2 })}</b><span class="g-chg" data-sign="${sign(m.changePct ?? 0)}">${m.changePct == null ? '—' : fmtPct(m.changePct)}</span></div>`).join('')}
    </div>`).join('') || '<p class="term-note">Mercados globais indisponíveis neste momento.</p>';

  calendar = data.calendar || [];
  $('#gCalMeta').textContent = calendar.length ? calendar.length + ' eventos' : '—';
  $('#gCalendar').innerHTML = calendar.slice(0, 25).map(e => `
    <div class="cal-row" data-impact="${escapeHtml(e.impact)}">
      <span class="cal-impact" title="Impacto ${escapeHtml(e.impact)}"></span>
      <span class="cal-time"><b>${fmtTime(e.time)}</b><small data-at="${e.time}">${countdown(e.time)}</small></span>
      <span class="cal-main"><b>${escapeHtml(e.currency)}</b> ${escapeHtml(e.title)}<small>${e.actual ? 'Atual ' + escapeHtml(e.actual) + ' · ' : ''}Previsão ${escapeHtml(e.forecast || '—')} · Anterior ${escapeHtml(e.previous || '—')}</small></span>
    </div>`).join('') || '<p class="term-note">Calendário indisponível neste momento.</p>';

  const fng = data.fearGreed;
  $('#gFng').innerHTML = fng ? `
    <div class="fng-gauge"><span style="--v:${fng.value}"></span></div>
    <div class="fng-value"><strong>${fng.value}</strong><span>${escapeHtml(fng.label)}</span></div>
    <div class="fng-spark">${sparkline(fng.history)}</div>
    <p class="term-note">0 = medo extremo · 100 = ganância extrema. Medo extremo costuma aparecer perto de fundos; ganância extrema perto de topos.</p>`
    : '<p class="term-note">Índice indisponível.</p>';
}

async function loadGlobal() {
  await guarded('global', async () => {
    try {
      renderGlobal(await api('/api/global'));
    } catch {
      $('#gMarkets').innerHTML = '<p class="term-note">Mercados globais indisponíveis neste momento.</p>';
    }
  });
  schedule('global', loadGlobal, GLOBAL_MS);
}

/* ---------- instructor terminal ---------- */

function ensureEquityChart() {
  if (equityChart) return;
  equityChart = createChart($('#equityChart'), {
    ...chartOptions(resolvedTheme()),
    layout: { ...chartOptions(resolvedTheme()).layout, attributionLogo: false },
    autoSize: true,
    rightPriceScale: { borderVisible: false },
    timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
    handleScroll: false,
    handleScale: false
  });
  equitySeries = equityChart.addSeries(LineSeries, { color: chartPalette().up, lineWidth: 2, priceLineVisible: false, lastValueVisible: true });
  onThemeChange(theme => {
    equityChart.applyOptions({ ...chartOptions(theme), layout: { ...chartOptions(theme).layout, attributionLogo: false } });
    equitySeries.applyOptions({ color: chartPalette(theme).up });
  });
}

function quantRow(label, value, display, meter, note) {
  const w = Math.max(0, Math.min(100, meter));
  return `<div class="q-row"><span class="q-label">${label}</span><b>${display}</b><span class="q-meter"><i style="--w:${w}%"></i></span><small>${note}</small></div>`;
}

function renderQuant(q) {
  if (!q) {
    $('#tQuant').innerHTML = '<p class="term-note">Histórico insuficiente.</p>';
    return;
  }
  const f2 = v => (Number.isFinite(v) ? v.toFixed(2) : '—');
  const rows = [
    quantRow('Hurst (R/S corrigido)', q.hurst, f2(q.hurst), (q.hurst ?? 0.5) * 100, q.hurst > 0.55 ? 'persistente: tendências continuam' : q.hurst < 0.45 ? 'anti-persistente: tende a reverter' : 'próximo de passeio aleatório'),
    quantRow('Variance ratio VR(4)', q.varianceRatio, f2(q.varianceRatio), (q.varianceRatio ?? 1) * 50, q.varianceRatio > 1.05 ? 'momentum nos retornos' : q.varianceRatio < 0.95 ? 'retornos revertem' : 'sem autocorrelação'),
    quantRow('Deriva Kalman (z)', q.kalmanZ, f2(q.kalmanZ), 50 + (q.kalmanZ ?? 0) * 12.5, Math.abs(q.kalmanZ ?? 0) < 1 ? 'deriva escondida plana' : q.kalmanZ > 0 ? 'deriva escondida de alta' : 'deriva escondida de baixa'),
    quantRow('Entropia de permutação', q.entropy, f2(q.entropy), (q.entropy ?? 1) * 100, q.entropy < 0.95 ? 'sequência com estrutura' : 'ordem das velas quase aleatória'),
    quantRow('VPIN (toxicidade)', q.vpin, f2(q.vpin), (q.vpin ?? 0) * 100, q.vpin > 0.5 ? 'fluxo informado/tóxico elevado' : 'fluxo equilibrado'),
    quantRow('Fluxo de volume BVC', q.flowImbalance, Number.isFinite(q.flowImbalance) ? (q.flowImbalance * 100).toFixed(0) + '%' : '—', 50 + (q.flowImbalance ?? 0) * 50, q.flowImbalance > 0.05 ? 'pressão compradora' : q.flowImbalance < -0.05 ? 'pressão vendedora' : 'equilibrado'),
    quantRow('Volatilidade Garman-Klass', q.volPercentile, Number.isFinite(q.volPercentile) ? 'P' + Math.round(q.volPercentile * 100) : '—', (q.volPercentile ?? 0) * 100, q.volPercentile > 0.9 ? 'regime de volatilidade extrema' : q.volPercentile < 0.2 ? 'compressão: possível expansão' : 'volatilidade normal'),
    quantRow('Desvio do VWAP (z)', q.vwapZ, f2(q.vwapZ), 50 + (q.vwapZ ?? 0) * 16, Math.abs(q.vwapZ ?? 0) > 2 ? 'preço esticado face ao VWAP' : 'perto do preço justo de volume'),
    quantRow('Autocorrelação lag-1', q.autocorr, f2(q.autocorr), 50 + (q.autocorr ?? 0) * 200, Math.abs(q.autocorr ?? 0) < 0.05 ? 'sem memória de curto prazo' : q.autocorr > 0 ? 'velas seguem a anterior' : 'velas alternam')
  ];
  $('#tQuant').innerHTML = rows.join('');
}

function renderContext(ctx, signal) {
  const pct = v => (Number.isFinite(v) ? (v > 0 ? '+' : '') + Math.round(v * 100) + '%' : '—');
  const row = (label, v, note) => `<div class="c-row"><span>${label}</span><span class="c-bar"><i style="--l:${50 + Math.min(0, (v ?? 0) * 50)}%;--w:${Math.abs((v ?? 0) * 50)}%" data-sign="${sign(v ?? 0)}"></i></span><b data-sign="${sign(v ?? 0)}">${pct(v)}</b><small>${note}</small></div>`;
  const news = ctx?.news || {};
  $('#tContext').innerHTML = ctx ? [
    row('Fluxo agressor', ctx.flow, 'últimos 500 trades'),
    row('Livro de ordens', ctx.book, 'topo 10 níveis'),
    row('Notícias (3h)', news.total ? news.score : null, `${news.bullish || 0} positivas · ${news.bearish || 0} negativas`),
    row('Mercados mundiais', ctx.global?.score ?? null, ctx.global?.label || 'sem dados'),
    eventRow(ctx.eventRisk)
  ].join('') : '<p class="term-note">Contexto indisponível.</p>';
  const score = $('#tContextScore');
  score.textContent = ctx ? 'score ' + pct(ctx.score) : '—';
  score.dataset.sign = sign(ctx?.score ?? 0);

  const decision = $('#tDecision');
  decision.textContent = signal ? `${signal.action}${signal.confidence ? ' · ' + signal.confidence + '%' : ''}` : '—';
  decision.dataset.sign = signal?.action === 'COMPRAR' ? 'up' : signal?.action === 'VENDER' ? 'down' : '';
  $('#tDecisionReasons').innerHTML = (signal?.reasons || []).map(r => `<li>${escapeHtml(r)}</li>`).join('');
}

function eventRow(risk) {
  if (!risk) return '';
  if (risk.blocked && risk.event) {
    return `<div class="c-event" data-sign="down"><b>NOTÍCIA FORTE AGORA</b><small>${escapeHtml(risk.event.currency)} · ${escapeHtml(risk.event.title)} · a IA não abre operações</small></div>`;
  }
  if (risk.next) {
    return `<div class="c-event"><b>PRÓXIMA NOTÍCIA FORTE</b><small>${escapeHtml(risk.next.currency)} · ${escapeHtml(risk.next.title)} · ${fmtTime(risk.next.time)}</small></div>`;
  }
  return '';
}

function renderBook(book, price) {
  const asks = (book?.asks || []).slice(0, 6).reverse();
  const bids = (book?.bids || []).slice(0, 6);
  const max = Math.max(...asks.map(r => r.quantity), ...bids.map(r => r.quantity), 1e-9);
  const row = (r, side) => `<div class="b-row" data-side="${side}"><span>${fmtPrice(r.price)}</span><span class="b-bar"><i style="--w:${(r.quantity / max) * 100}%"></i></span><span>${r.quantity.toFixed(3)}</span></div>`;
  $('#tBook').innerHTML = asks.map(r => row(r, 'ask')).join('') + `<div class="b-mid">${fmtPrice(price)}</div>` + bids.map(r => row(r, 'bid')).join('');
  const bestBid = bids[0]?.price;
  const bestAsk = book?.asks?.[0]?.price;
  $('#tSpread').textContent = bestBid && bestAsk ? 'spread ' + (((bestAsk - bestBid) / ((bestAsk + bestBid) / 2)) * 10000).toFixed(2) + ' bps' : 'spread —';
}

function renderLog(log) {
  $('#tLogCount').textContent = (log?.length || 0) + ' eventos';
  $('#tLog').innerHTML = (log || []).slice().reverse().map(item =>
    `<div class="l-row" data-kind="${escapeHtml(item.kind)}"><span>[${fmtTime(item.time * 1000)}]</span><span>${escapeHtml(item.text)}</span></div>`).join('') || '<p class="term-note">Sem atividade ainda.</p>';
}

function renderTerminal(data) {
  const s = data.summary;
  startedAt = s.startedAt;
  tickUptime();
  $('#tSymbol').textContent = pairLabel(data.symbol) + ' · ' + market.interval;
  $('#tStreak').textContent = s.streak;
  $('#tCycle').textContent = '#' + s.cycle;
  $('#tAlive').textContent = data.mode === 'persistent' ? 'ATIVO' : 'ATIVO (REPLAY)';

  const equity = data.equity || [];
  $('#tBalance').textContent = '$' + s.balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  $('#tBalanceSpark').innerHTML = sparkline(equity.slice(-80).map(p => p.value));
  const pnl = $('#tPnl');
  pnl.textContent = (s.pnl >= 0 ? '+$' : '-$') + Math.abs(s.pnl).toFixed(2);
  pnl.dataset.sign = sign(s.pnl);
  $('#tPnlSpark').innerHTML = sparkline(equity.slice(-80).map(p => p.value - s.startBalance));
  $('#tPnlSub').textContent = fmtPct(s.pnlPct) + ' · ' + s.totalR + 'R' + (s.profitFactor ? ' · PF ' + s.profitFactor : '');
  const pos = $('#tPosition');
  if (s.open) {
    pos.textContent = s.open.side === 'BUY' ? 'COMPRA' : 'VENDA';
    pos.dataset.sign = s.open.side === 'BUY' ? 'up' : 'down';
    $('#tPositionSub').textContent = `@ ${fmtPrice(s.open.entry)} · ${s.open.unrealizedR >= 0 ? '+' : ''}${s.open.unrealizedR}R`;
  } else {
    pos.textContent = 'SEM POSIÇÃO';
    pos.dataset.sign = '';
    $('#tPositionSub').textContent = 'a observar · ' + (data.signal?.regimeLabel || '—');
  }
  $('#tWinRate').textContent = s.winRate == null ? '—' : s.winRate + '%';
  $('#tWinSub').textContent = `${s.wins}W / ${s.losses}L · ${s.trades} operações`;

  ensureEquityChart();
  equitySeries.setData(equity.map(p => ({ time: p.time, value: p.value })));
  equityChart.timeScale().fitContent();
  $('#tEquityMeta').textContent = `${equity.length} velas · ${intervalName(market.interval)}`;

  renderLog(data.log);
  $('#tBookTitle').textContent = '// ORDER BOOK · ' + pairLabel(data.symbol);
  renderBook(data.orderBook, data.price);
  $('#tRegime').textContent = data.signal?.regimeLabel || '—';
  renderQuant(data.quant);
  renderContext(data.context, data.signal);
}

async function loadTerminal() {
  await guarded('terminal', async () => {
    try {
      renderTerminal(await api(`/api/instructor?symbol=${market.symbol}&interval=${market.interval}`));
    } catch (error) {
      $('#tAlive').textContent = 'OFFLINE';
      $('#tLog').innerHTML = `<p class="term-note">Instrutor indisponível: ${escapeHtml(error.message)}</p>`;
    }
  });
  schedule('terminal', loadTerminal, INSTRUCTOR_MS);
}

/* ---------- bots desk ---------- */

async function loadDesk() {
  await guarded('desk', async () => {
    try {
      const { desk = [] } = await api(`/api/instructor?desk=1&interval=${market.interval}`);
      $('#tBots').innerHTML = desk.map((bot, i) => {
        const asset = ASSETS.find(a => a.symbol === bot.symbol);
        const open = bot.summary?.open;
        const icon = open ? (open.side === 'BUY' ? 'trending-up' : 'trending-down') : 'pause';
        const state = !bot.ok ? 'offline' : open ? (open.side === 'BUY' ? 'compra' : 'venda') : 'a observar';
        return `<button class="bot${bot.symbol === market.symbol ? ' active' : ''}" type="button" data-bot="${bot.symbol}" style="--hue:${BOT_HUES[bot.symbol]}">
          <small>${String(i + 1).padStart(2, '0')}</small>
          <span class="bot-icon"><i data-lucide="${icon}"></i></span>
          <b>${asset?.short || bot.symbol}</b>
          <span class="bot-state">${state}</span>
          <span class="bot-pnl" data-sign="${sign(bot.summary?.pnl ?? 0)}">${bot.ok ? fmtPct(bot.summary.pnlPct) : '—'}</span>
        </button>`;
      }).join('');
      renderIcons();
      $$('#tBots [data-bot]').forEach(btn => { btn.onclick = () => setMarket({ symbol: btn.dataset.bot }); });
    } catch {
      $('#tBots').innerHTML = '';
    }
  });
  schedule('desk', loadDesk, DESK_MS);
}

/* ---------- market mechanics + AI ---------- */

async function loadMechanicsAi(state) {
  const key = market.symbol + ':' + market.interval;
  if (aiLoading) return;
  aiLoading = true;
  const el = $('#mechanicsAi');
  try {
    const result = await api('/api/mechanics-ai', { method: 'POST', body: { symbol: market.symbol, interval: market.interval } });
    if (key === market.symbol + ':' + market.interval) el.textContent = result.interpretation || 'Sem interpretação disponível.';
  } catch (error) {
    el.textContent = error.status === 401 ? 'Inicia sessão para ver a leitura por IA.'
      : error.status === 503 ? 'A leitura por IA não está configurada no servidor.'
      : error.status === 429 ? 'Limite de leituras atingido. Tenta daqui a pouco.'
      : 'Leitura IA indisponível neste momento.';
  } finally {
    lastAi = { key, state, at: Date.now() };
    aiLoading = false;
  }
}

async function loadMechanics() {
  await guarded('mechanics', async () => {
    try {
      const data = await api(`/api/mechanics?symbol=${market.symbol}&interval=${market.interval}`);
      const m = data.metrics || {};
      $('#mechanicsGrid').innerHTML = MECH_METRICS.map(([key, label]) =>
        quantRow(label, m[key], m[key] == null ? '—' : m[key] + '%', m[key] ?? 0, '')).join('');
      $('#mechanicsState').textContent = humanState(data.state);
      $('#mechanicsNote').textContent = STATE_NOTES[data.state] || STATE_NOTES.LOW_INFORMATION;
      const key = market.symbol + ':' + market.interval;
      if (lastAi.key !== key || lastAi.state !== data.state || Date.now() - lastAi.at > AI_MIN_INTERVAL_MS) loadMechanicsAi(data.state);
    } catch {
      $('#mechanicsState').textContent = 'OFFLINE';
    }
  });
  schedule('mechanics', loadMechanics, MECHANICS_MS);
}

/* ---------- news feed ---------- */

const eventTags = event => (Array.isArray(event.tags) ? event.tags : event.tag ? [event.tag] : []);
const visibleEvents = () => (tag === 'ALL' ? events : events.filter(e => eventTags(e).includes(tag)));
const sentimentLabel = s => (s === 'bullish' ? 'POSITIVO' : s === 'bearish' ? 'NEGATIVO' : 'NEUTRO');

function renderFeed() {
  const list = visibleEvents().slice(0, 40);
  $('#intelFeed').innerHTML = list.map((event, i) => `
    <button class="f-row" type="button" data-index="${i}">
      <span class="f-time">[${fmtTime(event.timestamp)}]</span>
      <span class="f-main"><b>${escapeHtml(event.source || 'Fonte')}</b> ${escapeHtml(event.headline || 'Evento')}</span>
      <span class="f-sent" data-sentiment="${escapeHtml(event.sentiment || 'neutral')}">${sentimentLabel(event.sentiment)}</span>
    </button>`).join('') || '<p class="term-note">Sem eventos para este filtro.</p>';
  $$('#intelFeed .f-row').forEach(btn => { btn.onclick = () => openEvent(list[Number(btn.dataset.index)]); });
}

function openEvent(event) {
  if (!event) return;
  const url = safeUrl(event.url);
  $('#eventDetail').innerHTML = `
    <small class="muted-line">${escapeHtml(event.source || 'Fonte')} · ${sentimentLabel(event.sentiment)} · ${fmtTime(event.timestamp)}</small>
    <h2 class="event-headline">${escapeHtml(event.headline || 'Evento')}</h2>
    ${event.summary && event.summary !== event.headline ? `<p class="reading-summary">${escapeHtml(event.summary)}</p>` : ''}
    ${url ? `<a class="btn btn-primary" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Abrir fonte original</a>` : ''}`;
  openSheet('#eventSheet');
}

async function loadFeed() {
  await guarded('feed', async () => {
    try {
      const data = await api('/api/intelligence?symbol=' + market.symbol);
      events = Array.isArray(data.events) ? data.events : [];
      renderFeed();
      $('#intelStatus').textContent = `${data.activeSources?.length || 0}/${data.sourceCount || 4} fontes · ${fmtTime(data.updatedAt)}`;
    } catch {
      $('#intelStatus').textContent = 'agregador offline';
    }
  });
  schedule('feed', loadFeed, FEED_MS);
}

function refreshAll() {
  loadGlobal();
  loadTerminal();
  loadDesk();
  loadMechanics();
  loadFeed();
}

export function initIntel() {
  $('#intelRefresh').onclick = () => { lastAi.at = 0; refreshAll(); };
  $$('#intelTags [data-tag]').forEach(button => {
    button.onclick = () => {
      tag = button.dataset.tag;
      $$('#intelTags [data-tag]').forEach(x => x.classList.toggle('active', x === button));
      renderFeed();
    };
  });
  onMarketChange(() => { if (active) refreshAll(); });
}

export function activateIntel() {
  if (active) return;
  active = true;
  uptimeTimer = setInterval(tickUptime, 1000);
  refreshAll();
}

export function deactivateIntel() {
  active = false;
  Object.values(timers).forEach(clearTimeout);
  timers = {};
  clearInterval(uptimeTimer);
  closeSheet('#eventSheet');
}
