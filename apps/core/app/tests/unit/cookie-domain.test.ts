import { describe, expect, it } from "vitest";

import { resolveAuthCookieDomain } from "~/lib/auth/cookie-domain";

describe("resolveAuthCookieDomain", () => {
  it("returns a real public suffix unchanged", () => {
    expect(resolveAuthCookieDomain(".eduai.ok.ubc.ca")).toBe(".eduai.ok.ubc.ca");
    expect(resolveAuthCookieDomain("eduai.ok.ubc.ca")).toBe("eduai.ok.ubc.ca");
  });

  it("ignores loopback values so local login cannot wipe its own session", () => {
    expect(resolveAuthCookieDomain("localhost")).toBeUndefined();
    expect(resolveAuthCookieDomain(".localhost")).toBeUndefined();
    expect(resolveAuthCookieDomain("127.0.0.1")).toBeUndefined();
    expect(resolveAuthCookieDomain("::1")).toBeUndefined();
    expect(resolveAuthCookieDomain("[::1]")).toBeUndefined();
  });

  it("treats blank and whitespace as unset", () => {
    expect(resolveAuthCookieDomain(undefined)).toBeUndefined();
    expect(resolveAuthCookieDomain("")).toBeUndefined();
    expect(resolveAuthCookieDomain("   ")).toBeUndefined();
  });
});
