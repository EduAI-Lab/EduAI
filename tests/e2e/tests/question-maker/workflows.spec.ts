/**
 * Question Maker role workflows.
 *
 * The workflow inventory is intentionally broader than route-gate coverage:
 * each test follows a user journey through the same API surfaces used by the
 * QM UI. AI/CANVAS calls are kept in reachability tests because their external
 * providers are environment-dependent.
 */
import { test, expect, type APIRequestContext } from "@playwright/test";
import { CORE_URL, QM_BACKEND_URL } from "../../playwright.config";
import {
  createAdmin,
  createInstructor,
  promoteUser,
  registerUser,
  signIn,
  signOut,
} from "../helpers/auth";
import { createQmCourseForInstructor } from "../helpers/qm-courses";

const QM = QM_BACKEND_URL;

type QmFixture = {
  ctx: APIRequestContext;
  qmCourseId: number;
  coreCourseId: string;
  topicId: string;
};

async function bodyData(response: { json(): Promise<any> }): Promise<any> {
  const body = await response.json();
  return body?.data ?? body;
}

async function createInstructorFixture(
  playwright: { request: { newContext: () => Promise<APIRequestContext> } },
  prefix: string,
): Promise<QmFixture> {
  const ctx = await playwright.request.newContext();
  await createInstructor(ctx, { prefix });
  const course = await createQmCourseForInstructor(playwright, ctx, {
    name: `QM workflow ${prefix}`,
    code: `QMW-${prefix}`,
  });

  const topicsRes = await ctx.get(`${QM}/api/course/${course.qmCourseId}/topics`);
  expect(topicsRes.status()).toBe(200);
  const topics = await bodyData(topicsRes);
  let topic = topics[0];
  if (!topic) {
    const createTopic = await ctx.post(`${QM}/api/course/${course.qmCourseId}/topics`, {
      data: { name: `Workflow topic ${prefix}` },
    });
    expect(createTopic.status()).toBe(201);
    topic = await bodyData(createTopic);
  }

  return { ctx, ...course, topicId: topic.id };
}

async function createQuestion(
  ctx: APIRequestContext,
  qmCourseId: number,
  topicId: string,
  description = "Workflow question",
): Promise<any> {
  const response = await ctx.post(`${QM}/api/questions`, {
    data: {
      courseId: qmCourseId,
      primaryTopicId: topicId,
      description,
      type: "MCQ",
      isDraft: true,
    },
  });
  expect(response.status()).toBe(201);
  return bodyData(response);
}

async function createAssessment(
  ctx: APIRequestContext,
  qmCourseId: number,
  name = "Workflow quiz",
): Promise<any> {
  const response = await ctx.post(`${QM}/api/assessments`, {
    data: { courseId: qmCourseId, type: "Quiz", name, description: "Workflow assessment" },
  });
  expect(response.status()).toBe(201);
  return bodyData(response);
}

test.describe("Question Maker course and onboarding workflows", () => {
  test("INSTRUCTOR opens a linked course, topics, roster, and access status", async ({
    playwright,
  }) => {
    const fixture = await createInstructorFixture(playwright, "course-read");
    try {
      const course = await fixture.ctx.get(
        `${QM}/api/course/${fixture.qmCourseId}?includeDetails=true`,
      );
      expect(course.status()).toBe(200);
      expect((await bodyData(course)).id).toBe(fixture.qmCourseId);

      const access = await fixture.ctx.get(`${QM}/api/course/${fixture.qmCourseId}/access`);
      expect(access.status()).toBe(200);
      expect(await bodyData(access)).toMatchObject({ level: "instructor", rank: 2 });

      const roster = await fixture.ctx.get(`${QM}/api/course/${fixture.qmCourseId}/enrollments`);
      expect(roster.status()).toBe(200);
      expect(Array.isArray(await bodyData(roster))).toBe(true);

      const sync = await fixture.ctx.get(`${QM}/api/topics/sync-status/${fixture.qmCourseId}`);
      expect(sync.status()).toBe(200);
      expect((await bodyData(sync)).localCount).toBeGreaterThan(0);
    } finally {
      await fixture.ctx.dispose();
    }
  });

  test("INSTRUCTOR creates, lists, updates, and removes a question bank", async ({
    playwright,
  }) => {
    const fixture = await createInstructorFixture(playwright, "bank-lifecycle");
    try {
      const banks = await fixture.ctx.get(`${QM}/api/course/${fixture.qmCourseId}/banks`);
      expect(banks.status()).toBe(200);

      const created = await fixture.ctx.post(`${QM}/api/course/${fixture.qmCourseId}/banks`, {
        data: { name: "Workflow bank", description: "Bank created by E2E" },
      });
      expect(created.status()).toBe(201);
      const bank = await bodyData(created);

      const updated = await fixture.ctx.put(
        `${QM}/api/course/${fixture.qmCourseId}/banks/${bank.id}`,
        { data: { name: "Renamed workflow bank" } },
      );
      expect(updated.status()).toBe(200);
      expect((await bodyData(updated)).name).toBe("Renamed workflow bank");

      const question = await createQuestion(fixture.ctx, fixture.qmCourseId, fixture.topicId);
      const add = await fixture.ctx.post(
        `${QM}/api/course/${fixture.qmCourseId}/banks/${bank.id}/questions`,
        { data: { questionMetadataId: question.id } },
      );
      expect(add.status()).toBe(201);

      const remove = await fixture.ctx.delete(
        `${QM}/api/course/${fixture.qmCourseId}/banks/${bank.id}/questions/${question.id}`,
      );
      expect(remove.status()).toBe(200);

      const deleted = await fixture.ctx.delete(
        `${QM}/api/course/${fixture.qmCourseId}/banks/${bank.id}`,
      );
      expect(deleted.status()).toBe(200);
    } finally {
      await fixture.ctx.dispose();
    }
  });
});

