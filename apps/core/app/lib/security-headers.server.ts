import { randomBytes } from "node:crypto";

/**
 * Generates a fresh CSP nonce (16 random bytes, base64) for a single request.
 * A new value per request is required — a reused nonce defeats the point.
 */
export function generateNonce(): string {
  return randomBytes(16).toString("base64");
}

/**
 * Builds the Content-Security-Policy value for a given request nonce.
 *
 * - `script-src` is strict: only same-origin scripts and the per-request
 *   nonce are allowed. `'strict-dynamic'` lets the nonce'd React Router
 *   bootstrap script load the hashed module bundle without whitelisting every
 *   chunk — required for hydration.
 * - `style-src` keeps `'unsafe-inline'`: React inline `style={}` attributes and
 *   UI libraries cannot carry a nonce, and style injection is low-risk versus
 *   scripts. Google Fonts' stylesheet origin is whitelisted.
 * - `frame-ancestors 'none'` is the modern equivalent of `X-Frame-Options: DENY`.
 */
function buildHtmlCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
  ].join("; ");
}

/**
 * CSP for non-document responses (JSON resource routes, redirects, errors).
 *
 * These bodies execute nothing and load no sub-resources, so everything is
 * denied. No nonce is needed. `frame-ancestors 'none'` still blocks framing.
 */
function buildResourceCsp(): string {
  return [
    "default-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

/**
 * Sets the HTTP security headers on a response.
 *
 * The static headers (clickjacking, MIME-sniff, referrer, permissions) apply in
 * every environment. HSTS and CSP are production-only: on http localhost HSTS is
 * ignored, and a strict CSP would break Vite HMR's inline eval + websocket in dev.
 *
 * Pass `nonce` for document (HTML) responses — the CSP then carries a strict
 * nonce'd `script-src`. Omit it for resource responses (JSON/redirects/errors),
 * which receive a locked-down `default-src 'none'` policy instead.
 */
export function applySecurityHeaders(
  headers: Headers,
  opts: { isProd: boolean; nonce?: string },
): void {
  headers.set("X-Frame-Options", "DENY");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );

  if (opts.isProd) {
    headers.set(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
    headers.set(
      "Content-Security-Policy",
      opts.nonce ? buildHtmlCsp(opts.nonce) : buildResourceCsp(),
    );
  }
}
