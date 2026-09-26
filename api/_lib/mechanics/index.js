import { calculateEfficiency, calculatePersistence } from './efficiency.js';
import { calculateMovementEnergy } from './energy.js';
import { calculateAbsorption } from './absorption.js';
import { calculateDisplacementCost } from './displacement.js';
import { calculateMarketEntropy } from './entropy.js';
import { calculateRegime } from './regime.js';
import { calculateLiquidityMemory } from './liquidity.js';
import { calculateStructuralPressure } from './structure.js';
import { calculateTradeFlow, calculateOrderBookDynamics, calculateMicroAbsorption, calculateExecutionSignature } from './microstructure.js';

const pct=v=>v==null?null:Math.round(Math.max(0,Math.min(1,v))*100);

export function analyzeMarketMechanics(candles, { trades = [], orderBook = {} } = {}) {
  const efficiency=calculateEfficiency(candles);
  const persistence=calculatePersistence(candles);
  const energy=calculateMovementEnergy(candles,efficiency.value,persistence);
  const absorption=calculateAbsorption(candles);
  const displacement=calculateDisplacementCost(candles);
  const entropy=calculateMarketEntropy(candles);
  const regime=calculateRegime(candles);
  const liquidity=calculateLiquidityMemory(candles);

  const tradeFlow=calculateTradeFlow(trades);
  const book=calculateOrderBookDynamics(orderBook);
  const microAbsorption=calculateMicroAbsorption({trades,candles});
  const execution=calculateExecutionSignature(trades);

  const structuralPressure=calculateStructuralPressure({
    efficiency:efficiency.value,
    persistence,
    absorption:microAbsorption.value ?? absorption.value,
    displacement:displacement.value,
    liquidity:book.value != null ? Math.abs(book.topImbalance ?? 0) : liquidity.value,
    regime:regime.change
  });

  const metrics={
    priceEfficiency:pct(efficiency.value),
    movementEnergy:pct(energy.value),
    absorption:pct(microAbsorption.value ?? absorption.value),
    displacementCost:pct(displacement.value),
    liquidityResistance:pct(book.value != null ? Math.abs(book.topImbalance ?? 0) : liquidity.value),
    marketOrderliness:pct(entropy.orderliness),
    regimeStability:pct(regime.stability),
    structuralPressure:pct(structuralPressure),
    tradeFlow:tradeFlow.imbalance == null ? null : Math.round(tradeFlow.imbalance*100),
    orderBookImbalance:book.imbalance == null ? null : Math.round(book.imbalance*100),
    spreadBps:book.spreadBps == null ? null : Number(book.spreadBps.toFixed(2)),
    executionSignature:pct(execution.value)
  };

  let state='LOW_INFORMATION';
  if (microAbsorption.value != null && microAbsorption.value >= 0.72) state='MICRO_ABSORPTION';
  else if (book.value != null && Math.abs(book.topImbalance ?? 0) >= 0.58) state='ORDER_BOOK_IMBALANCE';
  else if(regime.state==='changed')state='REGIME_TRANSITION';
  else if(absorption.value!=null&&absorption.value>=0.68)state='ABSORPTION';
  else if(liquidity.value!=null&&liquidity.value>=0.72)state='LIQUIDITY_CONFLICT';
  else if(energy.value!=null&&efficiency.value!=null&&energy.value>=0.68&&efficiency.value>=0.62)state='DIRECTIONAL_EXPANSION';
  else if(entropy.value!=null&&entropy.value>=0.80)state='RANGE_ROTATION';

  return{
    metrics,
    state,
    evidence:{
      efficiency:efficiency.value,
      persistence,
      absorptionType:microAbsorption.evidence || absorption.evidence,
      microAbsorption:microAbsorption,
      tradeFlow:tradeFlow,
      orderBook:book,
      executionSignature:execution,
      liquidityType:liquidity.evidence,
      liquidityZones:liquidity.zones.slice(0,5),
      entropy:entropy.value,
      regimeChange:regime.change
    },
    limitations:[
      trades.length ? 'Fluxo de trades agressor disponível para esta leitura.' : 'Trades agressor não disponíveis; métricas de fluxo usam apenas OHLCV.',
      (orderBook?.bids?.length && orderBook?.asks?.length) ? 'Order book real disponível no momento da captura.' : 'Order book não disponível; liquidez é estimada por OHLCV.',
      'Assinatura de execução descreve padrões compatíveis com fragmentação/ritmo observado; não identifica um algoritmo, trader ou instituição específica.'
    ]
  };
}
