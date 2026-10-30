/**
 * Short answers are never auto-graded (#2027), so graders get the activity's
 * reference answer alongside each short-answer submission.
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const courseFindUnique = vi.fn();
const submissionFindMany = vi.fn();

vi.mock("../../src/config/database.js", () => ({
  prisma: {
    courseOffering: { findUnique: (...args) => courseFindUnique(...args) },
    submission: { findMany: (...args) => submissionFindMany(...args) },
  },
}));

vi.mock("../../src/middleware/liveCoursePrincipal.js", () => ({
  gateCourseById: () => (_req, _res, next) => next(),
}));

vi.mock("../../src/services/liveCoursePrincipal.js", () => ({
  authorizeLiveCoursePrincipal: vi.fn(async () => ({ state: "allowed", kind: "INSTRUCTOR" })),
  isAllowedLiveCourseStaffPrincipal: vi.fn(() => true),
  LIVE_COURSE_AUTH_UNAVAILABLE_CODE: "COURSE_AUTH_UNAVAILABLE",
  LIVE_COURSE_AUTH_UNAVAILABLE_MESSAGE: "Course authorization unavailable",
}));

const { default: courseRoutes } = await import("../../src/routes/courses.js");

const app = express();
app.use((req, _res, next) => {
  req.user = { id: "prof-1", role: "INSTRUCTOR" };
  next();
});
app.use("/api", courseRoutes);

function submissionFor(id, config) {
  return {
    id,
    userId: "student-1",
    activityId: id,
    attemptNumber: 1,
    response: { answerText: "an answer" },
    isCorrect: null,
    activity: { id, title: `A${id}`, config, lesson: { title: "L" } },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  courseFindUnique.mockResolvedValue({ id: 7, coreOfferingId: null, instructors: [] });
});

describe("GET /courses/:courseId/submissions — referenceAnswer", () => {
  it("includes the short-answer reference text and omits it otherwise", async () => {
    submissionFindMany.mockResolvedValue([
      submissionFor(1, { questionType: "SHORT_TEXT", answer: { text: "base case" } }),
      submissionFor(2, { questionType: "SHORT_TEXT", answer: "legacy string" }),
      submissionFor(3, { questionType: "SHORT_TEXT" }),
      submissionFor(4, { questionType: "MCQ", options: ["a", "b"], answer: { correctIndex: 0 } }),
    ]);

    const res = await request(app).get("/api/courses/7/submissions");

    expect(res.status).toBe(200);
    expect(res.body.map((row) => row.referenceAnswer)).toEqual([
      "base case",
      "legacy string",
      null,
      null,
    ]);
  });
});
