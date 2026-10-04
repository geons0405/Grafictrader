// Reads a provider API key. Also accepts the misspelled names created in the
// Vercel project ("..._API_KAY", "..._PAI_KEY"), so any of them works.
export function apiKey(name) {
  const variants = [name, name.replace(/_KEY$/, '_KAY'), name.replace(/_API_KEY$/, '_PAI_KEY')];
  for (const variant of variants) {
    if (process.env[variant]) return process.env[variant];
  }
  return undefined;
}
