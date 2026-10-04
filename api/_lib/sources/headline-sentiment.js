import Sentiment from 'sentiment';

// AFINN word scores (thisandagain/sentiment) plus market vocabulary.
const MARKET_WORDS = {
  surge: 3, surges: 3, soar: 3, soars: 3, rally: 3, rallies: 3, jump: 2, jumps: 2, gain: 2, gains: 2,
  rise: 2, rises: 2, record: 2, bullish: 3, upgrade: 2, inflows: 2, approval: 2, approves: 2, beat: 2, beats: 2,
  plunge: -3, plunges: -3, crash: -3, crashes: -3, tumble: -3, tumbles: -3, slump: -3, drop: -2, drops: -2,
  fall: -2, falls: -2, bearish: -3, downgrade: -2, outflows: -2, hack: -3, hacked: -3, lawsuit: -2, ban: -2,
  'sell-off': -3, selloff: -3, recession: -3, default: -3, liquidation: -2, liquidations: -2, miss: -2, misses: -2
};

const analyzer = new Sentiment();

/** Tone of a headline: bullish, bearish or neutral, plus the raw score. */
export function headlineSentiment(text = '') {
  const { comparative, score } = analyzer.analyze(String(text), { extras: MARKET_WORDS });
  const sentiment = comparative > 0.08 ? 'bullish' : comparative < -0.08 ? 'bearish' : 'neutral';
  return { sentiment, score };
}
