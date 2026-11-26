import { createHash } from 'node:crypto';

export const LIVE_CHAT_TTL_SECONDS = 30 * 24 * 60 * 60;
export const LIVE_CHAT_MAX_TURNS = 12;
export const LIVE_CHAT_MAX_MESSAGE = 1500;

export function normalizeLiveChatMessage(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, LIVE_CHAT_MAX_MESSAGE);
}

export function validLiveChatSession(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{8,80}$/.test(value);
}

export function liveChatKey(email, sessionId) {
  const owner = createHash('sha256').update(String(email).toLowerCase()).digest('hex');
  return `grafictrader:live-chat:${owner}:${sessionId}`;
}

export function trimLiveChatHistory(history) {
  return (Array.isArray(history) ? history : [])
    .filter(item => item && ['user', 'model'].includes(item.role) && typeof item.text === 'string')
    .slice(-LIVE_CHAT_MAX_TURNS * 2)
    .map(item => ({ role: item.role, parts: [{ text: item.text.slice(0, LIVE_CHAT_MAX_MESSAGE * 2) }] }));
}
