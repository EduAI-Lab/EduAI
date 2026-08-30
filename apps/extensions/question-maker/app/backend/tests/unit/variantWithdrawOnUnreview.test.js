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

const variantsFindFirst = vi.fn();

vi.mock("../../src/config/database.js", () => ({
  prisma: {
    topics: { updateMany: vi.fn() },
    variants: { findFirst: (...args) => variantsFindFirst(...args) },
  },
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const { withdrawVariantFromCore, restoreVariantSharingOnCore } =
  await import("../../src/services/variant-publish.js");

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

/**
 * The withdrawal above runs before the local un-review write. When that write
 * then fails, the two stores disagree with nothing left to reconcile them, so
 * the withdrawal has to be undone — but only against freshly read state, never
 * the snapshot the failed request was working from.
 */
describe("restoreVariantSharingOnCore", () => {
  const args = { variantId: 11, ownerId: "owner-1", coreQuestionId: "cuid-q1" };

  it("re-enables the Core question a shared, still-linked variant points at", async () => {
    variantsFindFirst.mockResolvedValue({
      isDraft: false,
      coreQuestionId: "cuid-q1",
      shareWithExtensions: true,
    });
    patchQuestionTestableOnCore.mockResolvedValue({ id: "cuid-q1", testable: true });

    await expect(restoreVariantSharingOnCore(args)).resolves.toEqual({ outcome: "restored" });
    expect(patchQuestionTestableOnCore).toHaveBeenCalledWith("cuid-q1", true);
  });

  it("leaves a link a concurrent writer replaced alone", async () => {
    variantsFindFirst.mockResolvedValue({
      isDraft: false,
      coreQuestionId: "cuid-q2",
      shareWithExtensions: true,
    });

    await expect(restoreVariantSharingOnCore(args)).resolves.toEqual({ outcome: "not-needed" });
    expect(patchQuestionTestableOnCore).not.toHaveBeenCalled();
  });

  it("does nothing for a variant that was never shared", async () => {
    variantsFindFirst.mockResolvedValue({
      isDraft: false,
      coreQuestionId: "cuid-q1",
      shareWithExtensions: false,
    });

    await expect(restoreVariantSharingOnCore(args)).resolves.toEqual({ outcome: "not-needed" });
    expect(patchQuestionTestableOnCore).not.toHaveBeenCalled();
  });

  it("does nothing once the variant has actually reached draft", async () => {
    variantsFindFirst.mockResolvedValue({
      isDraft: true,
      coreQuestionId: "cuid-q1",
      shareWithExtensions: true,
    });

    await expect(restoreVariantSharingOnCore(args)).resolves.toEqual({ outcome: "not-needed" });
    expect(patchQuestionTestableOnCore).not.toHaveBeenCalled();
  });

  it("reports a failure when Core will not take the restore", async () => {
    variantsFindFirst.mockResolvedValue({
      isDraft: false,
      coreQuestionId: "cuid-q1",
      shareWithExtensions: true,
    });
    patchQuestionTestableOnCore.mockRejectedValue(new Error("Core down"));

    await expect(restoreVariantSharingOnCore(args)).resolves.toEqual({ outcome: "failed" });
  });

  it("reports a failure when the state it needs cannot even be read", async () => {
    variantsFindFirst.mockRejectedValue(new Error("db down"));

    await expect(restoreVariantSharingOnCore(args)).resolves.toEqual({ outcome: "failed" });
    expect(patchQuestionTestableOnCore).not.toHaveBeenCalled();
  });
});
