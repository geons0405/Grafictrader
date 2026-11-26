import { market } from '../lib/store.js';
import { downsampleTo16k, floatToPcm16, pcm16ToFloat } from '../lib/live-audio.js';

let panel = null;
let sessionId = '';
let liveSocket = null;
let audioContext = null;
let microphoneStream = null;
let microphoneSource = null;
let microphoneProcessor = null;
let mutedOutput = null;
let setupReady = false;
let shouldRun = false;
let reconnectTimer = null;
let reconnectAttempts = 0;
let resumeHandle = null;
let activeAudioSources = new Set();
let nextAudioTime = 0;
let activeInputNode = null;
let activeOutputNode = null;
let inputTranscript = '';
let outputTranscript = '';
let conversationHistory = [];
let liveTokenCache = null;

const LIVE_TOOLS = [{
  functionDeclarations: [{
    name: 'refresh_market_analysis',
    description: 'Obtém uma análise quantitativa atualizada do motor GraficTrader para um ativo e período suportados. Usa esta ferramenta antes de afirmar preços, indicadores ou sinais atuais.',
    parameters: {
      type: 'OBJECT',
      properties: {
        symbol: { type: 'STRING', description: 'Símbolo suportado, por exemplo BTCUSDT, EURUSD ou XAUUSD.' },
        interval: { type: 'STRING', enum: ['1m', '5m', '15m', '1h', '4h'] }
      },
      required: ['symbol', 'interval']
    }
  }]
}];

const makeSessionId = () => 'gt_' + Array.from(crypto.getRandomValues(new Uint8Array(18)), n => n.toString(16).padStart(2, '0')).join('');
const currentSymbol = () => market.source === 'mt5'
  ? market.mt5Symbol
  : market.source === 'tradingview'
    ? String(market.tvSymbol || '').replace(/^[A-Z0-9_]+:/, '')
    : market.symbol;

function ensurePanel() {
  if (panel) return panel;
  panel = document.createElement('section');
  panel.className = 'gt-assistant';
  panel.hidden = true;
  panel.innerHTML = '<div class="gt-assistant-card" role="dialog" aria-modal="true" aria-label="GraficTrader Live">' +
    '<header><div><small>GRAFICTRADER</small><h2>Assistente LIVE</h2><p id="gtAssistantStatus">Pronto para conversar</p></div>' +
    '<button type="button" id="gtAssistantClose" aria-label="Fechar">×</button></header>' +
    '<div class="gt-assistant-messages" id="gtAssistantMessages" aria-live="polite"><p class="gt-assistant-intro">Fala naturalmente comigo. Podes interromper-me e eu também vou acompanhar a tua fala. Posso explicar o mercado e as análises do GraficTrader.</p></div>' +
    '<div class="gt-assistant-controls"><button type="button" id="gtAssistantMic" aria-label="Iniciar ou terminar conversa LIVE">🎙</button><span id="gtAssistantHint">Toca no microfone para conversar</span></div>' +
    '<small class="gt-assistant-foot">A análise é informativa. Não executa ordens nem garante resultados.</small></div>';
  document.body.append(panel);
  panel.querySelector('#gtAssistantClose').onclick = closeAssistant;
  panel.querySelector('#gtAssistantMic').onclick = () => shouldRun ? stopLiveSession() : startLiveSession();
  panel.addEventListener('click', event => { if (event.target === panel) closeAssistant(); });
  return panel;
}

function setStatus(text) {
  if (panel) panel.querySelector('#gtAssistantStatus').textContent = text;
}

function setMicActive(active) {
  if (!panel) return;
  const button = panel.querySelector('#gtAssistantMic');
  button.textContent = active ? '■' : '🎙';
  button.classList.toggle('is-active', active);
  button.setAttribute('aria-label', active ? 'Terminar conversa LIVE' : 'Iniciar conversa LIVE');
  panel.querySelector('#gtAssistantHint').textContent = active ? 'Estás em LIVE · podes falar naturalmente' : 'Toca no microfone para conversar';
}

