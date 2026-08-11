import { describe, it, expect } from "vitest";
import { resolveReEmbedJobStatus } from "~/lib/ai/re-embed-job-status";
import {
  formatReEmbedJobMessage,
  isReEmbedJobTerminal,
} from "~/lib/api/re-embed-job.client";
import { serializeReEmbedJob } from "~/lib/ai/re-embed-job.server";

describe("resolveReEmbedJobStatus", () => {
  it("returns COMPLETED when there are no eligible materials", () => {
    expect(resolveReEmbedJobStatus({ processed: 0, failed: [], total: 0 })).toBe("COMPLETED");
  });

  it("returns COMPLETED when all materials succeed", () => {
    expect(resolveReEmbedJobStatus({ processed: 3, failed: [], total: 3 })).toBe("COMPLETED");
  });

  it("returns PARTIAL when any material fails", () => {
    expect(resolveReEmbedJobStatus({ processed: 2, failed: ["m1"], total: 3 })).toBe("PARTIAL");
  });
});

describe("re-embed job client helpers", () => {
  it("detects terminal job statuses", () => {
    expect(isReEmbedJobTerminal("COMPLETED")).toBe(true);
    expect(isReEmbedJobTerminal("RUNNING")).toBe(false);
  });

  it("formats user-facing messages", () => {
    expect(
      formatReEmbedJobMessage({
        id: "j1",
        courseId: "c1",
        status: "PARTIAL",
        totalMaterials: 3,
        processedCount: 2,
        failed: ["m3"],
        currentMaterialTitle: null,
        errorMessage: null,
      }),
    ).toContain("2 of 3");
  });

  it("serializes only stable failure messages", () => {
    const serialized = serializeReEmbedJob({
      id: "j1",
      courseId: "c1",
      idempotencyKey: null,
      status: "FAILED",
      embeddingProviderSnapshot: "cloud",
      embeddingModelSnapshot: "openai/text-embedding-3-small",
      totalMaterials: 1,
      processedCount: 0,
      failedMaterialIds: [],
      currentMaterialTitle: null,
      errorMessage: "https://provider.test/v1?api_key=provider-secret-canary",
      startedAt: null,
      completedAt: new Date("2026-01-01T00:00:00Z"),
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    });

    expect(serialized.errorMessage).toBe("Embedding provider failed. Please try again.");
    expect(JSON.stringify(serialized)).not.toContain("provider-secret-canary");
  });
});
