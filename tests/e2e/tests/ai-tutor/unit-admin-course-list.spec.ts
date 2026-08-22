/**
 * AI Tutor UNIT_ADMIN — course list workflows (browser-driven).
 *
 * `/instructor` is the shared teaching shell: `usesInstructorShell()` admits
 * INSTRUCTOR, UNIT_ADMIN and TA, so a unit admin browses courses through the
 * same `CourseListView` an instructor does. What differs is the *set* — the
 * server scopes `GET /api/courses` to the admin's `authorizedUnits`.
 *
 * Search, the term/status filters and the pager are all applied server-side
 * and mirrored into the URL (#1208), so each of those is exercised here as its
 * own workflow rather than assumed.
 */
import { test, expect } from "@playwright/test";
import { AI_TUTOR_URL } from "../../playwright.config";
import { signInThroughPage } from "../helpers/auth";
import { createUnitAdmin, type UnitAdminFixture } from "../helpers/at-unit-admin";
import { courseLink } from "../helpers/at-ui";

let ua: UnitAdminFixture;

test.beforeAll(async ({ playwright }) => {
  const ctx = await playwright.request.newContext();
  try {
    ua = await createUnitAdmin(playwright, ctx);
  } finally {
    await ctx.dispose();
  }
});

test.afterAll(async () => {
  await ua?.dispose();
});

