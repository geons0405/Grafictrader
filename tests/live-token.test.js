import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LIVE_MODEL, LIVE_TOOL_CONFIG, resolveLiveModel, buildLiveTokenRequest, buildLiveSystemInstruction
} from '../api/_lib/live-token.js';

test('uses a supported default Live model and safely normalizes model ids', () => {
  assert.equal(DEFAULT_LIVE_MODEL, 'gemini-3.1-flash-live-preview');
  assert.equal(resolveLiveModel('models/gemini-3.8-live'), 'gemini-3.8-live');
  assert.equal(resolveLiveModel('bad model!'), DEFAULT_LIVE_MODEL);
});

test('ephemeral token is restricted to one Live model and audio with session resumption', () => {
  const payload = buildLiveTokenRequest('gemini-3.1-flash-live-preview', 0);
  assert.equal(payload.uses, 1);
  assert.equal(payload.liveConnectConstraints.model, 'models/gemini-3.1-flash-live-preview');
  assert.deepEqual(payload.liveConnectConstraints.config.responseModalities, ['AUDIO']);
  assert.deepEqual(payload.liveConnectConstraints.config.sessionResumption, {});
  assert.equal(payload.liveConnectConstraints.config.tools[0].functionDeclarations[0].name, 'refresh_market_analysis');
  assert.equal(LIVE_TOOL_CONFIG[0].functionDeclarations[0].name, 'refresh_market_analysis');
  assert.equal(Date.parse(payload.expireTime), 30 * 60 * 1000);
  assert.equal(Date.parse(payload.newSessionExpireTime), 60 * 1000);
});

test('voice system instruction includes market snapshot but never invents one', () => {
  const withMarket = buildLiveSystemInstruction({ symbol: 'BTCUSDT', price: 90000 });
  assert.match(withMarket, /BTCUSDT/);
  assert.match(withMarket, /Nunca inventes/);
  const withoutMarket = buildLiveSystemInstruction();
  assert.match(withoutMarket, /Não foi possível obter/);
});
