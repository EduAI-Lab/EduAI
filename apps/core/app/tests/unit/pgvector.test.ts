import { describe, it, expect } from "vitest";
import { formatPgVectorLiteral } from "~/lib/ai/pgvector";

describe("formatPgVectorLiteral", () => {
  it("formats a small embedding as a pgvector bracket literal", () => {
    expect(formatPgVectorLiteral([0, 0.5, -1.25])).toBe("[0,0.5,-1.25]");
  });

  it("rejects empty arrays", () => {
    expect(() => formatPgVectorLiteral([])).toThrow(/non-empty/);
  });

  it("rejects non-finite values", () => {
    expect(() => formatPgVectorLiteral([1, Number.NaN])).toThrow(/index 1/);
    expect(() => formatPgVectorLiteral([1, Number.POSITIVE_INFINITY])).toThrow(/index 1/);
  });
});