/** Search is the only reliable way to surface one course out of a shared DB. */
async function searchFor(page: import("@playwright/test").Page, code: string) {
  await page.goto(`${AI_TUTOR_URL}/instructor?search=${encodeURIComponent(code)}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByText(code).first()).toBeVisible();
  // The result count only renders once the server-side search has landed —
  // waiting on it keeps a later filter click off a list that is still settling.
  await expect(page.getByText("1 course found")).toBeVisible();
}

/**
 * Pick a value from one of the list's filter Selects.
 *
 * The popover re-renders while the debounced list request settles, which
 * detaches the option mid-click, so the whole open-and-choose is retried
 * rather than just the click.
 */
async function chooseFilter(page: import("@playwright/test").Page, group: string, option: string) {
  await expect(async () => {
    await page.getByRole("combobox").filter({ hasText: group }).click();
    await page.getByRole("option", { name: option, exact: true }).click({ timeout: 3_000 });
  }).toPass({ timeout: 20_000 });
}

test.describe("UNIT_ADMIN course list", () => {
  test("the list renders the shared teaching shell for a unit admin", async ({ page }) => {
    await signInThroughPage(page, ua, `${AI_TUTOR_URL}/instructor`);

    await expect(page.getByRole("heading", { name: "Courses", exact: true })).toBeVisible();
    await expect(page.getByText("Browse your courses and manage their content.")).toBeVisible();
    // Course creation lives in Core — the list must offer no "new course" action.
    await expect(page.getByRole("button", { name: /new course|create course/i })).toHaveCount(0);
  });

  test("typing in the search box narrows the list and records it in the URL", async ({ page }) => {
    await signInThroughPage(page, ua, `${AI_TUTOR_URL}/instructor`);
    // `useCourseListFilters` re-seeds its draft from the loader's selection on
    // every re-render, so a keystroke landing while the (large) first page is
    // still settling is discarded. Wait for the list to finish, then retry the
    // typing until it sticks.
    const box = page.getByRole("searchbox", { name: "Search courses" });
    await expect(box).toBeEnabled();
    await page.waitForLoadState("networkidle");

    await expect(async () => {
      await box.fill(ua.course.code);
      await expect(box).toHaveValue(ua.course.code, { timeout: 2_000 });
    }).toPass({ timeout: 30_000 });

    // #1208: search is applied server-side and pushed into the URL so the
    // result is bookmarkable. This is a client-side navigation, so assert on
    // the URL rather than waiting for a load event that never fires.
    await expect(page).toHaveURL(new RegExp(`search=${ua.course.code}`), { timeout: 15_000 });
    await expect(page.getByText("1 course found")).toBeVisible();
    await expect(courseLink(page, ua.course.atCourseId)).toBeVisible();
  });

  test("the list shows in-unit courses and hides courses from other units", async ({ page }) => {
    await signInThroughPage(page, ua, `${AI_TUTOR_URL}/instructor`);

    await searchFor(page, ua.course.code);
    await expect(courseLink(page, ua.course.atCourseId)).toBeVisible();

    // The out-of-unit course exists and is searchable by an instructor, but a
    // unit admin's list is scoped to authorizedUnits, so it must not appear.
    await page.goto(`${AI_TUTOR_URL}/instructor?search=${ua.outOfUnit.code}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByText("No courses match")).toBeVisible();
    await expect(courseLink(page, ua.outOfUnit.atCourseId)).toHaveCount(0);
  });

  test("the Status filter narrows the list to drafts", async ({ page }) => {
    await signInThroughPage(page, ua, `${AI_TUTOR_URL}/instructor`);
    await searchFor(page, ua.course.code);

    // The filters are Select comboboxes, not buttons.
    await chooseFilter(page, "Status", "Draft");

    // The fixture course is unpublished, so it survives a draft-only filter.
    await expect(courseLink(page, ua.course.atCourseId)).toBeVisible();
    await expect(page.getByRole("button", { name: "Clear" })).toBeVisible();
  });

  test("the Term filter narrows the list to the course's term", async ({ page }) => {
    await signInThroughPage(page, ua, `${AI_TUTOR_URL}/instructor`);
    await searchFor(page, ua.course.code);

    await chooseFilter(page, "Term", "2026W1");

    await expect(courseLink(page, ua.course.atCourseId)).toBeVisible();
  });

  test("Clear resets the search and filters back to the full unit list", async ({ page }) => {
    await signInThroughPage(page, ua, `${AI_TUTOR_URL}/instructor`);
    await searchFor(page, ua.course.code);
    await expect(page.getByText("1 course found")).toBeVisible();

    await page.getByRole("button", { name: "Clear" }).click();

    await expect(page.getByText("1 course found")).toHaveCount(0);
    await expect(page.getByRole("searchbox", { name: "Search courses" })).toHaveValue("");
  });

  test("the pager walks the unit list and keeps the page in the URL", async ({ page }) => {
    await signInThroughPage(page, ua, `${AI_TUTOR_URL}/instructor`);

    const next = page.getByRole("button", { name: "Next" });
    await expect(next).toBeVisible();

    if (await next.isEnabled()) {
      await next.click();
      // #1162: the page lives in the URL so it survives a reload.
      await page.waitForURL(/[?&]page=2/);
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page).toHaveURL(/[?&]page=2/);
      await expect(page.getByRole("button", { name: "Previous" })).toBeEnabled();
    } else {
      // A unit with a single page still renders a disabled pager.
      await expect(page.getByRole("button", { name: "Previous" })).toBeDisabled();
    }
  });

  test("a course card opens the course detail page", async ({ page }) => {
    await signInThroughPage(page, ua, `${AI_TUTOR_URL}/instructor`);
    await searchFor(page, ua.course.code);

    await courseLink(page, ua.course.atCourseId).click();

    await page.waitForURL(`${AI_TUTOR_URL}/instructor/courses/${ua.course.atCourseId}`);
    // The Content tab is the landing tab of the course detail page.
    await expect(page.getByRole("tab", { name: "Content" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Modules", exact: true })).toBeVisible();
  });

  test("a course mirrored from Core is badged as such", async ({ page }) => {
    await signInThroughPage(page, ua, `${AI_TUTOR_URL}/instructor`);
    await searchFor(page, ua.course.code);

    // The card's clickable <a> is a transparent overlay carrying only an
    // aria-label, so the badges have to be read from the card body around it.
    await expect(courseLink(page, ua.course.atCourseId)).toHaveAttribute(
      "aria-label",
      new RegExp(ua.course.code),
    );
    // Search has narrowed the list to this one card, so these are unambiguous:
    // every course a unit admin can see arrived from Core, and this one is a draft.
    await expect(page.getByText("EduAI", { exact: true })).toBeVisible();
    await expect(page.getByText("Draft", { exact: true })).toBeVisible();
  });
});