function addMessage(text, role) {
  if (!panel || !text) return null;
  const list = panel.querySelector('#gtAssistantMessages');
  const intro = list.querySelector('.gt-assistant-intro');
  if (intro) intro.remove();
  const item = document.createElement('p');
  item.className = 'gt-message ' + role;
  item.textContent = text;
  list.append(item);
  list.scrollTop = list.scrollHeight;
  return item;
}

function appendTranscript(role, chunk) {
  if (!chunk) return;
  const isUser = role === 'user';
  let node = isUser ? activeInputNode : activeOutputNode;
  if (!node) {
    node = addMessage('', isUser ? 'user' : 'assistant');
    if (isUser) {
      activeInputNode = node;
      inputTranscript = '';
    } else {
      activeOutputNode = node;
      outputTranscript = '';
    }
  }
  if (isUser) {
    inputTranscript += chunk;
    node.textContent = inputTranscript;
  } else {
    outputTranscript += chunk;
    node.textContent = outputTranscript;
  }
  const list = panel.querySelector('#gtAssistantMessages');
  list.scrollTop = list.scrollHeight;
}

function finalizeTurn() {
  if (inputTranscript.trim()) conversationHistory.push({ role: 'user', text: inputTranscript.trim() });
  if (outputTranscript.trim()) conversationHistory.push({ role: 'model', text: outputTranscript.trim() });
  conversationHistory = conversationHistory.slice(-24);
  activeInputNode = null;
  activeOutputNode = null;
  inputTranscript = '';
  outputTranscript = '';
}

function encodeBase64(bytes) {
  let binary = '';
  const step = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += step) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + step, bytes.length)));
  }
  return btoa(binary);
}


async function startMicrophone() {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Este dispositivo não disponibiliza captura de áudio segura.');
  microphoneStream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: false
  });
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error('O áudio em tempo real não é suportado neste dispositivo.');
  try { audioContext = new AudioContextClass({ sampleRate: 16000 }); }
  catch { audioContext = new AudioContextClass(); }
  await audioContext.resume();
  microphoneSource = audioContext.createMediaStreamSource(microphoneStream);
  const bufferSize = audioContext.sampleRate > 24000 ? 4096 : 2048;
  microphoneProcessor = audioContext.createScriptProcessor(bufferSize, 1, 1);
  mutedOutput = audioContext.createGain();
  mutedOutput.gain.value = 0;
  microphoneProcessor.onaudioprocess = event => {
    if (!shouldRun || !setupReady || !liveSocket || liveSocket.readyState !== WebSocket.OPEN) return;
    const samples = downsampleTo16k(event.inputBuffer.getChannelData(0), audioContext.sampleRate);
    if (!samples.length) return;
    const pcm = floatToPcm16(samples);
    liveSocket.send(JSON.stringify({
      realtimeInput: {
        audio: { mimeType: 'audio/pcm;rate=16000', data: encodeBase64(pcm) }
      }
    }));
  };
  microphoneSource.connect(microphoneProcessor);
  microphoneProcessor.connect(mutedOutput);
  mutedOutput.connect(audioContext.destination);
}

function stopAudioPlayback() {
  for (const source of activeAudioSources) {
    try { source.onended = null; source.stop(); } catch { /* already stopped */ }
  }
  activeAudioSources.clear();
  nextAudioTime = audioContext?.currentTime || 0;
}

function playAudioChunk(base64, mimeType = 'audio/pcm;rate=24000') {
  if (!audioContext || !base64) return;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const samples = pcm16ToFloat(bytes);
  if (!samples.length) return;
  const rateMatch = String(mimeType).match(/rate=(\d+)/i);
  const sampleRate = rateMatch ? Number(rateMatch[1]) : 24000;
  const buffer = audioContext.createBuffer(1, samples.length, sampleRate);
  buffer.copyToChannel(samples, 0);
  const source = audioContext.createBufferSource();
  source.buffer = buffer;
  source.connect(audioContext.destination);
  const startAt = Math.max(audioContext.currentTime + 0.025, nextAudioTime);
  source.start(startAt);
  nextAudioTime = startAt + buffer.duration;
  activeAudioSources.add(source);
  source.onended = () => activeAudioSources.delete(source);
}

