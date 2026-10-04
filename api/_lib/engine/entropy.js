import { clamp, std, mean, round } from './core.js';

// Layer 2 — Entropy & information: how predictable (structured) or chaotic the
// market is right now, and whether that is changing.

/** Quantile bins (0..k-1) so every symbol is equally likely a priori. */
export function quantize(x, k = 5) {
  const sorted = [...x].sort((a, b) => a - b);
  const edges = Array.from({ length: k - 1 }, (_, i) => sorted[Math.floor(((i + 1) * sorted.length) / k)]);
  return x.map(v => {
    let b = 0;
    while (b < edges.length && v > edges[b]) b++;
    return b;
  });
}

/** Normalized Shannon entropy of the binned returns (1 = uniform / unpredictable). */
export function shannon(x, k = 5) {
  if (x.length < k * 4) return null;
  const counts = new Array(k).fill(0);
  for (const s of quantize(x, k)) counts[s]++;
  let h = 0;
  for (const c of counts) if (c) { const p = c / x.length; h -= p * Math.log(p); }
  return h / Math.log(k);
}

/** Bandt–Pompe permutation entropy, normalized. */
export function permutationEntropy(x, order = 3) {
  if (x.length < order + 10) return null;
  const counts = new Map();
  for (let i = 0; i + order <= x.length; i++) {
    const w = x.slice(i, i + order);
    const key = w.map((v, j) => [v, j]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(p => p[1]).join('');
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const n = x.length - order + 1;
  let h = 0;
  for (const c of counts.values()) { const p = c / n; h -= p * Math.log(p); }
  let fact = 1;
  for (let i = 2; i <= order; i++) fact *= i;
  return h / Math.log(fact);
}

function matches(x, m, r) {
  const n = x.length;
  let count = 0;
  for (let i = 0; i < n - m; i++) {
    for (let j = i + 1; j < n - m; j++) {
      let ok = true;
      for (let k = 0; k < m; k++) if (Math.abs(x[i + k] - x[j + k]) > r) { ok = false; break; }
      if (ok) count++;
    }
  }
  return count;
}

/** Sample entropy (Richman & Moorman): lower = more regular, self-similar series. */
export function sampleEntropy(x, m = 2, rFactor = 0.2) {
  if (x.length < 50) return null;
  const r = rFactor * std(x);
  const b = matches(x, m, r);
  const a = matches(x, m + 1, r);
  if (!a || !b) return null;
  return -Math.log(a / b);
}

/** Approximate entropy (Pincus). */
export function approximateEntropy(x, m = 2, rFactor = 0.2) {
  if (x.length < 50) return null;
  const r = rFactor * std(x);
  const phi = mm => {
    const n = x.length - mm + 1;
    let total = 0;
    for (let i = 0; i < n; i++) {
      let c = 0;
      for (let j = 0; j < n; j++) {
        let ok = true;
        for (let k = 0; k < mm; k++) if (Math.abs(x[i + k] - x[j + k]) > r) { ok = false; break; }
        if (ok) c++;
      }
      total += Math.log(c / n);
    }
    return total / n;
  };
  return phi(m) - phi(m + 1);
}

/** Mutual information between two binned series (in bits). */
export function mutualInformation(a, b, k = 3) {
  const n = Math.min(a.length, b.length);
  if (n < 30) return null;
  const qa = quantize(a.slice(-n), k);
  const qb = quantize(b.slice(-n), k);
  const joint = new Map(), pa = new Array(k).fill(0), pb = new Array(k).fill(0);
  for (let i = 0; i < n; i++) {
    joint.set(qa[i] * k + qb[i], (joint.get(qa[i] * k + qb[i]) || 0) + 1);
    pa[qa[i]]++; pb[qb[i]]++;
  }
  let mi = 0;
  for (const [key, c] of joint) {
    const i = Math.floor(key / k), j = key % k;
    mi += (c / n) * Math.log2((c / n) / ((pa[i] / n) * (pb[j] / n)));
  }
  return mi;
}

/**
 * Transfer entropy X→Y (bits), lag 1, 3 bins: how much X's past reduces the
 * uncertainty of Y's next value beyond Y's own past.
 */
export function transferEntropy(x, y, k = 3) {
  const n = Math.min(x.length, y.length);
  if (n < 60) return null;
  const qx = quantize(x.slice(-n), k);
  const qy = quantize(y.slice(-n), k);
  const c3 = new Map(), c2yy = new Map(), c2yx = new Map(), c1 = new Map();
  const inc = (m, key) => m.set(key, (m.get(key) || 0) + 1);
  for (let t = 1; t < n; t++) {
    const yn = qy[t], yp = qy[t - 1], xp = qx[t - 1];
    inc(c3, `${yn},${yp},${xp}`);
    inc(c2yy, `${yn},${yp}`);
    inc(c2yx, `${yp},${xp}`);
    inc(c1, `${yp}`);
  }
  const total = n - 1;
  let te = 0;
  for (const [key, c] of c3) {
    const [yn, yp, xp] = key.split(',');
    const pJoint = c / total;
    const pCondFull = c / c2yx.get(`${yp},${xp}`);
    const pCondSelf = c2yy.get(`${yn},${yp}`) / c1.get(yp);
    te += pJoint * Math.log2(pCondFull / pCondSelf);
  }
  return Math.max(0, te);
}

/** Layer score: structure (low entropy) × recent drift, plus entropy trend. */
export function entropyLayer(returns) {
  if (returns.length < 120) {
    return { id: 'entropy', name: 'Entropia e informação', score: 0, confidence: 0, metrics: {}, notes: ['Dados insuficientes.'] };
  }
  const recent = returns.slice(-100);
  const earlier = returns.slice(-200, -100);
  const pe3 = permutationEntropy(recent, 3);
  const pe4 = permutationEntropy(recent, 4);
  const sh = shannon(recent);
  const sampEn = sampleEntropy(recent);
  const apEn = approximateEntropy(recent);
  const peEarlier = earlier.length >= 60 ? permutationEntropy(earlier, 3) : null;
  const trend = pe3 != null && peEarlier != null ? pe3 - peEarlier : 0; // < 0: becoming more structured
  const mi = mutualInformation(recent.slice(0, -1), recent.slice(1));
  const structure = clamp(1 - (pe3 ?? 1), 0, 1) * 4 + clamp(-trend * 5, -0.5, 0.5);
  const drift = mean(returns.slice(-20)) / (std(returns.slice(-100)) || 1);
  const score = clamp(Math.tanh(drift * 4) * clamp(structure, 0, 1));
  const notes = [
    `Entropia de permutação ${pe3?.toFixed(3)} (1 = aleatório)${trend < -0.01 ? ', a descer: o movimento está a ficar mais estruturado' : trend > 0.01 ? ', a subir: estrutura a deteriorar-se' : ''}.`,
    `Entropia amostral ${sampEn != null ? sampEn.toFixed(2) : '—'}; informação mútua retorno→retorno ${mi != null ? mi.toFixed(3) : '—'} bits.`
  ];
  return {
    id: 'entropy', name: 'Entropia e informação', score: round(score), confidence: round(clamp(0.3 + structure * 0.6, 0.1, 0.9)),
    metrics: { permutation3: round(pe3), permutation4: round(pe4), shannon: round(sh), sampleEntropy: round(sampEn), approximateEntropy: round(apEn), mutualInformation: round(mi, 4), entropyTrend: round(trend, 4) },
    notes
  };
}
