/**
 * Regression coverage for global question-bank visibility. The route resolves
 * a trusted CourseWhereInput from the shared course-list access helper; these
 * service tests prove list and aggregate queries apply that predicate instead
 * of silently falling back to local course ownership.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockQuestionFindMany = vi.fn();
const mockQuestionCount = vi.fn();
const mockQuestionGroupBy = vi.fn();
const mockVariantFindMany = vi.fn();

vi.mock("../../src/config/database.js", () => ({
  prisma: {
    questionMetadata: {
      findMany: (...args) => mockQuestionFindMany(...args),
      count: (...args) => mockQuestionCount(...args),
      groupBy: (...args) => mockQuestionGroupBy(...args),
    },
    variants: {
      findMany: (...args) => mockVariantFindMany(...args),
    },
  },
}));

vi.mock("../../src/services/courseListService.js", () => ({
  enrichRowsWithCourse: vi.fn(async (rows) => rows),
  enrichRowWithCourse: vi.fn(async (row) => row),
  formatSemesterDisplay: vi.fn(() => "Unscheduled"),
}));

const { getQuestionsByUser, getQuestionStats } =
  await import("../../src/services/questionService.js");

beforeEach(() => {
  vi.clearAllMocks();
  mockQuestionFindMany.mockResolvedValue([]);
  mockQuestionCount.mockResolvedValue(0);
  mockQuestionGroupBy.mockResolvedValue([]);
  mockVariantFindMany.mockResolvedValue([]);
});

describe("global visible-course scope", () => {
  const visibleCourseWhere = {
    OR: [
      { userId: "caller-1", coreCourseId: null },
      { accessGrants: { some: { userId: "caller-1", role: "INSTRUCTOR" } } },
    ],
  };

  it("applies the shared course visibility predicate to list rows and totals", async () => {
    await getQuestionsByUser("caller-1", {
      courseWhere: visibleCourseWhere,
      limit: 25,
      offset: 0,
      enrich: false,
    });

    expect(mockQuestionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { course: visibleCourseWhere } }),
    );
    expect(mockQuestionCount).toHaveBeenCalledWith({ where: { course: visibleCourseWhere } });
  });

  it("applies the shared course visibility predicate to every stats query", async () => {
    await getQuestionStats("caller-1", { courseWhere: visibleCourseWhere });

    const metadataWhere = { course: visibleCourseWhere };
    expect(mockQuestionCount).toHaveBeenCalledWith({ where: metadataWhere });
    expect(mockQuestionGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: metadataWhere }),
    );
    expect(mockVariantFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { questionMetadata: metadataWhere } }),
    );
  });
});
