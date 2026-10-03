import { $, api, escapeHtml, fmtTime } from '../lib/dom.js';
import { sessionMode } from '../lib/session.js';

async function loadStatus() {
  const status = $('#mt5Status');
  const list = $('#mt5Symbols');
  if (sessionMode() !== 'server') {
    status.textContent = 'precisa de contas no servidor';
    $('#mt5Generate').disabled = true;
    list.innerHTML = '<p class="muted-line">A ponte MetaTrader 5 precisa que o servidor tenha contas (Redis) configuradas.</p>';
    return;
  }
  try {
    const { symbols = [] } = await api('/api/mt5?symbols=1');
    const live = symbols.filter(s => Date.now() - s.updatedAt < 60000);
    status.textContent = live.length ? `ligado · ${live.length} símbolo(s) ao vivo` : symbols.length ? 'sem ticks recentes' : 'não ligado';
    status.dataset.sign = live.length ? 'up' : '';
    list.innerHTML = symbols.map(s => `<div class="op"><span class="op-prices">${escapeHtml(s.symbol)}<small>${escapeHtml(s.broker || '')} · ${escapeHtml(s.timeframes.join(', '))}</small></span><small>${Date.now() - s.updatedAt < 60000 ? 'ao vivo' : fmtTime(s.updatedAt)}</small></div>`).join('');
  } catch (error) {
    status.textContent = error.status === 503 ? 'indisponível no servidor' : 'não ligado';
    list.innerHTML = '';
  }
}

export function initProfile() {
  $('#mt5Generate').onclick = async () => {
    const button = $('#mt5Generate');
    button.disabled = true;
    try {
      const { key } = await api('/api/auth?action=mt5key', { method: 'POST' });
      $('#mt5Key').textContent = key;
      $('#mt5KeyBox').hidden = false;
      button.textContent = 'Gerar nova chave (a anterior deixa de funcionar)';
    } catch (error) {
      $('#mt5Status').textContent = error.message;
    } finally {
      button.disabled = sessionMode() !== 'server';
    }
  };
  $('#mt5Copy').onclick = async () => {
    const key = $('#mt5Key').textContent;
    try {
      await navigator.clipboard.writeText(key);
      $('#mt5Copy').textContent = 'Copiada';
    } catch {
      const range = document.createRange();
      range.selectNodeContents($('#mt5Key'));
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    }
  };
}

export function activateProfile() {
  $('#mt5Origin').textContent = location.origin;
  $('#mt5Url').textContent = location.origin + '/api/mt5';
  $('#mt5Copy').textContent = 'Copiar';
  loadStatus();
}
