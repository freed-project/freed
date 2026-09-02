/** Public newsletter configuration shared by Freed's browser surfaces. */
export const FREED_NEWSLETTER_SUBSCRIBE_URL = "https://freed.wtf/api/subscribe";

/**
 * Cloudflare Turnstile site keys are public browser identifiers. The matching
 * secret remains on freed.wtf and is never shipped in Freed clients.
 */
export const FREED_NEWSLETTER_TURNSTILE_SITE_KEY = "0x4AAAAAADDc1lvzAG-LEY-7";

/** Cloudflare's public always-pass key for local and automated previews only. */
export const FREED_NEWSLETTER_TURNSTILE_TEST_SITE_KEY =
  "1x00000000000000000000AA";

export const FREED_NEWSLETTER_SUBSCRIBED_STORAGE_KEY =
  "freed-newsletter-subscribed-v1";
