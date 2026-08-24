/**
 * Course-scope guardrail happy-path workflows (#1522 / #1524).
 *
 * These use the same authenticated API surfaces that the Course Manager UI
 * calls, while keeping each role/settings combination isolated in its own
 * course. That makes a failing workflow point at one user journey instead of
 * depending on state left by a previous test.
 */
import { test, expect, type APIRequestContext } from "@playwright/test";
import { CORE_URL } from "../../playwright.config";
import { createAdmin, createInstructor, registerUser } from "../helpers/auth";

type CourseFixture = {
  admin: APIRequestContext;
  instructor: APIRequestContext;
  courseId: string;
};

let runCounter = 0;

function uniqueCourseCode(prefix: string): string {
  runCounter += 1;
  return `${prefix}-${Date.now()}-${runCounter}`;
}

async function getUserId(ctx: APIRequestContext): Promise<string> {
  const res = await ctx.get(`${CORE_URL}/api/me`);
  expect(res.status()).toBe(200);
  return (await res.json()).id;
}

async function withCourse(
  createContext: () => Promise<APIRequestContext>,
  prefix: string,
  run: (fixture: CourseFixture) => Promise<void>,
): Promise<void> {
  const admin = await createContext();
  const instructor = await createContext();

  try {
    await createInstructor(instructor, { prefix: `${prefix}-instructor` });
    const instructorId = await getUserId(instructor);
    await createAdmin(admin, { prefix: `${prefix}-admin` });

    const createRes = await admin.post(`${CORE_URL}/api/courses`, {
      form: {
        name: `Scope workflow ${prefix}`,
        code: uniqueCourseCode(prefix),
        section: "001",
        term: "W1",
        year: "2026",
        startDate: "2026-09-08",
        department: "COSC",
        instructorUserIds: instructorId,
      },
    });
    expect(createRes.status()).toBe(201);

    await run({ admin, instructor, courseId: (await createRes.json()).id });
  } finally {
    await Promise.all([admin.dispose(), instructor.dispose()]);
  }
}

async function getSettings(ctx: APIRequestContext, courseId: string) {
  const res = await ctx.get(`${CORE_URL}/api/courses/${courseId}/rag-settings`);
  expect(res.status()).toBe(200);
  return res.json();
}

/**
 * The three fields this endpoint accepts. `null` clears an override and falls
 * back to the instance default, which is what the clearing test asserts.
 */
type RagSettingsPatch = {
  courseScopeGuardrailEnabled?: boolean;
  ragTopK?: number | null;
  ragSimilarityThreshold?: number | null;
};

async function patchSettings(ctx: APIRequestContext, courseId: string, body: RagSettingsPatch) {
  const res = await ctx.patch(`${CORE_URL}/api/courses/${courseId}/rag-settings`, { data: body });
  expect(res.status()).toBe(200);
  return res.json();
}

