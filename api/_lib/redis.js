// Minimal Upstash Redis REST client (Vercel KV compatible).
// Reads env lazily so tests and local runs can configure it at runtime.

function credentials() {
  return {
    url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
  };
}

export function redisConfigured() {
  const { url, token } = credentials();
  return Boolean(url && token);
}

export async function redis(command) {
  const { url, token } = credentials();
  if (!url || !token) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(command),
      signal: controller.signal
    });
    if (!response.ok) throw new Error('Redis storage unavailable.');
    const data = await response.json();
    if (data?.error) throw new Error('Redis error: ' + data.error);
    return data?.result ?? null;
  } finally {
    clearTimeout(timer);
  }
}
