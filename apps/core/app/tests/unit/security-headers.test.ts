// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { applySecurityHeaders, generateNonce } from "~/lib/security-headers.server";
import { middleware } from "~/root";

afterEach(() => {
  vi.unstubAllEnvs();
});

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
    expect(headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(headers.get("Permissions-Policy")).toBe("camera=(), microphone=(), geolocation=()");
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

    expect(headers.get("Strict-Transport-Security")).toBe("max-age=31536000; includeSubDomains");
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

  it("allows no third-party font origins and denies framing in the HTML CSP", () => {
    const headers = new Headers();
    applySecurityHeaders(headers, { isProd: true, nonce: "abc" });

    const csp = headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    // `data:` covers the woff2 fonts Vite inlines under `assetsInlineLimit`.
    expect(csp).toContain("font-src 'self' data:");
    expect(csp).toContain("frame-ancestors 'none'");
    // Outfit is self-hosted (#1221) — re-adding a Google Fonts <link> anywhere
    // would need these origins back, so assert they stay gone.
    expect(csp).not.toContain("fonts.googleapis.com");
    expect(csp).not.toContain("fonts.gstatic.com");
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
    expect(res.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(res.headers.get("Permissions-Policy")).toBe("camera=(), microphone=(), geolocation=()");
    expect(res.headers.get("Strict-Transport-Security")).toBe(
      "max-age=31536000; includeSubDomains",
    );
    expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
  });

  it("does not clobber the nonce CSP already set on an HTML response", async () => {
    const nonceCsp = "default-src 'self'; script-src 'self' 'nonce-abc' 'strict-dynamic'";
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

  it("rejects direct navigation to React Router .data URLs", async () => {
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

  it("rejects .data URLs even when the request resembles an internal fetch", async () => {
    const request = new Request("https://eduai.example/dashboard.data", {
      headers: { Accept: "application/json", "Sec-Fetch-Dest": "empty" },
    });

    const res = await runProd(
      new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      }),
      request,
    );

    expect(res.status).toBe(404);
  });

  it("rejects .data URLs without browser navigation headers", async () => {
    const request = new Request("https://eduai.example/dashboard.data", {
      headers: { Accept: "*/*" },
    });
    let called = false;

    const res = await (middleware[0] as any)({ request }, async () => {
      called = true;
      return new Response("{}");
    });

    expect(res.status).toBe(404);
    expect(called).toBe(false);
  });

  it("rejects sibling-origin cookie-authenticated API mutations before the route runs", async () => {
    const request = new Request("https://eduai.example/api/questions", {
      method: "POST",
      headers: { Cookie: "better-auth.session_token=secret", Origin: "https://evil.example" },
    });
    let called = false;
    const res = await (middleware[0] as any)({ request }, async () => {
      called = true;
      return new Response(null, { status: 204 });
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "CROSS_ORIGIN_MUTATION" });
    expect(called).toBe(false);
  });

  it("rejects sibling-origin cookie-authenticated HTML form actions", async () => {
    const request = new Request("https://eduai.example/admin/logs", {
      method: "POST",
      headers: {
        Cookie: "better-auth.session_token=secret",
        Origin: "https://sibling.eduai.example",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "intent=clear",
    });
    const next = vi.fn(async () => new Response(null, { status: 204 }));
    const res = await (middleware[0] as any)({ request }, next);
    expect(res.status).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("does not trust an unverified bearer-looking header to bypass the cookie gate", async () => {
    const request = new Request("https://eduai.example/api/questions", {
      method: "POST",
      headers: {
        Cookie: "better-auth.session_token=secret",
        Origin: "https://evil.example",
        Authorization: "Bearer attacker-controlled",
      },
    });
    const next = vi.fn(async () => new Response(null, { status: 204 }));

    const res = await (middleware[0] as any)({ request }, next);

    expect(res.status).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("fails closed for cookie mutations with no Origin, Referer, or fetch metadata", async () => {
    const request = new Request("https://eduai.example/admin/logs", {
      method: "POST",
      headers: { Cookie: "better-auth.session_token=secret" },
    });
    const next = vi.fn(async () => new Response(null, { status: 204 }));

    const res = await (middleware[0] as any)({ request }, next);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "CROSS_ORIGIN_MUTATION" });
    expect(next).not.toHaveBeenCalled();
  });

  it("allows origin-less cookie mutations only with same-origin fallback evidence", async () => {
    const next = vi.fn(async () => new Response(null, { status: 204 }));
    const refererRequest = new Request("https://eduai.example/admin/logs", {
      method: "POST",
      headers: {
        Cookie: "better-auth.session_token=secret",
        Referer: "https://eduai.example/admin/logs",
      },
    });
    const fetchMetadataRequest = new Request("https://eduai.example/admin/logs", {
      method: "POST",
      headers: {
        Cookie: "better-auth.session_token=secret",
        "Sec-Fetch-Site": "same-origin",
      },
    });

    expect((await (middleware[0] as any)({ request: refererRequest }, next)).status).toBe(204);
    expect((await (middleware[0] as any)({ request: fetchMetadataRequest }, next)).status).toBe(204);
    expect(next).toHaveBeenCalledTimes(2);
  });

  it("allows a cookie-bearing non-browser call only after service-key verification", async () => {
    vi.stubEnv("EDUAI_API_KEY", "verified-service-key");
    const next = vi.fn(async () => new Response(null, { status: 204 }));
    const request = new Request("https://eduai.example/api/questions/q1", {
      method: "PATCH",
      headers: {
        Cookie: "incidental=1",
        Authorization: "Bearer verified-service-key",
      },
    });

    const res = await (middleware[0] as any)({ request }, next);

    expect(res.status).toBe(204);
    expect(next).toHaveBeenCalledOnce();
  });

  it("lets authenticated extension session validation reach the action without browser Origin", async () => {
    vi.stubEnv("EDUAI_API_KEY", "verified-service-key");
    const next = vi.fn(async () => new Response(JSON.stringify({ user: { id: "u1" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    const request = new Request("https://eduai.example/api/sessions/validate", {
      method: "POST",
      headers: {
        Cookie: "better-auth.session_token=secret",
        Authorization: "Bearer verified-service-key",
        "X-EduAI-Client-IP": "198.51.100.50",
      },
    });

    const res = await (middleware[0] as any)({ request }, next);

    expect(res.status).toBe(200);
    expect(next).toHaveBeenCalledOnce();
  });

  it("preserves same-origin cookie mutations and non-cookie service calls", async () => {
    const next = vi.fn(async () => new Response(null, { status: 204 }));
    const sameOrigin = new Request("https://eduai.example/admin/logs", {
      method: "POST",
      headers: { Cookie: "session=secret", Origin: "https://eduai.example" },
    });
    const service = new Request("https://eduai.example/api/questions/q1", {
      method: "PATCH",
      headers: { Authorization: "Bearer service-key", Origin: "https://worker.internal" },
    });
    expect((await (middleware[0] as any)({ request: sameOrigin }, next)).status).toBe(204);
    expect((await (middleware[0] as any)({ request: service }, next)).status).toBe(204);
    expect(next).toHaveBeenCalledTimes(2);
  });
});
