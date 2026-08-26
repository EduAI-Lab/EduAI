/**
 * The author's "usable by other extensions" choice (#1555) is stored on the
 * variant, because a draft has no Core row to hold it yet. These pin that the
 * field is persisted on create, editable on update, and defaults to unshared.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const variantsCreate = vi.fn();
const variantsUpdate = vi.fn();
const variantsFindFirst = vi.fn();

vi.mock("../../src/config/database.js", () => ({
  prisma: {
    questionMetadata: { findFirst: vi.fn() },
    variants: {
      create: (...args) => variantsCreate(...args),
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

const { prisma } = await import("../../src/config/database.js");
const { createVariant, updateVariant } = await import("../../src/services/questionService.js");

const BASE = { questionText: "What is 2+2?", difficulty: "easy" };

beforeEach(() => {
  vi.clearAllMocks();
  prisma.questionMetadata.findFirst.mockResolvedValue({ id: 3, courseId: 9, type: "SA" });
  variantsCreate.mockResolvedValue({ id: 11 });
  variantsFindFirst.mockResolvedValue({
    id: 11,
    questionMetadataId: 3,
    isDraft: true,
    coreQuestionId: null,
    createdBy: "u1",
    choices: null,
    answer: null,
    selectAllThatApply: false,
    correctAnswers: null,
    shareWithExtensions: false,
    questionMetadata: { id: 3, type: "SA", course: { id: 9, coreCourseId: "core_1" } },
  });
  variantsUpdate.mockResolvedValue({ id: 11 });
});

describe("createVariant share-with-extensions", () => {
  it("returns the course relation the publish step needs to reach Core", async () => {
    // publishApprovedVariant reads `variant.questionMetadata.course.coreCourseId`.
    // Without the include, that is undefined and the push is silently skipped —
    // creating an already-reviewed variant that can never be pushed or reverted.
    await createVariant(3, { ...BASE, isDraft: false }, "u1");

    const include = variantsCreate.mock.calls[0][0].include;
    expect(include?.questionMetadata?.select?.course).toBeTruthy();
  });

  it("persists an opted-in share choice on a reviewed question", async () => {
    await createVariant(3, { ...BASE, shareWithExtensions: true, isDraft: false }, "u1");

    expect(variantsCreate.mock.calls[0][0].data.shareWithExtensions).toBe(true);
  });

  it("refuses to share a question that has not been reviewed", async () => {
    await createVariant(3, { ...BASE, shareWithExtensions: true, isDraft: true }, "u1");

    expect(variantsCreate.mock.calls[0][0].data.shareWithExtensions).toBe(false);
  });

  it("defaults to unshared when the author says nothing", async () => {
    await createVariant(3, BASE, "u1");

    expect(variantsCreate.mock.calls[0][0].data.shareWithExtensions).toBe(false);
  });
});

describe("updateVariant share-with-extensions", () => {
  it("persists a change to the share choice", async () => {
    await updateVariant(11, { shareWithExtensions: true }, "u1", {
      isInstructorPlus: true,
      accessLevel: "instructor",
      requestUserId: "u1",
    });

    expect(variantsUpdate.mock.calls[0][0].data.shareWithExtensions).toBe(true);
  });

  it("leaves the share choice alone when the update does not mention it", async () => {
    await updateVariant(11, { questionText: "edited" }, "u1", {
      isInstructorPlus: true,
      accessLevel: "instructor",
      requestUserId: "u1",
    });

    expect(variantsUpdate.mock.calls[0][0].data).not.toHaveProperty("shareWithExtensions");
  });
});

describe("unreviewing withdraws the share choice (#1555)", () => {
  it("clears shareWithExtensions when an approved variant goes back to draft", async () => {
    variantsFindFirst.mockResolvedValue({
      id: 11,
      questionMetadataId: 3,
      isDraft: false,
      coreQuestionId: "cuid-q1",
      createdBy: "u1",
      choices: null,
      answer: null,
      selectAllThatApply: false,
      correctAnswers: null,
      shareWithExtensions: true,
      questionMetadata: { id: 3, type: "SA", course: { id: 9, coreCourseId: "core_1" } },
    });

    await updateVariant(11, { isDraft: true }, "u1", {
      isInstructorPlus: true,
      accessLevel: "instructor",
      requestUserId: "u1",
    });

    expect(variantsUpdate.mock.calls[0][0].data.shareWithExtensions).toBe(false);
  });
});
