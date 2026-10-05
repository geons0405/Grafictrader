import { $ } from './dom.js';

// Notice shown before the camera, screen sharing or the Android bubble start
// (Terms of Use, section 13). Accepted once per kind and version, on this device.
const KEY = 'grafictrader.captureConsent';
export const CONSENT_VERSION = '2026-10-05';

const PROVIDERS = 'fornecedores de IA (atualmente Groq, NVIDIA, Google, UnoRouter e OpenAI)';

export const CAPTURE_NOTICES = {
  camera: {
    title: 'Antes de ligar a câmara',
    items: [
      ['O que é captado', 'A imagem da câmara. Na FOTO só é enviada a foto que tirares; em “Minha corretora”, uma imagem a cada poucos segundos, só quando o gráfico muda.'],
      ['Durante quanto tempo', 'Até fechares a câmara ou tocares em Parar (no máximo 45 minutos em “Minha corretora”).'],
      ['Para quê', 'Para a IA ler o gráfico e dar a Análise. Nada mais.'],
      ['Para onde vai', 'Para o servidor do Grafictrader, por ligação cifrada, e daí para ' + PROVIDERS + ', que podem estar fora do teu país.'],
      ['O que guardamos', 'Não guardamos as imagens depois da Análise. Cada fornecedor de IA segue a sua própria política.'],
      ['Como parar', 'Toca em ✕ ou em Parar a qualquer momento.']
    ]
  },
  screen: {
    title: 'Antes de partilhar o ecrã',
    items: [
      ['O que é captado', 'O separador, a janela ou o ecrã que escolheres na partilha. Uma imagem a cada poucos segundos, só quando o gráfico muda.'],
      ['Durante quanto tempo', 'Até tocares em Parar ou terminares a partilha (no máximo 45 minutos).'],
      ['Para quê', 'Para a IA ler o gráfico da tua corretora e dar a Análise.'],
      ['Para onde vai', 'Para o servidor do Grafictrader, por ligação cifrada, e daí para ' + PROVIDERS + ', que podem estar fora do teu país.'],
      ['O que guardamos', 'Não guardamos as imagens depois da Análise. Cada fornecedor de IA segue a sua própria política.'],
      ['Como parar', 'Toca em Parar na app ou termina a partilha no navegador.']
    ]
  },
  bubble: {
    title: 'Antes de ligar a bolha',
    items: [
      ['O que é captado', 'O ECRÃ INTEIRO do telemóvel, incluindo notificações e qualquer app que abras durante a sessão. É enviada uma imagem quando o gráfico muda (no máximo uma a cada 8 segundos).'],
      ['Durante quanto tempo', 'Até tocares em “Parar análise” (na bolha ou na notificação), no máximo 45 minutos.'],
      ['Para quê', 'Para a IA ler o gráfico da tua corretora e mostrar a Análise na bolha.'],
      ['Para onde vai', 'Para o servidor do Grafictrader, por ligação cifrada, e daí para ' + PROVIDERS + ', que podem estar fora do teu país.'],
      ['O que guardamos', 'Não guardamos as imagens depois da Análise. Cada fornecedor de IA segue a sua própria política.'],
      ['Cuidado', 'Enquanto a bolha estiver ligada, não abras o banco, carteiras de cripto, senhas, conversas privadas ou documentos confidenciais.'],
      ['Como parar', 'Toca na bolha e depois em “Parar análise”, ou usa “Parar” na notificação.']
    ]
  }
};

function readAll() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; }
}

export function hasCaptureConsent(kind) {
  return readAll()[kind] === CONSENT_VERSION;
}

function remember(kind) {
  const all = readAll();
  all[kind] = CONSENT_VERSION;
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* asks again next time */ }
}

/** Resolves true when the user agrees (now or before), false when they decline. */
export function confirmCapture(kind) {
  const notice = CAPTURE_NOTICES[kind];
  if (!notice || hasCaptureConsent(kind)) return Promise.resolve(true);
  const sheet = $('#captureConsent');
  $('#captureTitle').textContent = notice.title;
  $('#captureList').innerHTML = notice.items.map(([term, text]) => `<div><dt>${term}</dt><dd>${text}</dd></div>`).join('');
  sheet.hidden = false;
  return new Promise(resolve => {
    const done = agreed => {
      sheet.hidden = true;
      $('#captureOk').onclick = null;
      $('#captureCancel').onclick = null;
      if (agreed) remember(kind);
      resolve(agreed);
    };
    $('#captureOk').onclick = () => done(true);
    $('#captureCancel').onclick = () => done(false);
    $('#captureOk').focus();
  });
}
