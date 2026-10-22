import { isForexMarket, formatPrice, marketLabel } from '../../api/_lib/markets.js';
export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, m => HTML_ESCAPES[m]);
}

/** Only http(s) links may reach an href; blocks javascript: and data: URLs from feeds. */
export function safeUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/** A price; with the market's symbol, currency pairs read as rates (1.08457) instead of dollars. */
export function fmtPrice(value, symbol = '') {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  if (isForexMarket(symbol) && symbol !== 'XAUUSD') return formatPrice(symbol, n);
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: n < 10 ? 4 : 2, maximumFractionDigits: n < 10 ? 4 : 2 });
}

/** Short price for tight spaces: no cents above $1,000. */
export function fmtPriceShort(value, symbol = '') {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1000) return fmtPrice(value, symbol);
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

export function fmtPct(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return (n >= 0 ? '+' : '') + n.toFixed(digits) + '%';
}

export function fmtCompact(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return '$' + n.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 2 });
}

export function fmtTime(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'agora';
  return d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
}

/** "BTC/USDT", "EUR/USD", "Ouro (XAU/USD)". */
export function pairLabel(symbol) {
  return marketLabel(symbol);
}

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export async function api(path, { method = 'GET', body, signal, timeoutMs = 65_000 } = {}) {
  // Never wait forever: a request that hangs ends with a clear message.
  const timeout = !signal && typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined;
  let response;
  try {
    response = await fetch(path, {
      method,
      signal: signal || timeout,
      cache: 'no-store',
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (error) {
    if (error?.name === 'TimeoutError') throw new ApiError('O servidor demorou demasiado a responder. Tenta de novo.', 0, { timeout: true });
    throw error;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    // The server asks for the current terms: the app shows the acceptance sheet.
    if (data.termsRequired) window.dispatchEvent(new CustomEvent('grafictrader:terms-required'));
    throw new ApiError(data.error || `Pedido falhou (${response.status})`, response.status, data);
  }
  return data;
}
