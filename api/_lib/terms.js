// Version of the Terms of Use and Risk Warning (public/termos.html, data-terms-version).
// Bump it when the terms change materially: every user must accept again.
export const TERMS_VERSION = '2026-10-05';

export const termsAccepted = user => Boolean(user) && user.termsVersion === TERMS_VERSION;
