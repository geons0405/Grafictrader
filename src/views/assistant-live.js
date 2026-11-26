import { market } from '../lib/store.js';

let panel = null;
let recognition = null;
let sessionId = '';
let listening = false;
let speaking = false;

const makeSessionId = () => 'gt_' + Array.from(crypto.getRandomValues(new Uint8Array(18)), n => n.toString(16).padStart(2, '0')).join('');
const currentSymbol = () => market.source === 'mt5' ? market.mt5Symbol : market.source === 'tradingview' ? market.tvSymbol.replace(/^[A-Z0-9_]+:/, '') : market.symbol;

function ensurePanel() {
  if (panel) return panel;
  panel = document.createElement('section');
  panel.className = 'gt-assistant';
  panel.hidden = true;
  panel.innerHTML = `
    <div class="gt-assistant-card" role="dialog" aria-modal="true" aria-label="GraficTrader Live">
      <header><div><small>GRAFICTRADER</small><h2>Assistente LIVE</h2><p id="gtAssistantStatus">Pronto para conversar</p></div><button type="button" id="gtAssistantClose" aria-label="Fechar">×</button></header>
      <div class="gt-assistant-messages" id="gtAssistantMessages" aria-live="polite"><p class="gt-assistant-intro">Podes falar comigo ou escrever. Posso explicar o mercado, analisar o ativo selecionado e responder às tuas perguntas.</p></div>
      <div class="gt-assistant-controls"><button type="button" id="gtAssistantMic" aria-label="Começar conversa por voz">🎙</button><form id="gtAssistantForm"><input id="gtAssistantInput" maxlength="1500" placeholder="Escreve a tua pergunta…" autocomplete="off"><button type="submit">Enviar</button></form></div>
      <small class="gt-assistant-foot">A análise é informativa. Não executa ordens nem garante resultados.</small>
    </div>`;
  document.body.append(panel);
  panel.querySelector('#gtAssistantClose').onclick = closeAssistant;
  panel.querySelector('#gtAssistantForm').onsubmit = event => {
    event.preventDefault();
    const input = panel.querySelector('#gtAssistantInput');
    const message = input.value.trim();
    if (!message) return;
    input.value = '';
    sendMessage(message);
  };
  panel.querySelector('#gtAssistantMic').onclick = () => listening ? stopListening() : startListening();
  panel.addEventListener('click', event => { if (event.target === panel) closeAssistant(); });
  return panel;
}

function addMessage(text, role) {
  const list = panel.querySelector('#gtAssistantMessages');
  const item = document.createElement('p');
  item.className = 'gt-message ' + role;
  item.textContent = text;
  list.append(item);
  list.scrollTop = list.scrollHeight;
}

function setStatus(text) {
  panel.querySelector('#gtAssistantStatus').textContent = text;
}

function speak(text) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'pt-PT';
  utterance.rate = 1;
  utterance.onstart = () => { speaking = true; setStatus('A responder por voz…'); };
  utterance.onend = () => { speaking = false; if (!listening) setStatus('Pronto para continuar'); };
  window.speechSynthesis.speak(utterance);
}

async function sendMessage(message) {
  addMessage(message, 'user');
  setStatus('A pensar…');
  panel.querySelector('#gtAssistantMic').disabled = true;
  try {
    const response = await fetch('/api/instructor?chat=1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ message, sessionId, symbol: currentSymbol(), interval: market.interval })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || 'Não foi possível obter resposta.');
    addMessage(data.answer, 'assistant');
    setStatus(data.market?.available === false ? 'Resposta sem dados de mercado recentes' : 'Resposta pronta');
    if (window.__grafictraderVoiceReply) speak(data.answer);
  } catch (error) {
    addMessage(error.message || 'O assistente está temporariamente indisponível.', 'assistant');
    setStatus('Não foi possível responder');
  } finally {
    panel.querySelector('#gtAssistantMic').disabled = false;
  }
}

function stopListening() {
  try { recognition?.stop(); } catch { /* already stopped */ }
  listening = false;
  panel.querySelector('#gtAssistantMic').textContent = '🎙';
  setStatus('Pronto para continuar');
}

function startListening() {
  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Speech) {
    setStatus('O reconhecimento de voz não está disponível neste dispositivo. Usa o campo de texto.');
    return;
  }
  try {
    recognition?.abort();
    recognition = new Speech();
    recognition.lang = 'pt-PT';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onstart = () => {
      listening = true;
      window.__grafictraderVoiceReply = true;
      panel.querySelector('#gtAssistantMic').textContent = '■';
      setStatus('Estou a ouvir…');
    };
    recognition.onresult = event => {
      const transcript = event.results?.[0]?.[0]?.transcript?.trim();
      if (transcript) sendMessage(transcript);
    };
    recognition.onerror = event => {
      setStatus(event.error === 'not-allowed' ? 'Permite o acesso ao microfone nas definições do telemóvel.' : 'Não consegui ouvir. Tenta novamente ou escreve.');
      listening = false;
      panel.querySelector('#gtAssistantMic').textContent = '🎙';
    };
    recognition.onend = () => {
      listening = false;
      panel.querySelector('#gtAssistantMic').textContent = '🎙';
      if (!speaking) setStatus('Pronto para continuar');
    };
    recognition.start();
  } catch {
    setStatus('Não foi possível iniciar o microfone. Verifica a permissão.');
  }
}

export function openAssistant(mode = 'text') {
  ensurePanel();
  sessionId ||= makeSessionId();
  panel.hidden = false;
  document.body.classList.add('gt-assistant-open');
  if (mode === 'voice') {
    window.__grafictraderVoiceReply = true;
    startListening();
  } else {
    window.__grafictraderVoiceReply = false;
    panel.querySelector('#gtAssistantInput').focus();
  }
}

export function closeAssistant() {
  stopListening();
  window.__grafictraderVoiceReply = false;
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  speaking = false;
  if (panel) panel.hidden = true;
  document.body.classList.remove('gt-assistant-open');
}
