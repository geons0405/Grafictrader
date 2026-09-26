export function calculateStructuralPressure({efficiency,persistence,absorption,displacement,liquidity,regime}) {
  const parts=[
    efficiency == null ? null : efficiency,
    persistence == null ? null : persistence,
    absorption == null ? null : absorption,
    displacement == null ? null : displacement,
    liquidity == null ? null : liquidity,
    regime == null ? null : regime
  ].filter(v=>Number.isFinite(v));
  if(!parts.length)return null;
  const directional = [efficiency,persistence].filter(Number.isFinite);
  const friction = [absorption,displacement,liquidity].filter(Number.isFinite);
  const directionalScore=directional.length?directional.reduce((a,b)=>a+b,0)/directional.length:0;
  const frictionScore=friction.length?friction.reduce((a,b)=>a+b,0)/friction.length:0;
  return Math.max(0,Math.min(1,0.65*directionalScore+0.35*(1-frictionScore)));
}