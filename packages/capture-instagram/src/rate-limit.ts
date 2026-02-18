/**
 * Rate limiting for Instagram scraping
 *
 * Instagram is more aggressive than Facebook about rate-limiting.
 * Conservative defaults: 10 minutes minimum, longer cooldowns on errors.
 */

import type { RateLimitState } from "./types.js";

/** Minimum time between scrapes in normal operation (10 minutes) */
const MIN_INTERVAL_MS = 10 * 60 * 1000;

/** Cooldown after first error (1 hour) */
const ERROR_COOLDOWN_MS = 60 * 60 * 1000;

/** Cooldown after 2+ consecutive errors (4 hours) */
const EXTENDED_COOLDOWN_MS = 4 * 60 * 60 * 1000;

export function createRateLimitState(): RateLimitState {
  return { lastScrapeAt: 0, consecutiveErrors: 0, cooldownUntil: 0 };
}

export function checkRateLimit(
  state: RateLimitState,
  now: number = Date.now()
): { allowed: boolean; waitMs?: number } {
  if (state.cooldownUntil > now) {
    return { allowed: false, waitMs: state.cooldownUntil - now };
  }
  const nextAllowed = state.lastScrapeAt + MIN_INTERVAL_MS;
  if (nextAllowed > now) {
    return { allowed: false, waitMs: nextAllowed - now };
  }
  return { allowed: true };
}

export function recordSuccess(
  state: RateLimitState,
  now: number = Date.now()
): RateLimitState {
  return { lastScrapeAt: now, consecutiveErrors: 0, cooldownUntil: 0 };
}

export function recordError(
  state: RateLimitState,
  now: number = Date.now()
): RateLimitState {
  const consecutiveErrors = state.consecutiveErrors + 1;
  const cooldownMs = consecutiveErrors >= 2 ? EXTENDED_COOLDOWN_MS : ERROR_COOLDOWN_MS;
  return { ...state, consecutiveErrors, cooldownUntil: now + cooldownMs };
}

export function formatWaitTime(ms: number): string {
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.ceil(minutes / 60)}h`;
}
