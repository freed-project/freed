/**
 * Rate limiting for Facebook scraping
 *
 * Facebook aggressively rate-limits and bans scrapers.
 * Conservative defaults: 5 minutes minimum between scrapes,
 * with exponential backoff on errors.
 */

import type { RateLimitState } from "./types.js";

/** Minimum time between scrapes in normal operation (5 minutes) */
const MIN_INTERVAL_MS = 5 * 60 * 1000;

/** Cooldown after first error (30 minutes) */
const ERROR_COOLDOWN_MS = 30 * 60 * 1000;

/** Cooldown after 3+ consecutive errors (2 hours) */
const EXTENDED_COOLDOWN_MS = 2 * 60 * 60 * 1000;

/** Initial empty state */
export function createRateLimitState(): RateLimitState {
  return {
    lastScrapeAt: 0,
    consecutiveErrors: 0,
    cooldownUntil: 0,
  };
}

/**
 * Check whether we're allowed to scrape right now.
 * Returns { allowed: true } or { allowed: false, waitMs: number }.
 */
export function checkRateLimit(
  state: RateLimitState,
  now: number = Date.now()
): { allowed: boolean; waitMs?: number } {
  // Hard cooldown from errors
  if (state.cooldownUntil > now) {
    return { allowed: false, waitMs: state.cooldownUntil - now };
  }

  // Minimum interval between scrapes
  const nextAllowed = state.lastScrapeAt + MIN_INTERVAL_MS;
  if (nextAllowed > now) {
    return { allowed: false, waitMs: nextAllowed - now };
  }

  return { allowed: true };
}

/**
 * Record a successful scrape — resets error count and updates lastScrapeAt.
 */
export function recordSuccess(
  state: RateLimitState,
  now: number = Date.now()
): RateLimitState {
  return {
    lastScrapeAt: now,
    consecutiveErrors: 0,
    cooldownUntil: 0,
  };
}

/**
 * Record a failed scrape — increments error count and applies cooldown.
 */
export function recordError(
  state: RateLimitState,
  now: number = Date.now()
): RateLimitState {
  const consecutiveErrors = state.consecutiveErrors + 1;
  const cooldownMs = consecutiveErrors >= 3 ? EXTENDED_COOLDOWN_MS : ERROR_COOLDOWN_MS;
  return {
    ...state,
    consecutiveErrors,
    cooldownUntil: now + cooldownMs,
  };
}

/**
 * Format wait time for human-readable logging.
 */
export function formatWaitTime(ms: number): string {
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.ceil(minutes / 60)}h`;
}
