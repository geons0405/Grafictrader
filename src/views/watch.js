import { $, $$, api, escapeHtml, fmtTime } from '../lib/dom.js';
import { renderIcons } from '../lib/icons.js';
import { frameSignature, frameDiff, shouldSend, createStabilizer } from '../lib/watch-core.js';
import { Capacitor, registerPlugin } from '@capacitor/core';

// "Minha corretora": the AI watches the user's own broker (shared screen on a
// computer, camera on a phone, or a recorded video) and keeps its advice up
// to date while the user trades there.

const MAX_SIDE = 1600;
const MIN_GAP_MS = 8000;
const MAX_GAP_MS = 45000;
const SESSION_LIMIT_MS = 45 * 60 * 1000;
const PREFS_KEY = 'grafictrader.watchPrefs';
const LABEL = { COMPRAR: 'COMPRAR', VENDER: 'VENDER', AGUARDAR: 'NÃO OPERAR' };
const SIDE = { COMPRAR: 'up', VENDER: 'down', AGUARDAR: '' };
// Android app: native screen capture of the broker app with a floating bubble.
const Native = Capacitor.isNativePlatform() ? registerPlugin('GrafictraderNative') : null;

let stream = null;
let kind = null; // 'screen' | 'camera' | 'file' | 'native'
let fileUrl = null;
let imageCapture = null;
let ticker = null;
let inflight = false;
let lastSig = null;
let lastSentAt = null;
let minGap = MIN_GAP_MS;
let startedAt = null;
let analyses = 0;
let history = [];
let lastByDecision = {};
let current = null;
let pipWindow = null;
let prefs = { voice: false, alerts: false };
const stabilizer = createStabilizer({ confirmations: 2 });
const tiny = document.createElement('canvas');
tiny.width = 96;
tiny.height = 54;
const tinyCtx = tiny.getContext('2d', { willReadFrequently: true });

function loadPrefs() {
  try { prefs = { ...prefs, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }; } catch { /* defaults */ }
}
function savePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
}

function setStatus(text) {
  $('#watchStatus').textContent = text;
  $('#watchHudStatus').textContent = text;
}

/** Full-screen stage while the AI watches; the card returns to normal size to read the analysis. */
function setExpanded(on) {
  $('.watch-card').classList.toggle('expanded', on);
  // The FOTO camera may also be open full screen: keep the page locked while either is.
  document.body.classList.toggle('stage-open', Boolean(document.querySelector('.camera-card.expanded, .watch-card.expanded')));
}

function isRunning() {
  return Boolean(stream || kind === 'file' || kind === 'native');
}

/* ---------- capture ---------- */

async function grabSource() {
  if (imageCapture) {
    try {
      // grabFrame reads straight from the track, so it keeps working while
      // the user is in the broker window and this tab is in the background.
      return await imageCapture.grabFrame();
    } catch { /* fall back to the video element */ }
  }
  const video = $('#watchVideo');
  return video.videoWidth ? video : null;
}

function sizeOf(source) {
  return { w: source.videoWidth || source.width, h: source.videoHeight || source.height };
}

function toJpeg(source) {
  const { w, h } = sizeOf(source);
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.8);
}

async function tick() {
  if (!isRunning() || inflight) return;
  if (Date.now() - startedAt > SESSION_LIMIT_MS) {
    stop('Sessão terminada ao fim de 45 minutos para poupar análises. Toca para continuar quando quiseres.');
    return;
  }
  const source = await grabSource();
  if (!source) return;
  const release = () => source.close?.();
  const { w, h } = sizeOf(source);
  if (!w || !h) return release();
  tinyCtx.drawImage(source, 0, 0, tiny.width, tiny.height);
  const sig = frameSignature(tinyCtx.getImageData(0, 0, tiny.width, tiny.height).data);
  const now = Date.now();
  if (!shouldSend({ now, lastSentAt, diff: frameDiff(sig, lastSig), minGapMs: minGap, maxGapMs: MAX_GAP_MS })) {
    release();
    updateClock();
    return;
  }
  lastSig = sig;
  lastSentAt = now;
  inflight = true;
  setStatus('A analisar o gráfico…');
  const image = toJpeg(source);
  release();
  try {
    const previous = current ? { decision: current.verdict.decision, asset: current.vision.asset, timeframe: current.vision.timeframe } : null;
    const data = await api('/api/watch', { method: 'POST', body: { image, previous } });
    analyses += 1;
    minGap = MIN_GAP_MS;
    handleResult(data);
  } catch (error) {
    if (error.status === 429) {
      minGap = 20000;
      setStatus('Muitas análises seguidas: a abrandar para uma a cada 20 s.');
    } else if (error.status === 401 || error.status === 503) {
      stop(error.status === 401 ? 'Inicia sessão para usar a análise ao vivo.' : error.message);
    } else {
      setStatus('Falhou uma análise (' + error.message + '). A tentar de novo…');
    }
  } finally {
    inflight = false;
  }
}

