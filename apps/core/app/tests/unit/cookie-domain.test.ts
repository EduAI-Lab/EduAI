// @vitest-environment node
import { describe, expect, it } from "vitest";

import { resolveAuthCookieDomain, resolveAuthCookiePrefix } from "~/lib/auth/cookie-domain";

describe("resolveAuthCookieDomain", () => {
  it("returns a real public suffix unchanged", () => {
    expect(resolveAuthCookieDomain(".eduai.ok.ubc.ca")).toBe(".eduai.ok.ubc.ca");
    expect(resolveAuthCookieDomain("eduai.ok.ubc.ca")).toBe("eduai.ok.ubc.ca");
  });

  it("trims surrounding whitespace off a public cookie domain", () => {
    expect(resolveAuthCookieDomain("  .eduai.ok.ubc.ca  ")).toBe(".eduai.ok.ubc.ca");
  });

  it.each(["localhost", ".localhost", "127.0.0.1", ".127.0.0.1", "[::1]", "::1"])(
    "ignores the loopback value %s so local login cannot wipe its own session",
    (domain) => {
      expect(resolveAuthCookieDomain(domain)).toBeUndefined();
    },
  );

  it("treats blank and whitespace as unset", () => {
    expect(resolveAuthCookieDomain(undefined)).toBeUndefined();
    expect(resolveAuthCookieDomain("")).toBeUndefined();
    expect(resolveAuthCookieDomain("   ")).toBeUndefined();
  });
});

describe("resolveAuthCookiePrefix (#2129)", () => {
  it("keeps Better Auth's default when unset, so prod's cookie name doesn't change", () => {
    expect(resolveAuthCookiePrefix(undefined)).toBe("better-auth");
    expect(resolveAuthCookiePrefix("")).toBe("better-auth");
    expect(resolveAuthCookiePrefix("   ")).toBe("better-auth");
  });

  it("returns dev's own prefix, trimmed", () => {
    expect(resolveAuthCookiePrefix("eduai-dev")).toBe("eduai-dev");
    expect(resolveAuthCookiePrefix("  eduai_dev  ")).toBe("eduai_dev");
  });

  it.each(["eduai dev", "eduai.dev", "eduai;dev", "eduai=dev"])(
    "throws on %s instead of falling back to the shared name",
    (prefix) => {
      expect(() => resolveAuthCookiePrefix(prefix)).toThrow(/COOKIE_PREFIX/);
    },
  );
});
