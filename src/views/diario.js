import { $, api, escapeHtml } from '../lib/dom.js';
import { positionSize } from '../lib/risk.js';
import { sessionMode } from '../lib/session.js';

const money = n => (n == null ? '—' : (n < 0 ? '−' : '') + Math.abs(n).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const qty = n => (n == null ? '—' : n >= 100 ? n.toFixed(2) : n >= 1 ? n.toFixed(4) : n.toPrecision(4));

function renderRisk() {
  const data = Object.fromEntries(new FormData($('#riskForm')));
  try { localStorage.setItem('grafictrader.risk', JSON.stringify({ balance: data.balance, riskPct: data.riskPct })); } catch { /* optional */ }
  const r = positionSize(data);
  if (!r) {
    $('#riskOut').innerHTML = '<p class="muted-line">Escreve o saldo e o risco: a calculadora diz quanto podes arriscar.</p>';
    return;
  }
  const warn = Number(data.riskPct) > 2 ? '<p class="calc-warn">Mais de 2% por operação: uma sequência de perdas normal pode apagar uma grande parte da conta.</p>' : '';
  $('#riskOut').innerHTML = `
    <div class="calc-result"><small>Podes arriscar</small><b>${money(r.riskAmount)}</b></div>
    <div class="calc-result"><small>Opções binárias: entrada máxima</small><b>${money(r.binaryStake)}</b></div>
    ${r.units == null ? '' : `
    <div class="calc-result"><small>Tamanho da posição</small><b>${qty(r.units)} unidades</b></div>
    <div class="calc-result"><small>Valor da posição</small><b>${money(r.notional)}</b><small>stop a ${r.stopPct}% · alavancagem ${r.leverageNeeded}×</small></div>`}
    ${warn}`;
}

function renderJournal({ entries = [], totals } = {}) {
  $('#journalCount').textContent = entries.length ? `${entries.length} operação(ões)` : '—';
  const box = (label, t) => `<div class="calc-result"><small>${label}</small><b data-sign="${t.net > 0 ? 'up' : t.net < 0 ? 'down' : ''}">${money(t.net)}</b><small>${t.trades} op. · ${t.winRate == null ? '—' : t.winRate + '% ganhas'}</small></div>`;
  $('#journalTotals').innerHTML = totals && entries.length
    ? box('Total', totals.all) + box('Seguindo a app', totals.followedApp) + box('Por tua conta', totals.ownCall)
    : '';
  $('#journalList').innerHTML = entries.map(e => `
    <div class="op">
      <span class="op-side" data-side="${e.side === 'BUY' ? 'up' : 'down'}">${e.side === 'BUY' ? 'COMPRA' : 'VENDA'}</span>
      <span class="op-prices">${escapeHtml(e.asset)} · ${money(e.amount)}<small>${new Date(e.date).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' })}${e.followedApp ? ' · seguiu a app' : ''}${e.note ? ' · ' + escapeHtml(e.note) : ''}</small></span>
      <span class="op-result" data-sign="${e.result > 0 ? 'up' : e.result < 0 ? 'down' : ''}">${money(e.result)}</span>
      <button class="round-btn sm" type="button" data-delete-entry="${escapeHtml(e.id)}" aria-label="Apagar">✕</button>
    </div>`).join('') || '<p class="muted-line">Ainda não há operações no diário.</p>';
}

async function loadJournal() {
  if (sessionMode() !== 'server') return;
  try { renderJournal(await api('/api/journal')); } catch { /* shown empty */ }
}

export function initDiario() {
  try {
    const saved = JSON.parse(localStorage.getItem('grafictrader.risk') || '{}');
    if (saved.balance) $('#riskForm').balance.value = saved.balance;
    if (saved.riskPct) $('#riskForm').riskPct.value = saved.riskPct;
  } catch { /* defaults */ }
  $('#riskForm').addEventListener('input', renderRisk);
  $('#journalForm').onsubmit = async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    form.querySelector('.form-message').textContent = '';
    if (!String(data.asset || '').trim() || data.amount === '' || data.result === '') {
      form.querySelector('.form-message').textContent = 'Preenche o ativo, o valor e o resultado.';
      return;
    }
    try {
      renderJournal(await api('/api/journal', { method: 'POST', body: { ...data, followedApp: Boolean(data.followedApp), date: new Date().toISOString() } }));
      form.reset();
    } catch (error) {
      form.querySelector('.form-message').textContent = error.message;
    }
  };
  $('#journalList').addEventListener('click', async event => {
    const id = event.target.closest('[data-delete-entry]')?.dataset.deleteEntry;
    if (!id || !confirm('Apagar esta operação do diário?')) return;
    try { renderJournal(await api('/api/journal?id=' + encodeURIComponent(id), { method: 'DELETE' })); } catch { /* keep list */ }
  });
}

export function activateDiario() {
  renderRisk();
  loadJournal();
}
