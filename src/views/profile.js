import { $, api, escapeHtml, fmtTime } from '../lib/dom.js';
import { Capacitor } from '@capacitor/core';
import { sessionMode, setUser, currentUser } from '../lib/session.js';
import { renderIcons } from '../lib/icons.js';
import { track } from '../lib/analytics.js';
import { pushSupported, currentSubscription, enableAlerts, disableAlerts, appAlerts, appAlertsStatus, enableAppAlerts, disableAppAlerts } from '../lib/push.js';

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

/* ---------- opportunity alerts ---------- */

const MARKET_LABEL = { BTCUSDT: 'BTC', ETHUSDT: 'ETH', SOLUSDT: 'SOL', BNBUSDT: 'BNB', XRPUSDT: 'XRP', EURUSD: 'EUR/USD', GBPUSD: 'GBP/USD', USDJPY: 'USD/JPY', XAUUSD: 'Ouro' };
const INTERVAL_LABEL = { '15m': '15 min', '1h': '1 hora', '4h': '4 horas' };
let alertsKey = null;

function alertsChoice() {
  const markets = [...document.querySelectorAll('#alertsMarkets input:checked')].map(i => i.value);
  const interval = document.querySelector('#alertsInterval button.active')?.dataset.interval || '1h';
  return { markets, interval };
}

async function loadAlerts() {
  const status = $('#alertsStatus');
  const hint = $('#alertsHint');
  $('#alertsForm').hidden = true;
  if (!pushSupported() && !appAlerts()) {
    status.textContent = 'indisponível aqui';
    hint.textContent = 'Este navegador não suporta alertas. No iPhone, primeiro adiciona o Grafictrader ao ecrã principal (Partilhar › Adicionar ao ecrã principal) e abre-o a partir daí.';
    return;
  }
  try {
    const data = await api('/api/auth?action=push-status');
    // The Android app needs no push key: it collects its alerts itself.
    alertsKey = appAlerts() ? 'app' : data.publicKey;
    let on;
    let blocked = false;
    if (appAlerts()) {
      const native = await appAlertsStatus();
      on = Boolean(native.on && data.app);
      blocked = on && !native.notifications;
    } else {
      const subscription = await currentSubscription();
      on = Boolean(subscription && data.devices.includes(subscription.endpoint));
    }
    $('#alertsMarkets').innerHTML = data.choices.markets.map(m => `<label class="chip"><input type="checkbox" value="${m}" ${data.markets.includes(m) ? 'checked' : ''}><span>${MARKET_LABEL[m] || m}</span></label>`).join('');
    $('#alertsInterval').innerHTML = data.choices.intervals.map(i => `<button type="button" data-interval="${i}" class="${i === data.interval ? 'active' : ''}">${INTERVAL_LABEL[i] || i}</button>`).join('');
    $('#alertsForm').hidden = !alertsKey;
    $('#alertsOn').innerHTML = on ? 'Guardar escolhas' : '<i data-lucide="bell"></i>Ativar alertas neste dispositivo';
    $('#alertsOff').hidden = !on;
    renderIcons();
    status.textContent = on ? 'ligados neste dispositivo' : 'desligados';
    status.dataset.sign = on ? 'up' : '';
    hint.textContent = blocked
      ? 'O Android está a bloquear as notificações do Grafictrader. Ativa-as em Definições › Apps › Grafictrader › Notificações.'
      : !alertsKey
        ? 'Os alertas ainda não estão disponíveis no servidor.'
        : appAlerts()
          ? 'Escolhe até 5 mercados e o tempo gráfico. A app confirma a cada 15 minutos, mesmo fechada, e avisa uma vez por oportunidade. É uma orientação educativa, não uma ordem: confirma sempre antes de operar.'
          : 'Escolhe até 5 mercados e o tempo gráfico. A IA verifica a cada 10 minutos e avisa uma vez por oportunidade. É uma orientação educativa, não uma ordem: confirma sempre antes de operar.';
  } catch (error) {
    status.textContent = 'indisponível';
    hint.textContent = error.message;
  }
}

function initAlerts() {
  $('#alertsInterval').addEventListener('click', event => {
    const button = event.target.closest('button[data-interval]');
    if (!button) return;
    document.querySelectorAll('#alertsInterval button').forEach(b => b.classList.toggle('active', b === button));
  });
  $('#alertsMarkets').addEventListener('change', event => {
    const checked = document.querySelectorAll('#alertsMarkets input:checked');
    if (checked.length > 5) event.target.checked = false;
  });
  $('#alertsOn').onclick = async () => {
    const choice = alertsChoice();
    if (!choice.markets.length) return ($('#alertsHint').textContent = 'Escolhe pelo menos um mercado.');
    $('#alertsOn').disabled = true;
    try {
      if (appAlerts()) await enableAppAlerts(choice);
      else await enableAlerts({ ...choice, publicKey: alertsKey });
      track('alerts_enabled', { markets: choice.markets.length, interval: choice.interval });
      await loadAlerts();
    } catch (error) {
      $('#alertsHint').textContent = error.message;
    } finally {
      $('#alertsOn').disabled = false;
    }
  };
  $('#alertsOff').onclick = async () => {
    try {
      if (appAlerts()) await disableAppAlerts();
      else await disableAlerts();
    } catch (error) {
      $('#alertsHint').textContent = error.message;
    }
    loadAlerts();
  };
}

const signedOut = () => window.dispatchEvent(new CustomEvent('grafictrader:signed-out'));

function formMessage(form, text) {
  form.querySelector('.form-message').textContent = text || '';
}

function renderPause(until) {
  const on = until && until > Date.now();
  $('#pauseStatus').textContent = on ? 'em pausa até ' + new Date(until).toLocaleDateString('pt-PT', { day: 'numeric', month: 'long' }) : 'sem pausa';
  $('#pauseStatus').dataset.sign = on ? 'down' : '';
}

function initPause() {
  $('#pauseButtons').addEventListener('click', async event => {
    const days = Number(event.target.closest('[data-pause]')?.dataset.pause);
    if (!days) return;
    if (!confirm(`Pausar as análises durante ${days} dia(s)? Não vais conseguir desfazer.`)) return;
    try {
      const { pausedUntil } = await api('/api/auth?action=pause', { method: 'POST', body: { days } });
      const user = currentUser();
      if (user) setUser({ ...user, pausedUntil });
      renderPause(pausedUntil);
    } catch (error) {
      $('#pauseStatus').textContent = error.message;
    }
  });
}

function initAccount() {
  initPause();
  $('#logoutAllBtn').onclick = async () => {
    if (!confirm('Terminar a sessão em todos os dispositivos, incluindo este?')) return;
    try {
      await api('/api/auth?action=logout-all', { method: 'POST' });
      signedOut();
    } catch (error) {
      alert(error.message);
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
  initAlerts();
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
  renderPause(currentUser()?.pausedUntil);
  $('#mt5Origin').textContent = location.origin;
  $('#mt5Url').textContent = location.origin + '/api/mt5';
  $('#mt5Copy').textContent = 'Copiar';
  loadStatus();
  if (sessionMode() === 'server') loadAlerts();
}
