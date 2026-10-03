/** fetch JSON with a timeout; throws on non-2xx. */
export async function fetchJson(url, { timeout = 8000, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: 'no-store', headers: { 'User-Agent': 'Mozilla/5.0 Grafictrader', Accept: 'application/json', ...headers } });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status} em ${new URL(url).hostname}`);
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

/** Per-instance memo with TTL; concurrent callers share one in-flight promise. */
export function memo(ttlMs, fn) {
  let entry = null;
  return () => {
    if (entry && Date.now() - entry.at < ttlMs) return entry.promise;
    const promise = fn();
    entry = { at: Date.now(), promise };
    promise.catch(() => { entry = null; });
    return promise;
  };
}