test.describe("Question Maker question authoring workflows", () => {
  test("INSTRUCTOR creates, edits, filters, exports, and deletes question content", async ({
    playwright,
  }) => {
    const fixture = await createInstructorFixture(playwright, "question-lifecycle");
    try {
      const question = await createQuestion(
        fixture.ctx,
        fixture.qmCourseId,
        fixture.topicId,
        "Original workflow question",
      );

      const list = await fixture.ctx.get(
        `${QM}/api/questions?courseId=${fixture.qmCourseId}&search=Original&limit=100`,
      );
      expect(list.status()).toBe(200);
      expect((await bodyData(list)).items.some((item: any) => item.id === question.id)).toBe(true);

      const stats = await fixture.ctx.get(
        `${QM}/api/questions/stats?courseId=${fixture.qmCourseId}`,
      );
      expect(stats.status()).toBe(200);
      expect((await bodyData(stats)).totalQuestions).toBeGreaterThanOrEqual(1);

      const updated = await fixture.ctx.put(`${QM}/api/questions/${question.id}`, {
        data: { description: "Updated workflow question", type: "SA" },
      });
      expect(updated.status()).toBe(200);

      const jsonExport = await fixture.ctx.get(
        `${QM}/api/questions/export?courseId=${fixture.qmCourseId}&format=json`,
      );
      expect(jsonExport.status()).toBe(200);
      expect(Array.isArray(await bodyData(jsonExport))).toBe(true);

      const csvExport = await fixture.ctx.get(
        `${QM}/api/questions/export?courseId=${fixture.qmCourseId}&format=csv`,
      );
      expect(csvExport.status()).toBe(200);
      expect(await csvExport.text()).toContain("questionId");

      const deleted = await fixture.ctx.delete(`${QM}/api/questions/${question.id}`);
      expect(deleted.status()).toBe(200);
    } finally {
      await fixture.ctx.dispose();
    }
  });

  test("INSTRUCTOR creates, reviews, edits, and removes a draft variant", async ({
    playwright,
  }) => {
    const fixture = await createInstructorFixture(playwright, "variant-lifecycle");
    try {
      const question = await createQuestion(fixture.ctx, fixture.qmCourseId, fixture.topicId);
      const created = await fixture.ctx.post(`${QM}/api/questions/${question.id}/variants`, {
        data: {
          questionText: "Draft variant text",
          difficulty: "medium",
          reasoningLevel: "analytical",
          answer: "A",
          choices: [
            { letter: "A", text: "Correct" },
            { letter: "B", text: "Other" },
          ],
          isDraft: true,
        },
      });
      expect(created.status()).toBe(201);
      const variant = await bodyData(created);

      const listed = await fixture.ctx.get(`${QM}/api/questions/${question.id}/variants`);
      expect(listed.status()).toBe(200);
      expect((await bodyData(listed)).items.some((item: any) => item.id === variant.id)).toBe(true);

      const updated = await fixture.ctx.put(`${QM}/api/questions/variants/${variant.id}`, {
        data: { questionText: "Edited draft variant", difficulty: "hard" },
      });
      expect(updated.status()).toBe(200);

      const deleted = await fixture.ctx.delete(`${QM}/api/questions/variants/${variant.id}`);
      expect(deleted.status()).toBe(200);
    } finally {
      await fixture.ctx.dispose();
    }
  });
});

