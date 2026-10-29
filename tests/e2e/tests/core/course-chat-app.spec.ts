/**
 * Course Chat as its own app (#1996): it lives in Core's `/chat` routes but is
 * listed in the app switcher beside the other apps, and while open the
 * shell presents it as the current app with its own rail.
 */
import { test, expect, type Page } from "@playwright/test";
import { CORE_URL } from "../../playwright.config";
import { createInstructor, signInThroughPage } from "../helpers/auth";

function rail(page: Page) {
  return page.getByRole("navigation", { name: "Global" }).first();
}

async function openSwitcher(page: Page) {
  // Core renders on the server; wait for hydration before clicking.
  await page.waitForLoadState("networkidle");
  await rail(page)
    .getByRole("button", { name: /^Switch app/ })
    .click();
  const tray = page.getByRole("dialog", { name: "Switch app" });
  await expect(tray).toBeVisible();
  return tray;
}

// Signed in as a fresh instructor: a fresh student is first sent to the
// student-ID onboarding page and then shown chat's privacy notice, neither of
// which this spec is about. The rail is the same for both roles.
test.describe("Course Chat as its own app", () => {
  test("a user switches from Core into Course Chat and back", async ({ page, request }) => {
    const user = await createInstructor(request, { prefix: "chat-app-switch" });
    await signInThroughPage(page, user, `${CORE_URL}/dashboard`);

    // Core's rail no longer carries Course Chat; the switcher does.
    await expect(rail(page).getByRole("link", { name: "Course Chat" })).toHaveCount(0);
    const tray = await openSwitcher(page);
    // AI Tutor and Question Maker are listed only when Core is built with
    // their URLs, which the e2e image is not; Core and Course Chat always are.
    await expect(tray.getByText("EduAI Core")).toBeVisible();
    await expect(tray.getByRole("link", { name: /Course Chat/ })).toBeVisible();

    await tray.getByRole("link", { name: /Course Chat/ }).click();
    await page.waitForURL((url) => url.pathname === "/chat");
    await expect(
      rail(page).getByRole("button", { name: "Switch app, current app: Course Chat" }),
    ).toBeVisible();
    await expect(rail(page).getByRole("link", { name: "New chat" })).toBeVisible();
    for (const name of ["History", "Courses", "Help"]) {
      await expect(rail(page).getByRole("button", { name, exact: true })).toBeVisible();
    }
    await expect(rail(page).getByRole("link", { name: "Dashboard" })).toHaveCount(0);
    await expect(rail(page).getByRole("link", { name: "Course Assistant" })).toHaveCount(0);

    // And back to Core through the same switcher.
    const back = await openSwitcher(page);
    await back.getByRole("link", { name: /EduAI Core/ }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/chat"));
    await expect(
      rail(page).getByRole("button", { name: "Switch app, current app: EduAI Core" }),
    ).toBeVisible();
  });

  test("the History tray opens from Course Chat's rail", async ({ page, request }) => {
    const user = await createInstructor(request, { prefix: "chat-app-history" });
    await signInThroughPage(page, user, `${CORE_URL}/chat`);

    await rail(page).getByRole("button", { name: "History", exact: true }).click();
    const history = page.getByRole("dialog", { name: "History" });
    await expect(history).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(history).toBeHidden();
  });

  test("an instructor with no published course gets no Course Assistant", async ({
    page,
    request,
  }) => {
    const instructor = await createInstructor(request, { prefix: "chat-app-instructor" });
    await signInThroughPage(page, instructor, `${CORE_URL}/chat`);
    await expect(rail(page).getByRole("link", { name: "Course Assistant" })).toHaveCount(0);
  });

  test("on a phone the header switcher lists Course Chat too", async ({ page, request }) => {
    const user = await createInstructor(request, { prefix: "chat-app-mobile" });
    await page.setViewportSize({ width: 375, height: 760 });
    await signInThroughPage(page, user, `${CORE_URL}/chat`);
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: "Switch app, current app: Course Chat" }).click();
    const sheet = page.getByRole("dialog", { name: "Switch app" });
    await expect(sheet.getByText("Course Chat", { exact: true })).toBeVisible();
    await expect(sheet.getByRole("link", { name: /EduAI Core/ })).toBeVisible();
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(375);
  });
});
