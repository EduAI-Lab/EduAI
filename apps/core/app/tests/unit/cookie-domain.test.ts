// @vitest-environment node
import { describe, expect, it } from "vitest";

import { resolveAuthCookieDomain } from "~/lib/auth/cookie-domain";

describe("resolveAuthCookieDomain", () => {
  it.each(["localhost", ".localhost", "127.0.0.1", ".127.0.0.1", "[::1]", "::1"])(
    "treats %s as unset",
    (domain) => {
      expect(resolveAuthCookieDomain(domain)).toBeUndefined();
    },
  );

  it("trims and preserves a public cookie domain", () => {
    expect(resolveAuthCookieDomain("  .eduai.ok.ubc.ca  ")).toBe(".eduai.ok.ubc.ca");
  });

  it("treats an empty value as unset", () => {
    expect(resolveAuthCookieDomain("   ")).toBeUndefined();
  });
});
