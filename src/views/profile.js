import { $, api, escapeHtml, fmtTime } from '../lib/dom.js';
import { Capacitor } from '@capacitor/core';
import { sessionMode, setUser } from '../lib/session.js';

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

const signedOut = () => window.dispatchEvent(new CustomEvent('grafictrader:signed-out'));

function formMessage(form, text) {
  form.querySelector('.form-message').textContent = text || '';
}

function initAccount() {
  $('#logoutAllBtn').onclick = async () => {
    if (!confirm('Terminar a sessão em todos os dispositivos, incluindo este?')) return;
    try {
      await api('/api/auth?action=logout-all', { method: 'POST' });
    } finally {
      signedOut();
    }
  };
  $('#passwordForm').onsubmit = async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    if (String(data.newPassword || '').length < 8) return formMessage(form, 'A nova palavra-passe deve ter pelo menos 8 caracteres.');
    form.querySelector('button').disabled = true;
    try {
      const { user } = await api('/api/auth?action=password', { method: 'POST', body: data });
      setUser(user);
      form.reset();
      formMessage(form, 'Palavra-passe mudada. As sessões nos outros dispositivos foram terminadas.');
    } catch (error) {
      formMessage(form, error.message);
    } finally {
      form.querySelector('button').disabled = false;
    }
  };
  $('#deleteForm').onsubmit = async event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!confirm('Apagar a conta para sempre? Não dá para desfazer.')) return;
    form.querySelector('button').disabled = true;
    try {
      await api('/api/auth?action=delete', { method: 'POST', body: Object.fromEntries(new FormData(form)) });
      signedOut();
    } catch (error) {
      formMessage(form, error.message);
      form.querySelector('button').disabled = false;
    }
  };
}

export function initProfile() {
  initAccount();
  // Already inside the Android app: no need to offer the download.
  $('#apkCard').hidden = Capacitor.isNativePlatform();
  $('#mt5Generate').onclick = async () => {
    const button = $('#mt5Generate');
    button.disabled = true;
    try {
      const { key } = await api('/api/auth?action=mt5key', { method: 'POST' });
      $('#mt5Key').textContent = key;
      $('#mt5KeyBox').hidden = false;
      $('#mt5KeyHint').hidden = false;
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