function updateClock() {
  if (!lastSentAt || inflight) return;
  const ago = Math.round((Date.now() - lastSentAt) / 1000);
  setStatus(`Ao vivo · ${analyses} análise(s) · última há ${ago}s · analisa quando o gráfico muda`);
}

function startTicker() {
  stopTicker();
  // A worker clock is not throttled like page timers in a background tab.
  try {
    const blob = new Blob(['setInterval(() => postMessage(0), 1000);'], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    ticker = new Worker(url);
    URL.revokeObjectURL(url);
    ticker.onmessage = tick;
  } catch {
    ticker = setInterval(tick, 1000);
  }
}

function stopTicker() {
  if (ticker instanceof Worker) ticker.terminate();
  else if (ticker) clearInterval(ticker);
  ticker = null;
}

async function begin(newStream, newKind, { keepSource = false } = {}) {
  if (!keepSource) stop();
  stream = newStream;
  kind = newKind;
  const video = $('#watchVideo');
  if (stream) {
    video.srcObject = stream;
    const track = stream.getVideoTracks()[0];
    imageCapture = 'ImageCapture' in window && track ? new window.ImageCapture(track) : null;
    track?.addEventListener('ended', () => stop('A partilha terminou.'));
  }
  if (kind !== 'native') await video.play().catch(() => {});
  startedAt = Date.now();
  analyses = 0;
  lastSig = null;
  lastSentAt = null;
  history = [];
  lastByDecision = {};
  current = null;
  stabilizer.reset();
  $('#watchStage').classList.add('active');
  $('#watchStage').dataset.kind = kind;
  $('#watchHudNow').textContent = 'A preparar a primeira análise…';
  setExpanded(kind !== 'native');
  $('#watchEmpty').hidden = true;
  $('#watchStop').hidden = false;
  $('#watchStarts').hidden = true;
  document.body.classList.add('is-watching');
  setStatus('A preparar a primeira análise…');
  renderHistory();
  if (kind === 'native') {
    $('#watchStage').classList.remove('active');
    setStatus('A IA está a ver o ecrã. Abre a tua corretora: a orientação aparece na bolha por cima dela.');
  } else {
    startTicker();
  }
}

export function stop(message) {
  if (kind === 'native') Native?.stopWatch().catch(() => {});
  stopTicker();
  stream?.getTracks().forEach(t => t.stop());
  stream = null;
  imageCapture = null;
  const video = $('#watchVideo');
  video.pause();
  video.srcObject = null;
  video.removeAttribute('src');
  if (fileUrl) URL.revokeObjectURL(fileUrl);
  fileUrl = null;
  kind = null;
  setExpanded(false);
  $('#watchStage').classList.remove('active');
  $('#watchStop').hidden = true;
  $('#watchStarts').hidden = false;
  document.body.classList.remove('is-watching');
  setStatus(message || 'Parado. Escolhe como queres mostrar a tua corretora.');
  pipWindow?.close();
}

/* ---------- results ---------- */

function handleResult(data) {
  if (kind === 'native') {
    analyses += 1;
    lastSentAt = Date.now();
    setStatus(`Ao vivo no telemóvel · ${analyses} análise(s) · a bolha mostra a orientação por cima da corretora`);
  }
  const decision = data.verdict.decision;
  const step = stabilizer.push(decision, { chartVisible: data.chartVisible });
  if (data.chartVisible) lastByDecision[decision] = data;
  // No chart now: show this reading (it explains what to do), not the last trade.
  const shownData = !step.noChart && step.shown ? lastByDecision[step.shown] || data : data;
  current = shownData;
  render(shownData, step, data);
  if (step.changed) {
    history.unshift({ at: data.at, decision: step.shown, asset: shownData.vision.asset, timeframe: shownData.vision.timeframe, confidence: shownData.verdict.confidence });
    history = history.slice(0, 30);
    renderHistory();
    // The Android app vibrates and speaks itself.
    if (kind !== 'native') announce(shownData);
  }
  updatePip();
}

function render(data, step, latest) {
  const g = data.guidance || {};
  const v = data.verdict;
  const vis = data.vision;
  // Without a chart on screen nothing is shown as a trade, not even the last one.
  const decision = step.noChart ? 'AGUARDAR' : step.shown || v.decision;
  const badgeText = step.noChart ? 'SEM GRÁFICO' : LABEL[decision] || decision;
  const badge = $('#watchBadge');
  badge.textContent = badgeText;
  badge.dataset.side = SIDE[decision] || '';
  $('#watchOverlay').textContent = badgeText;
  $('#watchOverlay').dataset.side = SIDE[decision] || '';
  $('#watchTitle').textContent = step.noChart ? 'Não vejo um gráfico no ecrã' : g.headline || v.headline;
  const bits = [vis.asset || 'ativo ?', vis.timeframe || 'timeframe ?', `confiança ${v.confidence}%`];
  if (latest.live) bits.push(v.agreement === 'confirma' ? 'mercado ao vivo confirma' : v.agreement === 'diverge' ? 'mercado ao vivo diverge' : 'mercado ao vivo sem sinal');
  $('#watchSub').textContent = bits.join(' · ');
  $('#watchPending').hidden = !step.pending || step.noChart;
  if (step.pending) $('#watchPending').textContent = `A IA começa a ver sinal de ${LABEL[step.pending]}. Vai confirmar na próxima leitura antes de mudar.`;
  // Exact engine levels when the market is tracked; otherwise what the AI read on screen.
  const levels = g.levels || { entry: vis.entry, stop: vis.stop, target: vis.targets?.join(' · ') };
  const showLevels = !step.noChart && decision !== 'AGUARDAR' && Boolean(levels.entry || levels.stop || levels.target);
  $('#watchLevels').hidden = !showLevels;
  if (showLevels) {
    $('#wlEntry').textContent = levels.entry || '—';
    $('#wlStop').textContent = levels.stop || '—';
    $('#wlTarget').textContent = levels.target || '—';
  }
  $('#watchNow').textContent = step.noChart ? 'Enquadra o gráfico da corretora inteiro no ecrã partilhado ou na câmara.' : g.now || '—';
  $('#watchHudNow').textContent = $('#watchNow').textContent;
  $('#watchWhy').innerHTML = (g.why || []).map(p => `<p>${escapeHtml(p)}</p>`).join('');
  $('#watchSteps').innerHTML = (g.steps || []).map(p => `<li>${escapeHtml(p)}</li>`).join('');
  $('#watchChange').textContent = latest.change || '';
  $('#watchChange').hidden = !latest.change;
  $('#watchResult').hidden = false;
}

function renderHistory() {
  $('#watchHistory').innerHTML = history.map(h => `
    <div class="op">
      <span class="op-side" data-side="${SIDE[h.decision] || ''}">${LABEL[h.decision] || h.decision}</span>
      <span class="op-prices">${escapeHtml(h.asset || 'ativo ?')} ${escapeHtml(h.timeframe || '')}<small>confiança ${h.confidence}%</small></span>
      <small>${fmtTime(h.at)}</small>
    </div>`).join('') || '<p class="muted-line">As mudanças de orientação desta sessão aparecem aqui.</p>';
}

function announce(data) {
  const label = LABEL[data.verdict.decision];
  if (prefs.voice && 'speechSynthesis' in window) {
    const text = `${label}. ${data.guidance?.now || ''}`;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'pt-PT';
    speechSynthesis.cancel();
    speechSynthesis.speak(utterance);
  }
  if (prefs.alerts && 'Notification' in window && Notification.permission === 'granted' && document.hidden) {
    try { new Notification(`Grafictrader: ${label}`, { body: data.guidance?.now || data.verdict.headline, tag: 'grafictrader-watch' }); } catch { /* ignore */ }
  }
}

/* ---------- floating window (Document Picture-in-Picture) ---------- */

function pipMarkup() {
  if (!current) return '<p class="pip-wait">À espera da primeira análise…</p>';
  // The current frame has no chart: show that, never the last stabilised trade.
  const noChart = current.chartVisible === false;
  const d = noChart ? 'AGUARDAR' : stabilizer.shown || current.verdict.decision;
  return `<div class="pip-badge" data-side="${SIDE[d] || ''}">${noChart ? 'SEM GRÁFICO' : LABEL[d] || d}</div>
    <p class="pip-asset">${escapeHtml(current.vision.asset || '')} ${escapeHtml(current.vision.timeframe || '')} · ${current.verdict.confidence}%</p>
    <p class="pip-now">${escapeHtml(current.guidance?.now || '')}</p>`;
}

function updatePip() {
  if (pipWindow && !pipWindow.closed) pipWindow.document.getElementById('pip').innerHTML = pipMarkup();
}

async function openPip() {
  if (!('documentPictureInPicture' in window)) return;
  pipWindow = await window.documentPictureInPicture.requestWindow({ width: 300, height: 210 });
  const css = getComputedStyle(document.documentElement);
  const v = name => css.getPropertyValue(name).trim();
  pipWindow.document.body.innerHTML = `<style>
    body { margin: 0; font-family: Geist, system-ui, sans-serif; background: ${v('--card')}; color: ${v('--text')}; }
    #pip { padding: 14px; display: grid; gap: 8px; }
    .pip-badge { font-size: 26px; font-weight: 800; letter-spacing: .04em; padding: 10px 12px; border-radius: 12px; text-align: center; background: ${v('--well')}; }
    .pip-badge[data-side="up"] { background: ${v('--up')}; color: #fff; }
    .pip-badge[data-side="down"] { background: ${v('--down')}; color: #fff; }
    .pip-asset { margin: 0; font-size: 12px; color: ${v('--muted')}; }
    .pip-now, .pip-wait { margin: 0; font-size: 13px; line-height: 1.4; }
  </style><div id="pip"></div>`;
  updatePip();
}

/* ---------- wiring ---------- */

function syncToggles() {
  $('#watchVoice').classList.toggle('active', prefs.voice);
  $('#watchAlerts').classList.toggle('active', prefs.alerts);
}

function initNative() {
  $('#watchNative').hidden = false;
  $('#watchNativeHint').hidden = false;
  $('#watchShare').hidden = true;
  $('#watchShareHint').hidden = true;
  $('#watchNative').onclick = async () => {
    try {
      await Native.startWatch({ serverUrl: location.origin, voice: prefs.voice });
      await begin(null, 'native');
    } catch (error) {
      setStatus(error?.message || 'Não foi possível começar a captura do ecrã.');
    }
  };
  Native.addListener('watchResult', data => {
    if (kind !== 'native') return;
    try { handleResult(data); } catch { /* malformed result */ }
  });
  Native.addListener('watchStopped', ({ message } = {}) => {
    if (kind === 'native') { kind = null; stop(message || undefined); }
  });
  // The capture keeps running when the app is reopened.
  Native.status().then(s => {
    if (s?.running && kind !== 'native') begin(null, 'native');
    else if (s?.lastStop) setStatus('A análise parou: ' + s.lastStop);
  }).catch(() => {});
}

export function initWatch() {
  loadPrefs();
  const canShare = Boolean(navigator.mediaDevices?.getDisplayMedia);
  $('#watchShare').hidden = !canShare;
  $('#watchShareHint').hidden = canShare;
  if (Native) initNative();
  $('#watchPip').hidden = !('documentPictureInPicture' in window);

  $('#watchShare').onclick = async () => {
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false });
      await begin(s, 'screen');
    } catch {
      setStatus('A partilha de ecrã foi cancelada ou bloqueada.');
    }
  };
  $('#watchCamera').onclick = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 } }, audio: false });
      await begin(s, 'camera');
    } catch {
      setStatus('Sem acesso à câmara. Permite o acesso nas definições do navegador.');
    }
  };
  $('#watchFile').onchange = async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const video = $('#watchVideo');
    stop();
    fileUrl = URL.createObjectURL(file);
    video.srcObject = null;
    video.src = fileUrl;
    video.loop = false;
    video.onended = () => stop('O vídeo terminou.');
    await begin(null, 'file', { keepSource: true });
  };
  $('#watchStop').onclick = () => stop();
  $('#watchHudStop').onclick = () => stop();
  $('#watchMin').onclick = () => setExpanded(false);
  $('#watchExpand').onclick = () => setExpanded(true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && $('.watch-card').classList.contains('expanded')) setExpanded(false);
  });
  $('#watchPip').onclick = () => openPip().catch(() => setStatus('Não foi possível abrir a janela flutuante.'));
  $('#watchVoice').onclick = () => { prefs.voice = !prefs.voice; savePrefs(); syncToggles(); };
  $('#watchAlerts').onclick = async () => {
    prefs.alerts = !prefs.alerts;
    if (prefs.alerts && 'Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission().catch(() => {});
    }
    savePrefs();
    syncToggles();
  };
  syncToggles();
  renderHistory();
  renderIcons();
}
