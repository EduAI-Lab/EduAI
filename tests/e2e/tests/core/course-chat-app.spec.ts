/**
 * Course Chat as its own app (#1996): it lives in Core's `/chat` routes but is
 * listed in the app switcher beside Core and AI Tutor, and while open the
 * shell presents it as the current app with its own rail.
 */
import { test, expect, type Page } from "@playwright/test";
import { CORE_URL } from "../../playwright.config";
import { createInstructor, registerUser, signInThroughPage } from "../helpers/auth";

function rail(page: Page) {
  return page.getByRole("navigation", { name: "Global" }).first();
}

async function openSwitcher(page: Page) {
  await rail(page)
    .getByRole("button", { name: /^Switch app/ })
    .click();
  const tray = page.getByRole("dialog", { name: "Switch app" });
  await expect(tray).toBeVisible();
  return tray;
}

test.describe("Course Chat as its own app", () => {
  test("a student switches from Core into Course Chat and back", async ({ page, request }) => {
    const student = await registerUser(request, { prefix: "chat-app-student" });
    await signInThroughPage(page, student, `${CORE_URL}/dashboard`);

    // Core's rail no longer carries Course Chat; the switcher does.
    await expect(rail(page).getByRole("link", { name: "Course Chat" })).toHaveCount(0);
    const tray = await openSwitcher(page);
    await expect(tray.getByText("EduAI Core")).toBeVisible();
    await expect(tray.getByRole("link", { name: /Course Chat/ })).toBeVisible();
    await expect(tray.getByRole("link", { name: /AI Tutor/ })).toBeVisible();

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
    const student = await registerUser(request, { prefix: "chat-app-history" });
    await signInThroughPage(page, student, `${CORE_URL}/chat`);

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
    const student = await registerUser(request, { prefix: "chat-app-mobile" });
    await page.setViewportSize({ width: 375, height: 760 });
    await signInThroughPage(page, student, `${CORE_URL}/chat`);

    await page.getByRole("button", { name: "Switch app, current app: Course Chat" }).click();
    const sheet = page.getByRole("dialog", { name: "Switch app" });
    await expect(sheet.getByText("Course Chat")).toBeVisible();
    await expect(sheet.getByRole("link", { name: /EduAI Core/ })).toBeVisible();
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(375);
  });
});
