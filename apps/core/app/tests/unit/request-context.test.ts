/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { getRequestContext } from "~/lib/request-context.server";

function requestWith(headers: Record<string, string>): Request {
  return new Request("https://eduai.example/api/thing", { method: "GET", headers });
}

describe("getRequestContext client IP derivation", () => {
  it("takes the single x-forwarded-for entry Apache appends for a normal client", () => {
    const ctx = getRequestContext(requestWith({ "x-forwarded-for": "203.0.113.9" }));
    expect(ctx.ipAddress).toBe("203.0.113.9");
  });

  it("ignores an attacker-prepended entry and trusts the rightmost (Apache-written) hop", () => {
    // A client sending `X-Forwarded-For: 1.2.3.4` results in `1.2.3.4, <real-client>` after Apache
    // appends the socket peer. We must record the real client, not the forged token.
    const ctx = getRequestContext(requestWith({ "x-forwarded-for": "1.2.3.4, 203.0.113.9" }));
    expect(ctx.ipAddress).toBe("203.0.113.9");
  });

  it("takes the last entry across a longer forged chain", () => {
    const ctx = getRequestContext(
      requestWith({ "x-forwarded-for": "9.9.9.9, 8.8.8.8, 203.0.113.9" }),
    );
    expect(ctx.ipAddress).toBe("203.0.113.9");
  });

  it("trims whitespace and skips empty tokens", () => {
    const ctx = getRequestContext(requestWith({ "x-forwarded-for": " 1.2.3.4 , , 203.0.113.9 " }));
    expect(ctx.ipAddress).toBe("203.0.113.9");
  });

  it("records null when x-forwarded-for is absent (e.g. local dev, no proxy)", () => {
    expect(getRequestContext(requestWith({})).ipAddress).toBeNull();
  });

  it("does not honor x-real-ip or cf-connecting-ip (Apache never sets them)", () => {
    const ctx = getRequestContext(
      requestWith({ "x-real-ip": "198.51.100.7", "cf-connecting-ip": "198.51.100.8" }),
    );
    expect(ctx.ipAddress).toBeNull();
  });

  it("still populates requestId, routePath, method, userAgent", () => {
    const ctx = getRequestContext(
      requestWith({ "x-forwarded-for": "203.0.113.9", "user-agent": "vitest" }),
    );
    expect(ctx.routePath).toBe("/api/thing");
    expect(ctx.httpMethod).toBe("GET");
    expect(ctx.userAgent).toBe("vitest");
    expect(ctx.requestId).toBeTruthy();
  });
});
