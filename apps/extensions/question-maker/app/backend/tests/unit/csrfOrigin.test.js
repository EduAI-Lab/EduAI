import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/config/settings.js", () => ({
  config: {
    corsOrigins: ["https://qm.example.test"],
    corePublicOrigin: "https://core.example.test",
    extensionUrl: "https://qm.example.test",
    eduaiApiKey: "verified-service-key",
  },
}));

const { csrfOriginGuard, trustedOrigins } = await import("../../src/middleware/csrfOrigin.js");

function response() {
  const res = {
    status: vi.fn(() => res),
    json: vi.fn(() => res),
  };
  return res;
}

function request(method, headers = {}) {
  return { method, headers };
}

describe("csrfOriginGuard", () => {
  beforeEach(() => vi.clearAllMocks());

  it("normalizes and deduplicates configured trusted origins", () => {
    expect(
      trustedOrigins({
        corsOrigins: ["https://qm.example.test/", "https://qm.example.test", "*"],
        corePublicOrigin: "https://core.example.test/path",
        extensionUrl: "not-an-origin",
      }),
    ).toEqual(new Set(["https://qm.example.test", "https://core.example.test"]));

    expect(
      trustedOrigins({
        corsOrigins: "https://qm.example.test, https://admin.example.test/",
      }),
    ).toEqual(new Set(["https://qm.example.test", "https://admin.example.test"]));
  });

  it("rejects an untrusted Origin before invoking the route", () => {
    const res = response();
    const next = vi.fn();

    csrfOriginGuard(
      request("POST", {
        cookie: "session=abc",
        origin: "https://evil.example.test",
      }),
      res,
      next,
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: "Cross-site request blocked",
      code: "CSRF_ORIGIN_DENIED",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("accepts trusted Origin, Referer, and same-origin Fetch Metadata", () => {
    const trustedNext = vi.fn();
    csrfOriginGuard(
      request("PATCH", {
        cookie: "session=abc",
        origin: "https://qm.example.test",
      }),
      response(),
      trustedNext,
    );
    expect(trustedNext).toHaveBeenCalledOnce();

    const refererNext = vi.fn();
    csrfOriginGuard(
      request("DELETE", {
        cookie: "session=abc",
        referer: "https://core.example.test/questions/1",
      }),
      response(),
      refererNext,
    );
    expect(refererNext).toHaveBeenCalledOnce();

    const metadataNext = vi.fn();
    csrfOriginGuard(
      request("POST", { cookie: "session=abc", "sec-fetch-site": "same-origin" }),
      response(),
      metadataNext,
    );
    expect(metadataNext).toHaveBeenCalledOnce();
  });

  it("rejects untrusted or missing fallback provenance", () => {
    for (const headers of [
      { cookie: "session=abc", referer: "https://evil.example.test/form" },
      { cookie: "session=abc", referer: "not a URL" },
      { cookie: "session=abc", "sec-fetch-site": "cross-site" },
      { cookie: "session=abc", "sec-fetch-site": "same-site" },
      { cookie: "session=abc" },
    ]) {
      const res = response();
      const next = vi.fn();

      csrfOriginGuard(request("POST", headers), res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    }
  });

  it("bypasses provenance only for the verified service credential", () => {
    const verifiedNext = vi.fn();
    csrfOriginGuard(
      request("POST", {
        cookie: "session=abc",
        authorization: "Bearer verified-service-key",
        origin: "https://evil.example.test",
      }),
      response(),
      verifiedNext,
    );
    expect(verifiedNext).toHaveBeenCalledOnce();

    const unverifiedRes = response();
    const unverifiedNext = vi.fn();
    csrfOriginGuard(
      request("POST", {
        cookie: "session=abc",
        authorization: "Bearer attacker-controlled",
      }),
      unverifiedRes,
      unverifiedNext,
    );
    expect(unverifiedRes.status).toHaveBeenCalledWith(403);
    expect(unverifiedNext).not.toHaveBeenCalled();
  });

  it("does not gate safe methods or requests without cookies", () => {
    const getNext = vi.fn();
    csrfOriginGuard(
      request("GET", {
        cookie: "session=abc",
        origin: "https://evil.example.test",
      }),
      response(),
      getNext,
    );
    expect(getNext).toHaveBeenCalledOnce();

    const noCookieNext = vi.fn();
    csrfOriginGuard(
      request("POST", { origin: "https://evil.example.test" }),
      response(),
      noCookieNext,
    );
    expect(noCookieNext).toHaveBeenCalledOnce();
  });
});
