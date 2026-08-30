/**
 * AI Tutor UNIT_ADMIN — course detail workflows (browser-driven).
 *
 * `getCourseDetailTabs()` gives a unit admin the full four-tab set — Content,
 * Submissions, Feedback and Analytics — because `canViewCourseAnalytics()` and
 * `canViewCourseFeedback()` both admit the `unit` access level. This file
 * walks each tab, the breadcrumb course switcher, and the two module-list
 * entry points (add and import) that `canManageContent()` unlocks.
 *
 * Course publish state is read-only *here*: this page renders it as a badge and
 * offers no toggle. That is a statement about this screen, not about the app —
 * the dashboard's "Needs attention" panel does publish a course (through Core,
 * which owns the flag), and `PATCH /api/courses/:id/publish` has always
 * admitted this role. See unit-admin-dashboard.spec.ts.
 */
import { test, expect } from "@playwright/test";
import { AI_TUTOR_API_URL, AI_TUTOR_URL } from "../../playwright.config";
import { signInThroughPage } from "../helpers/auth";
import { createUnitAdmin, type UnitAdminFixture } from "../helpers/at-unit-admin";
import { openTab } from "../helpers/at-ui";

let ua: UnitAdminFixture;
let coursePath: string;
/** A module the instructor authored, so the Content tab is not empty. */
const MODULE_TITLE = "Course Detail Module";
/** A module in the *second* in-unit course — the import dialog's copy source. */
const SOURCE_MODULE_TITLE = "Importable Source Module";
/**
 * Every tab but Content paints its copy only after its own fetch resolves, so
 * the first assertion after a tab switch is waiting on a request, not on a
 * render. Playwright's 5s default is not enough for that under merge-queue
 * load — this is the queue's most frequent red. Matches the timeout
 * admin-course-oversight.spec.ts already gives the same Submissions copy.
 */
const PANEL_LOAD_TIMEOUT = 20_000;

test.beforeAll(async ({ playwright }) => {
  const ctx = await playwright.request.newContext();
  try {
    // The second in-unit course is what the import dialog copies from and what
    // the breadcrumb switcher switches to — neither is exercisable against a
    // single course.
    ua = await createUnitAdmin(playwright, ctx, { secondCourse: true });
  } finally {
    await ctx.dispose();
  }
  coursePath = `${AI_TUTOR_URL}/instructor/courses/${ua.course.atCourseId}`;

  // Seeded through the API rather than the UI: this file is about reading the
  // course detail screen, and authoring has its own spec.
  const res = await ua.instrCtx.post(
    `${AI_TUTOR_API_URL}/api/courses/${ua.course.atCourseId}/modules`,
    { data: { title: MODULE_TITLE } },
  );
  expect(res.status()).toBe(201);

  const sourceRes = await ua.instrCtx.post(
    `${AI_TUTOR_API_URL}/api/courses/${ua.second!.atCourseId}/modules`,
    { data: { title: SOURCE_MODULE_TITLE } },
  );
  expect(sourceRes.status()).toBe(201);
});

test.afterAll(async () => {
  await ua?.dispose();
});

/**
 * The course switcher's search field. It is an `<input role="searchbox">`
 * labelled by its own placeholder, not a combobox — so a `getByRole("combobox")`
 * query inside the popover finds nothing.
 */
function searchCourses(page: import("@playwright/test").Page) {
  return page.getByRole("searchbox", { name: /Search courses/ });
}

