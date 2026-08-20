/**
 * Real-Postgres route/service regressions for POST /api/questions/approve.
 * Approval is instructor-scoped to one authorized linked course; local QM
 * ownership must not survive a revoked Core enrollment.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("../../src/services/authService.js", () => ({
  findOrCreateUser: vi.fn().mockResolvedValue({}),
}));

const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);
const describeDb = hasTestDb ? describe : describe.skip;

describeDb("POST /api/questions/approve course access (real DB)", () => {
  let connectTestDatabase;
  let truncateTestDatabase;
  let prisma;
  let app;
  let owner;
  let courseA;
  let courseB;
  let topicA;
  let topicB;

  const CALLER = {
    id: "approve-course-caller",
    email: "approve-course-caller@test.com",
    name: "Approval Caller",
    role: "INSTRUCTOR",
  };

  function coreResponse(body, status = 200) {
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      json: async () => body,
    };
  }

  function stubCore({ enrolledCoreCourseIds = [], failEnrollmentLookup = false } = {}) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input) => {
        const url = String(input);
        if (url.endsWith("/api/sessions/validate")) {
          return coreResponse({ user: CALLER });
        }

        const enrollmentMatch = url.match(/\/api\/courses\/([^/]+)\/enrollments$/);
        if (enrollmentMatch) {
          if (failEnrollmentLookup) throw new Error("Core enrollment lookup unavailable");
          const coreCourseId = enrollmentMatch[1];
          return coreResponse({
            enrollments: enrolledCoreCourseIds.includes(coreCourseId)
              ? [{ studentId: CALLER.id, role: "INSTRUCTOR", isActive: true }]
              : [],
          });
        }

        return coreResponse({});
      }),
    );
  }

  beforeAll(async () => {
    const testDb = await import("../helpers/testDb.js");
    ({ connectTestDatabase, truncateTestDatabase, prisma } = testDb);
    await connectTestDatabase();
    ({ default: app } = await import("../../src/app.js"));
  });

  beforeEach(async () => {
    await truncateTestDatabase();
    owner = await prisma.user.create({
      data: {
        id: CALLER.id,
        email: CALLER.email,
        name: CALLER.name,
      },
    });
    courseA = await prisma.course.create({
      data: { userId: owner.id, coreCourseId: "approve-core-a" },
    });
    courseB = await prisma.course.create({
      data: { userId: owner.id, coreCourseId: "approve-core-b" },
    });
    topicA = await prisma.topics.create({
      data: { id: "approve-topic-a", name: "Topic A", courseId: courseA.id },
    });
    topicB = await prisma.topics.create({
      data: { id: "approve-topic-b", name: "Topic B", courseId: courseB.id },
    });
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    if (prisma) await prisma.$disconnect();
  });

  it("denies a linked-course owner after their Core instructor enrollment is revoked", async () => {
    stubCore();

    const response = await request(app)
      .post("/api/questions/approve")
      .set("Cookie", "session=approve")
      .send({
        courseId: courseA.id,
        questions: [{ primaryTopicId: topicA.id, description: "revoked owner" }],
      });

    expect(response.status).toBe(403);
    expect(await prisma.questionMetadata.count()).toBe(0);
  });

  it("fails closed for a linked-course owner when Core enrollment lookup is unavailable", async () => {
    stubCore({ failEnrollmentLookup: true });

    const response = await request(app)
      .post("/api/questions/approve")
      .set("Cookie", "session=approve")
      .send({
        courseId: courseA.id,
        questions: [{ primaryTopicId: topicA.id, description: "Core outage" }],
      });

    expect(response.status).toBe(403);
    expect(await prisma.questionMetadata.count()).toBe(0);
  });

  it("rejects a mixed-course batch before any write", async () => {
    stubCore({ enrolledCoreCourseIds: [courseA.coreCourseId] });

    const response = await request(app)
      .post("/api/questions/approve")
      .set("Cookie", "session=approve")
      .send({
        courseId: courseA.id,
        questions: [
          { courseId: courseA.id, primaryTopicId: topicA.id, description: "course A" },
          { courseId: courseB.id, primaryTopicId: topicB.id, description: "course B" },
        ],
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/must match the authorized target course/i);
    expect(await prisma.questionMetadata.count()).toBe(0);
  });

  it("rejects malformed course ids before the Core access check", async () => {
    stubCore({ enrolledCoreCourseIds: [courseA.coreCourseId] });

    const response = await request(app)
      .post("/api/questions/approve")
      .set("Cookie", "session=approve")
      .send({
        questions: [{ courseId: "not-an-integer", primaryTopicId: topicA.id }],
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/courseId/i);
    expect(await prisma.questionMetadata.count()).toBe(0);
  });

  it("persists a batch only for the one authorized course", async () => {
    stubCore({ enrolledCoreCourseIds: [courseA.coreCourseId] });

    const response = await request(app)
      .post("/api/questions/approve")
      .set("Cookie", "session=approve")
      .send({
        courseId: courseA.id,
        questions: [
          { primaryTopicId: topicA.id, description: "first" },
          { primaryTopicId: topicA.id, description: "second" },
        ],
      });

    expect(response.status).toBe(201);
    expect(await prisma.questionMetadata.count({ where: { courseId: courseA.id } })).toBe(2);
    expect(await prisma.questionMetadata.count({ where: { courseId: courseB.id } })).toBe(0);
  });
});
