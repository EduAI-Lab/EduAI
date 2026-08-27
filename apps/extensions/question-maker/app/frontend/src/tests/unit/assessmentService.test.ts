/**
 * Unit tests for `assessmentService` (#1546): the offset-pagination envelope
 * unwrap/walk (`getAssessments`'s single-page vs. walk-all branches, and the
 * fetch-all safety cap), plus the section/variant CRUD wrappers.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
const del = vi.fn();
const fetchAllPages = vi.fn();

vi.mock("../../services/api", () => ({
  default: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
    put: (...args: unknown[]) => put(...args),
    delete: (...args: unknown[]) => del(...args),
  },
}));

vi.mock("../../services/pagination", () => ({
  fetchAllPages: (...args: unknown[]) => fetchAllPages(...args),
}));

import { assessmentService } from "../../services/assessmentService";

afterEach(() => {
  vi.clearAllMocks();
});

function pageEnvelope(items: unknown[], total: number, limit: number, offset: number) {
  return { data: { data: { items, total, limit, offset } } };
}

describe("assessmentService.getAssessmentsPage", () => {
  it("omits params entirely when none are given", async () => {
    get.mockResolvedValue(pageEnvelope([], 0, 50, 0));
    await assessmentService.getAssessmentsPage();
    expect(get).toHaveBeenCalledWith("/api/assessments", { params: undefined });
  });

  it("forwards courseId/limit/offset as query params", async () => {
    get.mockResolvedValue(pageEnvelope([{ id: 1 }], 1, 10, 0));
    const page = await assessmentService.getAssessmentsPage({ courseId: 5, limit: 10, offset: 0 });
    expect(get).toHaveBeenCalledWith("/api/assessments", {
      params: { courseId: 5, limit: 10, offset: 0 },
    });
    expect(page).toEqual({ items: [{ id: 1 }], total: 1, limit: 10, offset: 0 });
  });

  it("unwraps a legacy bare array response", async () => {
    get.mockResolvedValue({ data: { data: [{ id: 1 }, { id: 2 }] } });
    const page = await assessmentService.getAssessmentsPage();
    expect(page).toEqual({ items: [{ id: 1 }, { id: 2 }], total: 2, limit: 2, offset: 0 });
  });

  it("defaults to an empty page for an unrecognized payload shape", async () => {
    get.mockResolvedValue({ data: { data: null } });
    const page = await assessmentService.getAssessmentsPage();
    expect(page).toEqual({ items: [], total: 0, limit: 50, offset: 0 });
  });
});

describe("assessmentService.getAssessments", () => {
  it("returns a single page's items when limit is within the server max", async () => {
    get.mockResolvedValue(pageEnvelope([{ id: 1 }], 1, 50, 0));
    const items = await assessmentService.getAssessments({ limit: 50 });
    expect(items).toEqual([{ id: 1 }]);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("walks all offset pages when no limit is given", async () => {
    get
      .mockResolvedValueOnce(pageEnvelope([{ id: 1 }, { id: 2 }], 3, 2, 0))
      .mockResolvedValueOnce(pageEnvelope([{ id: 3 }], 3, 2, 2));

    const items = await assessmentService.getAssessments({ courseId: 9 });
    expect(items).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("walks all offset pages when limit exceeds the server max page size", async () => {
    get
      .mockResolvedValueOnce(pageEnvelope(Array.from({ length: 100 }, (_, i) => ({ id: i })), 150, 100, 0))
      .mockResolvedValueOnce(pageEnvelope(Array.from({ length: 50 }, (_, i) => ({ id: 100 + i })), 150, 100, 100));

    const items = await assessmentService.getAssessments({ limit: 500 });
    expect(items).toHaveLength(150);
  });

  it("stops walking on an empty page even if total says otherwise", async () => {
    get.mockResolvedValue(pageEnvelope([], 999, 100, 0));
    const items = await assessmentService.getAssessments({});
    expect(items).toEqual([]);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("throws when the result set exceeds the fetch-all safety cap", async () => {
    get.mockResolvedValue(
      pageEnvelope(Array.from({ length: 100 }, (_, i) => ({ id: i })), 1_000_000, 100, 0),
    );
    await expect(assessmentService.getAssessments({})).rejects.toThrow(/fetch-all safety cap/);
  });
});

describe("assessmentService CRUD", () => {
  it("createPracticeExamForCourse builds a zeroed blueprint and posts it", async () => {
    post.mockResolvedValue({ data: { data: { id: 1, name: "Practice Exam" } } });
    const result = await assessmentService.createPracticeExamForCourse(7);
    expect(post).toHaveBeenCalledWith(
      "/api/assessments",
      expect.objectContaining({ name: "Practice Exam", courseId: 7, type: "Quiz" }),
    );
    expect(result).toEqual({ id: 1, name: "Practice Exam" });
  });

  it("createAssessment posts type/name/description/courseId plus a derived blueprintConfig", async () => {
    post.mockResolvedValue({ data: { data: { id: 2 } } });
    await assessmentService.createAssessment({
      courseId: 1,
      name: "Midterm",
      type: "Exam",
      description: "d",
      primaryTopicIds: [1],
      secondaryTopicIds: [],
      excludedTopicIds: [],
      difficultyDistribution: { easy: 1, medium: 1, hard: 1 },
      reasoningDistribution: { factual: 1, analytical: 1, application: 1 },
      reasoningData: {} as any,
    });
    expect(post).toHaveBeenCalledWith("/api/assessments", {
      type: "Exam",
      name: "Midterm",
      description: "d",
      courseId: 1,
      blueprintConfig: expect.objectContaining({ primaryTopicIds: [1] }),
    });
  });

  it("updateAssessment puts by id with the same shaped payload", async () => {
    put.mockResolvedValue({ data: { data: { id: 2, name: "Updated" } } });
    await assessmentService.updateAssessment(2, {
      courseId: 1,
      name: "Updated",
      type: "Exam",
      description: "",
      primaryTopicIds: [],
      secondaryTopicIds: [],
      excludedTopicIds: [],
      difficultyDistribution: { easy: 0, medium: 0, hard: 0 },
      reasoningDistribution: { factual: 0, analytical: 0, application: 0 },
      reasoningData: {} as any,
    });
    expect(put).toHaveBeenCalledWith("/api/assessments/2", expect.objectContaining({ name: "Updated" }));
  });

  it("getAssessment fetches by id", async () => {
    get.mockResolvedValue({ data: { data: { id: 3 } } });
    await expect(assessmentService.getAssessment(3)).resolves.toEqual({ id: 3 });
    expect(get).toHaveBeenCalledWith("/api/assessments/3");
  });

  it("getAssessmentSections delegates to fetchAllPages", async () => {
    fetchAllPages.mockResolvedValue([{ id: 1 }]);
    await assessmentService.getAssessmentSections(3);
    expect(fetchAllPages).toHaveBeenCalledWith("/api/assessments/3/sections");
  });

  it("createSection posts the payload", async () => {
    post.mockResolvedValue({ data: { data: { id: 10 } } });
    await assessmentService.createSection(3, { name: "S1" } as any);
    expect(post).toHaveBeenCalledWith("/api/assessments/3/sections", { name: "S1" });
  });

  it("updateSection puts the payload", async () => {
    put.mockResolvedValue({ data: { data: { id: 10, name: "S1b" } } });
    await assessmentService.updateSection(3, 10, { name: "S1b" });
    expect(put).toHaveBeenCalledWith("/api/assessments/3/sections/10", { name: "S1b" });
  });

  it("deleteSection deletes by id", async () => {
    del.mockResolvedValue({});
    await assessmentService.deleteSection(3, 10);
    expect(del).toHaveBeenCalledWith("/api/assessments/3/sections/10");
  });

  it("reorderSections puts the ordered id list", async () => {
    put.mockResolvedValue({ data: { data: [{ id: 1 }, { id: 2 }] } });
    await assessmentService.reorderSections(3, [2, 1]);
    expect(put).toHaveBeenCalledWith("/api/assessments/3/sections/reorder", { sectionIds: [2, 1] });
  });

  it("deleteAssessment deletes by id", async () => {
    del.mockResolvedValue({});
    await assessmentService.deleteAssessment(3);
    expect(del).toHaveBeenCalledWith("/api/assessments/3");
  });

  it("addVariantToSection posts the link payload", async () => {
    post.mockResolvedValue({ data: { data: { id: 1 } } });
    await assessmentService.addVariantToSection(3, 10, { variantId: 99 });
    expect(post).toHaveBeenCalledWith("/api/assessments/3/sections/10/variants", { variantId: 99 });
  });

  it("removeVariantFromSection deletes the link", async () => {
    del.mockResolvedValue({});
    await assessmentService.removeVariantFromSection(3, 10, 99);
    expect(del).toHaveBeenCalledWith("/api/assessments/3/sections/10/variants/99");
  });

  it("removeQuestionFromAssessment deletes the question link", async () => {
    del.mockResolvedValue({});
    await assessmentService.removeQuestionFromAssessment(3, 55);
    expect(del).toHaveBeenCalledWith("/api/assessments/3/questions/55");
  });

  it("checkQuestionInAssessments returns the check result", async () => {
    get.mockResolvedValue({ data: { data: { isInAssessments: true, assessmentIds: [1] } } });
    await expect(assessmentService.checkQuestionInAssessments(55)).resolves.toEqual({
      isInAssessments: true,
      assessmentIds: [1],
    });
  });

  it("removeQuestionFromAllSections deletes and returns the summary", async () => {
    del.mockResolvedValue({ data: { data: { removedLinks: 2, affectedAssessments: [1, 2] } } });
    await expect(assessmentService.removeQuestionFromAllSections(55)).resolves.toEqual({
      removedLinks: 2,
      affectedAssessments: [1, 2],
    });
  });
});
