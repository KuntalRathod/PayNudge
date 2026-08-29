/**
 * Rate-limiting middleware for the PayNudge API.
 *
 * A public backend needs basic protection against abuse and accidental request
 * floods. We apply two limiters:
 *
 *   - {@link apiRateLimiter}  — a generous per-IP limit on ALL API traffic, to
 *                               bound overall load without hindering normal use.
 *   - {@link authRateLimiter} — a stricter per-IP limit intended for
 *                               auth-sensitive or expensive endpoints (e.g.
 *                               anything that triggers email or AI calls), to
 *                               blunt brute-force and cost-amplification abuse.
 *
 * Limits are configurable via environment variables so they can be tuned per
 * deployment without a code change. The health check is intentionally NOT rate
 * limited (see how it is mounted in `index.ts`) so uptime probes never trip it.
 */

import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';

/** Parses a positive integer env var, falling back to `fallback` when unset/invalid. */
function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim().length === 0) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** Window (ms) shared by the limiters. Defaults to 15 minutes. */
const WINDOW_MS = intFromEnv('RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000);

/**
 * General API limiter: applied to every request. Defaults to 300 requests per
 * IP per 15-minute window — comfortably above normal interactive usage but low
 * enough to bound a runaway client or scraper.
 */
export const apiRateLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: WINDOW_MS,
  limit: intFromEnv('RATE_LIMIT_MAX', 300),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});

/**
 * Stricter limiter for expensive/sensitive routes (email sends, AI drafting).
 * Defaults to 30 requests per IP per window.
 */
export const authRateLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: WINDOW_MS,
  limit: intFromEnv('RATE_LIMIT_SENSITIVE_MAX', 30),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});
