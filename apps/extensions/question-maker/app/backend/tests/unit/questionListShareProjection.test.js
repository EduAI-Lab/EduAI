/**
 * The sharing panel is opened straight from the question list and the question
 * detail, so both must project the Core link and the author's current share
 * choice. Without them every approved variant arrived with `coreQuestionId`
 * null, so the panel rendered its "mark this reviewed" notice and the toggle
 * was unreachable (#1652 review).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const questionMetadataFindMany = vi.fn();
const questionMetadataCount = vi.fn();
const questionMetadataFindFirst = vi.fn();

vi.mock("../../src/config/database.js", () => ({
  prisma: {
    questionMetadata: {
      findMany: (...a) => questionMetadataFindMany(...a),
      count: (...a) => questionMetadataCount(...a),
      findFirst: (...a) => questionMetadataFindFirst(...a),
    },
    variants: {},
    topics: {},
  },
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const { getQuestionsByUser, getQuestionById } =
  await import("../../src/services/questionService.js");

beforeEach(() => {
  vi.clearAllMocks();
  questionMetadataFindMany.mockResolvedValue([]);
  questionMetadataCount.mockResolvedValue(0);
  questionMetadataFindFirst.mockResolvedValue({
    id: 1,
    courseId: 9,
    course: { id: 9, coreCourseId: null },
    variants: [],
  });
});

describe("question list/detail share projection", () => {
  it("selects coreQuestionId and shareWithExtensions on the list path", async () => {
    await getQuestionsByUser("u1", { enrich: false });

    const select = questionMetadataFindMany.mock.calls[0][0].include.variants.select;
    expect(select.coreQuestionId).toBe(true);
    expect(select.shareWithExtensions).toBe(true);
    expect(select.createdBy).toBe(true);
  });

  it("selects them on the detail path too, so the two cannot drift", async () => {
    await getQuestionById(1, "u1");

    const select = questionMetadataFindFirst.mock.calls[0][0].include.variants.select;
    expect(select.coreQuestionId).toBe(true);
    expect(select.shareWithExtensions).toBe(true);
    expect(select.createdBy).toBe(true);
  });
});
