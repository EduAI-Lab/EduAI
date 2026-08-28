/**
 * Data fixtures for the AI Tutor ADMIN workflow specs.
 *
 * The workflows themselves are walked through the browser; this module only
 * builds the state they need to walk *over*. Courses are deliberately owned by
 * a **different** instructor than the admin driving the UI — an admin seeing
 * and acting on someone else's course is the point of most of these paths
 * (`nav.ts`: "admin ⊇ instructor").
 *
 * Publish state has two sources: AI Tutor keeps its own `isPublished` flag per
 * offering, but `POST /questions/:id/answer` gates on Core's live publish state
 * (`isCoursePublishedLive`), so `seedAtCourse({ publish: true })` publishes in
 * both places.
 */
import { expect, type APIRequestContext } from "@playwright/test";
import { AI_TUTOR_API_URL, CORE_URL } from "../../playwright.config";
import { createAdmin, createInstructor, registerUser } from "./auth";

const AT = AI_TUTOR_API_URL;

type RequestFixture = { request: { newContext: () => Promise<APIRequestContext> } };

export type SeededCourse = {
  coreCourseId: string;
  atCourseId: number;
  code: string;
  name: string;
  term: string;
  /** Context authenticated as the course's owning instructor. */
  instructor: APIRequestContext;
  /** Context authenticated as a platform admin (for Core-side setup). */
  admin: APIRequestContext;
  dispose: () => Promise<void>;
};

function uniqueCode(prefix: string): string {
  return `${prefix}-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 1e3)}`;
}

/**
 * Create a Core course owned by a fresh instructor and mirror it into AI Tutor.
 *
 * `topics` are created on the Core course; AI Tutor pulls them in on its first
 * topic read (the sync-on-read seam in `server/src/routes/topics.js`), which is
 * what makes activity authoring possible — the add-activity dialog requires a
 * main topic.
 */
/** Options accepted by {@link seedAtCourse}; every field falls back to a default. */
export interface SeedAtCourseOptions {
  name?: string;
  codePrefix?: string;
  term?: string;
  topics?: string[];
  publish?: boolean;
}

export async function seedAtCourse(
  playwright: RequestFixture,
  opts: SeedAtCourseOptions = {},
): Promise<SeededCourse> {
  const instructor = await playwright.request.newContext();
  const admin = await playwright.request.newContext();

  await createInstructor(instructor, { prefix: "at-admin-fx-instr" });
  await createAdmin(admin, { prefix: "at-admin-fx-admin" });

  const { id: instructorId } = await (await instructor.get(`${CORE_URL}/api/me`)).json();
  const name = opts.name ?? "Admin Workflow Course";
  const code = uniqueCode(opts.codePrefix ?? "ADM");
  const term = opts.term ?? "W1";

  const coreRes = await admin.post(`${CORE_URL}/api/courses`, {
    form: {
      name,
      code,
      section: "001",
      term,
      year: "2026",
      startDate: "2026-09-08",
      department: "COSC",
      instructorUserIds: instructorId,
    },
  });
  expect(coreRes.status()).toBe(201);
  const { id: coreCourseId } = await coreRes.json();

  for (const topic of opts.topics ?? []) {
    const res = await admin.post(`${CORE_URL}/api/courses/${coreCourseId}/topics`, {
      data: { name: topic },
    });
    expect([201, 409]).toContain(res.status());
  }

  if (opts.publish) {
    expect((await admin.patch(`${CORE_URL}/api/courses/${coreCourseId}/publish`)).status()).toBe(
      200,
    );
  }

  const importRes = await instructor.post(`${AT}/api/courses/import-external`, {
    data: { externalCourseId: coreCourseId },
  });
  // 201 = this call anchored it, 200 = the background mirror got there first.
  expect([200, 201]).toContain(importRes.status());
  const { id: atCourseId } = await importRes.json();

  if (opts.publish) {
    expect((await admin.patch(`${AT}/api/courses/${atCourseId}/publish`)).status()).toBe(200);
  }

  return {
    coreCourseId,
    atCourseId,
    code,
    name,
    term,
    instructor,
    admin,
    dispose: async () => {
      await instructor.dispose();
      await admin.dispose();
    },
  };
}

