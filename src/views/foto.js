import { $, api, escapeHtml } from '../lib/dom.js';
import { renderIcons } from '../lib/icons.js';

const MAX_SIDE = 1600;
const LABELS = ['RESUMO', 'TENDÊNCIA', 'ESTRUTURA', 'NÍVEIS', 'INDICADORES', 'CENÁRIO A', 'CENÁRIO B', 'RISCO', 'CONFIANÇA VISUAL'];

let stream = null;
let busy = false;

export function parseAnalysis(raw) {
  const result = { raw };
  LABELS.forEach(label => { result[label] = 'Não identificado na imagem.'; });
  let current = null;
  for (const line of String(raw).split(/\r?\n/)) {
    const match = line.replace(/\*\*/g, '').match(/^\s*([^:]+):\s*(.*)$/);
    const label = match?.[1].trim().toUpperCase();
    if (label && LABELS.includes(label)) {
      current = label;
      result[label] = match[2].trim() || 'Não identificado na imagem.';
    } else if (current && line.trim()) {
      result[current] += ' ' + line.trim();
    }
  }
  return result;
}

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

async function analyze(image) {
  if (busy) return;
  busy = true;
  showPanel(`
    <header class="card-head"><b>Grafictrader AI</b><span class="pill">A processar</span></header>
    <div class="loading"><span class="spinner"></span><b>A ler o gráfico…</b><small>Tendência · estrutura · níveis · indicadores · cenários</small></div>`);
  try {
    const data = await api('/api/analyze', { method: 'POST', body: { image } });
    const p = parseAnalysis(String(data.analysis || ''));
    const sections = LABELS.slice(1).map(label =>
      `<div class="analysis-item"><small>${escapeHtml(label)}</small><p>${escapeHtml(p[label])}</p></div>`).join('');
    showPanel(`
      <header class="card-head"><b>Análise concluída</b><span class="pill">${escapeHtml(data.provider || 'IA')}</span></header>
      <div class="analysis-preview"><img src="${image}" alt="Gráfico analisado"><div><small>Resumo</small><b>${escapeHtml(p.RESUMO)}</b></div></div>
      <div class="analysis-list">${sections}</div>
      <button class="btn btn-soft" type="button" id="retryPhoto"><i data-lucide="refresh-cw"></i>Nova análise</button>`);
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

function stopCamera() {
  stream?.getTracks().forEach(track => track.stop());
  stream = null;
  $('#video').srcObject = null;
  $('#snap').disabled = true;
  $('#camera').classList.remove('active');
  $('#cameraStatus').textContent = 'Câmara desligada';
}

export function initFoto() {
  $('#startCam').onclick = async () => {
    try {
      stopCamera();
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 } } });
      $('#video').srcObject = stream;
      $('#snap').disabled = false;
      $('#camera').classList.add('active');
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
    analyze(toJpeg(video, video.videoWidth, video.videoHeight));
  };

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
