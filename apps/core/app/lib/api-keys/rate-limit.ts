/**
 * Per-key rate limit for `x-api-key` traffic (#1803).
 *
 * The better-auth api-key plugin rate-limits every key by default, and its
 * defaults are 10 requests per 24 hours. Core never passed a `rateLimit` config,
 * so every EduAI API key silently inherited that — an instructor's autograding
 * script died on its 11th call of the day and the denial surfaced as a bare
 * `401 Unauthorized`, indistinguishable from revocation.
 *
 * The limit stays on (a leaked key should not be unbounded) but is sized for
 * server-to-server automation and is env-tunable. It is a coarse daily backstop;
 * burst control is the per-route limiter in `auth/rate-limit.server.ts`.
 *
 * This module deliberately does not import `parseEnvInt` from
 * `auth/rate-limit.server.ts`: that module pulls in the Redis queue connection,
 * and `auth/server.ts` reads this config at bootstrap, before a Redis
 * connection should be established.
 */

export type ApiKeyRateLimitConfig = {
  enabled: boolean;
  /** Window length in milliseconds. */
  timeWindow: number;
  /** Requests permitted per key per window. */
  maxRequests: number;
};

const DAY_MS = 1000 * 60 * 60 * 24;

/** Sized for a grading run: comfortably above the pilot's 200 calls/24h. */
export const DEFAULT_API_KEY_RATE_LIMIT_MAX = 1000;
export const DEFAULT_API_KEY_RATE_LIMIT_WINDOW_MS = DAY_MS;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  // A zero or negative ceiling would deny every request, and NaN would make the
  // plugin's comparison always false. Neither is a configuration anyone means.
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

export function getApiKeyRateLimitConfig(): ApiKeyRateLimitConfig {
  return {
    // Opt-out exists for load testing against a disposable deployment; it is
    // not meant for production, hence the explicit "0" rather than any falsy
    // value.
    enabled: process.env.API_KEY_RATE_LIMIT_ENABLED !== "0",
    timeWindow: parsePositiveInt(
      process.env.API_KEY_RATE_LIMIT_WINDOW_MS,
      DEFAULT_API_KEY_RATE_LIMIT_WINDOW_MS,
    ),
    maxRequests: parsePositiveInt(
      process.env.API_KEY_RATE_LIMIT_MAX,
      DEFAULT_API_KEY_RATE_LIMIT_MAX,
    ),
  };
}