/** Create a module in an AI Tutor course, optionally published. */
export async function seedModule(
  ctx: APIRequestContext,
  atCourseId: number,
  opts: { title?: string; publish?: boolean } = {},
): Promise<{ id: number; title: string }> {
  const title = opts.title ?? "Seeded Module";
  const res = await ctx.post(`${AT}/api/courses/${atCourseId}/modules`, { data: { title } });
  expect(res.status()).toBe(201);
  const module = await res.json();
  if (opts.publish) {
    expect((await ctx.patch(`${AT}/api/modules/${module.id}/publish`)).status()).toBe(200);
  }
  return { id: module.id, title };
}

/** Create a lesson in a module, optionally published. */
export async function seedLesson(
  ctx: APIRequestContext,
  moduleId: number,
  opts: { title?: string; publish?: boolean } = {},
): Promise<{ id: number; title: string }> {
  const title = opts.title ?? "Seeded Lesson";
  const res = await ctx.post(`${AT}/api/modules/${moduleId}/lessons`, { data: { title } });
  expect(res.status()).toBe(201);
  const lesson = await res.json();
  if (opts.publish) {
    expect((await ctx.patch(`${AT}/api/lessons/${lesson.id}/publish`)).status()).toBe(200);
  }
  return { id: lesson.id, title };
}

