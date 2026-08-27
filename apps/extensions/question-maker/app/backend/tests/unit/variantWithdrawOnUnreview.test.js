/**
 * Un-reviewing a published variant must withdraw its Core question first
 * (#1652 review). Clearing `coreQuestionId` locally only forgets the link — the
 * Core row keeps whatever `testable` it was pushed with, so AI Tutor would go
 * on serving an un-reviewed question and the next approval would mint a second
 * Core row beside it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const patchQuestionTestableOnCore = vi.fn();

vi.mock("../../src/services/coreApiService.js", () => ({
  patchQuestionTestableOnCore: (...args) => patchQuestionTestableOnCore(...args),
}));

vi.mock("../../src/services/coreWiringService.js", () => ({
  pushVariantToCore: vi.fn(),
}));

vi.mock("../../src/services/questionService.js", () => ({
  linkVariantToCore: vi.fn(),
  rollbackVariantApproval: vi.fn(),
}));

vi.mock("../../src/services/variant-push-gate.js", () => ({
  shouldPushApprovedVariantToCore: vi.fn(() => false),
}));

vi.mock("../../src/config/database.js", () => ({ prisma: { topics: { updateMany: vi.fn() } } }));

vi.mock("../../src/utils/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const { withdrawVariantFromCore } = await import("../../src/services/variant-publish.js");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("withdrawVariantFromCore", () => {
  it("disables the Core question rather than merely unlinking it", async () => {
    patchQuestionTestableOnCore.mockResolvedValue({ id: "cuid-q1", testable: false });

    const result = await withdrawVariantFromCore("cuid-q1");

    expect(patchQuestionTestableOnCore).toHaveBeenCalledWith("cuid-q1", false);
    expect(result).toEqual({ outcome: "withdrawn" });
  });

  it("treats a Core question that no longer exists as already withdrawn", async () => {
    // patchQuestionTestableOnCore returns null on a Core 404.
    patchQuestionTestableOnCore.mockResolvedValue(null);

    await expect(withdrawVariantFromCore("cuid-gone")).resolves.toEqual({ outcome: "gone" });
  });

  it("reports a failure instead of throwing, so the caller can keep the variant reviewed", async () => {
    patchQuestionTestableOnCore.mockRejectedValue(
      Object.assign(new Error("Core down"), { status: 502 }),
    );

    await expect(withdrawVariantFromCore("cuid-q1")).resolves.toEqual({ outcome: "failed" });
  });
});