async function fetchLiveToken() {
  if (liveTokenCache && Date.parse(liveTokenCache.expiresAt) - Date.now() > 60000) return liveTokenCache;
  const response = await fetch('/api/instructor?liveToken=1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    cache: 'no-store',
    body: JSON.stringify({
      sessionId,
      symbol: currentSymbol() || undefined,
      interval: market.interval || '5m'
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok || !data.token) throw new Error(data.error || 'Não foi possível iniciar a sessão LIVE.');
  liveTokenCache = data;
  return data;
}

function setupMessage(data) {
  const config = {
    responseModalities: ['AUDIO'],
    speechConfig: {
      languageCode: 'pt-PT',
      voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } }
    },
    maxOutputTokens: 1024
  };
  return {
    setup: {
      model: 'models/' + data.model,
      generationConfig: config,
      systemInstruction: { parts: [{ text: data.systemInstruction }] },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      realtimeInputConfig: {
        automaticActivityDetection: {
          disabled: false,
          prefixPaddingMs: 300,
          silenceDurationMs: 850
        }
      },
      sessionResumption: resumeHandle ? { handle: resumeHandle } : {},
      tools: LIVE_TOOLS
    }
  };
}

async function handleToolCalls(toolCall) {
  const calls = toolCall?.functionCalls || [];
  for (const call of calls) {
    if (call.name !== 'refresh_market_analysis') continue;
    let result;
    try {
      const response = await fetch('/api/instructor?liveMarket=1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify({
          symbol: call.args?.symbol || currentSymbol(),
          interval: call.args?.interval || market.interval || '5m'
        })
      });
      const data = await response.json().catch(() => ({}));
      result = response.ok && data.ok ? data.analysis : { error: data.error || 'A análise atual não está disponível.' };
    } catch {
      result = { error: 'Não foi possível contactar o motor GraficTrader.' };
    }
    if (liveSocket?.readyState === WebSocket.OPEN) {
      liveSocket.send(JSON.stringify({
        toolResponse: {
          functionResponses: [{ id: call.id, name: call.name, response: result }]
        }
      }));
    }
  }
}

function handleLiveMessage(raw) {
  let message;
  try { message = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return; }
  if (message.setupComplete) {
    setupReady = true;
    reconnectAttempts = 0;
    setStatus('Ligado · estou a ouvir');
    setMicActive(true);
  }
  if (message.error) {
    const detail = message.error.message || 'O serviço LIVE devolveu um erro.';
    setStatus(detail.slice(0, 180));
    if (liveSocket?.readyState === WebSocket.OPEN) liveSocket.close(1011, 'Gemini Live error');
    return;
  }
  const resumption = message.sessionResumptionUpdate || message.serverContent?.sessionResumptionUpdate;
  if (resumption?.newHandle) resumeHandle = resumption.newHandle;

  const server = message.serverContent || {};
  if (server.interrupted) {
    stopAudioPlayback();
    setStatus('Interrompeste a resposta · continua a falar');
  }
  const inputText = server.inputTranscription?.text;
  if (inputText) {
    appendTranscript('user', inputText);
    setStatus('A ouvir a tua pergunta…');
  }
  const outputText = server.outputTranscription?.text;
  if (outputText) appendTranscript('assistant', outputText);

  const parts = server.modelTurn?.parts || [];
  for (const part of parts) {
    const inline = part.inlineData || part.inline_data;
    if (inline?.data && String(inline.mimeType || inline.mime_type || '').startsWith('audio/pcm')) {
      playAudioChunk(inline.data, inline.mimeType || inline.mime_type);
      setStatus('A responder por voz…');
    }
    if (part.text) appendTranscript('assistant', part.text);
  }
  if (server.turnComplete) {
    finalizeTurn();
    setStatus('Estou ligado · podes continuar');
  }
  if (message.toolCall) handleToolCalls(message.toolCall);
  if (message.goAway && liveSocket?.readyState === WebSocket.OPEN) {
    liveSocket.close(1012, 'Gemini session renewal');
  }
}

