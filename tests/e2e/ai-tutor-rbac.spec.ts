import { test, expect } from "@playwright/test";

/**
 * AiTutor RBAC smoke flows (#616, #617).
 * Requires EduAI Core + AiTutor running locally with seeded accounts.
 */
const CORE_URL = process.env.E2E_CORE_URL ?? "http://localhost:3000";
const AT_URL = process.env.E2E_AI_TUTOR_URL ?? "http://localhost:3001";
const LOCAL_SEED_PASSWORD = (() => {
  const password = process.env.EDUAI_LOCAL_SEED_PASSWORD?.trim();
  if (!password) {
    throw new Error(
      "Set EDUAI_LOCAL_SEED_PASSWORD to the local-only Core fixture password before running this e2e suite",
    );
  }
  return password;
})();

async function loginAs(page: import("@playwright/test").Page, email: string) {
  await page.goto(`${CORE_URL}/login?redirect=${encodeURIComponent(AT_URL)}`);
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(LOCAL_SEED_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/localhost:3001/);
}

test.describe("AiTutor RBAC role shells", () => {
  test("student lands on student dashboard", async ({ page }) => {
    await loginAs(page, "student1@eduai.local");
    await expect(page).toHaveURL(/\/student/);
    await expect(page.getByText(/Student view/i)).toBeVisible();
  });

  test("instructor lands on teaching dashboard", async ({ page }) => {
    await loginAs(page, "instructor.cs@eduai.local");
    await expect(page).toHaveURL(/\/instructor/);
    await expect(page.getByText(/Instructor view|Teaching/i)).toBeVisible();
  });

  test("admin lands on admin console", async ({ page }) => {
    await loginAs(page, "admin@eduai.local");
    await expect(page).toHaveURL(/\/admin/);
    await expect(page.getByRole("button", { name: /User Management/i })).toBeVisible();
  });
});
