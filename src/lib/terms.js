// Must match api/_lib/terms.js and the data-terms-version of public/termos.html.
export const TERMS_VERSION = '2026-10-05';
export const TERMS_URL = '/termos.html';

export const needsTerms = user => Boolean(user) && user.termsVersion !== TERMS_VERSION;
