import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/prisma.server", () => ({
  default: { $queryRaw: vi.fn() },
}));

import prisma from "~/lib/prisma.server";
import {
  hasIndexableText,
  selectMaterialIdsWithIndexableText,
} from "~/lib/materials/indexable-text.server";

/** The SQL text of the probe's tagged template, with its bound values elided. */
function probeSql(): string {
  const [strings] = vi.mocked(prisma.$queryRaw).mock.calls[0] as [TemplateStringsArray];
  return strings.join(" ? ");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never);
});

// #1795 review: the materials list and the reprocess route both ask whether a
// failed row still holds text worth re-indexing, and they answered differently.
// The list tested `rawText: { not: null }`; the route tested `!material.rawText`.
// An empty string satisfied the first and failed the second, so the list offered
// "Try again" on rows the route then refused with 409 — the same dead end #1749
// exists to remove, now with a button attached.
describe("hasIndexableText", () => {
  it("rejects a row whose extraction never wrote any text", () => {
    expect(hasIndexableText(null)).toBe(false);
  });

  it("rejects the empty string every text-free upload was promoted with before #1797", () => {
    // An image-only PDF scan, a figures-only DOCX and a blank .txt all wrote
    // `rawText: ""` and then failed at embedding, so those rows are FAILED in
    // every existing course. Re-indexing one can only reach the same end.
    expect(hasIndexableText("")).toBe(false);
  });

  it("rejects whitespace-only text, which yields no chunks to embed", () => {
    // `generateChunks` trims before it splits, so " \n\t " produces zero chunks
    // and `processMaterialEmbeddings` throws "No content chunks generated".
    expect(hasIndexableText(" \n\t ")).toBe(false);
  });

  it("accepts text a retry could actually index", () => {
    expect(hasIndexableText("lecture notes")).toBe(true);
  });
});

describe("selectMaterialIdsWithIndexableText", () => {
  it("asks the database nothing when no row on the page failed", async () => {
    const retryable = await selectMaterialIdsWithIndexableText([]);

    expect(retryable.size).toBe(0);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("returns the ids whose text survived", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ id: "mat-1" }] as never);

    const retryable = await selectMaterialIdsWithIndexableText(["mat-1", "mat-2"]);

    expect(retryable.has("mat-1")).toBe(true);
    expect(retryable.has("mat-2")).toBe(false);
  });

  it("applies the same trimming rule the route applies, in SQL", async () => {
    // Prisma has no trimming filter, so the predicate is written out rather
    // than approximated with `{ not: null }` — approximating is how the two
    // sides drifted apart. `btrim` is NULL-propagating, so a null `rawText`
    // drops out of the result without a second clause.
    await selectMaterialIdsWithIndexableText(["mat-1"]);

    expect(probeSql()).toContain(`btrim("rawText") <> ''`);
  });

  it("selects ids only, never the document text (#948)", async () => {
    await selectMaterialIdsWithIndexableText(["mat-1"]);

    expect(probeSql()).toMatch(/SELECT\s+"id"\s+FROM/);
  });
});