/** Read the AI Tutor topic ids for a course (which also triggers the Core sync). */
export async function atCourseTopicIds(
  ctx: APIRequestContext,
  atCourseId: number,
): Promise<string[]> {
  const res = await ctx.get(`${AT}/api/courses/${atCourseId}/topics?page=1&pageSize=50`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  const rows = Array.isArray(body?.data) ? body.data : body;
  return rows.map((t: { id: string }) => t.id);
}

/**
 * Create a two-choice MCQ activity whose first choice is correct.
 *
 * The wire contract is `CreateActivitySchema` (`shared/schemas/activity.js`):
 * choices go in `options` and the key goes in `answer`. An earlier version of
 * this helper sent `choices` / `correctIndex` / `modes` at the top level, which
 * Zod strips silently — the activity was created with `options: null` and
 * `answer: null`, so every seeded MCQ had no choices and no correct answer, and
 * any test that graded one was grading an unanswerable question.
 */
export async function seedMcqActivity(
  ctx: APIRequestContext,
  lessonId: number,
  mainTopicId: string,
  opts: { question?: string } = {},
): Promise<{ id: number; question: string }> {
  const question = opts.question ?? "Which case stops a recursion?";
  const res = await ctx.post(`${AT}/api/lessons/${lessonId}/activities`, {
    data: {
      question,
      type: "MCQ",
      options: ["The base case", "The recursive case"],
      answer: { correctIndex: 0 },
      mainTopicId,
      instructionsMd: "Answer the question.",
      enableTeachMode: true,
      enableGuideMode: true,
    },
  });
  expect(res.status()).toBe(201);
  const activity = await res.json();
  expect(activity.options?.choices ?? []).toHaveLength(2);
  return { id: activity.id, question };
}

/**
 * Create an open-ended SHORT_TEXT activity — no answer key, so a submission to
 * it cannot be auto-graded and lands in the staff "to review" grading queue
 * (`isCorrect: null`). This is the realistic source of an ungraded submission,
 * since MCQ and answer-keyed short-text both auto-grade on submit.
 */
export async function seedShortTextActivity(
  ctx: APIRequestContext,
  lessonId: number,
  mainTopicId: string,
  opts: { question?: string } = {},
): Promise<{ id: number; question: string }> {
  const question = opts.question ?? "Explain, in your own words, why the base case terminates.";
  const res = await ctx.post(`${AT}/api/lessons/${lessonId}/activities`, {
    data: {
      question,
      type: "SHORT_TEXT",
      // No `answer` — an open-ended prompt a human grades.
      mainTopicId,
      instructionsMd: "Answer in a sentence or two.",
      enableTeachMode: true,
      enableGuideMode: true,
    },
  });
  expect(res.status()).toBe(201);
  const activity = await res.json();
  return { id: activity.id, question };
}

/**
 * Enrol a fresh student in the Core course and have them answer an activity,
 * so course staff have a submission to grade.
 *
 * `answerOption` is an **index**, not a letter — `activityEvaluation.js` only
 * compares it when it is a number, so a letter silently records no answer.
 * Pass `answerText` instead to submit a short-text answer (e.g. to an
 * open-ended activity, which stays ungraded and enters the review queue).
 */
export async function seedStudentSubmission(
  playwright: RequestFixture,
  seeded: SeededCourse,
  activityId: number,
  opts: { answerOption?: number; answerText?: string } = {},
): Promise<{ studentEmail: string; studentName: string }> {
  const studentCtx = await playwright.request.newContext();
  try {
    const student = await registerUser(studentCtx, {
      name: "E2E Submitting Student",
      prefix: "at-admin-fx-student",
    });
    const { id: studentId } = await (await studentCtx.get(`${CORE_URL}/api/me`)).json();

    const enrollRes = await seeded.admin.post(
      `${CORE_URL}/api/courses/${seeded.coreCourseId}/enrollments`,
      { data: { userId: studentId, role: "STUDENT" } },
    );
    expect(enrollRes.status()).toBe(201);

    // AI Tutor answers against its own `CourseEnrollment` mirror, which is
    // refreshed from Core by a *throttled* sync-on-read (`AUTO_SYNC_TTL_MS`).
    // The import above already consumed that window, so a Core-only enrolment
    // can still read as "not enrolled" here. Write the mirror row directly via
    // the admin enrolment endpoint, which is an idempotent upsert.
    const mirrorRes = await seeded.admin.post(
      `${AT}/api/admin/courses/${seeded.atCourseId}/enrollments`,
      { data: { userId: studentId, role: "STUDENT" } },
    );
    expect(mirrorRes.status()).toBe(201);

    const answerBody =
      typeof opts.answerText === "string"
        ? { answerText: opts.answerText }
        : { answerOption: opts.answerOption ?? 1 };
    const answerRes = await studentCtx.post(`${AT}/api/questions/${activityId}/answer`, {
      data: answerBody,
    });
    expect(answerRes.status()).toBe(200);

    return { studentEmail: student.email, studentName: student.name };
  } finally {
    await studentCtx.dispose();
  }
}

/**
 * Seed a course that already has a module, a lesson, and one MCQ activity.
 *
 * Most authoring/AI-config workflows need that whole spine before the path
 * under test even becomes reachable, and rebuilding it inline in each spec
 * buries the actual assertion under twenty lines of setup.
 */
export async function seedCourseWithActivity(
  playwright: RequestFixture,
  opts: {
    name?: string;
    codePrefix?: string;
    topics?: string[];
    publish?: boolean;
    question?: string;
    term?: string;
  } = {},
): Promise<
  SeededCourse & {
    moduleId: number;
    lessonId: number;
    activityId: number;
    question: string;
    topicIds: string[];
  }
> {
  const topics = opts.topics ?? ["Recursion", "Complexity"];
  const seedOpts: SeedAtCourseOptions = {
    name: opts.name ?? "Activity Spine Course",
    codePrefix: opts.codePrefix ?? "SPIN",
    topics,
  };
  if (opts.term) seedOpts.term = opts.term;
  if (opts.publish) seedOpts.publish = true;
  const seeded = await seedAtCourse(playwright, seedOpts);

  const module = await seedModule(seeded.admin, seeded.atCourseId, { title: "Spine module" });
  const lesson = await seedLesson(seeded.admin, module.id, { title: "Spine lesson" });
  const topicIds = await atCourseTopicIds(seeded.admin, seeded.atCourseId);
  // `seedMcqActivity` defaults `question`, so an undefined one is already the
  // right thing to pass — no need to build a conditional object around it.
  const activity = await seedMcqActivity(seeded.admin, lesson.id, topicIds[0], {
    question: opts.question,
  });

  return {
    ...seeded,
    moduleId: module.id,
    lessonId: lesson.id,
    activityId: activity.id,
    question: activity.question,
    topicIds,
  };
}

/**
 * Seed a Core AI provider + two CHAT models so the admin console's loop-policy
 * editor has a catalogue to work with.
 *
 * The catalogue lives in Core (`POST /api/ai-models`, ADMIN-only) and AI Tutor
 * reads it through `GET /api/ai-models`. The e2e stack ships with an empty
 * `ai_models` table, so without this the allowlist renders "No AI models are
 * available yet" and the policy can never be saved.
 *
 * Both the models and the provider are platform-global, so `dispose` deletes
 * them again — otherwise the very next spec that asserts the empty catalogue
 * would see whatever this test left behind.
 */
export async function seedAiModelCatalogue(
  admin: APIRequestContext,
  opts: { count?: number } = {},
): Promise<{
  models: Array<{ id: string; modelId: string; tutorModelId: string; modelName: string }>;
  dispose: () => Promise<void>;
}> {
  // Core evaluates `session.user.role` on every write, and under parallel load
  // the freshly promoted session can still read as STUDENT for a moment — which
  // surfaces as a confusing 403 from the provider POST below. Wait for the role
  // to actually land first.
  await expect
    .poll(
      async () => {
        const me = await admin.get(`${CORE_URL}/api/me`);
        return me.ok() ? ((await me.json())?.role ?? null) : null;
      },
      { timeout: 15_000, message: "admin session never reported role ADMIN" },
    )
    .toBe("ADMIN");

  const suffix = `${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 1e3)}`;

  const providerName = `e2e-provider-${suffix}`;

  const providerRes = await admin.post(`${CORE_URL}/api/ai-providers`, {
    data: {
      name: providerName,
      displayName: `E2E Provider ${suffix}`,
      description: "Synthetic provider created by the AI Tutor admin e2e suite.",
      requiresApiKey: false,
      isActive: true,
    },
  });
  expect(providerRes.status()).toBe(201);
  const provider = await providerRes.json();

  const models: Array<{
    id: string;
    modelId: string;
    /** How AI Tutor addresses the model: `${provider.name}:${modelId}`. */
    tutorModelId: string;
    modelName: string;
  }> = [];
  for (let i = 0; i < (opts.count ?? 2); i += 1) {
    const modelId = `e2e/tutor-model-${suffix}-${i}`;
    const res = await admin.post(`${CORE_URL}/api/ai-models`, {
      data: {
        modelId,
        name: `E2E Tutor Model ${suffix}-${i}`,
        description: "Synthetic model created by the AI Tutor admin e2e suite.",
        type: "CHAT",
        isActive: true,
        providerId: provider.id,
      },
    });
    expect(res.status()).toBe(201);
    const model = await res.json();
    models.push({
      id: model.id,
      modelId,
      tutorModelId: `${providerName}:${modelId}`,
      modelName: model.name,
    });
  }

  return {
    models,
    dispose: async () => {
      for (const model of models) {
        await admin.delete(`${CORE_URL}/api/ai-models/${model.id}`);
      }
      await admin.delete(`${CORE_URL}/api/ai-providers/${provider.id}`);
    },
  };
}

/**
 * Snapshot the AI loop policy and hand back a restore function.
 *
 * The policy is one global `SystemSetting` row, so a spec that saves a new one
 * has to put the old one back or it leaks into every later run. `GET` answers
 * `{ policy, availableModels, ... }` while `PUT` takes the bare policy, hence
 * the unwrap.
 *
 * Restore is best-effort on purpose: `setAiModelPolicy` validates against the
 * *live* catalogue, so restoring a policy captured while the catalogue was
 * empty is rejected with 400 ("At least one tutor model must be allowed").
 * That is harmless — `resolveAiModelPolicy` re-derives the allowlist from the
 * catalogue whenever the stored ids no longer resolve.
 */
export async function captureAiPolicy(
  admin: APIRequestContext,
): Promise<{ restore: () => Promise<void> }> {
  const res = await admin.get(`${AT}/api/admin/settings/ai-model-policy`);
  const before = res.ok() ? ((await res.json())?.policy ?? null) : null;
  return {
    restore: async () => {
      if (!before) return;
      await admin.put(`${AT}/api/admin/settings/ai-model-policy`, { data: before });
    },
  };
}

/**
 * Pin the AI loop policy to a known baseline so a UI test is not at the mercy
 * of whatever a previous run left in the shared `SystemSetting` row.
 *
 * `tutorModelId` is AI Tutor's `${provider}:${modelId}` form — the id the
 * allowlist and both defaults are expressed in.
 */
export async function setAiPolicyBaseline(
  admin: APIRequestContext,
  tutorModelId: string,
): Promise<void> {
  // AI Tutor derives the caller's role by revalidating the Core cookie on every
  // request, so a freshly promoted session can still read as non-ADMIN here even
  // after Core itself reports ADMIN. Wait on *AI Tutor's* view of the role, not
  // Core's, or this 403s under load.
  await expect
    .poll(
      async () => {
        const me = await admin.get(`${AT}/api/me`);
        // AI Tutor wraps the user (`{ user: { role } }`); Core answers it flat.
        return me.ok() ? ((await me.json())?.user?.role ?? null) : null;
      },
      { timeout: 15_000, message: "AI Tutor never reported the session as ADMIN" },
    )
    .toBe("ADMIN");

  const res = await admin.put(`${AT}/api/admin/settings/ai-model-policy`, {
    data: {
      allowedTutorModelIds: [tutorModelId],
      defaultTutorModelId: tutorModelId,
      defaultSupervisorModelId: tutorModelId,
      dualLoopEnabled: true,
      maxSupervisorIterations: 3,
    },
  });
  expect(res.status()).toBe(200);
}
