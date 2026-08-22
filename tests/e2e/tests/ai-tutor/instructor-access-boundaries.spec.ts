/**
 * AI Tutor INSTRUCTOR — access boundaries (browser-driven and over HTTP).
 *
 * Instructor scope is *per enrollment*, not per department: `resolveCourseAccess`
 * keeps only the courses Core reports with `callerEnrollmentRole === "INSTRUCTOR"`.
 * The fixture's control course therefore sits in the *same* department as the
 * instructor's own, so a denial here proves the enrollment set is what gates
 * access rather than a department filter that happens to agree.
 *
 * Two different answers, deliberately:
 *   - In the browser every refusal — wrong role for a route, a record this
 *     instructor may not see, or a URL matching nothing — resolves to the same
 *     generic in-shell 404 (`NotFoundState`), with the sidebar and header still
 *     mounted. The sameness is the point: the app must never confirm that a
 *     record exists to someone who cannot see it.
 *   - Over HTTP the answer is specific (403 with a reason), because an API
 *     caller is not a reader being let down gently.
 */
import { test, expect } from "@playwright/test";
import { AI_TUTOR_API_URL, AI_TUTOR_URL } from "../../playwright.config";
import { signInThroughPage } from "../helpers/auth";
import { createTeachingInstructor, type InstructorFixture } from "../helpers/at-instructor";
import { errorBoundary, sidebar } from "../helpers/at-ui";

let fx: InstructorFixture;
/** A module + lesson inside the course taught by the *other* instructor. */
let foreignSpine: { moduleId: number; lessonId: number };

test.beforeAll(async ({ playwright }) => {
  const ctx = await playwright.request.newContext();
  try {
    fx = await createTeachingInstructor(playwright, ctx, { seedTopic: true });

    // Built through the other instructor's own context — content this fixture's
    // instructor has never been able to touch.
    const moduleRow = await (
      await fx.otherCtx.post(`${AI_TUTOR_API_URL}/api/courses/${fx.foreign.atCourseId}/modules`, {
        data: { title: "Foreign Module" },
      })
    ).json();
    const lesson = await (
      await fx.otherCtx.post(`${AI_TUTOR_API_URL}/api/modules/${moduleRow.id}/lessons`, {
        data: { title: "Foreign Lesson" },
      })
    ).json();
    foreignSpine = { moduleId: moduleRow.id, lessonId: lesson.id };
  } finally {
    await ctx.dispose();
  }
});

test.afterAll(async () => {
  await fx?.dispose();
});

/**
 * Navigate and assert the generic in-shell 404, with the navigation intact.
 *
 * Asserting the shell too is the difference between "refused" and "crashed":
 * a bare error page would strand the reader with no way out.
 */
async function expectInShell404(page: import("@playwright/test").Page, path: string) {
  await page.goto(`${AI_TUTOR_URL}${path}`);
  await expect(errorBoundary(page)).toBeVisible({ timeout: 30_000 });
  await expect(sidebar(page).getByRole("link", { name: "Dashboard", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Go to dashboard" })).toBeVisible();
}

test.describe("INSTRUCTOR access boundaries", () => {
  test("the admin console is a generic 404, leaking nothing from it", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);
    await expectInShell404(page, "/admin");

    // Nothing from the console bleeds through: no heading, no tabs, no
    // narrowed subheading that would confirm what lives there.
    await expect(page.getByRole("tab")).toHaveCount(0);
    await expect(page.getByText(/Bug reports|AI configuration/i)).toHaveCount(0);
  });

  test("the student shell is a generic 404, not a redirect", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);

    // All four student routes, so a future change to one of them cannot pass
    // by resembling the others.
    await expectInShell404(page, "/student");
    await expectInShell404(page, "/student/courses/1");
    await expectInShell404(page, "/student/module/1");
    await expectInShell404(page, "/student/lesson/1");
  });

  test("a course taught by someone else is a generic 404", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);

    await expectInShell404(page, `/instructor/courses/${fx.foreign.atCourseId}`);
    // Not one word of the course itself — not the name, not the code.
    await expect(page.getByText(fx.foreign.name)).toHaveCount(0);
    await expect(page.getByText(fx.foreign.code)).toHaveCount(0);
  });

  test("a module and a lesson in someone else's course are generic 404s", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);

    await expectInShell404(page, `/instructor/module/${foreignSpine.moduleId}`);
    await expect(page.getByText("Foreign Module")).toHaveCount(0);

    await expectInShell404(page, `/instructor/lesson/${foreignSpine.lessonId}`);
    await expect(page.getByText("Foreign Lesson")).toHaveCount(0);
  });

  test("a URL matching no route lands on the same 404", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);

    // Identical to every refusal above — which is what makes the refusals
    // uninformative to someone probing for what exists.
    await expectInShell404(page, "/no-such-page");
    await expectInShell404(page, "/instructor/courses/999999999");
  });

  test("the API refuses a course this instructor does not teach", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);

    // Specific over HTTP, unlike the browser's generic 404.
    const res = await page.request.get(`${AI_TUTOR_API_URL}/api/courses/${fx.foreign.atCourseId}`);
    expect(res.status()).toBe(403);
    expect((await res.json()).error).toMatch(/not authorized/i);
  });

  test("the API refuses writes into someone else's course", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);

    // Read-denied is not enough on its own — the write path has its own gate.
    const createModule = await page.request.post(
      `${AI_TUTOR_API_URL}/api/courses/${fx.foreign.atCourseId}/modules`,
      { data: { title: "Should never exist" } },
    );
    expect(createModule.status()).toBe(403);

    const publish = await page.request.patch(
      `${AI_TUTOR_API_URL}/api/courses/${fx.foreign.atCourseId}/publish`,
    );
    expect(publish.status()).toBe(403);

    const topic = await page.request.post(
      `${AI_TUTOR_API_URL}/api/courses/${fx.foreign.atCourseId}/topics`,
      { data: { name: "Should never exist" } },
    );
    expect(topic.status()).toBe(403);
  });

  test("the other instructor can still reach their own course", async () => {
    // The control for every denial above: the foreign course is refused because
    // of *who is asking*, not because it is broken or missing.
    const res = await fx.otherCtx.get(`${AI_TUTOR_API_URL}/api/courses/${fx.foreign.atCourseId}`);
    expect(res.status()).toBe(200);
    expect((await res.json()).id).toBe(fx.foreign.atCourseId);
  });

  test("creating a course is refused for every role, instructors included", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);

    // Course lifecycle is owned by EduAI Core (#632). The endpoint still exists
    // for legacy clients but always refuses, and it says where to go instead.
    const res = await page.request.post(`${AI_TUTOR_API_URL}/api/courses`, { data: {} });
    expect(res.status()).toBe(403);
    expect((await res.json()).error).toMatch(/managed in EduAI Core/i);
  });

  test("the admin bug-report queue is refused over HTTP as well", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);

    // The console is hidden in the UI; the API behind it must refuse too, or
    // hiding it is decoration.
    const res = await page.request.get(`${AI_TUTOR_API_URL}/api/admin/bug-reports`);
    expect(res.status()).toBe(403);
  });

  test("the prompt-template store is open to teaching roles", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);

    // API-only: `GET /api/prompts` admits INSTRUCTOR/UNIT_ADMIN/ADMIN
    // (`TEACHING_ROLES`) and `api.listPrompts` exists in the client, but no
    // screen in AI Tutor renders it today. Recorded here so the surface is
    // covered even though it has no UI path.
    const res = await page.request.get(`${AI_TUTOR_API_URL}/api/prompts`);
    expect(res.status()).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });
});
