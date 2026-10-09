// @vitest-environment node
/**
 * #1819: retrieval over the help-docs corpus. The embedding provider and the
 * database are mocked; the manifest and guide text are real.
 *
 * - fail-closed: a provider or database failure throws, never returns [];
 * - the allowlist holds even when the stored index is stale or tampered with
 *   (a student is never handed an admin page the SQL filter let through);
 * - content comes from the manifest's resolved section, not the stored chunk;
 * - pages are deduplicated, capped at maxDocs, and filtered by similarity.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  systemConfig: { findUnique: vi.fn(), upsert: vi.fn() },
  $queryRaw: vi.fn(),
  $executeRaw: vi.fn(),
  $transaction: vi.fn(),
}));
vi.mock("~/lib/prisma.server", () => ({ default: prismaMock }));

const embeddingMock = vi.hoisted(() => ({
  generateEmbedding: vi.fn(),
  generateEmbeddings: vi.fn(),
}));
vi.mock("~/lib/ai/embedding", () => ({
  INDEXING_RETRY_BUDGET: { totalMs: 1, maxAttempts: 1 },
  generateEmbedding: embeddingMock.generateEmbedding,
  generateEmbeddings: embeddingMock.generateEmbeddings,
  getExpectedEmbeddingDimension: () => 3,
  resolveEffectiveEmbeddingSettings: () => ({
    provider: "local",
    model: "test-embed",
    wantsLocal: true,
    source: { provider: "env", model: "env" },
  }),
}));

import {
  HelpDocsUnavailableError,
  chunkHelpPage,
  ensureHelpDocsIndex,
  helpDocsEmbeddingSpace,
  reindexHelpDocsIfStale,
  retrieveHelpDocs,
} from "~/lib/assistant/help-docs/index.server";
import { helpCorpusHash, resolvedHelpPage } from "~/lib/assistant/help-docs/sources.server";

function indexIsFresh() {
  prismaMock.systemConfig.findUnique.mockResolvedValue({
    value: helpCorpusHash(helpDocsEmbeddingSpace()),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  embeddingMock.generateEmbedding.mockResolvedValue([0.1, 0.2, 0.3]);
});

describe("retrieveHelpDocs — fail closed", () => {
  it("an embedding provider failure is an error, not an empty result", async () => {
    indexIsFresh();
    embeddingMock.generateEmbedding.mockRejectedValue(new Error("connect ECONNREFUSED cmps01"));
    await expect(
      retrieveHelpDocs({ role: "STUDENT", query: "how do I find a course", maxDocs: 3 }),
    ).rejects.toBeInstanceOf(HelpDocsUnavailableError);
  });

  it("a database failure is an error, not an empty result", async () => {
    indexIsFresh();
    prismaMock.$queryRaw.mockRejectedValue(new Error("P1001 can't reach database"));
    await expect(
      retrieveHelpDocs({ role: "STUDENT", query: "how do I find a course", maxDocs: 3 }),
    ).rejects.toBeInstanceOf(HelpDocsUnavailableError);
  });

  it("an index that cannot be built is an error too", async () => {
    prismaMock.systemConfig.findUnique.mockResolvedValue(null);
    embeddingMock.generateEmbeddings.mockRejectedValue(new Error("provider down"));
    await expect(
      retrieveHelpDocs({ role: "STUDENT", query: "anything", maxDocs: 3 }),
    ).rejects.toBeInstanceOf(HelpDocsUnavailableError);
  });

  it("finding nothing relevant IS a valid empty result", async () => {
    indexIsFresh();
    prismaMock.$queryRaw.mockResolvedValue([{ pageId: "find-a-course", similarity: 0.05 }]);
    await expect(
      retrieveHelpDocs({ role: "STUDENT", query: "weather in Kelowna", maxDocs: 3 }),
    ).resolves.toEqual([]);
  });
});

describe("retrieveHelpDocs — allowlist and slices", () => {
  it("never returns an admin or instructor page to a student, even if the index offers one", async () => {
    indexIsFresh();
    prismaMock.$queryRaw.mockResolvedValue([
      { pageId: "platform-admin", similarity: 0.9 },
      { pageId: "canvas-sync", similarity: 0.88 },
      { pageId: "../../../.env", similarity: 0.87 },
      { pageId: "find-a-course", similarity: 0.8 },
    ]);
    const pages = await retrieveHelpDocs({ role: "STUDENT", query: "q", maxDocs: 5 });
    expect(pages.map((page) => page.id)).toEqual(["find-a-course"]);
  });

  it("filters the SQL to the reader's own slices", async () => {
    indexIsFresh();
    prismaMock.$queryRaw.mockResolvedValue([]);
    await retrieveHelpDocs({ role: "INSTRUCTOR", query: "q", maxDocs: 3 });
    // The slice list is a nested `Prisma.join` fragment; its bound values
    // serialize with the call, and the SQL text itself never says "admin".
    const call = JSON.stringify(prismaMock.$queryRaw.mock.calls[0]);
    expect(call).toContain('"student"');
    expect(call).toContain('"instructor"');
    expect(call).not.toContain('"admin"');
  });

  it("loads content from the manifest's own section, not from the stored chunk", async () => {
    indexIsFresh();
    prismaMock.$queryRaw.mockResolvedValue([{ pageId: "find-a-course", similarity: 0.9 }]);
    const [page] = await retrieveHelpDocs({ role: "STUDENT", query: "q", maxDocs: 3 });
    expect(page.content).toBe(resolvedHelpPage("find-a-course")?.content);
    expect(page.url).toBe("/help/guide/find-a-course");
  });

  it("deduplicates pages and caps at maxDocs", async () => {
    indexIsFresh();
    prismaMock.$queryRaw.mockResolvedValue([
      { pageId: "find-a-course", similarity: 0.9 },
      { pageId: "find-a-course", similarity: 0.85 },
      { pageId: "course-chat", similarity: 0.8 },
      { pageId: "navigation", similarity: 0.75 },
    ]);
    const pages = await retrieveHelpDocs({ role: "STUDENT", query: "q", maxDocs: 2 });
    expect(pages.map((page) => page.id)).toEqual(["find-a-course", "course-chat"]);
  });

  it("makes no upstream call at all for maxDocs < 1 or an empty query", async () => {
    await expect(retrieveHelpDocs({ role: "STUDENT", query: "q", maxDocs: 0 })).resolves.toEqual(
      [],
    );
    await expect(retrieveHelpDocs({ role: "STUDENT", query: "  ", maxDocs: 3 })).resolves.toEqual(
      [],
    );
    expect(embeddingMock.generateEmbedding).not.toHaveBeenCalled();
  });
});

describe("index lifecycle", () => {
  it("reports a fresh index without rebuilding", async () => {
    indexIsFresh();
    await expect(ensureHelpDocsIndex()).resolves.toBe("fresh");
    expect(embeddingMock.generateEmbeddings).not.toHaveBeenCalled();
  });

  it("the cron job is a no-op when the corpus hash is unchanged", async () => {
    indexIsFresh();
    const result = await reindexHelpDocsIfStale();
    expect(result.rebuilt).toBe(false);
    expect(embeddingMock.generateEmbeddings).not.toHaveBeenCalled();
  });

  it("the cron job rebuilds when a guide or the embedding space changed", async () => {
    prismaMock.systemConfig.findUnique.mockResolvedValue({ value: "an-older-hash" });
    embeddingMock.generateEmbeddings.mockImplementation(async (chunks: string[]) =>
      chunks.map((content) => ({ content, embedding: [0.1, 0.2, 0.3] })),
    );
    prismaMock.$transaction.mockImplementation(
      async (run: (tx: typeof prismaMock) => Promise<void>) => run(prismaMock),
    );
    const result = await reindexHelpDocsIfStale();
    expect(result.rebuilt).toBe(true);
    expect(result.chunks).toBeGreaterThan(0);
    expect(prismaMock.systemConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ value: helpCorpusHash(helpDocsEmbeddingSpace()) }),
      }),
    );
  });

  it("chunks carry their page title so a deep chunk still says what the page is about", () => {
    const chunks = chunkHelpPage({
      title: "Find a course",
      content: Array.from({ length: 6 }, (_, i) => `Paragraph ${i} ${"x".repeat(400)}`).join(
        "\n\n",
      ),
    });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.startsWith("Find a course\n\n")).toBe(true);
  });
});
