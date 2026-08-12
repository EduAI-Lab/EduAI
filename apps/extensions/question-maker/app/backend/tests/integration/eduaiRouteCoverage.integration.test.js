/**
 * Coverage-focused route tests for eduai.js (issue #1217: eduai.js was one of
 * the worst-covered files — GET /courses, /courses/:courseId/topics,
 * /test-api-key, and /ai-models had no coverage at all, and /chat +
 * /generate-questions were only exercised for their 400 validation branches;
 * budget admission and rate-limit canaries now live here as well.
 *
 * eduaiService and the course-code access resolution are mocked — no live
 * Core or test DB required.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";

const {
  mockFindCoursesByProjectedCode,
  mockListCoursesForUser,
  mockCourseFindMany,
  mockEnrollments,
  eduaiService,
} = vi.hoisted(() => ({
  mockFindCoursesByProjectedCode: vi.fn(),
  mockListCoursesForUser: vi.fn(),
  mockCourseFindMany: vi.fn(),
  mockEnrollments: vi.fn(),
  eduaiService: {
    chat: vi.fn(),
    generateQuestions: vi.fn(),
    listCourses: vi.fn(),
    getCourseTopics: vi.fn(),
    testApiKey: vi.fn(),
    listAIModels: vi.fn(),
  },
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
    maxQuestions: 50,
    qmGeneratePromptMaxChars: 20,
    qmAiRateLimitMax: 100,
  };
  return { config: cfg, default: cfg };
});

vi.mock("../../src/services/courseListService.js", () => ({
  findCoursesByProjectedCode: mockFindCoursesByProjectedCode,
  listCoursesForUser: mockListCoursesForUser,
}));

vi.mock('../../src/config/database.js', () => ({
  prisma: {
    course: { findMany: mockCourseFindMany },
  },
}));

vi.mock("../../src/services/coreApiService.js", () => ({
  getCourseEnrollmentsFromCore: mockEnrollments,
  getCourseFromCore: vi.fn().mockResolvedValue({ id: "cuid-core-course", department: "COSC" }),
  getMyProfileFromCore: vi.fn().mockResolvedValue({ authorizedUnits: [] }),
}));

vi.mock("../../src/services/eduaiService.js", () => ({ default: eduaiService }));

const { default: app } = await import("../../src/app.js");

const INSTRUCTOR = { id: "inst-1", role: "INSTRUCTOR", email: "i@t.co", name: "I" };
// ADMIN short-circuits resolveAccessForCourse before the coreCourseId check
// (#1114), the only caller that can reach a course unlinked from Core.
const ADMIN = { id: "admin-1", role: "ADMIN", email: "a@t.co", name: "A" };

function authAs(user) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ user }) }),
  );
}

/** A QM course the caller has TA+ access to, resolved via an active INSTRUCTOR enrollment. */
function accessibleCourse(overrides = {}) {
  const course = {
    id: 1,
    userId: INSTRUCTOR.id,
    coreCourseId: "cuid-core-course",
    code: null,
    ...overrides,
  };
  mockFindCoursesByProjectedCode.mockResolvedValue([course]);
  mockEnrollments.mockResolvedValue({
    enrollments: [{ studentId: INSTRUCTOR.id, role: "INSTRUCTOR", isActive: true }],
  });
  return course;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockListCoursesForUser.mockResolvedValue([]);
  mockCourseFindMany.mockResolvedValue([]);
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/eduai/chat", () => {
  it("returns 403 when no accessible course matches the course code", async () => {
    authAs(INSTRUCTOR);
    mockFindCoursesByProjectedCode.mockResolvedValue([]);

    const res = await request(app)
      .post("/api/eduai/chat")
      .set("Cookie", "session=v")
      .send({ messages: [{ role: "user", content: "hi" }], courseCode: "COSC 101" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("COURSE_ACCESS_DENIED");
  });

  it("proxies to eduaiService with the resolved Core course id on success", async () => {
    authAs(INSTRUCTOR);
    accessibleCourse();
    eduaiService.chat.mockResolvedValue({ reply: "hello" });

    const res = await request(app)
      .post("/api/eduai/chat")
      .set("Cookie", "session=v")
      .send({ messages: [{ role: "user", content: "hi" }], courseCode: "COSC 101" });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ reply: "hello" });
    expect(res.body.course.coreCourseId).toBe("cuid-core-course");
    expect(eduaiService.chat).toHaveBeenCalledWith(
      expect.objectContaining({ courseId: "cuid-core-course", model: "google:gemini-2.5-flash" }),
    );
  });

  it("omits courseId when the resolved course has no Core link", async () => {
    // Unlinked course: ADMIN is the only caller that can reach it (#1114).
    authAs(ADMIN);
    accessibleCourse({ coreCourseId: null });
    eduaiService.chat.mockResolvedValue({ reply: "hi" });

    const res = await request(app)
      .post("/api/eduai/chat")
      .set("Cookie", "session=v")
      .send({ messages: [{ role: "user", content: "hi" }], courseCode: "COSC 101" });

    expect(res.status).toBe(200);
    expect(res.body.course.coreCourseId).toBeNull();
    expect(eduaiService.chat).toHaveBeenCalledWith(
      expect.objectContaining({ courseId: undefined }),
    );
  });

  it('returns a stable error without upstream details when eduaiService.chat throws', async () => {
    authAs(INSTRUCTOR);
    accessibleCourse();
    eduaiService.chat.mockRejectedValue(new Error("provider down"));

    const res = await request(app)
      .post("/api/eduai/chat")
      .set("Cookie", "session=v")
      .send({ messages: [{ role: "user", content: "hi" }], courseCode: "COSC 101" });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Failed to process chat request');
    expect(res.body.code).toBe('EDUAI_CHAT_FAILED');
    expect(res.body.details).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('provider down');
  });

  it('rejects oversized transcripts before resolving the course or calling EduAI', async () => {
    authAs(INSTRUCTOR);
    const res = await request(app)
      .post('/api/eduai/chat')
      .set('Cookie', 'session=v')
      .send({ messages: [{ role: 'user', content: 'x'.repeat(12_001) }], courseCode: 'COSC 101' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('QM_CHAT_MESSAGE_TOO_LARGE');
    expect(mockFindCoursesByProjectedCode).not.toHaveBeenCalled();
    expect(eduaiService.chat).not.toHaveBeenCalled();
  });

  it('stops on an upstream 429 without leaking its body', async () => {
    authAs(INSTRUCTOR);
    accessibleCourse();
    const rateLimited = new Error('provider body api_key=must-not-leak');
    rateLimited.statusCode = 429;
    eduaiService.chat.mockRejectedValue(rateLimited);

    const res = await request(app)
      .post('/api/eduai/chat')
      .set('Cookie', 'session=v')
      .send({ messages: [{ role: 'user', content: 'hi' }], courseCode: 'COSC 101' });

    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ code: 'EDUAI_UPSTREAM_RATE_LIMITED' });
    expect(JSON.stringify(res.body)).not.toContain('api_key');
  });
});

