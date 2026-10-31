/**
 * Submit/override messaging for short answers (#1982, #2027, #2033): a null
 * verdict must never read as "Not quite", and a staff override must replace
 * the submit-time feedback so it can't contradict the new result.
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const activityFindUnique = vi.fn();
const submissionFindUnique = vi.fn();
const submissionUpdate = vi.fn();
const createSubmissionWithNextAttempt = vi.fn();
const recordSubmissionMetrics = vi.fn();
const resyncSubmissionMetrics = vi.fn();

vi.mock("../../src/config/database.js", () => ({
  prisma: {
    activity: { findUnique: (...args) => activityFindUnique(...args) },
    submission: {
      findUnique: (...args) => submissionFindUnique(...args),
      update: (...args) => submissionUpdate(...args),
    },
  },
}));

vi.mock("../../src/middleware/liveCoursePrincipal.js", () => ({
  gateCourseThrough: () => (_req, _res, next) => next(),
}));

vi.mock("../../src/services/liveCoursePrincipal.js", () => ({
  authorizeLiveCoursePrincipal: vi.fn(async () => ({ state: "allowed", kind: "INSTRUCTOR" })),
  isAllowedLiveCourseStaffPrincipal: vi.fn(() => true),
  LIVE_COURSE_AUTH_UNAVAILABLE_CODE: "COURSE_AUTH_UNAVAILABLE",
  LIVE_COURSE_AUTH_UNAVAILABLE_MESSAGE: "Course authorization unavailable",
}));

vi.mock("../../src/services/enrollmentSync.js", () => ({
  authorizeLiveStudentEnrollment: vi.fn(async () => ({
    allowed: true,
    state: "allowed",
    role: "STUDENT",
  })),
  LIVE_ENROLLMENT_AUTH_UNAVAILABLE_CODE: "ENROLLMENT_AUTH_UNAVAILABLE",
  LIVE_ENROLLMENT_AUTH_UNAVAILABLE_MESSAGE: "Enrollment authorization unavailable",
}));

vi.mock("../../src/services/courseResolver.js", () => ({
  isCoursePublishedLive: vi.fn(async () => true),
  resolveCoreCourseById: vi.fn(),
  resolveCoreCourseCatalog: vi.fn(),
}));

vi.mock("../../src/services/submissionAttempts.js", () => ({
  createSubmissionWithNextAttempt: (...args) => createSubmissionWithNextAttempt(...args),
}));

vi.mock("../../src/services/activityAnalytics.js", () => ({
  hasActivityFeedback: vi.fn(async () => false),
  recordActivityFeedback: vi.fn(),
  recordAiHelpRequest: vi.fn(),
  recordSubmissionMetrics: (...args) => recordSubmissionMetrics(...args),
  resyncSubmissionMetrics: (...args) => resyncSubmissionMetrics(...args),
}));

const { default: activityRoutes } = await import("../../src/routes/activities.js");

const COURSE = { id: 1, coreOfferingId: "core-1", enrollments: [], instructors: [] };
const LESSON = { isPublished: true, module: { isPublished: true, courseOffering: COURSE } };

function buildApp(user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.use("/api", activityRoutes);
  return app;
}

const student = buildApp({ id: "student-1", role: "STUDENT" });
const instructor = buildApp({ id: "prof-1", role: "INSTRUCTOR" });

beforeEach(() => {
  vi.clearAllMocks();
  createSubmissionWithNextAttempt.mockImplementation(async (data) => ({ id: 99, ...data }));
  submissionUpdate.mockImplementation(async ({ where, data }) => ({
    id: where.id,
    userId: "student-1",
    activityId: 5,
    ...data,
  }));
});

describe("POST /questions/:id/answer", () => {
  it("sends a keyed short answer to staff grading, not 'Not quite' (#1982, #2027)", async () => {
    activityFindUnique.mockResolvedValue({
      id: 5,
      config: { questionType: "SHORT_TEXT", answer: { text: "base case" } },
      lesson: LESSON,
    });

    const res = await request(student)
      .post("/api/questions/5/answer")
      .send({ answerText: "the base case" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      isCorrect: null,
      message: "Submitted. Your instructor will review this answer.",
    });
    expect(createSubmissionWithNextAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        isCorrect: null,
        aiFeedback: { message: "Submitted. Your instructor will review this answer." },
      }),
    );
    // Pending is neither correct nor incorrect in analytics.
    expect(recordSubmissionMetrics).toHaveBeenCalledWith({
      userId: "student-1",
      activityId: 5,
      isCorrect: null,
    });
  });

  it.each([
    [1, true, "Nice! That looks right."],
    [0, false, "Not quite. Try another angle."],
  ])("MCQ answer %i still auto-grades", async (answerOption, isCorrect, message) => {
    activityFindUnique.mockResolvedValue({
      id: 5,
      config: {
        questionType: "MCQ",
        options: { choices: ["a", "b"] },
        answer: { correctIndex: 1 },
      },
      lesson: LESSON,
    });

    const res = await request(student).post("/api/questions/5/answer").send({ answerOption });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ isCorrect, message });
    expect(createSubmissionWithNextAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ isCorrect, aiFeedback: { message } }),
    );
  });
});

describe("PATCH /activities/:activityId/submissions/:submissionId", () => {
  function existingSubmission(isCorrect, message) {
    submissionFindUnique.mockResolvedValue({
      id: 42,
      activityId: 5,
      userId: "student-1",
      isCorrect,
      aiFeedback: { message },
      activity: { lesson: LESSON },
    });
  }

  it("replaces stale feedback when the verdict changes (#2033)", async () => {
    existingSubmission(false, "Not quite. Try another angle.");

    const res = await request(instructor)
      .patch("/api/activities/5/submissions/42")
      .send({ isCorrect: true, score: 1 });

    expect(res.status).toBe(200);
    expect(submissionUpdate).toHaveBeenCalledWith({
      where: { id: 42 },
      data: {
        isCorrect: true,
        score: 1,
        aiFeedback: { message: "Marked correct by your instructor." },
      },
    });
    expect(res.body.aiFeedback).toEqual({ message: "Marked correct by your instructor." });
    expect(resyncSubmissionMetrics).toHaveBeenCalled();
  });

  it("grading a pending answer incorrect replaces the pending note", async () => {
    existingSubmission(null, "Submitted. Your instructor will review this answer.");

    const res = await request(instructor)
      .patch("/api/activities/5/submissions/42")
      .send({ isCorrect: false });

    expect(res.status).toBe(200);
    expect(res.body.aiFeedback).toEqual({ message: "Marked incorrect by your instructor." });
  });

  it("keeps feedback on a score-only or same-verdict edit", async () => {
    existingSubmission(true, "Nice! That looks right.");

    await request(instructor).patch("/api/activities/5/submissions/42").send({ score: 0.5 });
    await request(instructor)
      .patch("/api/activities/5/submissions/42")
      .send({ isCorrect: true, score: 1 });

    expect(submissionUpdate).toHaveBeenNthCalledWith(1, {
      where: { id: 42 },
      data: { score: 0.5 },
    });
    expect(submissionUpdate).toHaveBeenNthCalledWith(2, {
      where: { id: 42 },
      data: { isCorrect: true, score: 1 },
    });
  });
});