test.describe("Question Maker assessment workflows", () => {
  test("INSTRUCTOR builds, edits, composes, and removes an assessment", async ({ playwright }) => {
    const fixture = await createInstructorFixture(playwright, "assessment-lifecycle");
    try {
      const question = await createQuestion(fixture.ctx, fixture.qmCourseId, fixture.topicId);
      const variantRes = await fixture.ctx.post(`${QM}/api/questions/${question.id}/variants`, {
        data: { questionText: "Assessment variant", isDraft: true },
      });
      expect(variantRes.status()).toBe(201);
      const variant = await bodyData(variantRes);
      const assessment = await createAssessment(fixture.ctx, fixture.qmCourseId);

      const read = await fixture.ctx.get(`${QM}/api/assessments/${assessment.id}`);
      expect(read.status()).toBe(200);
      const update = await fixture.ctx.put(`${QM}/api/assessments/${assessment.id}`, {
        data: { name: "Updated workflow quiz", type: "Quiz", courseId: fixture.qmCourseId },
      });
      expect(update.status()).toBe(200);

      const sectionRes = await fixture.ctx.post(`${QM}/api/assessments/${assessment.id}/sections`, {
        data: { name: "Section 1", description: "Workflow section" },
      });
      expect(sectionRes.status()).toBe(201);
      const section = await bodyData(sectionRes);

      const link = await fixture.ctx.post(
        `${QM}/api/assessments/${assessment.id}/sections/${section.id}/variants`,
        { data: { variantId: variant.id, displayOrder: 1 } },
      );
      expect(link.status()).toBe(201);

      const questions = await fixture.ctx.get(`${QM}/api/assessments/${assessment.id}/questions`);
      expect(questions.status()).toBe(200);
      const sections = await fixture.ctx.get(`${QM}/api/assessments/${assessment.id}/sections`);
      expect(sections.status()).toBe(200);

      const reorder = await fixture.ctx.put(
        `${QM}/api/assessments/${assessment.id}/sections/reorder`,
        { data: { sectionIds: [section.id] } },
      );
      expect(reorder.status()).toBe(200);

      const removeVariant = await fixture.ctx.delete(
        `${QM}/api/assessments/${assessment.id}/sections/${section.id}/variants/${variant.id}`,
      );
      expect(removeVariant.status()).toBe(200);
      const removeSection = await fixture.ctx.delete(
        `${QM}/api/assessments/${assessment.id}/sections/${section.id}`,
      );
      expect(removeSection.status()).toBe(200);
      const removeAssessment = await fixture.ctx.delete(`${QM}/api/assessments/${assessment.id}`);
      expect(removeAssessment.status()).toBe(200);
    } finally {
      await fixture.ctx.dispose();
    }
  });

  test("INSTRUCTOR reads blueprint, readiness, and study-role workflows", async ({
    playwright,
  }) => {
    const fixture = await createInstructorFixture(playwright, "assessment-variants");
    try {
      const assessment = await createAssessment(fixture.ctx, fixture.qmCourseId, "Baseline exam");
      const role = await fixture.ctx.patch(
        `${QM}/api/assessment-variant/assessments/${assessment.id}/role`,
        { data: { studyRole: "reference_baseline" } },
      );
      expect(role.status()).toBe(200);

      const snapshot = await fixture.ctx.get(
        `${QM}/api/assessment-variant/assessments/${assessment.id}/blueprint-snapshot`,
      );
      expect(snapshot.status()).toBe(200);
      const readiness = await fixture.ctx.get(
        `${QM}/api/assessment-variant/assessments/${assessment.id}/variant-readiness?courseId=${fixture.qmCourseId}`,
      );
      expect(readiness.status()).toBe(200);
    } finally {
      await fixture.ctx.dispose();
    }
  });
});

