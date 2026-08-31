/**
 * Real-Postgres regression coverage for QM's course-level TA contract.
 *
 * Core sessions identify course TAs as platform STUDENT users. The enrollment
 * response is therefore the only authority that should admit the TA view/own
 * resource routes; a normal STUDENT enrollment must remain denied and TA writes
 * must not cross the instructor-only boundary.
 *
 * Requires TEST_DATABASE_URL. Core HTTP is stubbed at the network boundary so
 * this exercises the real QM Prisma queries and Express middleware without
 * depending on a running Core instance.
 */
import { vi, describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import supertest from "supertest";

const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);
const describeDb = hasTestDb ? describe : describe.skip;

const TA = {
  id: "qm-ta-rbac-user",
  email: "qm-ta-rbac@example.test",
  name: "QM TA",
  role: "STUDENT",
};
const STUDENT = {
  id: "qm-student-rbac-user",
  email: "qm-student-rbac@example.test",
  name: "QM Student",
  role: "STUDENT",
};
const OWNER = {
  id: "qm-instructor-rbac-user",
  email: "qm-instructor-rbac@example.test",
  name: "QM Instructor",
  role: "INSTRUCTOR",
};
const CORE_COURSE_ID = "qm-core-ta-rbac-course";

function coreResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: () => Promise.resolve(body),
  };
}

describeDb("QM course TA authorization (real PostgreSQL)", () => {
  let app;
  const request = () => supertest.agent(app).set("Sec-Fetch-Site", "same-origin");
  let prisma;
  let truncateTestDatabase;
  let courseId;
  let assessmentId;
  let ownQuestionId;
  let otherQuestionId;
  let currentUser;
  let currentEnrollmentRole;

  beforeAll(async () => {
    ({ truncateTestDatabase, prisma } = await import("../helpers/testDb.js"));
    ({ default: app } = await import("../../src/app.js"));
  });

  beforeEach(async () => {
    await truncateTestDatabase();
    await prisma.user.createMany({
      data: [TA, STUDENT, OWNER].map(({ role: _role, ...user }) => user),
    });
    const course = await prisma.course.create({
      data: { userId: OWNER.id, coreCourseId: CORE_COURSE_ID },
    });
    courseId = course.id;
    const assessment = await prisma.assessments.create({
      data: { courseId, type: "Quiz", name: "TA-visible quiz" },
    });
    assessmentId = assessment.id;
    const topic = await prisma.topics.create({
      data: { id: "qm-ta-rbac-topic", name: "TA RBAC topic", courseId },
    });
    const ownQuestion = await prisma.questionMetadata.create({
      data: {
        courseId,
        primaryTopicId: topic.id,
        type: "MCQ",
        description: "TA-owned question",
        createdBy: TA.id,
      },
    });
    ownQuestionId = ownQuestion.id;
    const otherQuestion = await prisma.questionMetadata.create({
      data: {
        courseId,
        primaryTopicId: topic.id,
        type: "MCQ",
        description: "Instructor-owned question",
        createdBy: OWNER.id,
      },
    });
    otherQuestionId = otherQuestion.id;
    currentUser = TA;
    currentEnrollmentRole = "TA";

    vi.stubGlobal(
      "fetch",
      vi.fn((url) => {
        const path = String(url);
        if (path.endsWith("/api/sessions/validate")) {
          return Promise.resolve(coreResponse({ user: currentUser }));
        }
        if (path.endsWith(`/api/courses/${CORE_COURSE_ID}/enrollments`)) {
          return Promise.resolve(
            coreResponse({
              enrollments: currentEnrollmentRole
                ? [{ studentId: currentUser.id, role: currentEnrollmentRole, isActive: true }]
                : [],
            }),
          );
        }
        // Read-through enrichment is deliberately allowed to degrade when Core
        // has no field response in this focused test.
        return Promise.resolve(coreResponse({}, 404));
      }),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  it("admits platform STUDENT with active TA enrollment to assessment view", async () => {
    const res = await request().get(`/api/assessments/${assessmentId}`).set("Cookie", "session=ta");

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(assessmentId);
  });

  it("denies an ordinary STUDENT enrollment on the same course", async () => {
    currentUser = STUDENT;
    currentEnrollmentRole = "STUDENT";

    const res = await request()
      .get(`/api/assessments/${assessmentId}`)
      .set("Cookie", "session=student");

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Insufficient course access");
  });

  it("does not let a TA perform instructor-only assessment creation", async () => {
    const res = await request()
      .post("/api/assessments")
      .set("Cookie", "session=ta")
      .send({ type: "Quiz", name: "forbidden", courseId });

    expect(res.status).toBe(403);
    expect(await prisma.assessments.count({ where: { courseId } })).toBe(1);
  });

  it("allows a TA to update their own question but not another author's", async () => {
    const own = await request()
      .put(`/api/questions/${ownQuestionId}`)
      .set("Cookie", "session=ta")
      .send({ description: "TA updated question" });
    expect(own.status).toBe(200);

    const other = await request()
      .put(`/api/questions/${otherQuestionId}`)
      .set("Cookie", "session=ta")
      .send({ description: "attempted takeover" });
    expect(other.status).toBe(403);
    expect(
      (await prisma.questionMetadata.findUnique({ where: { id: otherQuestionId } })).description,
    ).toBe("Instructor-owned question");
  });
});
