// Reads a provider API key. Also accepts the misspelled "..._API_KAY" names
// that were created in the Vercel project, so either spelling works.
export function apiKey(name) {
  return process.env[name] || process.env[name.replace(/_KEY$/, '_KAY')] || undefined;
}