test.describe("Question Maker AI, Canvas, and administration workflows", () => {
  test("INSTRUCTOR can read AI course, topic, and model availability", async ({ playwright }) => {
    const fixture = await createInstructorFixture(playwright, "ai-discovery");
    try {
      const courses = await fixture.ctx.get(`${QM}/api/eduai/courses`);
      expect(courses.status()).toBe(200);
      const topics = await fixture.ctx.get(
        `${QM}/api/eduai/courses/${fixture.coreCourseId}/topics`,
      );
      expect([200, 404]).toContain(topics.status());
      const models = await fixture.ctx.get(`${QM}/api/eduai/ai-models`);
      expect(models.status()).toBe(200);
    } finally {
      await fixture.ctx.dispose();
    }
  });

  test("ADMIN reads QM bug reports and an instructor can submit one", async ({ playwright }) => {
    const instructor = await playwright.request.newContext();
    const admin = await playwright.request.newContext();
    try {
      await createInstructor(instructor, { prefix: "qm-bug-instructor" });
      await createAdmin(admin, { prefix: "qm-bug-admin" });
      const report = await instructor.post(`${QM}/api/bug-reports`, {
        data: { description: "Reported from a QM workflow" },
      });
      expect([201, 502, 503]).toContain(report.status());
      const list = await admin.get(`${QM}/api/admin/bug-reports`);
      expect([200, 502]).toContain(list.status());
    } finally {
      await instructor.dispose();
      await admin.dispose();
    }
  });

  test("ADMIN, UNIT_ADMIN, and INSTRUCTOR sessions are recognized by QM", async ({
    playwright,
  }) => {
    const contexts = await Promise.all([
      playwright.request.newContext(),
      playwright.request.newContext(),
      playwright.request.newContext(),
    ]);
    try {
      await createAdmin(contexts[0], { prefix: "qm-role-admin" });
      await createInstructor(contexts[1], { prefix: "qm-role-instructor" });
      const unit = await registerUser(contexts[2], { prefix: "qm-role-unit" });
      await promoteUser(contexts[2], unit.email, "UNIT_ADMIN");
      await signOut(contexts[2]);
      await signIn(contexts[2], { email: unit.email, password: unit.password });

      for (const [ctx, role] of [
        [contexts[0], "ADMIN"],
        [contexts[1], "INSTRUCTOR"],
        [contexts[2], "UNIT_ADMIN"],
      ] as const) {
        const me = await ctx.get(`${QM}/api/auth/me`);
        expect(me.status()).toBe(200);
        expect((await bodyData(me)).user.role).toBe(role);
      }
    } finally {
      await Promise.all(contexts.map((ctx) => ctx.dispose()));
    }
  });
});

test.describe("Question Maker TA and Student role paths", () => {
  test("STUDENT sees course access as denied and cannot enter authoring routes", async ({
    playwright,
  }) => {
    const instructor = await createInstructorFixture(playwright, "student-boundary");
    const student = await playwright.request.newContext();
    try {
      await registerUser(student, { prefix: "qm-student-boundary" });
      const access = await student.get(`${QM}/api/course/${instructor.qmCourseId}/access`);
      expect(access.status()).toBe(200);
      expect(await bodyData(access)).toBeNull();

      const course = await student.get(`${QM}/api/course/${instructor.qmCourseId}`);
      expect(course.status()).toBe(403);
      const questions = await student.get(`${QM}/api/questions`);
      expect(questions.status()).toBe(403);
      const assessments = await student.get(`${QM}/api/assessments`);
      expect(assessments.status()).toBe(403);
    } finally {
      await instructor.ctx.dispose();
      await student.dispose();
    }
  });

  test("TA reads a course roster/topics and can use the approval shell workflow", async ({
    playwright,
  }) => {
    const fixture = await createInstructorFixture(playwright, "ta-workflow");
    const admin = await playwright.request.newContext();
    const ta = await playwright.request.newContext();
    try {
      await createAdmin(admin, { prefix: "qm-ta-admin" });
      const taUser = await registerUser(ta, { prefix: "qm-ta-user" });
      const taId = (await (await ta.get(`${CORE_URL}/api/me`)).json()).id;
      const enrollment = await admin.post(
        `${CORE_URL}/api/courses/${fixture.coreCourseId}/enrollments`,
        {
          data: { userId: taId, role: "TA" },
        },
      );
      expect(enrollment.status()).toBe(201);

      const access = await ta.get(`${QM}/api/course/${fixture.qmCourseId}/access`);
      expect(access.status()).toBe(200);
      expect(await bodyData(access)).toMatchObject({ level: "ta", rank: 1 });
      const course = await ta.get(`${QM}/api/course/${fixture.qmCourseId}`);
      expect(course.status()).toBe(200);
      const topics = await ta.get(`${QM}/api/course/${fixture.qmCourseId}/topics`);
      expect(topics.status()).toBe(200);

      const approved = await ta.post(`${QM}/api/questions/approve`, {
        data: {
          courseId: fixture.qmCourseId,
          questions: [
            {
              description: "TA-approved question shell",
              type: "MCQ",
              primaryTopicId: fixture.topicId,
            },
          ],
        },
      });
      expect(approved.status()).toBe(201);
      expect((await bodyData(approved)).length).toBe(1);
      void taUser;
    } finally {
      await fixture.ctx.dispose();
      await admin.dispose();
      await ta.dispose();
    }
  });
});
