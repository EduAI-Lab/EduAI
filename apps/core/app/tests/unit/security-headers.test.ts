import { describe, expect, it } from "vitest";

import {
  applySecurityHeaders,
  generateNonce,
} from "~/lib/security-headers.server";
import { middleware } from "~/root";

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
    applySecurityHeaders(headers, { isProd: false });

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
    applySecurityHeaders(headers, { isProd: false, nonce: "abc" });

    expect(headers.get("Strict-Transport-Security")).toBeNull();
    expect(headers.get("Content-Security-Policy")).toBeNull();
  });

  it("sets HSTS and CSP in production", () => {
    const headers = new Headers();
    applySecurityHeaders(headers, { isProd: true, nonce: "abc" });

    expect(headers.get("Strict-Transport-Security")).toBe(
      "max-age=31536000; includeSubDomains",
    );
    expect(headers.get("Content-Security-Policy")).not.toBeNull();
  });

  it("embeds the given nonce and strict-dynamic in the HTML CSP script-src", () => {
    const headers = new Headers();
    applySecurityHeaders(headers, { isProd: true, nonce: "test-nonce-123" });

    const csp = headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("script-src");
    expect(csp).toContain("'nonce-test-nonce-123'");
    expect(csp).toContain("'strict-dynamic'");
  });

  it("whitelists Google Fonts origins and denies framing in the HTML CSP", () => {
    const headers = new Headers();
    applySecurityHeaders(headers, { isProd: true, nonce: "abc" });

    const csp = headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain(
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    );
    expect(csp).toContain("font-src 'self' https://fonts.gstatic.com");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("uses a locked-down resource CSP when no nonce is given", () => {
    const headers = new Headers();
    applySecurityHeaders(headers, { isProd: true });

    const csp = headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("script-src");
    expect(csp).not.toContain("nonce");
  });
});

// Exercises the real root middleware against actual Response objects, proving
// that both an API (JSON) response and a page (HTML) response carry the right
// headers — the gap the helper-only tests could not catch (#982, PR #1016).
describe("root middleware", () => {
  const runProd = async (
    response: Response,
    request = new Request("https://eduai.example/api/status"),
  ): Promise<Response> => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      // Middleware ignores its first arg; a Response-returning next() is enough.
      // Must await before restoring env — the isProd check runs after `await next()`.
      return await (middleware[0] as any)({ request }, async () => response);
    } finally {
      process.env.NODE_ENV = prev;
    }
  };

  it("applies security headers to an API (JSON) response", async () => {
    const json = new Response(JSON.stringify({ status: "ok" }), {
      headers: { "Content-Type": "application/json" },
    });

    const res: Response = await runProd(json);

    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Referrer-Policy")).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(res.headers.get("Permissions-Policy")).toBe(
      "camera=(), microphone=(), geolocation=()",
    );
    expect(res.headers.get("Strict-Transport-Security")).toBe(
      "max-age=31536000; includeSubDomains",
    );
    expect(res.headers.get("Content-Security-Policy")).toContain(
      "default-src 'none'",
    );
  });

  it("does not clobber the nonce CSP already set on an HTML response", async () => {
    const nonceCsp =
      "default-src 'self'; script-src 'self' 'nonce-abc' 'strict-dynamic'";
    const html = new Response("<!doctype html><html></html>", {
      headers: {
        "Content-Type": "text/html",
        "Content-Security-Policy": nonceCsp,
      },
    });

    const res: Response = await runProd(html);

    // entry.server owns the HTML response; middleware must leave it untouched.
    expect(res.headers.get("Content-Security-Policy")).toBe(nonceCsp);
  });

  it("rejects direct document navigation to React Router .data URLs", async () => {
    const request = new Request("https://eduai.example/dashboard.data", {
      headers: { Accept: "text/html", "Sec-Fetch-Dest": "document" },
    });
    let called = false;

    const res = await (middleware[0] as any)({ request }, async () => {
      called = true;
      return new Response("{}");
    });

    expect(res.status).toBe(404);
    expect(called).toBe(false);
  });

  it("allows internal React Router .data fetches", async () => {
    const request = new Request("https://eduai.example/dashboard.data", {
      headers: { Accept: "application/json", "Sec-Fetch-Dest": "empty" },
    });

    const res = await runProd(
      new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      }),
      request,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
