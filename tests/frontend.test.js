import test from 'node:test';
import assert from 'node:assert/strict';
import { wilderRsi, marketStructure, technicalReading } from '../src/lib/indicators.js';
import { safeUrl, escapeHtml } from '../src/lib/dom.js';
import { makeCandles } from './helpers.js';

test('Wilder RSI edges', () => {
  const rising = Array.from({ length: 30 }, (_, i) => 100 + i);
  assert.equal(wilderRsi(rising), 100);
  const falling = rising.slice().reverse();
  assert.equal(wilderRsi(falling), 0);
  assert.equal(wilderRsi([1, 2, 3]), null);
});

test('market structure detects higher highs and higher lows', () => {
  const candles = [];
  for (let i = 0; i < 60; i++) {
    const base = 100 + i * 0.5 + Math.sin(i / 2) * 3;
    candles.push({ open: base, high: base + 1, low: base - 1, close: base });
  }
  assert.equal(marketStructure(candles).key, 'bullish');
});

test('technical reading needs enough data and reports bounded confidence', () => {
  assert.equal(technicalReading(makeCandles(10)), null);
  const reading = technicalReading(makeCandles(120));
  assert.ok(reading.confidence >= 0 && reading.confidence <= 100);
  assert.ok(['Alta', 'Baixa', 'Lateral'].includes(reading.trend));
});

test('safeUrl blocks script URLs and escapeHtml escapes markup', () => {
  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.equal(safeUrl('data:text/html,hi'), null);
  assert.equal(safeUrl('https://example.com/a?b=1'), 'https://example.com/a?b=1');
  assert.equal(escapeHtml('<img onerror="x">'), '&lt;img onerror=&quot;x&quot;&gt;');
});
