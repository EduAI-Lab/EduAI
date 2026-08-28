/**
 * A Core question created by `pushVariantToCore` must never outlive the publish
 * that created it (#1652 review). Once the push resolves, the Core row is live
 * — `testable` possibly true — while nothing local points at it yet, and the
 * idempotency key hashes `testable`, so a retry with a different share choice
 * mints a *second* row instead of replaying the first. Every path that does not
 * end in a link therefore has to withdraw the row it just pushed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const patchQuestionTestableOnCore = vi.fn();
const pushVariantToCore = vi.fn();
const linkVariantToCore = vi.fn();
const rollbackVariantApproval = vi.fn();

vi.mock("../../src/services/coreApiService.js", () => ({
  patchQuestionTestableOnCore: (...args) => patchQuestionTestableOnCore(...args),
}));

vi.mock("../../src/services/coreWiringService.js", () => ({
  pushVariantToCore: (...args) => pushVariantToCore(...args),
}));

vi.mock("../../src/services/questionService.js", () => ({
  linkVariantToCore: (...args) => linkVariantToCore(...args),
  rollbackVariantApproval: (...args) => rollbackVariantApproval(...args),
}));

vi.mock("../../src/config/database.js", () => ({ prisma: { topics: { updateMany: vi.fn() } } }));

vi.mock("../../src/utils/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const { publishApprovedVariant, respondToPublishFailure } =
  await import("../../src/services/variant-publish.js");

const VARIANT = {
  id: 11,
  isDraft: false,
  coreQuestionId: null,
  shareWithExtensions: true,
  questionMetadata: { id: 3, type: "SA", course: { id: 9, coreCourseId: "core_1" } },
};

const publish = () =>
  publishApprovedVariant({ variant: VARIANT, ownerId: "u1", cookie: "session=x" });

beforeEach(() => {
  vi.clearAllMocks();
  pushVariantToCore.mockResolvedValue({ coreQuestionId: "cq_new" });
  patchQuestionTestableOnCore.mockResolvedValue({ id: "cq_new", testable: false });
  rollbackVariantApproval.mockResolvedValue({ applied: true, variant: { isDraft: true } });
});

describe("publishApprovedVariant compensation", () => {
  it("withdraws the pushed Core question when the link is refused", async () => {
    linkVariantToCore.mockResolvedValue({ applied: false, variant: { id: 11 } });

    await expect(publish()).resolves.toEqual({ outcome: "conflict" });

    expect(patchQuestionTestableOnCore).toHaveBeenCalledWith("cq_new", false);
  });

  it("withdraws the pushed Core question when linking throws", async () => {
    linkVariantToCore.mockRejectedValue(Object.assign(new Error("db down"), { status: 500 }));

    await expect(publish()).resolves.toEqual({ outcome: "push-failed" });

    expect(patchQuestionTestableOnCore).toHaveBeenCalledWith("cq_new", false);
    expect(rollbackVariantApproval).toHaveBeenCalled();
  });

  it("reports the orphan instead of a bare conflict when the withdrawal also fails", async () => {
    linkVariantToCore.mockResolvedValue({ applied: false, variant: { id: 11 } });
    patchQuestionTestableOnCore.mockRejectedValue(new Error("Core down"));

    await expect(publish()).resolves.toEqual({
      outcome: "orphaned-core-question",
      coreQuestionId: "cq_new",
    });
  });

  it("reports the orphan when linking throws and the withdrawal fails too", async () => {
    linkVariantToCore.mockRejectedValue(new Error("db down"));
    patchQuestionTestableOnCore.mockRejectedValue(new Error("Core down"));

    await expect(publish()).resolves.toEqual({
      outcome: "orphaned-core-question",
      coreQuestionId: "cq_new",
    });
  });

  it("still reports the unrevertable approval first when rollback fails as well", async () => {
    // A row stuck approved-with-no-link is the worse state: it blocks the retry
    // that would otherwise clean the orphan up.
    linkVariantToCore.mockRejectedValue(new Error("db down"));
    patchQuestionTestableOnCore.mockRejectedValue(new Error("Core down"));
    rollbackVariantApproval.mockResolvedValue({ applied: false, variant: { isDraft: false } });

    await expect(publish()).resolves.toEqual({ outcome: "rollback-failed" });
  });

  it("does not touch Core when the push itself failed — no row was created", async () => {
    pushVariantToCore.mockRejectedValue(Object.assign(new Error("Core down"), { status: 502 }));

    await expect(publish()).resolves.toEqual({ outcome: "push-failed" });

    expect(patchQuestionTestableOnCore).not.toHaveBeenCalled();
  });

  it("leaves a linked publish alone", async () => {
    linkVariantToCore.mockResolvedValue({
      applied: true,
      variant: { id: 11, coreQuestionId: "cq_new" },
    });

    await expect(publish()).resolves.toEqual({ outcome: "linked", coreQuestionId: "cq_new" });

    expect(patchQuestionTestableOnCore).not.toHaveBeenCalled();
  });
});

describe("respondToPublishFailure", () => {
  it("answers an orphaned Core question with 502 rather than a success", () => {
    const json = vi.fn();
    const res = { status: vi.fn(() => ({ json })) };

    const handled = respondToPublishFailure(res, {
      outcome: "orphaned-core-question",
      coreQuestionId: "cq_new",
    });

    expect(handled).toBe(true);
    expect(res.status).toHaveBeenCalledWith(502);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, code: "CORE_PUBLISH_COMPENSATION_FAILED" }),
    );
  });
});
