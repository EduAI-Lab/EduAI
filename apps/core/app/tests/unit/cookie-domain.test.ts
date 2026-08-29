// @vitest-environment node
import { describe, expect, it } from "vitest";

import { resolveAuthCookieDomain } from "~/lib/auth/cookie-domain";

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