describe("POST /api/eduai/generate-questions", () => {
  it("returns 403 when no accessible course matches the course code", async () => {
    authAs(INSTRUCTOR);
    mockFindCoursesByProjectedCode.mockResolvedValue([]);

    const res = await request(app)
      .post("/api/eduai/generate-questions")
      .set("Cookie", "session=v")
      .send({ prompt: "x", courseCode: "COSC 101" });

    expect(res.status).toBe(403);
  });

  it("clamps mcqRequiredChoiceCount into [2, 26] and forwards it", async () => {
    authAs(INSTRUCTOR);
    accessibleCourse();
    eduaiService.generateQuestions.mockResolvedValue([{ id: "q1" }]);

    const res = await request(app)
      .post("/api/eduai/generate-questions")
      .set("Cookie", "session=v")
      .send({ prompt: "x", courseCode: "COSC 101", mcqRequiredChoiceCount: 999 });

    expect(res.status).toBe(200);
    expect(res.body.data.count).toBe(1);
    expect(eduaiService.generateQuestions).toHaveBeenCalledWith(
      expect.objectContaining({ mcqRequiredChoiceCount: 26 }),
    );
  });

  it('rejects an oversized prompt before resolving a course or calling EduAI', async () => {
    authAs(INSTRUCTOR);
    const res = await request(app)
      .post('/api/eduai/generate-questions')
      .set('Cookie', 'session=v')
      .send({ prompt: 'x'.repeat(21), courseCode: 'COSC 101' });

    expect(res.status).toBe(413);
    expect(res.body.code).toBe('QM_PROMPT_TOO_LARGE');
    expect(mockFindCoursesByProjectedCode).not.toHaveBeenCalled();
    expect(eduaiService.generateQuestions).not.toHaveBeenCalled();
  });

  it('rejects non-integer or over-limit counts before calling EduAI', async () => {
    authAs(INSTRUCTOR);
    for (const numQuestions of [0, 1.5, 51]) {
      const res = await request(app)
        .post('/api/eduai/generate-questions')
        .set('Cookie', 'session=v')
        .send({ prompt: 'x', courseCode: 'COSC 101', numQuestions });
      expect(res.status).toBe(400);
      expect(res.body.code).toMatch(/^QM_QUESTION_COUNT_/);
    }
    expect(eduaiService.generateQuestions).not.toHaveBeenCalled();
  });

  it('omits mcqRequiredChoiceCount when not a finite number', async () => {
    authAs(INSTRUCTOR);
    accessibleCourse();
    eduaiService.generateQuestions.mockResolvedValue([]);

    await request(app)
      .post("/api/eduai/generate-questions")
      .set("Cookie", "session=v")
      .send({ prompt: "x", courseCode: "COSC 101" });

    const call = eduaiService.generateQuestions.mock.calls[0][0];
    expect(call).not.toHaveProperty("mcqRequiredChoiceCount");
  });

  it('returns a stable error without upstream details when generation fails', async () => {
    authAs(INSTRUCTOR);
    accessibleCourse();
    eduaiService.generateQuestions.mockRejectedValue(new Error('The model refused: unsafe content'));

    const res = await request(app)
      .post('/api/eduai/generate-questions')
      .set('Cookie', 'session=v')
      .send({ prompt: 'x', courseCode: 'COSC 101' });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Failed to generate questions');
    expect(res.body.code).toBe('EDUAI_GENERATION_FAILED');
    expect(res.body.aiErrorReason).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('unsafe content');
  });

  it('returns the same stable error for internal wrapper failures', async () => {
    authAs(INSTRUCTOR);
    accessibleCourse();
    eduaiService.generateQuestions.mockRejectedValue(
      new Error("The model refused: unsafe content"),
    );

    const res = await request(app)
      .post("/api/eduai/generate-questions")
      .set("Cookie", "session=v")
      .send({ prompt: "x", courseCode: "COSC 101" });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Failed to generate questions');
    expect(res.body.code).toBe('EDUAI_GENERATION_FAILED');
    expect(res.body.aiErrorReason).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('503');
  });
});

