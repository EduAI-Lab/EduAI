import { config } from "../config/settings.js";
import { timingSafeEqual } from "node:crypto";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function normalizeOrigin(value) {
  if (typeof value !== "string" || !value.trim() || value.trim() === "*") return null;
  try {
    const origin = new URL(value.trim()).origin;
    return origin === "null" ? null : origin;
  } catch {
    return null;
  }
}

export function trustedOrigins(settings = config) {
  const configured = Array.isArray(settings.corsOrigins)
    ? settings.corsOrigins
    : typeof settings.corsOrigins === "string"
      ? settings.corsOrigins.split(",")
      : [];
  return new Set(
    [...configured, settings.corePublicOrigin, settings.extensionUrl]
      .map(normalizeOrigin)
      .filter(Boolean),
  );
}

function hasVerifiedServiceCredential(authorization) {
  if (!config.eduaiApiKey || typeof authorization !== "string") return false;
  const expected = Buffer.from(`Bearer ${config.eduaiApiKey}`);
  const actual = Buffer.from(authorization);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * Reject unsafe cookie-authenticated requests without trusted browser
 * provenance. Verified server-to-server requests may bypass this check.
 */
export function csrfOriginGuard(req, res, next) {
  const method = typeof req.method === "string" ? req.method.toUpperCase() : "";
  if (!UNSAFE_METHODS.has(method) || !req.headers.cookie) return next();
  if (hasVerifiedServiceCredential(req.headers.authorization)) return next();

  const origin = req.headers.origin;
  const referer = req.headers.referer;
  const site = req.headers["sec-fetch-site"];
  const trusted = trustedOrigins();
  const accepted =
    origin !== undefined
      ? trusted.has(normalizeOrigin(origin))
      : referer !== undefined
        ? trusted.has(normalizeOrigin(referer))
        : typeof site === "string" && site.toLowerCase() === "same-origin";

  if (accepted) return next();
  return res.status(403).json({
    success: false,
    error: "Cross-site request blocked",
    code: "CSRF_ORIGIN_DENIED",
  });
}

export default csrfOriginGuard;
