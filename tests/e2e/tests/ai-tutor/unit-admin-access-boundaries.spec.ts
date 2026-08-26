/**
 * AI Tutor UNIT_ADMIN — access boundaries (browser-driven where there is UI).
 *
 * A unit admin's authority is bounded by `authorizedUnits`. Everything here
 * asks the same question from a different direction: can this role reach
 * something outside its unit, or above its rank?
 *
 * **One UI contract, two causes.** On this branch every refusal resolves to
 * the same in-shell 404 (`NotFoundState`), and that sameness is the point — the
 * app must not confirm that a record exists to someone who cannot see it:
 *   - Wrong *role* for a route (`/admin`): `requireClientUser` throws
 *     `new Response(404)`. #1660 widened `/student/*`'s allow-list to include
 *     UNIT_ADMIN as a preview of the learner experience — see
 *     student-preview-banner.route.test.tsx and the two #1660 tests below —
 *     so it is no longer a role refusal on this branch, only a unit one.
 *   - Wrong *unit* for a record on a route the role may otherwise use
 *     (including a `/student/*` preview of out-of-unit content): the loader's
 *     API call 403s and `http()` throws an `ApiHttpError` carrying the status,
 *     which `RouteErrorState` maps to the same 404 page.
 *   - A URL matching no route at all: the `*` catch-all.
 * The boundary sits on the child route rather than on `_app.tsx`, so the
 * sidebar and header stay mounted and the reader can navigate onwards.
 *
 * Over HTTP the answer is different and more specific — 403 with an explicit
 * reason — because an API caller is not a reader who needs to be let down
 * gently.
 *
 * The out-of-unit course is created by the same fixture as the in-unit one and
 * differs only in `department`, so any difference in outcome is the unit gate.
 */
import { test, expect } from "@playwright/test";
import { AI_TUTOR_API_URL, AI_TUTOR_URL, CORE_URL } from "../../playwright.config";
import { signInThroughPage } from "../helpers/auth";
import { createUnitAdmin, type UnitAdminFixture } from "../helpers/at-unit-admin";
import { errorBoundary, shellMain, sidebarLink } from "../helpers/at-ui";

let ua: UnitAdminFixture;
/** Module + lesson the instructor authored inside the out-of-unit course. */
/** The out-of-unit module/lesson pair every boundary assertion below targets. */
interface ForeignContent {
  moduleId: number;
  lessonId: number;
}

let foreign: ForeignContent;

test.beforeAll(async ({ playwright }) => {
  const ctx = await playwright.request.newContext();
  try {
    ua = await createUnitAdmin(playwright, ctx);
  } finally {
    await ctx.dispose();
  }

  // Authored by the course's own instructor, so these rows are legitimate —
  // the only reason the unit admin must not reach them is the unit gate.
  const moduleRes = await ua.instrCtx.post(
    `${AI_TUTOR_API_URL}/api/courses/${ua.outOfUnit.atCourseId}/modules`,
    { data: { title: "Out-of-unit module" } },
  );
  expect(moduleRes.status()).toBe(201);
  const moduleId = (await moduleRes.json()).id;

  const lessonRes = await ua.instrCtx.post(`${AI_TUTOR_API_URL}/api/modules/${moduleId}/lessons`, {
    data: { title: "Out-of-unit lesson" },
  });
  expect(lessonRes.status()).toBe(201);

  foreign = { moduleId, lessonId: (await lessonRes.json()).id };
});

test.afterAll(async () => {
  await ua?.dispose();
});

