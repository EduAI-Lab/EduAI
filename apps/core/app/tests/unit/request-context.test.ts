/** @vitest-environment node */
import { afterEach, describe, expect, it } from "vitest";
import { getRequestContext } from "~/lib/request-context.server";

const ORIGINAL_HOP_COUNT = process.env.TRUSTED_PROXY_HOP_COUNT;

function requestWith(headers: Record<string, string>): Request {
  return new Request("https://eduai.example/api/thing", { method: "GET", headers });
}

function setHopCount(value: string | undefined) {
  if (value === undefined) {
    delete process.env.TRUSTED_PROXY_HOP_COUNT;
  } else {
    process.env.TRUSTED_PROXY_HOP_COUNT = value;
  }
}

afterEach(() => {
  setHopCount(ORIGINAL_HOP_COUNT);
});

describe("getRequestContext client IP derivation", () => {
  it("hopCount 0: single-entry XFF is the immediate hop and is trusted", () => {
    setHopCount("0");
    const ctx = getRequestContext(requestWith({ "x-forwarded-for": "203.0.113.9" }));
    expect(ctx.ipAddress).toBe("203.0.113.9");
  });

  it("hopCount 0: ignores an attacker-prepended entry, trusts the rightmost hop", () => {
    setHopCount("0");
    const ctx = getRequestContext(requestWith({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }));
    // Attacker's forged "1.2.3.4" is on the left; rightmost was written by our proxy.
    expect(ctx.ipAddress).toBe("10.0.0.1");
  });

  it("hopCount 1: steps back past one trusted proxy to the real client", () => {
    setHopCount("1");
    const ctx = getRequestContext(requestWith({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }));
    expect(ctx.ipAddress).toBe("203.0.113.9");
  });

  it("hopCount 1: attacker prepend before the real client is ignored", () => {
    setHopCount("1");
    const ctx = getRequestContext(
      requestWith({ "x-forwarded-for": "9.9.9.9, 203.0.113.9, 10.0.0.1" }),
    );
    expect(ctx.ipAddress).toBe("203.0.113.9");
  });

  it("hopCount 2: selects the correct offset from the right", () => {
    setHopCount("2");
    const ctx = getRequestContext(
      requestWith({ "x-forwarded-for": "203.0.113.9, 172.16.0.1, 10.0.0.1" }),
    );
    expect(ctx.ipAddress).toBe("203.0.113.9");
  });

  it("fails closed to x-real-ip fallback when hop count exceeds the chain length", () => {
    setHopCount("5");
    const ctx = getRequestContext(
      requestWith({ "x-forwarded-for": "203.0.113.9, 10.0.0.1", "x-real-ip": "198.51.100.7" }),
    );
    // Underflow -> XFF yields null -> falls through to x-real-ip, never the spoofable leftmost token.
    expect(ctx.ipAddress).toBe("198.51.100.7");
  });

  it("underflow with no fallback header records null, not a spoofable token", () => {
    setHopCount("5");
    const ctx = getRequestContext(requestWith({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }));
    expect(ctx.ipAddress).toBeNull();
  });

  it("trims whitespace and skips empty tokens", () => {
    setHopCount("1");
    const ctx = getRequestContext(requestWith({ "x-forwarded-for": " 203.0.113.9 , , 10.0.0.1 " }));
    expect(ctx.ipAddress).toBe("203.0.113.9");
  });

  it("absent XFF falls back to x-real-ip then cf-connecting-ip", () => {
    setHopCount("0");
    expect(getRequestContext(requestWith({ "x-real-ip": "198.51.100.7" })).ipAddress).toBe(
      "198.51.100.7",
    );
    expect(
      getRequestContext(requestWith({ "cf-connecting-ip": "198.51.100.8" })).ipAddress,
    ).toBe("198.51.100.8");
  });

  it("no IP headers at all records null (e.g. local dev, no proxy)", () => {
    setHopCount("0");
    expect(getRequestContext(requestWith({})).ipAddress).toBeNull();
  });

  it("invalid or negative hop count falls back to 0 (trust rightmost)", () => {
    setHopCount("-3");
    expect(
      getRequestContext(requestWith({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" })).ipAddress,
    ).toBe("10.0.0.1");
    setHopCount("not-a-number");
    expect(
      getRequestContext(requestWith({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" })).ipAddress,
    ).toBe("10.0.0.1");
  });

  it("still populates requestId, routePath, method, userAgent", () => {
    setHopCount("0");
    const ctx = getRequestContext(
      requestWith({ "x-forwarded-for": "10.0.0.1", "user-agent": "vitest" }),
    );
    expect(ctx.routePath).toBe("/api/thing");
    expect(ctx.httpMethod).toBe("GET");
    expect(ctx.userAgent).toBe("vitest");
    expect(ctx.requestId).toBeTruthy();
  });
});
