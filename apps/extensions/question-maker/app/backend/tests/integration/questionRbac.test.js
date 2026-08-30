/**
 * Route-level RBAC tests for question_metadata authoring (#311/#312, §16/§19):
 *   - ordinary STUDENT callers denied by the enrollment-aware course gate,
 *   - platform STUDENT + TA enrollment can edit/delete only their own rows.
 *
 * No DB / live Core: questionService, schema, and the RBAC Core reads are mocked.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";

const {
  mockUpdate,
  mockDelete,
  mockCreate,
  mockList,
  mockQuestionFindOne,
  mockCourseFindOne,
  mockEnrollments,
} = vi.hoisted(() => ({
  mockUpdate: vi.fn(),
  mockDelete: vi.fn().mockResolvedValue(true),
  mockCreate: vi.fn(),
  mockList: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 }),
  mockQuestionFindOne: vi.fn(),
  mockCourseFindOne: vi.fn(),
  mockEnrollments: vi.fn(),
}));

vi.mock("../../src/services/authService.js", () => ({
  findOrCreateUser: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../src/config/settings.js", () => {
  const cfg = {
    coreUrl: "http://core.test",
    eduaiApiKey: "k",
    corsOrigins: ["*"],
    nodeEnv: "test",
    logLevel: "silent",
  };
  return { config: cfg, default: cfg };
});

vi.mock("../../src/services/questionService.js", () => ({
  createQuestion: mockCreate,
  getQuestionsByUser: mockList,
  getQuestionById: vi.fn(),
  updateQuestion: mockUpdate,
  deleteQuestion: mockDelete,
  createMultipleQuestions: vi.fn(),
  getQuestionStats: vi.fn(),
  updateQuestionOrder: vi.fn(),
  removeQuestionFromAssessment: vi.fn(),
  saveExtractedQuestions: vi.fn(),
  normalizePrimaryTopicId: (v) => (v ? String(v) : null),
}));

vi.mock("../../src/services/aiService.js", () => ({
  generateQuestions: vi.fn(),
  extractQuestionsFromText: vi.fn(),
  AI_PROVIDERS: { GROQ: "groq" },
}));

vi.mock("../../src/services/coreApiService.js", () => ({
  getCourseEnrollmentsFromCore: mockEnrollments,
  getCourseFromCore: vi.fn().mockResolvedValue({ id: "cuid-core-course", department: "COSC" }),
  getMyProfileFromCore: vi.fn().mockResolvedValue({ authorizedUnits: [] }),
}));

vi.mock("../../src/config/database.js", () => ({
  prisma: {
    course: { findUnique: mockCourseFindOne },
    questionMetadata: { findUnique: mockQuestionFindOne },
    variants: {},
    assessments: {},
    assessmentSections: {},
    topics: {},
  },
}));

const { default: app } = await import("../../src/app.js");

// Core's platform role for a course TA is STUDENT; the course-level TA role
// comes from the active enrollment mocked by authAs(..., 'TA').
const TA = { id: "ta-1", role: "STUDENT", email: "t@t.co", name: "TA" };
const INSTRUCTOR = {
  id: "inst-1",
  role: "INSTRUCTOR",
  email: "i@t.co",
  name: "I",
};
const STUDENT = { id: "stu-1", role: "STUDENT", email: "s@t.co", name: "S" };

const COURSE = { id: 1, userId: "owner-1", coreCourseId: "cuid-core-course" };
const OTHER_COURSE = {
  id: 2,
  userId: "owner-1",
  coreCourseId: "cuid-other-course",
};

function authAs(user, enrollRole) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ user }) }),
  );
  mockEnrollments.mockResolvedValue({
    enrollments: enrollRole ? [{ studentId: user.id, role: enrollRole, isActive: true }] : [],
  });
  mockCourseFindOne.mockResolvedValue(COURSE);
}

function loadQuestion(createdBy) {
  mockQuestionFindOne.mockResolvedValue({ id: 7, createdBy, course: COURSE });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDelete.mockResolvedValue(true);
});
afterEach(() => vi.restoreAllMocks());

describe("ordinary STUDENT remains denied from question authoring (§16)", () => {
  it.each([
    ["post", "/api/questions", { courseId: 1, primaryTopicId: "t1", type: "MCQ" }],
    ["put", "/api/questions/7", { description: "x" }],
    ["delete", "/api/questions/7", {}],
  ])("%s %s → 403", async (method, path, body) => {
    authAs(STUDENT, null);
    if (path.includes("/7")) loadQuestion("someone-else");
    const res = await request(app)[method](path).set("Cookie", "session=v").send(body);
    expect(res.status).toBe(403);
  });
});

describe("course-level TA access is enrollment-scoped (§16)", () => {
  it.each([
    ["put", "/api/questions/7", { description: "edit" }],
    ["delete", "/api/questions/7", {}],
    ["get", "/api/questions?courseId=1", {}],
  ])("%s %s → allowed for own/course view", async (method, path, body) => {
    authAs(TA, "TA");
    if (path.includes("/7")) loadQuestion(TA.id);
    if (method === "put") mockUpdate.mockResolvedValue({ id: 7 });
    const res = await request(app)[method](path).set("Cookie", "session=v").send(body);
    expect(res.status).toBe(200);
  });

  it("returns the TA's server-scoped aggregate list", async () => {
    authAs(TA, "TA");
    const res = await request(app).get("/api/questions").set("Cookie", "session=v");
    expect(res.status).toBe(200);
    expect(mockList).toHaveBeenCalledWith(
      TA.id,
      expect.objectContaining({ courseWhere: expect.any(Object) }),
    );
  });

  it("rejects a TA editing another author's question", async () => {
    authAs(TA, "TA");
    loadQuestion("someone-else");

    const res = await request(app)
      .put("/api/questions/7")
      .set("Cookie", "session=v")
      .send({ description: "edit" });

    expect(res.status).toBe(403);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe("INSTRUCTOR may edit/delete any question in the course (C)", () => {
  it("edits a question created by someone else → 200", async () => {
    authAs(INSTRUCTOR, "INSTRUCTOR");
    loadQuestion("ta-1");
    mockUpdate.mockResolvedValue({ id: 7 });
    const res = await request(app)
      .put("/api/questions/7")
      .set("Cookie", "session=v")
      .send({ description: "edit" });
    expect(res.status).toBe(200);
  });

  it("creates a question and records createdBy = caller", async () => {
    authAs(INSTRUCTOR, "INSTRUCTOR");
    mockCreate.mockResolvedValue({ id: 9 });
    const res = await request(app).post("/api/questions").set("Cookie", "session=v").send({
      courseId: 1,
      primaryTopicId: "t1",
      type: "MCQ",
      description: "q",
    });
    expect(res.status).toBe(201);
    // scoped by course owner, authored by caller
    expect(mockCreate).toHaveBeenCalledWith(
      "owner-1",
      expect.objectContaining({ createdBy: INSTRUCTOR.id, courseId: 1 }),
    );
  });

  it("does not allow a source-authorized caller to move a question into an inaccessible course", async () => {
    authAs(INSTRUCTOR, "INSTRUCTOR");
    loadQuestion("ta-1");
    mockCourseFindOne.mockImplementation(({ where }) =>
      Promise.resolve(where.id === OTHER_COURSE.id ? OTHER_COURSE : COURSE),
    );
    mockEnrollments.mockImplementation((coreCourseId) =>
      Promise.resolve({
        enrollments:
          coreCourseId === COURSE.coreCourseId
            ? [{ studentId: INSTRUCTOR.id, role: "INSTRUCTOR", isActive: true }]
            : [],
      }),
    );
    mockUpdate.mockResolvedValue({ id: 7, courseId: OTHER_COURSE.id });

    const res = await request(app)
      .put("/api/questions/7")
      .set("Cookie", "session=v")
      .send({ courseId: OTHER_COURSE.id, description: "move" });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: "COURSE_RELOCATION_NOT_ALLOWED" });
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
