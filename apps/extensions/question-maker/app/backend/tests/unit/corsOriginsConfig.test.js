/**
 * Unit tests for parseCorsOrigins — the CORS_ORIGINS allowlist parser rejects a
 * wildcard ("*") outside development/test (#1569 review) so a production
 * `CORS_ORIGINS=*` cannot widen CORS and defeat the CSRF origin backstop.
 */
import { describe, it, expect } from "vitest";
import { parseCorsOrigins } from "../../src/config/settings.js";

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