describe('GET /api/eduai/courses', () => {
  it('returns only the caller-scoped QM/Core course catalog', async () => {
    authAs(INSTRUCTOR);
    mockListCoursesForUser.mockResolvedValue([
      { id: 1, coreCourseId: 'c1', name: 'Visible', code: 'COSC 101', department: 'COSC' },
      { id: 3, coreCourseId: null, name: 'Unlinked' },
    ]);

    const res = await request(app).get("/api/eduai/courses").set("Cookie", "session=v");

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{
      id: 'c1',
      name: 'Visible',
      code: 'COSC 101',
      department: 'COSC',
      term: null,
      year: null,
      description: null,
      isPublished: null,
    }]);
    expect(mockListCoursesForUser).toHaveBeenCalledWith(
      expect.objectContaining({ id: INSTRUCTOR.id, role: INSTRUCTOR.role }),
      { cookie: 'session=v' },
    );
    expect(eduaiService.listCourses).not.toHaveBeenCalled();
  });

  it("returns 500 when the catalog fetch fails", async () => {
    authAs(INSTRUCTOR);
    mockListCoursesForUser.mockRejectedValue(new Error('unreachable'));

    const res = await request(app).get("/api/eduai/courses").set("Cookie", "session=v");

    expect(res.status).toBe(500);
    expect(res.body.details).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('unreachable');
  });
});