test.describe("UNIT_ADMIN access boundaries", () => {
  test("SECURITY: a course outside the admin's unit fails closed without leaking it", async ({
    page,
  }) => {
    await signInThroughPage(page, ua, `${AI_TUTOR_URL}/dashboard`);

    await page.goto(`${AI_TUTOR_URL}/instructor/courses/${ua.outOfUnit.atCourseId}`, {
      waitUntil: "domcontentloaded",
    });

    await expect(errorBoundary(page)).toBeVisible();
    // What matters for the boundary: neither the code, the name, nor the
    // server's reason reaches the page.
    await expect(page.getByText(ua.outOfUnit.code)).toHaveCount(0);
    await expect(page.getByText(ua.outOfUnit.name)).toHaveCount(0);
    await expect(page.getByText(/Not authorized for this course/)).toHaveCount(0);
    // Rendered in place — the URL is not rewritten to hide the attempt.
    expect(page.url()).toContain(`/instructor/courses/${ua.outOfUnit.atCourseId}`);
  });

  test("SECURITY: a module outside the admin's unit fails closed without leaking it", async ({
    page,
  }) => {
    await signInThroughPage(page, ua, `${AI_TUTOR_URL}/dashboard`);

    await page.goto(`${AI_TUTOR_URL}/instructor/module/${foreign.moduleId}`, {
      waitUntil: "domcontentloaded",
    });

    await expect(errorBoundary(page)).toBeVisible();
    await expect(page.getByText("Out-of-unit module")).toHaveCount(0);
  });

  test("SECURITY: a lesson outside the admin's unit fails closed without leaking it", async ({
    page,
  }) => {
    await signInThroughPage(page, ua, `${AI_TUTOR_URL}/dashboard`);

    await page.goto(`${AI_TUTOR_URL}/instructor/lesson/${foreign.lessonId}`, {
      waitUntil: "domcontentloaded",
    });

    await expect(errorBoundary(page)).toBeVisible();
    await expect(page.getByText("Out-of-unit lesson")).toHaveCount(0);
  });

  test("the refusal keeps the reader inside the shell, with a way out", async ({ page }) => {
    await signInThroughPage(page, ua, `${AI_TUTOR_URL}/dashboard`);

    await page.goto(`${AI_TUTOR_URL}/instructor/courses/${ua.outOfUnit.atCourseId}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(errorBoundary(page)).toBeVisible();

    // The UX half of the same behaviour, pinned separately from the leak
    // assertions above: `RouteErrorState` is exported by the child route, so a
    // boundary hit replaces the page but not the shell around it.
    await expect(sidebarLink(page, "/dashboard")).toBeVisible();
    await expect(page.getByRole("link", { name: "Go to dashboard" })).toBeVisible();
  });

  test("SECURITY: an out-of-unit record and a nonexistent one are indistinguishable", async ({
    page,
  }) => {
    await signInThroughPage(page, ua, `${AI_TUTOR_URL}/dashboard`);

    // The whole reason the 404 is generic. If a forbidden course looked any
    // different from an id that was never issued, the page itself would confirm
    // the course exists to someone who may not see it.
    await page.goto(`${AI_TUTOR_URL}/instructor/courses/${ua.outOfUnit.atCourseId}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(errorBoundary(page)).toBeVisible();
    const forbidden = await shellMain(page).innerText();

    await page.goto(`${AI_TUTOR_URL}/instructor/courses/999999999`, {
      waitUntil: "domcontentloaded",
    });
    await expect(errorBoundary(page)).toBeVisible();
    const missing = await shellMain(page).innerText();

    expect(forbidden).toBe(missing);
  });

  test("SECURITY: every read on an out-of-unit course is refused over the API", async ({
    page,
  }) => {
    await signInThroughPage(page, ua, `${AI_TUTOR_URL}/dashboard`);
    const id = ua.outOfUnit.atCourseId;

    const reads = [
      `/api/courses/${id}`,
      `/api/courses/${id}/modules?page=1&pageSize=10`,
      `/api/courses/${id}/submissions`,
      `/api/courses/${id}/analytics`,
      `/api/courses/${id}/feedback`,
      `/api/courses/${id}/student-metrics`,
      // `/topics` belongs here now. It used to be excluded because it 403'd
      // in-unit too, so its 403 proved nothing about the unit boundary — the
      // in-unit half of this test is what makes it evidence again.
      `/api/courses/${id}/topics?page=1&pageSize=200`,
    ];

    for (const path of reads) {
      const res = await page.request.get(`${AI_TUTOR_API_URL}${path}`);
      expect(res.status(), `${path} must be 403`).toBe(403);
      expect((await res.json()).error).toBe("Not authorized for this course");
    }

    // Each of these is a read the same admin can make on their in-unit course,
    // so the 403s above are the unit gate and not a blanket denial.
    for (const path of reads) {
      const inUnit = path.replace(String(id), String(ua.course.atCourseId));
      const res = await page.request.get(`${AI_TUTOR_API_URL}${inUnit}`);
      expect(res.status(), `${inUnit} must be allowed in-unit`).toBe(200);
    }
  });

  test("SECURITY: every write on out-of-unit content is refused over the API", async ({ page }) => {
    await signInThroughPage(page, ua, `${AI_TUTOR_URL}/dashboard`);

    const writes: Array<{ method: "post" | "patch"; path: string; data: unknown }> = [
      {
        method: "post",
        path: `/api/courses/${ua.outOfUnit.atCourseId}/modules`,
        data: { title: "hijacked module" },
      },
      { method: "patch", path: `/api/modules/${foreign.moduleId}`, data: { title: "renamed" } },
      { method: "patch", path: `/api/modules/${foreign.moduleId}/publish`, data: {} },
      {
        method: "post",
        path: `/api/modules/${foreign.moduleId}/lessons`,
        data: { title: "hijacked lesson" },
      },
      { method: "patch", path: `/api/lessons/${foreign.lessonId}`, data: { title: "renamed" } },
      { method: "patch", path: `/api/lessons/${foreign.lessonId}/publish`, data: {} },
      // Course publish/unpublish admit INSTRUCTOR/UNIT_ADMIN/ADMIN and write
      // straight through to Core. They are the one write in this app that
      // changes what students can see at the *course* level, and they were
      // missing from this matrix entirely — a unit admin flipping another
      // department's course live is exactly the failure this row guards.
      { method: "patch", path: `/api/courses/${ua.outOfUnit.atCourseId}/publish`, data: {} },
      { method: "patch", path: `/api/courses/${ua.outOfUnit.atCourseId}/unpublish`, data: {} },
      // Topic writes on the same router as the (now unit-aware) topic read.
      {
        method: "post",
        path: `/api/courses/${ua.outOfUnit.atCourseId}/topics`,
        data: { name: "hijacked topic" },
      },
      {
        method: "post",
        path: `/api/courses/${ua.outOfUnit.atCourseId}/topics/remap`,
        data: { mappings: [{ fromTopicId: 1, toTopicId: 2 }] },
      },
    ];

    for (const { method, path, data } of writes) {
      const res = await page.request[method](`${AI_TUTOR_API_URL}${path}`, { data });
      expect(res.status(), `${method.toUpperCase()} ${path} must be 403`).toBe(403);
    }

    // The out-of-unit course must still be a draft afterwards — a 403 that had
    // already written before refusing would pass every assertion above.
    const asInstructor = await (
      await ua.instrCtx.get(`${AI_TUTOR_API_URL}/api/courses/${ua.outOfUnit.atCourseId}`)
    ).json();
    expect(asInstructor.isPublished).toBe(false);
  });

  test("SECURITY: the student routes still refuse out-of-unit content", async ({ page }) => {
    await signInThroughPage(page, ua, `${AI_TUTOR_URL}/dashboard`);

    // #1660 lets a UNIT_ADMIN open /student/* to preview the learner
    // experience, but only for content the unit gate already lets them reach
    // through the instructor shell — the preview is a different lens on the
    // same authorization, not a bypass of it. Out-of-unit content must still
    // be refused there exactly as it is on the instructor side.
    for (const path of [
      `/student/module/${foreign.moduleId}`,
      `/student/lesson/${foreign.lessonId}`,
    ]) {
      await page.goto(`${AI_TUTOR_URL}${path}`, { waitUntil: "domcontentloaded" });
      await expect(errorBoundary(page), `${path} must be refused`).toBeVisible({
        timeout: 15_000,
      });
      // Refused in place, not bounced: the URL is left alone so the attempt is
      // visible rather than papered over with a redirect.
      expect(page.url()).toContain(path);
    }
  });

  test("the student shell previews in-unit content instead of refusing it (#1660)", async ({
    page,
  }) => {
    await signInThroughPage(page, ua, `${AI_TUTOR_URL}/dashboard`);

    // A module the admin can manage through the instructor shell. #1660 makes
    // the student route open the same record as a read-only preview — the
    // unit gate already let them in, so there is nothing left to refuse.
    const moduleRes = await page.request.post(
      `${AI_TUTOR_API_URL}/api/courses/${ua.course.atCourseId}/modules`,
      { data: { title: "In-unit module for student-shell check" } },
    );
    expect(moduleRes.status()).toBe(201);
    const ownModuleId = (await moduleRes.json()).id;

    await page.goto(`${AI_TUTOR_URL}/student`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("student-preview-banner")).toBeVisible({ timeout: 15_000 });

    await page.goto(`${AI_TUTOR_URL}/student/courses/${ua.course.atCourseId}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByTestId("student-preview-banner")).toBeVisible({ timeout: 15_000 });

    await page.goto(`${AI_TUTOR_URL}/student/module/${ownModuleId}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByTestId("student-preview-banner")).toBeVisible({ timeout: 15_000 });
    // The title also appears in the breadcrumb, so scope to the hero heading —
    // getByText would otherwise match both and violate Playwright's strict mode.
    await expect(
      page.getByRole("heading", { name: "In-unit module for student-shell check" }),
    ).toBeVisible();
  });

  test("an unsupported-role landing sends a supported role back to their dashboard", async ({
    page,
  }) => {
    await signInThroughPage(page, ua, `${AI_TUTOR_URL}/dashboard`);

    // `/unsupported-role` sits outside the app shell and is the one refusal that
    // still redirects: UNIT_ADMIN *is* supported, so the page bounces through
    // `routeForRole` rather than sticking on a dead end.
    await page.goto(`${AI_TUTOR_URL}/unsupported-role`, { waitUntil: "domcontentloaded" });

    await expect(page).toHaveURL(`${AI_TUTOR_URL}/dashboard`, { timeout: 15_000 });
    await expect(page.getByText("Your unit's courses and administration.")).toBeVisible();
  });

  test("course creation is refused — courses are owned by EduAI Core", async ({ page }) => {
    await signInThroughPage(page, ua, `${AI_TUTOR_URL}/dashboard`);

    // canCreateCourse() returns false for every role, so this is a product
    // boundary rather than a permission gap: Core is the source of truth.
    const res = await page.request.post(`${AI_TUTOR_API_URL}/api/courses`, {
      data: { title: "Unit Admin Course" },
    });
    expect(res.status()).toBe(403);
    expect((await res.json()).error).toMatch(/EduAI Core/i);
  });

  test("SECURITY: losing the session closes the app to the unit admin", async ({ page }) => {
    await signInThroughPage(page, ua, `${AI_TUTOR_URL}/dashboard`);

    // AI Tutor holds no session of its own — revoking Core's must be enough.
    await page.request.post(`${CORE_URL}/api/auth/sign-out`, { data: {} });

    const res = await page.request.get(`${AI_TUTOR_API_URL}/api/courses?page=1&pageSize=10`);
    expect(res.status()).toBe(401);
  });
});
