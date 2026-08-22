/**
 * Unit tests for assertCoreServiceKeyConfigured — startup fail-fast when Core
 * is configured but EDUAI_API_KEY is missing. Does not boot the HTTP server.
 */
import { describe, it, expect } from "vitest";
import { assertCoreServiceKeyConfigured } from "../../src/config/settings.js";

describe("assertCoreServiceKeyConfigured", () => {
  it("throws when coreUrl is set and eduaiApiKey is empty", () => {
    expect(() =>
      assertCoreServiceKeyConfigured({
        coreUrl: "http://localhost:3000",
        eduaiApiKey: "",
      }),
    ).toThrow(/EDUAI_API_KEY/);

    expect(() =>
      assertCoreServiceKeyConfigured({
        coreUrl: "http://localhost:3000",
        eduaiApiKey: "   ",
      }),
    ).toThrow(/Core session validation/);
  });

  it("throws when coreUrl is set and eduaiApiKey is missing", () => {
    expect(() => assertCoreServiceKeyConfigured({ coreUrl: "http://localhost:3000" })).toThrow(
      /EDUAI_API_KEY/,
    );
  });

  it("does not throw when the service key is present", () => {
    expect(() =>
      assertCoreServiceKeyConfigured({
        coreUrl: "http://localhost:3000",
        eduaiApiKey: "test-service-key",
      }),
    ).not.toThrow();
  });

  it("does not throw when coreUrl is empty or whitespace", () => {
    expect(() => assertCoreServiceKeyConfigured({ coreUrl: "", eduaiApiKey: "" })).not.toThrow();

    expect(() => assertCoreServiceKeyConfigured({ coreUrl: "   ", eduaiApiKey: "" })).not.toThrow();
  });
});
