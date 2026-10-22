// Error and usage reports through PostHog (github.com/PostHog/posthog-js, MIT / Apache-2.0),
// only when VITE_POSTHOG_KEY is set at build time. Kept to the minimum: no session recording,
// no automatic click capture, nothing stored on the device (a new anonymous id each visit),
// and never the user's name, email, images or screen.

const KEY = import.meta.env.VITE_POSTHOG_KEY;
const HOST = import.meta.env.VITE_POSTHOG_HOST || 'https://eu.i.posthog.com';

let client = null;
const queue = [];

export const analyticsOn = () => Boolean(KEY);

/** Loads PostHog (a separate file, fetched only when a key is set) and starts reporting errors. */
export async function initAnalytics() {
  if (!KEY || client) return;
  try {
    const { default: posthog } = await import('posthog-js');
    posthog.init(KEY, {
      api_host: HOST,
      persistence: 'memory',
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      disable_session_recording: true,
      person_profiles: 'never',
      mask_all_text: true,
      mask_all_element_attributes: true
    });
    client = posthog;
    queue.splice(0).forEach(([name, props]) => client.capture(name, props));
    window.addEventListener('error', event => report(event.error || event.message));
    window.addEventListener('unhandledrejection', event => report(event.reason));
  } catch {
    // reporting is optional: the app works the same without it
  }
}

/** One event with a few plain properties (never personal data). */
export function track(name, props = {}) {
  if (!KEY) return;
  const clean = Object.fromEntries(Object.entries(props).filter(([, v]) => v == null || ['string', 'number', 'boolean'].includes(typeof v)).map(([k, v]) => [k, typeof v === 'string' ? v.slice(0, 200) : v]));
  if (client) client.capture(name, clean);
  else if (queue.length < 50) queue.push([name, clean]);
}

/** An unexpected error, without any user data. */
export function report(error) {
  if (!KEY || !error) return;
  const value = error instanceof Error ? error : new Error(String(error).slice(0, 300));
  if (client?.captureException) client.captureException(value);
  else track('$exception', { message: value.message });
}