test.describe("UNIT_ADMIN course detail", () => {
  test("the hero shows the course identity and its Core-owned publish state", async ({ page }) => {
    await signInThroughPage(page, ua, coursePath);

    await expect(page.getByRole("heading", { name: ua.course.name, level: 1 })).toBeVisible();
    await expect(page.getByText(`${ua.course.code} · 2026-27W1`)).toBeVisible();
    // Read-only badge. The one course-publish control in the app lives on the
    // dashboard's drafts panel; this page shows state without an action, so a
    // toggle appearing here would be a second, unreviewed entry point.
    await expect(page.getByText("Draft", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /^(Publish|Unpublish) course/ })).toHaveCount(0);
  });

  test("all four staff tabs are offered to a unit admin", async ({ page }) => {
    await signInThroughPage(page, ua, coursePath);

    for (const tab of ["Content", "Submissions", "Feedback", "Analytics"]) {
      await expect(page.getByRole("tab", { name: tab })).toBeVisible();
    }
  });

  test("the Content tab lists modules and offers the authoring actions", async ({ page }) => {
    await signInThroughPage(page, ua, coursePath);

    await expect(page.getByRole("heading", { name: "Modules", exact: true })).toBeVisible();
    // PermissionGate(perms.canManageContent) — a unit admin resolves to the
    // `unit` access level, which canManageContent() admits.
    await expect(page.getByRole("button", { name: "Add module" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Import", exact: true })).toBeVisible();
    await expect(page.getByRole("searchbox", { name: "Search modules" })).toBeVisible();
  });

  test("the Submissions tab renders the course grading rollup", async ({ page }) => {
    await signInThroughPage(page, ua, coursePath);

    await openTab(page, "Submissions");

    await expect(page.getByText("Student answer attempts in this course.")).toBeVisible({
      timeout: PANEL_LOAD_TIMEOUT,
    });
    for (const tile of ["Needs grading", "Correct", "Pass rate"]) {
      await expect(page.getByText(tile, { exact: true })).toBeVisible();
    }
  });

  test("the Feedback tab renders its filters and pager", async ({ page }) => {
    await signInThroughPage(page, ua, coursePath);

    await openTab(page, "Feedback");

    await expect(page.getByText("Student activity feedback in this course.")).toBeVisible({
      timeout: PANEL_LOAD_TIMEOUT,
    });
    await expect(page.getByRole("button", { name: "Apply filters" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Previous" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Next" })).toBeVisible();
  });

  test("the Feedback filters validate, apply and clear", async ({ page }) => {
    await signInThroughPage(page, ua, coursePath);
    await openTab(page, "Feedback");
    await expect(page.getByText("Student activity feedback in this course.")).toBeVisible({
      timeout: PANEL_LOAD_TIMEOUT,
    });

    // A non-numeric Activity ID is rejected in the client before any request —
    // an assertion that holds whether or not the course has feedback rows, so
    // this exercises the filter rather than the (empty) fixture data.
    await page.getByLabel("Activity ID").fill("not-a-number");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page.getByText("Activity ID must be a number.")).toBeVisible();

    // A well-formed filter applies and leaves the empty state intact.
    await page.getByLabel("Activity ID").fill("999999");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page.getByText("Activity ID must be a number.")).toHaveCount(0);
    await expect(page.getByText("No feedback yet.")).toBeVisible();

    await page.getByRole("button", { name: "Clear" }).click();
    await expect(page.getByLabel("Activity ID")).toHaveValue("");
    await expect(page.getByLabel("Student ID")).toHaveValue("");
  });

  test("the Analytics tab renders the course and per-student panels", async ({ page }) => {
    await signInThroughPage(page, ua, coursePath);

    await openTab(page, "Analytics");

    for (const tile of ["Students", "Submissions", "Accuracy", "Avg rating", "Help requests"]) {
      await expect(page.getByText(tile, { exact: true }).first()).toBeVisible({
        timeout: PANEL_LOAD_TIMEOUT,
      });
    }
    // Panel titles are card titles, not headings.
    await expect(
      page.getByText("Aggregate ratings and difficulty signals per activity."),
    ).toBeVisible();
    await expect(page.getByText("Per-student activity performance.")).toBeVisible();
  });

  test("the Add module dialog names the course it will write into", async ({ page }) => {
    await signInThroughPage(page, ua, coursePath);

    await page.getByRole("button", { name: "Add module" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Add module" })).toBeVisible();
    await expect(dialog).toContainText(`Create a new module in ${ua.course.name}`);
    await expect(dialog.getByLabel("Module title")).toBeVisible();

    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
  });

  test("the Import dialog offers to copy modules from another course", async ({ page }) => {
    await signInThroughPage(page, ua, coursePath);

    await page.getByRole("button", { name: "Import", exact: true }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Import modules" })).toBeVisible();
    await expect(dialog).toContainText(`into ${ua.course.name}`);
    await expect(dialog.getByText("Choose course to copy")).toBeVisible();
    // Nothing is copied until a source course is chosen.
    await expect(dialog.getByText("Select a course to preview its modules.")).toBeVisible();

    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
  });

  test("choosing a source course previews its modules before anything is copied", async ({
    page,
  }) => {
    await signInThroughPage(page, ua, coursePath);

    await page.getByRole("button", { name: "Import", exact: true }).click();
    const dialog = page.getByRole("dialog");

    // Import is unusable until a source is picked, so the earlier test's
    // placeholder assertion proves nothing about the copy flow itself.
    await expect(dialog.getByRole("button", { name: "Import modules" })).toBeDisabled();

    await dialog.getByRole("combobox").first().click();
    await page.getByRole("option", { name: ua.second!.name, exact: true }).click();

    // The preview is the safety rail: the source's modules are named before any
    // copy happens, and the action stays disabled until one is actually ticked.
    await expect(
      dialog.getByText("Select modules to import (lessons and activities included)."),
    ).toBeVisible();
    await expect(dialog.getByText(SOURCE_MODULE_TITLE)).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Import modules" })).toBeDisabled();

    await dialog.getByText(SOURCE_MODULE_TITLE).click();
    await expect(dialog.getByRole("button", { name: "Import 1 module" })).toBeEnabled();

    // Cancel — this test is about the preview contract, and copying would
    // mutate the shared fixture course out from under the other tests here.
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
  });

  test("the breadcrumb course switcher jumps between courses in the unit", async ({ page }) => {
    await signInThroughPage(page, ua, coursePath);

    await expect(page.getByRole("button", { name: "Switch course" })).toBeVisible();
    await page.getByRole("button", { name: "Switch course" }).click();

    // The switcher is fed by the same unit-scoped list, so the out-of-unit
    // course can never be reached through it.
    const popover = page.locator("[role=dialog], [role=menu], [role=listbox]").last();
    await expect(popover).toBeVisible();
    await expect(popover).not.toContainText(ua.outOfUnit.code);

    // Searching for the out-of-unit course by name must not surface it either —
    // the list is searched server-side, so an unlisted course is not merely
    // "past the first page".
    await searchCourses(page).fill(ua.outOfUnit.name);
    await expect(page.getByText("No courses match")).toBeVisible();
  });

  test("the breadcrumb switcher moves to another course in the unit", async ({ page }) => {
    await signInThroughPage(page, ua, coursePath);

    await page.getByRole("button", { name: "Switch course" }).click();
    await expect(searchCourses(page)).toBeVisible();

    // Search rather than scroll: the switcher loads one page of a shared
    // database, so the target is only reliably present once narrowed to it.
    await searchCourses(page).fill(ua.second!.name);
    await page.getByText(ua.second!.name).first().click();

    await page.waitForURL(`${AI_TUTOR_URL}/instructor/courses/${ua.second!.atCourseId}`);
    await expect(page.getByRole("heading", { name: ua.second!.name, level: 1 })).toBeVisible();
  });

  test("the module search box narrows the list and records it in the URL", async ({ page }) => {
    await signInThroughPage(page, ua, coursePath);
    await expect(page.getByRole("button", { name: new RegExp(MODULE_TITLE) })).toBeVisible();

    // Retry the fill until the *URL* moves, not until the box holds the text.
    // A keystroke landing before the input has hydrated sets the DOM value
    // without ever reaching React's onChange, so the debounce never fires:
    // `toHaveValue` passes while nothing at all has happened. Asserting on the
    // effect is what makes the retry meaningful.
    //
    // #1207: module search is applied server-side and recorded in the URL, so a
    // narrowed list is bookmarkable.
    const box = page.getByRole("searchbox", { name: "Search modules" });
    await expect(async () => {
      await box.fill("Detail");
      await expect(page).toHaveURL(/[?&]search=Detail/, { timeout: 3_000 });
    }).toPass({ timeout: 30_000 });

    await expect(page.getByRole("button", { name: new RegExp(MODULE_TITLE) })).toBeVisible();

    // A term that matches nothing empties the list rather than falling back to
    // an unfiltered one — the #1207 failure mode being guarded against.
    await expect(async () => {
      await box.fill("no-such-module-zzz");
      await expect(page).toHaveURL(/[?&]search=no-such-module-zzz/, { timeout: 3_000 });
    }).toPass({ timeout: 30_000 });

    await expect(page.getByRole("button", { name: new RegExp(MODULE_TITLE) })).toHaveCount(0);
    await expect(page.getByText("No modules match your search.")).toBeVisible();
  });
});
