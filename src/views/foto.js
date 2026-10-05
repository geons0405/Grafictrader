import { $, api, escapeHtml, fmtPrice, pairLabel } from '../lib/dom.js';
import { market } from '../lib/store.js';
import { renderIcons } from '../lib/icons.js';
import { confirmCapture } from '../lib/consent.js';

const MAX_SIDE = 1600;

let stream = null;
let busy = false;

/** Draws a source onto a canvas no larger than MAX_SIDE and returns a JPEG data URL. */
function toJpeg(source, width, height) {
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85);
}

function showPanel(html) {
  const panel = $('#analysis');
  panel.hidden = false;
  panel.innerHTML = html;
  renderIcons();
  const retry = $('#retryPhoto');
  if (retry) retry.onclick = () => { panel.hidden = true; panel.innerHTML = ''; };
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

const DECISION_ICON = { COMPRAR: 'trending-up', VENDER: 'trending-down', AGUARDAR: 'pause' };
const DECISION_LABEL = { COMPRAR: 'COMPRAR', VENDER: 'VENDER', AGUARDAR: 'NÃO OPERAR' };
const AGREEMENT_LABEL = {
  confirma: 'Motor ao vivo confirma',
  diverge: 'Motor ao vivo diverge',
  neutro: 'Motor ao vivo sem sinal',
  'sem dados ao vivo': 'Ativo fora do motor ao vivo'
};

const list = items => (items || []).map(item => `<li>${escapeHtml(item)}</li>`).join('');

function renderNoChart(image, data) {
  const g = data.guidance || {};
  return `
    <div class="verdict" data-side="flat">
      <span class="verdict-icon"><i data-lucide="image"></i></span>
      <div class="verdict-main">
        <small>Sem gráfico</small>
        <strong>NÃO OPERAR</strong>
        <span>${escapeHtml(g.headline || 'Isto não parece um gráfico de preços')}</span>
      </div>
    </div>
    <div class="guide">
      <div class="guide-now"><small>O que fazer agora</small><p>${escapeHtml(g.now || 'Tira uma foto ao gráfico da corretora.')}</p></div>
      <div class="guide-block"><small>Porquê</small>${(g.why || []).map(p => `<p>${escapeHtml(p)}</p>`).join('')}</div>
      <div class="guide-block"><small>Como tirar a foto</small><ol>${list(g.steps)}</ol></div>
    </div>
    <div class="analysis-preview"><img src="${image}" alt="Imagem enviada"><div><small>Imagem enviada</small><b>A IA não deu sinal porque não encontrou um gráfico.</b></div></div>
    <button class="btn btn-soft" type="button" id="retryPhoto"><i data-lucide="refresh-cw"></i>Tentar outra foto</button>`;
}

function renderResult(image, data) {
  if (data.chartVisible === false) return renderNoChart(image, data);
  const v = data.verdict;
  const vis = data.vision;
  const side = v.direction > 0 ? 'up' : v.direction < 0 ? 'down' : 'flat';
  const live = data.live;
  const quant = live?.quant;
  const f2 = n => (Number.isFinite(n) ? n.toFixed(2) : '—');
  return `
    <div class="verdict" data-side="${side}">
      <span class="verdict-icon"><i data-lucide="${DECISION_ICON[v.decision]}"></i></span>
      <div class="verdict-main">
        <small>Orientação da IA</small>
        <strong>${DECISION_LABEL[v.decision] || v.decision}</strong>
        <span>${escapeHtml(v.headline)}</span>
      </div>
      <div class="verdict-ring">
        <svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="26" class="ring-track" pathLength="100"/><circle cx="32" cy="32" r="26" class="ring-value" pathLength="100" style="--value:${v.confidence}"/></svg>
        <b>${v.confidence}%</b>
      </div>
    </div>
    <div class="pill-row">
      <span class="pill">${escapeHtml(vis.asset || 'Ativo não identificado')}</span>
      <span class="pill">${escapeHtml(vis.timeframe || 'timeframe ?')}</span>
      <span class="pill" data-agree="${escapeHtml(v.agreement)}">${escapeHtml(AGREEMENT_LABEL[v.agreement] || v.agreement)}</span>
    </div>
    ${v.direction !== 0 ? `
    <div class="levels levels-3">
      <div><small>Entrada</small><b>${escapeHtml(data.guidance?.levels?.entry || vis.entry || '—')}</b></div>
      <div><small>Stop</small><b class="neg">${escapeHtml(data.guidance?.levels?.stop || vis.stop || '—')}</b></div>
      <div><small>Alvos</small><b class="pos">${escapeHtml(data.guidance?.levels?.target || vis.targets.join(' · ') || '—')}</b></div>
    </div>` : ''}
    ${data.guidance ? `
    <div class="guide">
      <div class="guide-now"><small>O que fazer agora</small><p>${escapeHtml(data.guidance.now)}</p></div>
      <div class="guide-block"><small>Porquê</small>${(data.guidance.why || []).map(p => `<p>${escapeHtml(p)}</p>`).join('')}</div>
      <div class="guide-block"><small>Passo a passo</small><ol>${list(data.guidance.steps)}</ol></div>
    </div>` : ''}
    <details class="guide-tech">
      <summary>Detalhes técnicos</summary>
      <div class="analysis-item"><small>Sinais</small><ul class="reasons">${list([...v.reasons, ...vis.reasons])}</ul></div>
      ${vis.structure || vis.indicators ? `<div class="analysis-item"><small>Leitura do gráfico</small><p>${escapeHtml([vis.structure, vis.indicators, vis.patterns.join(', ')].filter(Boolean).join(' · '))}</p></div>` : ''}
      ${vis.risks.length ? `<div class="analysis-item"><small>Riscos</small><ul class="reasons">${list(vis.risks)}</ul></div>` : ''}
      ${live ? `
      <div class="analysis-item">
        <small>Motor ao vivo · ${escapeHtml(pairLabel(live.symbol))} ${escapeHtml(live.interval)} · ${fmtPrice(live.price)}</small>
        <p>${escapeHtml(live.signal.action)} · ${escapeHtml(live.signal.regimeLabel)}${live.context ? ' · contexto ' + Math.round((live.context.score || 0) * 100) + '%' : ''}</p>
        ${quant ? `<div class="quant-chips"><span>Hurst ${f2(quant.hurst)}</span><span>VR ${f2(quant.varianceRatio)}</span><span>Kalman z ${f2(quant.kalmanZ)}</span><span>Entropia ${f2(quant.entropy)}</span><span>VPIN ${f2(quant.vpin)}</span></div>` : ''}
      </div>` : ''}
    </details>
    <div class="analysis-preview"><img src="${image}" alt="Gráfico analisado"><div><small>Resumo</small><b>${escapeHtml(vis.summary || '—')}</b></div></div>
    <p class="fine-print left">${escapeHtml(data.disclaimer || '')} Imagem: qualidade ${escapeHtml(vis.imageQuality || '—')} · ${escapeHtml(data.provider)}.</p>
    <button class="btn btn-soft" type="button" id="retryPhoto"><i data-lucide="refresh-cw"></i>Nova análise</button>`;
}

async function analyze(image) {
  if (busy) return;
  busy = true;
  showPanel(`
    <header class="card-head"><b>Grafictrader AI</b><span class="pill">A analisar</span></header>
    <div class="loading"><span class="spinner"></span><b>A ler o gráfico e a cruzar com o mercado ao vivo…</b><small>Estrutura · níveis · padrões · motor estatístico · contexto</small></div>`);
  try {
    const data = await api('/api/analyze', { method: 'POST', body: { image, symbol: market.symbol, interval: market.interval } });
    showPanel(renderResult(image, data));
  } catch (error) {
    const hint = error.status === 401 ? 'Inicia sessão novamente para usar a IA.'
      : error.status === 429 ? 'Atingiste o limite de análises. Aguarda uns minutos.'
      : error.status === 503 ? 'A IA não está configurada no servidor.'
      : 'Verifica a ligação e tenta novamente.';
    showPanel(`
      <header class="card-head"><b>Não foi possível analisar</b><span class="pill">Erro</span></header>
      <p class="reading-summary">${escapeHtml(error.message)}</p>
      <p class="fine-print left">${escapeHtml(hint)}</p>
      <button class="btn btn-soft" type="button" id="retryPhoto">Tentar novamente</button>`);
  } finally {
    busy = false;
  }
}

// Bumped on every stop so a camera that opens after the user left is discarded.
let cameraRequest = 0;

function stopCamera() {
  cameraRequest += 1;
  stream?.getTracks().forEach(track => track.stop());
  stream = null;
  $('#video').srcObject = null;
  $('#snap').disabled = true;
  $('#camera').classList.remove('active');
  $('.camera-card').classList.remove('expanded');
  document.body.classList.toggle('stage-open', Boolean(document.querySelector('.watch-card.expanded')));
  $('#cameraStatus').textContent = 'Câmara desligada';
}

export function initFoto() {
  $('#startCam').onclick = async () => {
    if (!(await confirmCapture('camera'))) return;
    try {
      stopCamera();
      const request = cameraRequest;
      const opened = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 } } });
      if (request !== cameraRequest) {
        opened.getTracks().forEach(track => track.stop());
        return;
      }
      stream = opened;
      $('#video').srcObject = stream;
      $('#snap').disabled = false;
      $('#camera').classList.add('active');
      // The live camera takes the whole screen so the chart is easy to frame.
      $('.camera-card').classList.add('expanded');
      document.body.classList.add('stage-open');
      $('#cameraStatus').textContent = 'Câmara ativa';
    } catch {
      $('#cameraStatus').textContent = 'Câmara bloqueada';
      showPanel(`<header class="card-head"><b>Sem acesso à câmara</b></header>
        <p class="reading-summary">Permite o acesso à câmara nas definições do navegador, ou usa “Carregar imagem”.</p>`);
    }
  };

  $('#snap').onclick = () => {
    const video = $('#video');
    if (!video.videoWidth) return;
    const image = toJpeg(video, video.videoWidth, video.videoHeight);
    // Close the full-screen camera so the analysis is visible.
    stopCamera();
    analyze(image);
  };

  $('#closeCam').onclick = () => stopCamera();
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && $('.camera-card').classList.contains('expanded')) stopCamera();
  });

  $('#fileInput').onchange = event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !/^image\/(png|jpeg|webp)$/.test(file.type)) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      analyze(toJpeg(img, img.naturalWidth, img.naturalHeight));
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  };
}

export function deactivateFoto() {
  // Never keep the camera running when the user leaves the screen.
  stopCamera();
}
