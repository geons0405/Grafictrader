import { calculateEfficiency, calculatePersistence } from './efficiency.js';
import { calculateMovementEnergy } from './energy.js';
import { calculateAbsorption } from './absorption.js';
import { calculateDisplacementCost } from './displacement.js';
import { calculateMarketEntropy } from './entropy.js';
import { calculateRegime } from './regime.js';
import { calculateLiquidityMemory } from './liquidity.js';
import { calculateStructuralPressure } from './structure.js';

const pct=v=>v==null?null:Math.round(Math.max(0,Math.min(1,v))*100);

export function analyzeMarketMechanics(candles){
  const efficiency=calculateEfficiency(candles);
  const persistence=calculatePersistence(candles);
  const energy=calculateMovementEnergy(candles,efficiency.value,persistence);
  const absorption=calculateAbsorption(candles);
  const displacement=calculateDisplacementCost(candles);
  const entropy=calculateMarketEntropy(candles);
  const regime=calculateRegime(candles);
  const liquidity=calculateLiquidityMemory(candles);

  const structuralPressure=calculateStructuralPressure({
    efficiency:efficiency.value,
    persistence,
    absorption:absorption.value,
    displacement:displacement.value,
    liquidity:liquidity.value,
    regime:regime.change
  });

  const metrics={
    priceEfficiency:pct(efficiency.value),
    movementEnergy:pct(energy.value),
    absorption:pct(absorption.value),
    displacementCost:pct(displacement.value),
    liquidityResistance:pct(liquidity.value),
    marketOrderliness:pct(entropy.orderliness),
    regimeStability:pct(regime.stability),
    structuralPressure:pct(structuralPressure)
  };

  let state='LOW_INFORMATION';
  if(regime.state==='changed')state='REGIME_TRANSITION';
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
      absorptionType:absorption.evidence,
      liquidityType:liquidity.evidence,
      liquidityZones:liquidity.zones.slice(0,5),
      entropy:entropy.value,
      regimeChange:regime.change
    },
    limitations:[
      'A leitura atual usa OHLCV; trades e order book não estão disponíveis neste cálculo.',
      'Absorção e liquidez são proxies de OHLCV, não observações diretas de fluxo agressor ou profundidade.',
      'Assinaturas de execução avançadas e replenishment ficam indisponíveis sem trades/order book.'
    ]
  };
}