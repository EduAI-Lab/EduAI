/**
 * Session validation and RBAC middleware for Question Maker API routes.
 *
 * Validates the incoming session cookie via Core's POST /api/sessions/validate,
 * ensures a local user row exists for FK integrity (creating it on first login),
 * and populates `req.user` with the Core user shape.
 */
import { findOrCreateUser } from "../services/authService.js";
import { VALID_ROLES } from "./roles.js";
import { config } from "../config/settings.js";

const DEFAULT_CORE_AUTH_TIMEOUT_MS = 5_000;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

class CoreAuthTimeoutError extends Error {
  constructor(timeoutMs, options) {
    super(`Core authentication request timed out after ${timeoutMs}ms`, options);
    this.name = 'CoreAuthTimeoutError';
    this.code = 'CORE_AUTH_TIMEOUT';
  }
}

function getCoreAuthTimeoutMs() {
  const configured = Number(process.env.CORE_AUTH_TIMEOUT_MS);
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_CORE_AUTH_TIMEOUT_MS;
  return Math.min(Math.trunc(configured), MAX_TIMER_DELAY_MS);
}

/**
 * Fetch a Core authentication endpoint with a finite deadline. When an outer
 * request exposes a cancellation signal, preserve it alongside the deadline
 * rather than replacing it.
 */
export async function fetchCoreAuth(input, init = {}, callerSignal) {
  const timeoutMs = getCoreAuthTimeoutMs();
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal;

  try {
    return await fetch(input, { ...init, signal });
  } catch (error) {
    if (timeoutSignal.aborted && !callerSignal?.aborted) {
      throw new CoreAuthTimeoutError(timeoutMs, { cause: error });
    }
    throw error;
  }
}

export function isCoreAuthTimeoutError(error) {
  return error?.code === 'CORE_AUTH_TIMEOUT';
}

function normalizeRole(role) {
  return VALID_ROLES.has(role) ? role : "STUDENT";
}

/**
 * Validate the request's session cookie against Core and populate `req.user`.
 * API routes (path starts with /api/) return 401 on failure; other routes
 * redirect to Core login with a ?redirect= param so the user lands back here.
 * A Core 429 (IP rate limit) is passed through as 429 with `Retry-After`
 * forwarded when present, instead of being collapsed into a generic 401 —
 * otherwise every extension API call looks like "logged out" during a
 * rate-limit window (#225 edge-case audit SEAM-01 / #1197).
 */
export async function requireAuth(req, res, next) {
  try {
    const response = await fetchCoreAuth(
      `${config.coreUrl}/api/sessions/validate`,
      {
        method: 'POST',
        headers: { cookie: req.headers.cookie ?? '' },
      },
      req.signal,
    );

    if (response.status === 429) {
      const retryAfter = response.headers?.get?.("retry-after") ?? null;
      if (retryAfter != null) res.set("Retry-After", retryAfter);
      return res.status(429).json({ success: false, error: "Rate limited", retryAfter });
    }

    if (response.status === 401) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    if (response.status === 403) {
      return res.status(403).json({ success: false, error: 'Authentication forbidden' });
    }

    if (response.status === 408 || response.status === 504) {
      return res.status(504).json({ success: false, error: 'Authentication service timed out' });
    }

    if (!response.ok) {
      return res.status(503).json({ success: false, error: 'Authentication service unavailable' });
    }

    const { user: coreUser } = await response.json();
    const normalizedUser = { ...coreUser, role: normalizeRole(coreUser.role) };
    await findOrCreateUser(normalizedUser);
    req.user = normalizedUser;
    next();
  } catch (error) {
    if (isCoreAuthTimeoutError(error)) {
      return res.status(504).json({ success: false, error: 'Authentication service timed out' });
    }
    return res.status(503).json({ success: false, error: 'Authentication service unavailable' });
  }
}

/**
 * Build a middleware that requires the caller's role to be in `allowed`.
 * Pass a single role string or an array.
 */
export function requireRole(allowed) {
  const roles = Array.isArray(allowed) ? allowed : [allowed];
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: "Authentication required" });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: `One of the following roles required: ${roles.join(", ")}`,
      });
    }
    next();
  };
}

// Backward-compat alias: existing route files import authenticateToken.
export { requireAuth as authenticateToken };
