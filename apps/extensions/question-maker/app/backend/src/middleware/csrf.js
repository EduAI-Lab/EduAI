/**
 * @file CSRF origin guard (#1571).
 *
 * Question Maker authenticates by forwarding Core's session cookie and has no
 * CSRF token of its own — safe only while Core's cookie stays `SameSite=Lax`.
 * This adds an independent backstop: state-changing requests carrying a
 * cross-origin `Origin` header are rejected, so the extension does not depend
 * solely on the cookie's SameSite attribute.
 *
 * Rules:
 *   - Safe methods (GET/HEAD/OPTIONS) are never gated.
 *   - A request with NO `Origin` header is allowed (non-browser / server-to-
 *     server caller; browsers always send `Origin` on state-changing fetches).
 *   - A present `Origin` must be in `config.corsOrigins`, else 403. A `"*"`
 *     entry (used in dev/test) disables the check.
 */
import { config } from "../config/settings.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function isAllowedOrigin(origin) {
  const allowed = config.corsOrigins;
  if (!Array.isArray(allowed)) return false;
  if (allowed.includes("*")) return true;
  return allowed.map((o) => (typeof o === "string" ? o.trim() : o)).includes(origin);
}

export function csrfOriginGuard(req, res, next) {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return next();

  const origin = req.get("origin");
  if (!origin || origin === "null") {
    // Absent Origin ⇒ non-browser caller; a literal "null" origin (sandboxed
    // iframe, file://) is never trusted for a mutation.
    if (origin === "null") {
      return res.status(403).json({ error: "Cross-origin request blocked" });
    }
    return next();
  }

  if (isAllowedOrigin(origin)) return next();

  return res.status(403).json({ error: "Cross-origin request blocked" });
}
