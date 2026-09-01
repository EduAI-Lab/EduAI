/** Unit tests for security-sensitive environment configuration parsers. */
import { describe, it, expect } from "vitest";
import { parseCorsOrigins, parseQmAiProviderBudgets } from "../../src/config/settings.js";

describe("parseCorsOrigins", () => {
  it("throws on a wildcard entry in production", () => {
    expect(() => parseCorsOrigins("*", "production")).toThrow(/wildcard/);
    expect(() => parseCorsOrigins("https://a.test,*", "production")).toThrow(/wildcard/);
  });

  it("throws on a wildcard entry in any non-dev/test environment", () => {
    expect(() => parseCorsOrigins("*", "staging")).toThrow(/wildcard/);
  });

  it("allows a wildcard in development/test (local convenience)", () => {
    expect(parseCorsOrigins("*", "development")).toEqual(["*"]);
    expect(parseCorsOrigins("*", "test")).toEqual(["*"]);
    expect(parseCorsOrigins("*", undefined)).toEqual(["*"]);
  });

  it("returns the trimmed explicit origins and drops blanks", () => {
    expect(parseCorsOrigins(" https://a.test , https://b.test ,", "production")).toEqual([
      "https://a.test",
      "https://b.test",
    ]);
  });

  it("falls back to the local default when CORS_ORIGINS is unset or empty", () => {
    expect(parseCorsOrigins(undefined, "production")).toEqual(["http://localhost:5173"]);
    expect(parseCorsOrigins("", "production")).toEqual(["http://localhost:5173"]);
    expect(parseCorsOrigins("  ,  ", "production")).toEqual(["http://localhost:5173"]);
  });
});

describe("parseQmAiProviderBudgets", () => {
  it("lets a fresh caller reserve one worst-case extraction", () => {
    expect(parseQmAiProviderBudgets({})).toEqual({
      qmMaxExtractProviderCalls: 36,
      qmAiProviderCallLimit: 72,
    });
    expect(parseQmAiProviderBudgets({ QM_MAX_EXTRACT_PROVIDER_CALLS: "40" })).toEqual({
      qmMaxExtractProviderCalls: 40,
      qmAiProviderCallLimit: 80,
    });
  });
});
