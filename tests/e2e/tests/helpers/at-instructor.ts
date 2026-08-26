/**
 * INSTRUCTOR fixture builder for the AI Tutor E2E suite.
 *
 * Why a dedicated helper: `createInstructor` (helpers/auth) only sets the
 * platform role, and the platform role on its own gets an instructor *nothing*
 * in AI Tutor. Course scope for INSTRUCTOR resolves through Core enrollments —
 * `resolveCourseAccess` keeps only the courses Core reports with
 * `callerEnrollmentRole === "INSTRUCTOR"` (server/src/services/courseAccess.js).
 * So a usable instructor needs courses created in Core with their user id in
 * `instructorUserIds`, then mirrored into AI Tutor via
 * `POST /api/courses/import-external` (AI Tutor never creates courses — #632).
 *
 * What it builds, so a spec can assert on both sides of the teaching boundary:
 *   - an INSTRUCTOR who teaches `course`;
 *   - `course` — a course this instructor is enrolled on as INSTRUCTOR;
 *   - `foreign` — a course taught by a *different* instructor, which this one
 *     must not be able to reach. It is deliberately in the same department as
 *     `course`: instructor scope is per-enrollment, not per-unit, so a
 *     same-department control proves the denial comes from the enrollment set
 *     rather than from a department filter that happens to agree.
 *
 * The returned `request` context is re-authenticated as the instructor, and
 * `otherCtx` stays open so specs can act as the *other* instructor (e.g. to
 * verify the foreign course really exists and is reachable by its owner).
 * Call `dispose()` when done.
 */
import { expect, type APIRequestContext } from "@playwright/test";
import { AI_TUTOR_API_URL, CORE_URL } from "../../playwright.config";
import { createAdmin, createInstructor, registerUser, signIn, signOut } from "./auth";
import type { AtFixtureCourse } from "./at-unit-admin";
import { atCourseTopicIds, seedLesson, seedMcqActivity, seedModule } from "./at-admin-fixtures";

const AT = AI_TUTOR_API_URL;
const RUN = Date.now().toString().slice(-5);

/** Department used for every course this helper creates. Must exist in Core's `Discipline` table. */
export const INSTRUCTOR_DEPARTMENT = "COSC";

type PlaywrightRequestFixture = {
  request: { newContext: () => Promise<APIRequestContext> };
};

export type { AtFixtureCourse };

export interface InstructorFixture {
  email: string;
  password: string;
  name: string;
  id: string;
  /** Course this instructor is enrolled on as INSTRUCTOR — the one they can manage. */
  course: AtFixtureCourse;
  /** Course taught by someone else — this instructor must be denied it. */
  foreign: AtFixtureCourse;
  /**
   * Second course this instructor teaches, present only with `secondCourse: true`.
   * Its name is deliberately distinct from `course.name` so a <Select> option
   * can be picked by exact title (module import, breadcrumb course switcher,
   * the command palette's "Switch course" group).
   */
  second?: AtFixtureCourse;
  /** Topic name seeded into `course` in Core, present only with `seedTopic: true`. */
  seededTopic?: string;
  /** Authenticated request context for the INSTRUCTOR who owns `foreign`. */
  otherCtx: APIRequestContext;
  /**
   * Authenticated ADMIN context, kept open for the Core-side setup an
   * instructor cannot do themselves: publishing a course, enrolling a student,
   * and writing AI Tutor's enrollment mirror (`seedInstructorSubmission`).
   */
  adminCtx: APIRequestContext;
  dispose(): Promise<void>;
}

export interface CreateTeachingInstructorOptions {
  /**
   * Publish `course` in Core before returning. AI Tutor's publish cascade
   * refuses to publish a module whose parent course is unpublished, and course
   * publish state is owned by Core — so any spec that publishes content needs
   * this.
   */
  publishCourse?: boolean;
  /**
   * Mirror a second taught course. Needed by any flow that has to name
   * *another* course this instructor can reach — module import's "copy from"
   * picker, the breadcrumb course switcher, the palette's course switch.
   */
  secondCourse?: boolean;
  /**
   * Create a topic on `course` through Core. AI Tutor auto-syncs topics from
   * Core on every `GET /topics`, so this is the only way to get a non-empty
   * topic list onto an imported course.
   *
   * Without it a course has zero topics and the activity form's topic pickers
   * are disabled for *everyone* (`AddActivityPanel` disables on
   * `topics.length === 0`), which would make "the picker is disabled" useless
   * as evidence of anything role-specific.
   */
  seedTopic?: boolean;
}

/**
 * Register a user, promote them to INSTRUCTOR, and mirror the courses they
 * teach (plus one they do not) into AI Tutor.
 *
 * `ctx` is left signed in as the instructor.
 */
