/**
 * The picker is instructor-facing and reads another app's data, so the gate and
 * the upstream failure shape matter as much as the payload.
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listBankQuestions = vi.fn();
const isCourseAdmin = vi.fn();
const courseFindUnique = vi.fn();

vi.mock("../../src/services/bankQuestions.js", () => ({
  listBankQuestions: (...args) => listBankQuestions(...args),
}));

vi.mock("../../src/middleware/auth.js", async () => {
  const actual = await vi.importActual("../../src/middleware/auth.js");
  return {
    ...actual,
    isCourseAdmin: (...args) => isCourseAdmin(...args),
  };
});

// courses.js mounts `gateCourseById()` on every `/courses/:courseId` path.
// For INSTRUCTOR/UNIT_ADMIN/ADMIN it drives a real live-Core authorization
// round trip (`authorizeLiveCoursePrincipal` -> Core fetch) that this unit
// test has no business exercising a second time — the route under test does
// its own `isCourseAdmin` check. Neutralize the gate the same way a real
// request would pass through it.
vi.mock("../../src/middleware/liveCoursePrincipal.js", () => ({
  gateCourseById: () => (_req, _res, next) => next(),
}));

vi.mock("../../src/config/database.js", () => ({
  prisma: {
    courseOffering: { findUnique: (...args) => courseFindUnique(...args) },
  },
}));

const { default: courseRoutes } = await import("../../src/routes/courses.js");

function buildApp(user = { id: "instructor-1", role: "INSTRUCTOR" }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.use("/api", courseRoutes);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  isCourseAdmin.mockResolvedValue(true);
  courseFindUnique.mockResolvedValue({
    id: 7,
    coreOfferingId: "core-course-1",
    instructors: [{ userId: "instructor-1" }],
  });
  listBankQuestions.mockResolvedValue([
    {
      id: "q1",
      content: "What does Big-O measure?",
      type: "MCQ",
      choices: null,
      answer: "A",
      difficulty: "MEDIUM",
      topicId: "core-t1",
      topicName: "Complexity",
    },
  ]);
});

describe("GET /api/courses/:courseId/bank-questions", () => {
  it("returns the course's shared questions", async () => {
    const app = buildApp();
    const res = await request(app).get("/api/courses/7/bank-questions");

    expect(res.status).toBe(200);
    expect(res.body.questions).toHaveLength(1);
    expect(res.body.questions[0].topicName).toBe("Complexity");
  });

  it("forwards the topic filter and paging", async () => {
    const app = buildApp();
    await request(app).get("/api/courses/7/bank-questions?topicId=core-t2&limit=5&offset=10");

    expect(listBankQuestions).toHaveBeenCalledWith("core-course-1", {
      topicId: "core-t2",
      limit: 5,
      offset: 10,
    });
  });

  it("refuses a caller who does not administer the course", async () => {
    isCourseAdmin.mockResolvedValue(false);
    const app = buildApp();

    const res = await request(app).get("/api/courses/7/bank-questions");

    expect(res.status).toBe(403);
    expect(listBankQuestions).not.toHaveBeenCalled();
  });

  it("explains that a course with no Core link has no bank", async () => {
    courseFindUnique.mockResolvedValue({ id: 7, coreOfferingId: null, instructors: [] });
    const app = buildApp();

    const res = await request(app).get("/api/courses/7/bank-questions");

    expect(res.status).toBe(400);
  });

  it("does not report success when Core fails", async () => {
    const upstream = new Error("Core unreachable");
    upstream.status = 502;
    listBankQuestions.mockRejectedValue(upstream);
    const app = buildApp();

    const res = await request(app).get("/api/courses/7/bank-questions");

    expect(res.status).toBeGreaterThanOrEqual(500);
  });
});
