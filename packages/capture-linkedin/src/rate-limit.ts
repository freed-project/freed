/**
 * Rate limiting for LinkedIn scraping
 *
 * LinkedIn is more aggressive than Facebook about bot detection, so we
 * use longer base intervals and more aggressive error backoff.
 */

import type { RateLimitState } from "./types.js";

/** 30 min base interval between scrapes */
export const MIN_INTERVAL_MS = 30 * 60 * 1000;

/** 6 min jitter on top of MIN_INTERVAL_MS (prevents predictable patterns) */
export const INTERVAL_JITTER_MS = 6 * 60 * 1000;

/** Cooldown after first error: 1 hour */
export const ERROR_COOLDOWN_MS = 60 * 60 * 1000;

/** Cooldown after 3+ consecutive errors: 4 hours */
export const EXTENDED_COOLDOWN_MS = 4 * 60 * 60 * 1000;

export function createRateLimitState(): RateLimitState {
  return { lastScrapeAt: 0, consecutiveErrors: 0, cooldownUntil: 0 };
}

export interface RateLimitCheck {
  allowed: boolean;
  waitMs?: number;
}

export function checkRateLimit(state: RateLimitState): RateLimitCheck {
  const now = Date.now();

  if (state.cooldownUntil > now) {
    return { allowed: false, waitMs: state.cooldownUntil - now };
  }

  if (state.lastScrapeAt > 0) {
    const jitter = Math.random() * INTERVAL_JITTER_MS;
    const minWait = MIN_INTERVAL_MS + jitter;
    const elapsed = now - state.lastScrapeAt;
    if (elapsed < minWait) {
      return { allowed: false, waitMs: minWait - elapsed };
    }
  }

  return { allowed: true };
}

export function recordSuccess(_state: RateLimitState): RateLimitState {
  return {
    lastScrapeAt: Date.now(),
    consecutiveErrors: 0,
    cooldownUntil: 0,
  };
}

export function recordError(state: RateLimitState): RateLimitState {
  const errors = state.consecutiveErrors + 1;
  const cooldown = errors >= 3
    ? EXTENDED_COOLDOWN_MS
    : ERROR_COOLDOWN_MS;
  return {
    ...state,
    consecutiveErrors: errors,
    cooldownUntil: Date.now() + cooldown,
  };
}

export function formatWaitTime(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`;
}
