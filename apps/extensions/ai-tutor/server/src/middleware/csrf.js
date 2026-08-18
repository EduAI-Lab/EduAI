/**
 * @file CSRF origin guard (#1571).
 *
 * The extension authenticates by forwarding Core's session cookie and has no
 * CSRF token of its own — safe only while Core's cookie stays `SameSite=Lax`.
 * This adds an independent backstop: state-changing requests carrying a
 * cross-origin `Origin` header are rejected, so the extension does not depend
 * solely on the cookie's SameSite attribute (e.g. if Core ever moves to
 * `SameSite=None` to iframe-embed an extension).
 *
 * Rules:
 *   - Safe methods (GET/HEAD/OPTIONS) are never gated.
 *   - A request with NO `Origin` header is allowed: browsers always send
 *     `Origin` on state-changing fetches, so an absent one is a non-browser /
 *     server-to-server caller (already authenticated by cookie or service key)
 *     — and supertest/internal calls must not break.
 *   - A present `Origin` must be in the CORS allowlist, else 403.
 */
import { isAllowedOrigin } from "../config/cors.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function csrfOriginGuard(req, res, next) {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return next();

  const origin = req.get("origin");
  if (!origin) return next();

  if (isAllowedOrigin(origin)) return next();

  return res.status(403).json({ error: "Cross-origin request blocked" });
}