export async function createTeachingInstructor(
  playwright: PlaywrightRequestFixture,
  ctx: APIRequestContext,
  opts: CreateTeachingInstructorOptions = {},
): Promise<InstructorFixture> {
  const user = await registerUser(ctx, { name: "E2E Instructor", prefix: "instructor" });
  const me = await (await ctx.get(`${CORE_URL}/api/me`)).json();

  const adminCtx = await playwright.request.newContext();
  const otherCtx = await playwright.request.newContext();

  let course: AtFixtureCourse;
  let foreign: AtFixtureCourse;
  let second: AtFixtureCourse | undefined;
  let seededTopic: string | undefined;
  {
    await createAdmin(adminCtx, { prefix: "instr-admin" });

    // Core's ADMIN-only user API rather than `/api/e2e/promote`: same result for
    // the role, but it is the path the platform actually uses and it validates.
    const promoteRes = await adminCtx.patch(`${CORE_URL}/api/users/${me.id}`, {
      data: { role: "INSTRUCTOR" },
    });
    expect(
      promoteRes.status(),
      `PATCH /api/users/:id → INSTRUCTOR: ${await promoteRes.text()}`,
    ).toBe(200);

    // The owner of `foreign`. A second real instructor, not an admin, so the
    // control course is scoped exactly the way the fixture instructor's own is.
    await createInstructor(otherCtx, { prefix: "instr-other" });
    const otherMe = await (await otherCtx.get(`${CORE_URL}/api/me`)).json();

    /**
     * Create a course in Core assigned to `teacherId`, then mirror it into AI
     * Tutor as that teacher (the import is scoped to the caller's enrollments).
     */
    const mirror = async (
      teacherId: string,
      teacherCtx: APIRequestContext,
      codePrefix: string,
      name: string,
      topicName?: string,
    ): Promise<AtFixtureCourse> => {
      const coreRes = await adminCtx.post(`${CORE_URL}/api/courses`, {
        form: {
          name,
          code: `${codePrefix}-${RUN}-${Math.floor(Math.random() * 1e4)}`,
          section: "001",
          term: "W1",
          year: "2026",
          startDate: "2026-09-08",
          department: INSTRUCTOR_DEPARTMENT,
          instructorUserIds: teacherId,
        },
      });
      expect(coreRes.status(), `Core course create (${codePrefix}): ${await coreRes.text()}`).toBe(
        201,
      );
      const core = await coreRes.json();

      // Seed the topic BEFORE the import, not after. AI Tutor pulls topics from
      // Core on `GET /topics` but throttles that pull to one per course per
      // `AUTO_SYNC_TTL_MS`, and the import performs the first pull — so a topic
      // added afterwards stays invisible until the window expires, and every
      // read in a test run serves the empty mirror the import captured.
      if (topicName) {
        const topicRes = await adminCtx.post(`${CORE_URL}/api/courses/${core.id}/topics`, {
          data: { name: topicName },
        });
        expect(topicRes.status(), `Core topic create: ${await topicRes.text()}`).toBe(201);
      }

      // Import is an idempotent ensure: 201 = created here, 200 = the throttled
      // background mirror won the race and anchored it first (see at-courses.ts).
      const importRes = await teacherCtx.post(`${AT}/api/courses/import-external`, {
        data: { externalCourseId: core.id },
      });
      expect([200, 201]).toContain(importRes.status());
      const at = await importRes.json();

      return {
        coreCourseId: core.id,
        atCourseId: at.id,
        code: core.code,
        name: core.name,
        department: INSTRUCTOR_DEPARTMENT,
      };
    };

    if (opts.seedTopic) {
      seededTopic = `E2E Instructor Topic ${RUN}-${Math.floor(Math.random() * 1e4)}`;
    }

    course = await mirror(me.id, ctx, "INTEACH", `Instructor E2E ${RUN}`, seededTopic);
    foreign = await mirror(otherMe.id, otherCtx, "INFOREIGN", `Foreign Instructor E2E ${RUN}`);

    if (opts.secondCourse) {
      // The second course gets the topic too when one was asked for: an import
      // *source* needs a full spine (module → lesson → activity), and an
      // activity cannot be authored into a course with no topics.
      second = await mirror(
        me.id,
        ctx,
        "INSRC",
        `Instructor Import Source E2E ${RUN}`,
        seededTopic,
      );
    }

    if (opts.publishCourse) {
      const pub = await adminCtx.patch(`${CORE_URL}/api/courses/${course.coreCourseId}/publish`);
      expect(pub.status(), `Core publish: ${await pub.text()}`).toBe(200);

      // AI Tutor keeps its own `isPublished` flag per offering alongside Core's.
      // `POST /questions/:id/answer` gates on Core's *live* state, but the UI
      // and the module publish cascade read AI Tutor's — publish both, or a
      // course reads as Published in Core and Draft in the app.
      const atPub = await ctx.patch(`${AT}/api/courses/${course.atCourseId}/publish`);
      expect(atPub.status(), `AT publish: ${await atPub.text()}`).toBe(200);
    }
  }

  // Re-authenticate so the caller's context carries the INSTRUCTOR role.
  await signOut(ctx);
  await signIn(ctx, { email: user.email, password: user.password });

  return {
    ...user,
    id: me.id,
    course,
    foreign,
    second,
    seededTopic,
    otherCtx,
    adminCtx,
    dispose: async () => {
      await otherCtx.dispose();
      await adminCtx.dispose();
    },
  };
}

