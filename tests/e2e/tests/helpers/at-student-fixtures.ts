/**
 * Fixtures for the AI Tutor STUDENT workflow specs.
 *
 * The student workflows are walked through the real browser (methodology step
 * 2 in `docs/end-to-end-user-workflows/README.md`); this module builds the
 * enrolled-and-published state those walks need.
 *
 * A student only ever *sees* a course when three things line up: the course is
 * published in both Core and AI Tutor, the module and lesson under test are
 * published (publish cascades downward, never up), and the student is enrolled
 * in both Core and AI Tutor's throttled `CourseEnrollment` mirror. `seedAtCourse`
 * covers the first; this helper covers the last two, then signs the browser in
 * as the enrolled student so `page` and `page.request` share one session.
 */
import { expect, type Page } from "@playwright/test";
import { AI_TUTOR_API_URL, AI_TUTOR_URL, CORE_URL } from "../../playwright.config";
import { registerUser } from "./auth";
import { seedCourseWithActivity, type SeededCourse } from "./at-admin-fixtures";
import { gotoAiTutor } from "./at-ui";

const AT = AI_TUTOR_API_URL;

type RequestFixture = {
  request: { newContext: () => Promise<import("@playwright/test").APIRequestContext> };
};

export type EnrolledStudentCourse = SeededCourse & {
  moduleId: number;
  lessonId: number;
  activityId: number;
  question: string;
  topicIds: string[];
  student: { email: string; password: string; name: string };
  studentId: string;
};

/**
 * Register a fresh STUDENT on the browser's own request context (so the page
 * carries their session), seed a fully published course → module → lesson →
 * MCQ activity owned by a *different* instructor, and enrol the student in
 * both Core and AI Tutor's mirror.
 *
 * `publish` defaults to true — a student walking the UI needs to see content.
 */
export async function seedEnrolledStudentCourse(
  page: Page,
  playwright: RequestFixture,
  opts: {
    name?: string;
    codePrefix?: string;
    topics?: string[];
    question?: string;
  } = {},
): Promise<EnrolledStudentCourse> {
  const { student, studentId } = await registerStudent(page);
  const seeded = await seedPublishedCourseAndEnroll(playwright, studentId, opts);
  return { ...seeded, student, studentId };
}

/** Register a fresh STUDENT on the browser's own request context. */
export async function registerStudent(
  page: Page,
): Promise<{ student: { email: string; password: string; name: string }; studentId: string }> {
  const student = await registerUser(page.request, { name: "E2E Student", prefix: "at-student" });
  const { id: studentId } = await (await page.request.get(`${CORE_URL}/api/me`)).json();
  return { student, studentId };
}

/**
 * Seed a fully published course → module → lesson → MCQ activity owned by a
 * separate instructor/admin, then enrol `studentId` in both Core and AI Tutor.
 * Does not touch the browser session — pair it with `registerStudent`.
 */
export async function seedPublishedCourseAndEnroll(
  playwright: RequestFixture,
  studentId: string,
  opts: {
    name?: string;
    codePrefix?: string;
    topics?: string[];
    question?: string;
    term?: string;
    role?: "STUDENT" | "TA";
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
  const enrollRole = opts.role ?? "STUDENT";
  const seeded = await seedCourseWithActivity(playwright, {
    name: opts.name ?? "Student Walkthrough Course",
    codePrefix: opts.codePrefix ?? "STU",
    topics: opts.topics ?? ["Recursion", "Complexity"],
    publish: true,
    question: opts.question,
    term: opts.term,
  });

  // Publish the module and lesson (publish cascades down, so both are needed
  // before the lesson's activities are visible to a student).
  expect((await seeded.admin.patch(`${AT}/api/modules/${seeded.moduleId}/publish`)).status()).toBe(
    200,
  );
  expect((await seeded.admin.patch(`${AT}/api/lessons/${seeded.lessonId}/publish`)).status()).toBe(
    200,
  );

  // Enrol in Core and in AI Tutor's mirror. The mirror is refreshed from Core
  // by a throttled sync-on-read the import already consumed, so write it
  // directly (idempotent upsert) rather than hoping the next read syncs it.
  expect(
    (
      await seeded.admin.post(`${CORE_URL}/api/courses/${seeded.coreCourseId}/enrollments`, {
        data: { userId: studentId, role: enrollRole },
      })
    ).status(),
  ).toBe(201);
  expect(
    (
      await seeded.admin.post(`${AT}/api/admin/courses/${seeded.atCourseId}/enrollments`, {
        data: { userId: studentId, role: enrollRole },
      })
    ).status(),
  ).toBe(201);

  return seeded;
}

/**
 * Enrol `studentId` in an already-seeded course (Core + AI Tutor mirror).
 * Use with `seedAtCourse` when a spec needs to control the course's content
 * (e.g. a published course with no modules for an empty-state walk).
 */
export async function enrollStudent(seeded: SeededCourse, studentId: string): Promise<void> {
  expect(
    (
      await seeded.admin.post(`${CORE_URL}/api/courses/${seeded.coreCourseId}/enrollments`, {
        data: { userId: studentId, role: "STUDENT" },
      })
    ).status(),
  ).toBe(201);
  expect(
    (
      await seeded.admin.post(`${AT}/api/admin/courses/${seeded.atCourseId}/enrollments`, {
        data: { userId: studentId, role: "STUDENT" },
      })
    ).status(),
  ).toBe(201);
}

/** Navigate the (already-authenticated) student to an AI Tutor path. */
export async function gotoAsStudent(page: Page, path: string): Promise<void> {
  await gotoAiTutor(page, path);
}

/**
 * Seed a browser-local BYOK provider key so `StudentAiChat` treats the chat as
 * connected (`hasApiKey`) and renders the composer, mode chips, knowledge-level
 * chips and topic select — the paths that are otherwise hidden behind the
 * "Connect an AI provider" empty state.
 *
 * This does NOT make the tutor loop able to answer: a real streamed reply needs
 * a live model provider, which the e2e stack has none of. It only unlocks the
 * chat's client-side surface for walking. The storage key mirrors
 * `provider-keys.ts` (`ai-provider-keys:v2:<userId>`), default provider "google".
 */
export async function seedByokKey(
  page: Page,
  studentId: string,
  opts: { provider?: string; key?: string } = {},
): Promise<void> {
  const provider = opts.provider ?? "google";
  const key = opts.key ?? "e2e-fake-byok-key-000000000000";
  await page.addInitScript(
    ([uid, prov, k]) => {
      try {
        window.localStorage.setItem(
          `ai-provider-keys:v2:${encodeURIComponent(uid)}`,
          JSON.stringify({ [prov]: k }),
        );
      } catch {
        /* private mode — the connect-a-provider path is what runs instead */
      }
    },
    [studentId, provider, key] as const,
  );
}

export { AI_TUTOR_URL };
