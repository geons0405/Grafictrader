import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeLiveChatMessage, validLiveChatSession, liveChatKey, trimLiveChatHistory,
  LIVE_CHAT_MAX_MESSAGE, LIVE_CHAT_MAX_TURNS
} from '../api/_lib/live-chat.js';

test('normalizes and bounds user messages', () => {
  assert.equal(normalizeLiveChatMessage('  Olá\\u0000 mundo  '), 'Olá mundo');
  assert.equal(normalizeLiveChatMessage('x'.repeat(LIVE_CHAT_MAX_MESSAGE + 10)).length, LIVE_CHAT_MAX_MESSAGE);
  assert.equal(normalizeLiveChatMessage('   '), '');
});

test('accepts only bounded safe session identifiers', () => {
  assert.equal(validLiveChatSession('session_123456'), true);
  assert.equal(validLiveChatSession('x'), false);
  assert.equal(validLiveChatSession('bad/id/123456'), false);
});

test('conversation keys are scoped to user and session without exposing email', () => {
  const a = liveChatKey('user@example.com', 'session_123456');
  assert.equal(a, liveChatKey('USER@example.com', 'session_123456'));
  assert.notEqual(a, liveChatKey('other@example.com', 'session_123456'));
  assert.equal(a.includes('user@example.com'), false);
});

test('history keeps only valid roles and latest bounded turns', () => {
  const history = Array.from({ length: LIVE_CHAT_MAX_TURNS * 2 + 4 }, (_, i) => ({
    role: i % 2 ? 'model' : 'user', text: 'turn ' + i
  }));
  history.push({ role: 'system', text: 'ignore' }, { role: 'user', text: 123 });
  const result = trimLiveChatHistory(history);
  assert.equal(result.length, LIVE_CHAT_MAX_TURNS * 2);
  assert.equal(result.at(-1).parts[0].text, 'turn ' + (LIVE_CHAT_MAX_TURNS * 2 + 3));
});
