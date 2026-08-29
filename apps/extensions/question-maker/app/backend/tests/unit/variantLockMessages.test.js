/**
 * Three different situations answered with the identical string
 * "VARIANT_LOCKED", which the UI printed verbatim. Each now carries a reason
 * and a sentence a instructor can act on, while the machine-readable code stays
 * VARIANT_LOCKED because callers branch on it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const variantsUpdate = vi.fn();
const variantsFindFirst = vi.fn();

vi.mock("../../src/config/database.js", () => ({
  prisma: {
    questionMetadata: { findFirst: vi.fn() },
    variants: {
      create: vi.fn(),
      update: (...args) => variantsUpdate(...args),
      findFirst: (...args) => variantsFindFirst(...args),
    },
  },
}));

vi.mock("../../src/services/questionMutationFence.js", () => ({
  withQuestionMutationFence: async (_id, fn) =>
    fn({
      variants: {
        update: (...args) => variantsUpdate(...args),
        findFirst: (...args) => variantsFindFirst(...args),
      },
    }),
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const { updateVariant } = await import("../../src/services/questionService.js");

const INSTRUCTOR_CONTEXT = {
  isInstructorPlus: true,
  accessLevel: "instructor",
  requestUserId: "u1",
};

function variant(overrides) {
  return {
    id: 11,
    questionMetadataId: 3,
    isDraft: false,
    coreQuestionId: "cuid-q1",
    createdBy: "u1",
    choices: null,
    answer: null,
    selectAllThatApply: false,
    correctAnswers: null,
    shareWithExtensions: false,
    questionMetadata: { id: 3, type: "SA", course: { id: 9, coreCourseId: "core_1" } },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  variantsUpdate.mockResolvedValue({ id: 11 });
});

describe("VARIANT_LOCKED reasons", () => {
  it("says a publish is still finishing when the variant never reached Core", async () => {
    variantsFindFirst.mockResolvedValue(variant({ coreQuestionId: null }));

    await expect(
      updateVariant(11, { isDraft: true }, "u1", INSTRUCTOR_CONTEXT),
    ).rejects.toMatchObject({
      status: 409,
      code: "VARIANT_LOCKED",
      reason: "PUBLISH_IN_FLIGHT",
    });
  });

  it("says an approved question must be reopened before its content can change", async () => {
    variantsFindFirst.mockResolvedValue(variant());

    await expect(
      updateVariant(11, { questionText: "edited" }, "u1", INSTRUCTOR_CONTEXT),
    ).rejects.toMatchObject({
      status: 409,
      code: "VARIANT_LOCKED",
      reason: "APPROVED",
    });
  });

  it("keeps VARIANT_LOCKED as the message so existing callers still branch on it", async () => {
    variantsFindFirst.mockResolvedValue(variant());

    await expect(
      updateVariant(11, { questionText: "edited" }, "u1", INSTRUCTOR_CONTEXT),
    ).rejects.toMatchObject({ message: expect.stringContaining("reopen") });
  });
});