/**
 * Give an instructor's course a full content spine — module → lesson → MCQ
 * activity — authored by the instructor themselves.
 *
 * Most authoring, AI-config and grading workflows only become reachable once
 * that spine exists, and rebuilding it inline in each spec buries the actual
 * assertion under twenty lines of setup. Everything is created through the
 * instructor's own context, so it also doubles as evidence that the instructor
 * really can author in their own course.
 *
 * `publish` publishes the module and lesson as well. Publishing a lesson
 * requires its module *and* course to already be published (the cascade in
 * `instructor.module.tsx`), so pair it with
 * `createTeachingInstructor({ publishCourse: true })`.
 */
export async function seedInstructorSpine(
  instrCtx: APIRequestContext,
  fixture: InstructorFixture,
  opts: {
    publish?: boolean;
    question?: string;
    /**
     * Which taught course to build the spine in. Defaults to `fixture.course`;
     * pass `fixture.second!.atCourseId` to build the *source* side of an import
     * flow, which needs content in a course other than the destination.
     */
    atCourseId?: number;
  } = {},
): Promise<{
  moduleId: number;
  moduleTitle: string;
  lessonId: number;
  lessonTitle: string;
  activityId: number;
  question: string;
  topicIds: string[];
}> {
  const atCourseId = opts.atCourseId ?? fixture.course.atCourseId;
  const moduleTitle = `Instructor Spine Module ${RUN}-${Math.floor(Math.random() * 1e4)}`;
  const lessonTitle = `Instructor Spine Lesson ${RUN}-${Math.floor(Math.random() * 1e4)}`;

  // `publish` is read as a plain boolean by both seeders, so `false` and
  // "absent" already mean the same thing — no conditional spread needed.
  const publish = opts.publish ?? false;
  const module = await seedModule(instrCtx, atCourseId, { title: moduleTitle, publish });
  const lesson = await seedLesson(instrCtx, module.id, { title: lessonTitle, publish });

  // Reading topics is also what triggers AI Tutor's sync-on-read pull from
  // Core, so this is the call that makes `seedTopic` visible to the activity
  // form's main-topic picker.
  const topicIds = await atCourseTopicIds(instrCtx, atCourseId);
  expect(
    topicIds.length,
    "seedInstructorSpine needs a topic — build the fixture with { seedTopic: true }",
  ).toBeGreaterThan(0);

  // `seedMcqActivity` defaults `question`, so an undefined one is already the
  // right thing to pass — no conditional object needed around it.
  const activity = await seedMcqActivity(instrCtx, lesson.id, topicIds[0], {
    question: opts.question,
  });

  return {
    moduleId: module.id,
    moduleTitle,
    lessonId: lesson.id,
    lessonTitle,
    activityId: activity.id,
    question: activity.question,
    topicIds,
  };
}

/**
 * Enrol a fresh student in the instructor's Core course and have them answer an
 * activity, so the instructor has a real submission to grade.
 *
 * `answerOption` is an **index**, not a letter — `activityEvaluation.js` only
 * compares it when it is a number, so a letter silently records no answer.
 * The default (1) is the *wrong* choice for `seedMcqActivity`'s MCQ, which
 * leaves the attempt incorrect and therefore worth regrading.
 */
export async function seedInstructorSubmission(
  playwright: PlaywrightRequestFixture,
  fixture: InstructorFixture,
  activityId: number,
  opts: { answerOption?: number } = {},
): Promise<{ studentEmail: string; studentName: string; studentId: string }> {
  const studentCtx = await playwright.request.newContext();
  try {
    const student = await registerUser(studentCtx, {
      name: "E2E Instructor Student",
      prefix: "instr-student",
    });
    const { id: studentId } = await (await studentCtx.get(`${CORE_URL}/api/me`)).json();

    const enrollRes = await fixture.adminCtx.post(
      `${CORE_URL}/api/courses/${fixture.course.coreCourseId}/enrollments`,
      { data: { userId: studentId, role: "STUDENT" } },
    );
    expect(enrollRes.status(), `Core enroll: ${await enrollRes.text()}`).toBe(201);

    // AI Tutor answers against its own `CourseEnrollment` mirror, refreshed
    // from Core by a *throttled* sync-on-read (`AUTO_SYNC_TTL_MS`). The course
    // import already consumed that window, so a Core-only enrolment can still
    // read as "not enrolled" here. Write the mirror row directly through the
    // admin enrolment endpoint, which is an idempotent upsert.
    const mirrorRes = await fixture.adminCtx.post(
      `${AT}/api/admin/courses/${fixture.course.atCourseId}/enrollments`,
      { data: { userId: studentId, role: "STUDENT" } },
    );
    expect(mirrorRes.status(), `AT enroll mirror: ${await mirrorRes.text()}`).toBe(201);

    const answerRes = await studentCtx.post(`${AT}/api/questions/${activityId}/answer`, {
      data: { answerOption: opts.answerOption ?? 1 },
    });
    expect(answerRes.status(), `student answer: ${await answerRes.text()}`).toBe(200);

    return { studentEmail: student.email, studentName: student.name, studentId };
  } finally {
    await studentCtx.dispose();
  }
}
