/**
 * #1961: someone with no EduAI account opens a course join link, creates an
 * account, and ends up in the course without reopening the link.
 *
 * The docker stack runs with email verification off (accounts are minted
 * verified), so signup immediately joins and forwards the new session. Students
 * finish or skip student-number onboarding before reaching the course. The verification-hook path is covered against
 * real Postgres in self-enrollment-after-signup.integration.test.ts.
 */
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { CORE_URL } from "../../playwright.config";
import { createAdmin, createInstructor, DEFAULT_PASSWORD, uniqueEmail } from "../helpers/auth";

interface JoinFixture {
  courseId: string;
  code: string;
  url: string;
  linkId: string;
}

async function myId(ctx: APIRequestContext): Promise<string> {
  const res = await ctx.get(`${CORE_URL}/api/me`);
  expect(res.status(), await res.text()).toBe(200);
  return ((await res.json()) as { id: string }).id;
}

/** A published course with a fresh join link, minted by its instructor. */
async function publishedCourseWithLink(
  adminCtx: APIRequestContext,
  instrCtx: APIRequestContext,
): Promise<JoinFixture> {
  const instrId = await myId(instrCtx);
  // Per run: a retry re-enters the test in the same worker and must not reuse the code.
  const code = `J61-${Date.now().toString().slice(-6)}`;
  const created = await adminCtx.post(`${CORE_URL}/api/courses`, {
    form: {
      name: "Join After Signup",
      code,
      section: "001",
      term: "W1",
      year: "2026",
      startDate: "2026-09-08",
      department: "COSC",
      instructorUserIds: instrId,
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const courseId = ((await created.json()) as { id: string }).id;

  const published = await adminCtx.patch(`${CORE_URL}/api/courses/${courseId}/publish`);
  expect(published.status(), await published.text()).toBe(200);

  const minted = await instrCtx.post(`${CORE_URL}/api/courses/${courseId}/self-enroll`, {
    data: {},
  });
  expect(minted.status(), await minted.text()).toBe(201);
  const body = (await minted.json()) as { url: string; link: { id: string } };
  // The mint answers with the server's share origin; the walk uses the test's.
  const shared = new URL(body.url);
  return {
    courseId,
    code,
    url: `${CORE_URL}${shared.pathname}${shared.search}`,
    linkId: body.link.id,
  };
}

async function createAccountFromLink(
  page: Page,
  fixture: JoinFixture,
  email: string,
  beforeSubmit?: () => Promise<void>,
) {
  await page.goto(fixture.url);
  await expect(page).toHaveURL(/\/auth\/login\?redirect=/);
  await expect(page.getByText(`Sign in to join ${fixture.code}`, { exact: false })).toBeVisible();

  await page.getByRole("link", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/auth\/register\?redirect=/);
  await expect(
    page.getByText(`Create your account to join ${fixture.code}`, { exact: false }),
  ).toBeVisible();
  await page.getByLabel("Name").fill("Join Student");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(DEFAULT_PASSWORD);
  await page.getByLabel("Confirm Password").fill(DEFAULT_PASSWORD);
  await beforeSubmit?.();
  await page.getByRole("button", { name: "Create account" }).click();
}

test.describe("Join link → new account → in the course (#1961)", () => {
  test("a person with no account joins after creating one, without reopening the link", async ({
    page,
    playwright,
  }) => {
    test.setTimeout(120_000);
    const adminCtx = await playwright.request.newContext();
    const instrCtx = await playwright.request.newContext();
    try {
      await createAdmin(adminCtx, { prefix: "j61-admin" });
      await createInstructor(instrCtx, { prefix: "j61-instr" });
      const fixture = await publishedCourseWithLink(adminCtx, instrCtx);
      const email = uniqueEmail("j61-student");

      await createAccountFromLink(page, fixture, email);
      await expect(page).toHaveURL(/\/onboarding\/student-id\?next=/);
      await page.getByRole("button", { name: /Skip/i }).click();

      await expect(page).toHaveURL(new RegExp(`/courses/${fixture.courseId}`));
    } finally {
      await adminCtx.dispose();
      await instrCtx.dispose();
    }
  });

  test("a link revoked before signup is not redeemed, and the student is told", async ({
    page,
    playwright,
  }) => {
    test.setTimeout(120_000);
    const adminCtx = await playwright.request.newContext();
    const instrCtx = await playwright.request.newContext();
    try {
      await createAdmin(adminCtx, { prefix: "j61r-admin" });
      await createInstructor(instrCtx, { prefix: "j61r-instr" });
      const fixture = await publishedCourseWithLink(adminCtx, instrCtx);
      const email = uniqueEmail("j61r-student");

      await createAccountFromLink(page, fixture, email, async () => {
        const revoked = await instrCtx.delete(
          `${CORE_URL}/api/courses/${fixture.courseId}/self-enroll?linkId=${encodeURIComponent(fixture.linkId)}`,
        );
        expect(revoked.status(), await revoked.text()).toBe(204);
      });

      await expect(page).toHaveURL(/\/courses\/self-enroll\/complete/);
      await expect(page.getByText(`Can't join ${fixture.code}`)).toBeVisible();
      await expect(page.getByText(/was turned off/)).toBeVisible();
    } finally {
      await adminCtx.dispose();
      await instrCtx.dispose();
    }
  });
});