describe("GET /api/eduai/courses/:courseId/topics", () => {
  it("returns topics for the course", async () => {
    authAs(INSTRUCTOR);
    mockCourseFindMany.mockResolvedValue([{ id: 1, userId: INSTRUCTOR.id, coreCourseId: 'c1' }]);
    mockEnrollments.mockResolvedValue({
      enrollments: [{ studentId: INSTRUCTOR.id, role: 'INSTRUCTOR', isActive: true }],
    });
    eduaiService.getCourseTopics.mockResolvedValue([{ id: 't1' }]);

    const res = await request(app).get("/api/eduai/courses/c1/topics").set("Cookie", "session=v");

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{ id: "t1" }]);
  });

  it('does not probe topics for a course the caller cannot access', async () => {
    authAs(INSTRUCTOR);
    mockCourseFindMany.mockResolvedValue([{ id: 1, userId: 'other-owner', coreCourseId: 'c1' }]);
    mockEnrollments.mockResolvedValue({ enrollments: [] });

    const res = await request(app).get('/api/eduai/courses/c1/topics').set('Cookie', 'session=v');

    expect(res.status).toBe(404);
    expect(eduaiService.getCourseTopics).not.toHaveBeenCalled();
  });

  it('denies the linked local owner when Core returns an empty roster', async () => {
    authAs(INSTRUCTOR);
    mockCourseFindMany.mockResolvedValue([{ id: 1, userId: INSTRUCTOR.id, coreCourseId: 'c1' }]);
    mockEnrollments.mockResolvedValue({ enrollments: [] });

    const res = await request(app).get('/api/eduai/courses/c1/topics').set('Cookie', 'session=v');

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('COURSE_NOT_FOUND');
    expect(eduaiService.getCourseTopics).not.toHaveBeenCalled();
  });

  it('returns 500 when the topics fetch fails', async () => {
    authAs(INSTRUCTOR);
    mockCourseFindMany.mockResolvedValue([{ id: 1, userId: INSTRUCTOR.id, coreCourseId: 'c1' }]);
    mockEnrollments.mockResolvedValue({
      enrollments: [{ studentId: INSTRUCTOR.id, role: 'INSTRUCTOR', isActive: true }],
    });
    eduaiService.getCourseTopics.mockRejectedValue(new Error('unreachable'));

    const res = await request(app).get("/api/eduai/courses/c1/topics").set("Cookie", "session=v");

    expect(res.status).toBe(500);
    expect(res.body.details).toBeUndefined();
    expect(res.body.code).toBe('EDUAI_COURSE_TOPICS_FAILED');
  });
});