async function connectLive() {
  const data = await fetchLiveToken();
  if (!shouldRun) return;
  const url = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=' + encodeURIComponent(data.token);
  await new Promise((resolve, reject) => {
    let settled = false;
    const socket = new WebSocket(url);
    liveSocket = socket;
    const setupTimeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { socket.close(); } catch { /* no-op */ }
        reject(new Error('A ligação LIVE demorou demasiado tempo a responder.'));
      }
    }, 18000);
    socket.onopen = () => {
      if (!shouldRun) {
        socket.close(1000, 'User stopped');
        return;
      }
      socket.send(JSON.stringify(setupMessage(data)));
    };
    socket.onmessage = event => {
      handleLiveMessage(event.data);
      if (!settled && setupReady) {
        settled = true;
        clearTimeout(setupTimeout);
        resolve();
      }
    };
    socket.onerror = () => {
      if (!settled) {
        settled = true;
        clearTimeout(setupTimeout);
        reject(new Error('Não foi possível estabelecer ligação com o Gemini Live.'));
      }
    };
    socket.onclose = event => {
      if (!settled) {
        settled = true;
        clearTimeout(setupTimeout);
        reject(new Error('A ligação LIVE foi fechada (' + event.code + ').'));
      }
      if (liveSocket === socket) liveSocket = null;
      setupReady = false;
      if (shouldRun) scheduleReconnect();
    };
  });
}

function scheduleReconnect() {
  if (!shouldRun || reconnectTimer) return;
  if (reconnectAttempts >= 5) {
    shouldRun = false;
    releaseAudio();
    setMicActive(false);
    setStatus('A ligação caiu várias vezes. Toca no microfone para voltar a ligar.');
    return;
  }
  reconnectAttempts += 1;
  const delay = Math.min(1000 * (2 ** (reconnectAttempts - 1)), 8000);
  setStatus('A recuperar a ligação (' + reconnectAttempts + '/5)…');
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    if (!shouldRun) return;
    try {
      await connectLive();
    } catch (error) {
      if (shouldRun) {
        setStatus(error.message || 'A tentar recuperar a ligação…');
        scheduleReconnect();
      }
    }
  }, delay);
}

function releaseAudio() {
  setupReady = false;
  stopAudioPlayback();
  if (microphoneProcessor) {
    microphoneProcessor.onaudioprocess = null;
    try { microphoneProcessor.disconnect(); } catch { /* already disconnected */ }
    microphoneProcessor = null;
  }
  try { microphoneSource?.disconnect(); } catch { /* already disconnected */ }
  microphoneSource = null;
  try { mutedOutput?.disconnect(); } catch { /* already disconnected */ }
  mutedOutput = null;
  if (microphoneStream) {
    microphoneStream.getTracks().forEach(track => track.stop());
    microphoneStream = null;
  }
  if (audioContext) {
    const context = audioContext;
    audioContext = null;
    context.close().catch(() => {});
  }
}

async function startLiveSession() {
  if (shouldRun) return;
  shouldRun = true;
  reconnectAttempts = 0;
  resumeHandle = null;
  liveTokenCache = null;
  conversationHistory = [];
  activeInputNode = null;
  activeOutputNode = null;
  inputTranscript = '';
  outputTranscript = '';
  setMicActive(true);
  setStatus('A pedir acesso ao microfone…');
  try {
    await startMicrophone();
    if (!shouldRun) return;
    setStatus('A ligar ao GraficTrader Live…');
    await connectLive();
  } catch (error) {
    if (!shouldRun) return;
    releaseAudio();
    setStatus(error.message || 'Não foi possível iniciar o LIVE.');
    scheduleReconnect();
  }
}

function stopLiveSession() {
  shouldRun = false;
  setupReady = false;
  liveTokenCache = null;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  if (liveSocket) {
    const socket = liveSocket;
    liveSocket = null;
    try { socket.close(1000, 'User ended LIVE session'); } catch { /* already closed */ }
  }
  releaseAudio();
  setMicActive(false);
  setStatus('Sessão terminada · toca no microfone para recomeçar');
}

export function openAssistant(mode = 'voice') {
  ensurePanel();
  sessionId ||= makeSessionId();
  panel.hidden = false;
  document.body.classList.add('gt-assistant-open');
  if (mode === 'voice' && !shouldRun) startLiveSession();
}

export function closeAssistant() {
  stopLiveSession();
  if (panel) panel.hidden = true;
  document.body.classList.remove('gt-assistant-open');
}
