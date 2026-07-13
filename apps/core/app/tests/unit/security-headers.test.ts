import { describe, expect, it } from "vitest";

import {
  applySecurityHeaders,
  generateNonce,
} from "~/lib/security-headers.server";

describe("generateNonce", () => {
  it("returns a fresh value on each call", () => {
    expect(generateNonce()).not.toBe(generateNonce());
  });

  it("returns a non-empty base64 string", () => {
    const nonce = generateNonce();
    expect(nonce.length).toBeGreaterThan(0);
    expect(nonce).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });
});

describe("applySecurityHeaders", () => {
  it("always sets the static security headers", () => {
    const headers = new Headers();
    applySecurityHeaders(headers, "abc", { isProd: false });

    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("Referrer-Policy")).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(headers.get("Permissions-Policy")).toBe(
      "camera=(), microphone=(), geolocation=()",
    );
  });

  it("omits HSTS and CSP outside production", () => {
    const headers = new Headers();
    applySecurityHeaders(headers, "abc", { isProd: false });

    expect(headers.get("Strict-Transport-Security")).toBeNull();
    expect(headers.get("Content-Security-Policy")).toBeNull();
  });

  it("sets HSTS and CSP in production", () => {
    const headers = new Headers();
    applySecurityHeaders(headers, "abc", { isProd: true });

    expect(headers.get("Strict-Transport-Security")).toBe(
      "max-age=31536000; includeSubDomains",
    );
    expect(headers.get("Content-Security-Policy")).not.toBeNull();
  });

  it("embeds the given nonce and strict-dynamic in the CSP script-src", () => {
    const headers = new Headers();
    applySecurityHeaders(headers, "test-nonce-123", { isProd: true });

    const csp = headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("script-src");
    expect(csp).toContain("'nonce-test-nonce-123'");
    expect(csp).toContain("'strict-dynamic'");
  });

  it("whitelists Google Fonts origins and denies framing in the CSP", () => {
    const headers = new Headers();
    applySecurityHeaders(headers, "abc", { isProd: true });

    const csp = headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain(
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    );
    expect(csp).toContain("font-src 'self' https://fonts.gstatic.com");
    expect(csp).toContain("frame-ancestors 'none'");
  });
});
