import { timingSafeEqual } from "crypto";
import { corsOriginCallback } from "../config/cors.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function isTrustedOrigin(origin) {
  let trusted = false;
  corsOriginCallback(origin, (error, allowed) => {
    trusted = !error && allowed !== false;
  });
  return trusted;
}

function isVerifiedServiceAuthorization(authorization) {
  const serviceKey = process.env.EDUAI_API_KEY;
  if (!serviceKey || typeof authorization !== "string") return false;
  const expected = Buffer.from(`Bearer ${serviceKey}`);
  const actual = Buffer.from(authorization);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function requestOrigin(req) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] ?? "")
    .split(",")[0]
    .trim();
  return `${forwardedProto || req.protocol}://${req.get("host")}`;
}

function isAcceptedBrowserProvenance(req) {
  const origin = req.headers.origin;
  if (origin) return origin === requestOrigin(req) || isTrustedOrigin(origin);

  const referer = req.headers.referer;
  if (referer) {
    try {
      const refererOrigin = new URL(referer).origin;
      return refererOrigin === requestOrigin(req) || isTrustedOrigin(refererOrigin);
    } catch {
      return false;
    }
  }

  return req.headers["sec-fetch-site"] === "same-origin";
}

/** Reject browser cross-origin cookie-authenticated mutations before routes. */
export function requireSameOriginMutation(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  if (!req.headers.cookie) return next();
  // Only a verified service credential bypasses browser provenance checks.
  if (isVerifiedServiceAuthorization(req.headers.authorization)) return next();
  if (isAcceptedBrowserProvenance(req)) return next();

  return res.status(403).json({ error: "Cross-origin request blocked" });
}