test.describe("Course-scope guardrail workflows", () => {
  test("INSTRUCTOR reads the persisted off-by-default setting", async ({ playwright }) => {
    await withCourse(
      () => playwright.request.newContext(),
      "scope-default",
      async ({ instructor, courseId }) => {
        await expect(getSettings(instructor, courseId)).resolves.toMatchObject({
          courseScopeGuardrailEnabled: false,
          ragTopK: null,
          ragSimilarityThreshold: null,
        });
      },
    );
  });

  test("INSTRUCTOR enables the guardrail and reads the setting back", async ({ playwright }) => {
    await withCourse(
      () => playwright.request.newContext(),
      "scope-enable",
      async ({ instructor, courseId }) => {
        await expect(
          patchSettings(instructor, courseId, { courseScopeGuardrailEnabled: true }),
        ).resolves.toMatchObject({
          courseScopeGuardrailEnabled: true,
        });
        await expect(getSettings(instructor, courseId)).resolves.toMatchObject({
          courseScopeGuardrailEnabled: true,
        });
      },
    );
  });

  test("INSTRUCTOR disables an enabled guardrail", async ({ playwright }) => {
    await withCourse(
      () => playwright.request.newContext(),
      "scope-disable",
      async ({ instructor, courseId }) => {
        await patchSettings(instructor, courseId, { courseScopeGuardrailEnabled: true });
        await expect(
          patchSettings(instructor, courseId, { courseScopeGuardrailEnabled: false }),
        ).resolves.toMatchObject({
          courseScopeGuardrailEnabled: false,
        });
        await expect(getSettings(instructor, courseId)).resolves.toMatchObject({
          courseScopeGuardrailEnabled: false,
        });
      },
    );
  });

  test("INSTRUCTOR updates RAG top-k without disabling the guardrail", async ({ playwright }) => {
    await withCourse(
      () => playwright.request.newContext(),
      "scope-top-k",
      async ({ instructor, courseId }) => {
        await patchSettings(instructor, courseId, { courseScopeGuardrailEnabled: true });
        await expect(
          patchSettings(instructor, courseId, { courseScopeGuardrailEnabled: true, ragTopK: 8 }),
        ).resolves.toMatchObject({
          courseScopeGuardrailEnabled: true,
          ragTopK: 8,
        });
        await expect(getSettings(instructor, courseId)).resolves.toMatchObject({
          courseScopeGuardrailEnabled: true,
          ragTopK: 8,
        });
      },
    );
  });

  test("INSTRUCTOR updates relevance threshold without disabling the guardrail", async ({
    playwright,
  }) => {
    await withCourse(
      () => playwright.request.newContext(),
      "scope-threshold",
      async ({ instructor, courseId }) => {
        await patchSettings(instructor, courseId, { courseScopeGuardrailEnabled: true });
        await expect(
          patchSettings(instructor, courseId, {
            courseScopeGuardrailEnabled: true,
            ragSimilarityThreshold: 0.65,
          }),
        ).resolves.toMatchObject({
          courseScopeGuardrailEnabled: true,
          ragSimilarityThreshold: 0.65,
        });
        await expect(getSettings(instructor, courseId)).resolves.toMatchObject({
          courseScopeGuardrailEnabled: true,
          ragSimilarityThreshold: 0.65,
        });
      },
    );
  });

  test("INSTRUCTOR saves the guardrail and both RAG values together", async ({ playwright }) => {
    await withCourse(
      () => playwright.request.newContext(),
      "scope-combined",
      async ({ instructor, courseId }) => {
        await expect(
          patchSettings(instructor, courseId, {
            courseScopeGuardrailEnabled: true,
            ragTopK: 8,
            ragSimilarityThreshold: 0.65,
          }),
        ).resolves.toMatchObject({
          courseScopeGuardrailEnabled: true,
          ragTopK: 8,
          ragSimilarityThreshold: 0.65,
        });
      },
    );
  });

  test("INSTRUCTOR clears RAG overrides while keeping the guardrail enabled", async ({
    playwright,
  }) => {
    await withCourse(
      () => playwright.request.newContext(),
      "scope-clear",
      async ({ instructor, courseId }) => {
        await patchSettings(instructor, courseId, {
          courseScopeGuardrailEnabled: true,
          ragTopK: 8,
          ragSimilarityThreshold: 0.65,
        });
        await expect(
          patchSettings(instructor, courseId, {
            courseScopeGuardrailEnabled: true,
            ragTopK: null,
            ragSimilarityThreshold: null,
          }),
        ).resolves.toMatchObject({
          courseScopeGuardrailEnabled: true,
          ragTopK: null,
          ragSimilarityThreshold: null,
        });
      },
    );
  });

  test("ADMIN reads and updates a course guardrail setting", async ({ playwright }) => {
    await withCourse(
      () => playwright.request.newContext(),
      "scope-admin",
      async ({ admin, courseId }) => {
        await expect(getSettings(admin, courseId)).resolves.toMatchObject({
          courseScopeGuardrailEnabled: false,
        });
        await expect(
          patchSettings(admin, courseId, { courseScopeGuardrailEnabled: true }),
        ).resolves.toMatchObject({
          courseScopeGuardrailEnabled: true,
        });
      },
    );
  });

  test("enrolled STUDENT can see the published course but not staff settings", async ({
    playwright,
  }) => {
    await withCourse(
      () => playwright.request.newContext(),
      "scope-student",
      async ({ admin, courseId }) => {
        const student = await playwright.request.newContext();
        try {
          await registerUser(student, { prefix: "scope-student" });
          const studentId = await getUserId(student);
          expect(
            await (
              await admin.post(`${CORE_URL}/api/courses/${courseId}/enrollments`, {
                data: { userId: studentId, role: "STUDENT" },
              })
            ).status(),
          ).toBe(201);
          expect(
            await (await admin.patch(`${CORE_URL}/api/courses/${courseId}/publish`)).status(),
          ).toBe(200);

          const courses = await student.get(`${CORE_URL}/api/courses?ids=${courseId}`);
          expect(courses.status()).toBe(200);
          expect(
            (await courses.json()).data.some((course: { id: string }) => course.id === courseId),
          ).toBe(true);

          const settings = await student.get(`${CORE_URL}/api/courses/${courseId}/rag-settings`);
          expect(settings.status()).toBe(403);
        } finally {
          await student.dispose();
        }
      },
    );
  });

  test("course TA cannot read staff-only course-scope settings", async ({ playwright }) => {
    await withCourse(
      () => playwright.request.newContext(),
      "scope-ta",
      async ({ admin, courseId }) => {
        const ta = await playwright.request.newContext();
        try {
          await registerUser(ta, { prefix: "scope-ta" });
          const taId = await getUserId(ta);
          const enrollRes = await admin.post(`${CORE_URL}/api/courses/${courseId}/enrollments`, {
            data: { userId: taId, role: "TA" },
          });
          expect(enrollRes.status()).toBe(201);

          const settings = await ta.get(`${CORE_URL}/api/courses/${courseId}/rag-settings`);
          expect(settings.status()).toBe(403);
        } finally {
          await ta.dispose();
        }
      },
    );
  });
});