describe("POST /api/eduai/test-api-key", () => {
  it("returns 200 with the provider result on success", async () => {
    authAs(INSTRUCTOR);
    eduaiService.testApiKey.mockResolvedValue({
      success: true,
      message: "ok",
      provider: "google",
      response: { ping: "pong" },
    });

    const res = await request(app)
      .post("/api/eduai/test-api-key")
      .set("Cookie", "session=v")
      .send({ apiKeys: { google: "key" }, provider: "google" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, provider: "google", data: { ping: "pong" } });
  });

  it('returns 400 with a stable error when the provider probe fails', async () => {
    authAs(INSTRUCTOR);
    eduaiService.testApiKey.mockResolvedValue({
      success: false,
      provider: "vllm",
      error: "unauthorized",
      statusCode: 401,
    });

    const res = await request(app)
      .post("/api/eduai/test-api-key")
      .set("Cookie", "session=v")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      provider: 'vllm',
      error: 'EduAI API key test failed',
      code: 'EDUAI_API_KEY_TEST_REJECTED',
      statusCode: 401,
    });
    expect(JSON.stringify(res.body)).not.toContain('unauthorized');
  });

  it("returns 500 when the probe throws", async () => {
    authAs(INSTRUCTOR);
    eduaiService.testApiKey.mockRejectedValue(new Error("network error"));

    const res = await request(app)
      .post("/api/eduai/test-api-key")
      .set("Cookie", "session=v")
      .send({});

    expect(res.status).toBe(500);
    expect(res.body.details).toBeUndefined();
    expect(res.body.code).toBe('EDUAI_API_KEY_TEST_FAILED');
    expect(JSON.stringify(res.body)).not.toContain('network error');
  });

  it('rejects ambiguous provider keys before invoking the probe', async () => {
    authAs(INSTRUCTOR);
    const res = await request(app)
      .post('/api/eduai/test-api-key')
      .set('Cookie', 'session=v')
      .send({ apiKeys: { google: { apiKey: 'g' }, openai: { apiKey: 'o' } } });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('QM_TEST_API_KEY_AMBIGUOUS_PROVIDER');
    expect(eduaiService.testApiKey).not.toHaveBeenCalled();
  });

  it('returns a stable 429 when the probe is rate limited', async () => {
    authAs(INSTRUCTOR);
    eduaiService.testApiKey.mockResolvedValue({ success: false, provider: 'google', statusCode: 429 });

    const res = await request(app)
      .post('/api/eduai/test-api-key')
      .set('Cookie', 'session=v')
      .send({ provider: 'google', apiKeys: { google: { apiKey: 'g' } } });

    expect(res.status).toBe(429);
    expect(res.body.code).toBe('EDUAI_UPSTREAM_RATE_LIMITED');
    expect(JSON.stringify(res.body)).not.toContain('provider body');
  });
});

describe("GET /api/eduai/ai-models", () => {
  it("returns the live catalog when non-empty", async () => {
    authAs(INSTRUCTOR);
    eduaiService.listAIModels.mockResolvedValue([{ modelId: "live-model" }]);

    const res = await request(app).get("/api/eduai/ai-models").set("Cookie", "session=v");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ modelId: "live-model" }]);
  });

  it("falls back to the static catalog when the live list is empty", async () => {
    authAs(INSTRUCTOR);
    eduaiService.listAIModels.mockResolvedValue([]);

    const res = await request(app).get("/api/eduai/ai-models").set("Cookie", "session=v");

    expect(res.status).toBe(200);
    expect(res.body.some((m) => m.modelId === "gemini-2.5-flash")).toBe(true);
  });

  it("falls back to the static catalog on a non-auth error", async () => {
    authAs(INSTRUCTOR);
    eduaiService.listAIModels.mockRejectedValue(new Error("timeout"));

    const res = await request(app).get("/api/eduai/ai-models").set("Cookie", "session=v");

    expect(res.status).toBe(200);
    expect(res.body.some((m) => m.modelId === "gemini-2.5-flash")).toBe(true);
  });

  it("surfaces a 401/403 auth failure instead of falling back", async () => {
    authAs(INSTRUCTOR);
    const err = new Error("unauthorized");
    err.status = 401;
    eduaiService.listAIModels.mockRejectedValue(err);

    const res = await request(app).get("/api/eduai/ai-models").set("Cookie", "session=v");

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Failed to retrieve AI models/);
    expect(res.body.details).toBeUndefined();
  });
});
