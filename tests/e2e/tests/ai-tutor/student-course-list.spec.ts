/**
 * AI Tutor — STUDENT course list (`/student`), driven through the browser.
 *
 * The list is scoped to the student's enrolments and applies search, term and
 * progress filters SERVER-side across every enrolled course (#1208), with a
 * pager and an upper-bound `?page=` correction. Covers the empty state, the
 * no-results state, filter facets, pagination, and the enrolment/publish gate
 * (only published courses the student is enrolled in appear).
 *
 * Path inventory: `docs/end-to-end-user-workflows/ai-tutor-workflows.md`.
 */
import { test, expect } from "@playwright/test";
import { gotoAiTutor, loginAsStudent } from "../helpers/at-ui";
import { registerStudent, seedPublishedCourseAndEnroll } from "../helpers/at-student-fixtures";
import { seedCourseWithActivity } from "../helpers/at-admin-fixtures";

test.describe("AI Tutor STUDENT — course list empty state", () => {
  test("a student with no enrolments sees the 'No courses yet' empty state", async ({ page }) => {
    await loginAsStudent(page, "at-student-list-empty");
    await gotoAiTutor(page, "/student");
    await expect(page.getByRole("heading", { name: /No courses yet/i })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText(/not enrolled in any published courses yet/i)).toBeVisible();
  });
});

test.describe("AI Tutor STUDENT — enrolled course list", () => {
  test("an enrolled published course appears and its card opens the course", async ({
    page,
    playwright,
  }) => {
    const { studentId } = await registerStudent(page);
    const seeded = await seedPublishedCourseAndEnroll(playwright, studentId, {
      name: "Enrolled Visible Course",
      codePrefix: "EVC",
    });
    try {
      await gotoAiTutor(page, "/student");
      // The card is covered by a full-bleed anchor (aria-label = "CODE Name"),
      // so click that link rather than the text under it.
      const card = page.getByRole("link", { name: new RegExp(seeded.name) }).first();
      await expect(card).toBeVisible({ timeout: 20_000 });
      await card.click();
      await expect(page).toHaveURL(new RegExp(`/student/courses/${seeded.atCourseId}$`), {
        timeout: 20_000,
      });
    } finally {
      await seeded.dispose();
    }
  });

  test("searching by title narrows the list to the matching course", async ({
    page,
    playwright,
  }) => {
    const { studentId } = await registerStudent(page);
    const stamp = Date.now();
    const first = await seedPublishedCourseAndEnroll(playwright, studentId, {
      name: `Searchable Alpha ${stamp}`,
      codePrefix: "SRA",
    });
    const second = await seedPublishedCourseAndEnroll(playwright, studentId, {
      name: `Searchable Beta ${stamp}`,
      codePrefix: "SRB",
    });
    try {
      await gotoAiTutor(page, "/student");
      await expect(page.getByText(first.name).first()).toBeVisible({ timeout: 20_000 });

      await page.getByRole("searchbox").first().fill(`Alpha ${stamp}`);
      await expect(page.getByText(first.name).first()).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(second.name)).toHaveCount(0);
    } finally {
      await first.dispose();
      await second.dispose();
    }
  });

  test("a search that matches nothing shows the 'No courses match' state", async ({
    page,
    playwright,
  }) => {
    const { studentId } = await registerStudent(page);
    const seeded = await seedPublishedCourseAndEnroll(playwright, studentId, {
      name: "No Match Host Course",
      codePrefix: "NMH",
    });
    try {
      await gotoAiTutor(page, "/student");
      await expect(page.getByText(seeded.name).first()).toBeVisible({ timeout: 20_000 });

      await page.getByRole("searchbox").first().fill(`zzz-no-such-course-${Date.now()}`);
      await expect(page.getByText(/No courses match/i)).toBeVisible({ timeout: 20_000 });
    } finally {
      await seeded.dispose();
    }
  });
});

test.describe("AI Tutor STUDENT — course list filters and pagination", () => {
  test("the term filter narrows the list and Clear resets it", async ({ page, playwright }) => {
    const { studentId } = await registerStudent(page);
    // Two enrolled courses in different terms so the term filter has >1 value
    // and therefore renders (it hides when a single term is present).
    const w1 = await seedPublishedCourseAndEnroll(playwright, studentId, {
      name: "Term Winter One Course",
      codePrefix: "TW1",
      term: "W1",
    });
    const w2 = await seedPublishedCourseAndEnroll(playwright, studentId, {
      name: "Term Winter Two Course",
      codePrefix: "TW2",
      term: "W2",
    });
    try {
      await gotoAiTutor(page, "/student");
      await expect(page.getByText(w1.name).first()).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(w2.name).first()).toBeVisible();

      await page.getByRole("combobox").filter({ hasText: "Term" }).click();
      await page.getByRole("option", { name: "2026W2", exact: true }).click();
      await expect(page).toHaveURL(/term=W2/, { timeout: 20_000 });
      await expect(page.getByText(w2.name).first()).toBeVisible();
      await expect(page.getByText(w1.name)).toHaveCount(0);

      await page
        .getByRole("button", { name: /^clear/i })
        .first()
        .click();
      await expect(page).not.toHaveURL(/term=W2/, { timeout: 20_000 });
      await expect(page.getByText(w1.name).first()).toBeVisible();
    } finally {
      await w1.dispose();
      await w2.dispose();
    }
  });

  test("the progress filter is applied server-side across every enrolled course", async ({
    page,
    playwright,
  }) => {
    // #1208: the progress filter runs in the loader (`?progress=`), spanning all
    // enrolments rather than the loaded page. A freshly seeded course is
    // not-started, so `progress=completed` must exclude it while
    // `progress=not-started` keeps it.
    const { studentId } = await registerStudent(page);
    const seeded = await seedPublishedCourseAndEnroll(playwright, studentId, {
      name: "Progress Filter Course",
      codePrefix: "PGF",
    });
    try {
      await gotoAiTutor(page, "/student?progress=not-started");
      await expect(page.getByText(seeded.name).first()).toBeVisible({ timeout: 20_000 });

      // `progress=completed` excludes the not-started course server-side, so it
      // is gone and the list falls back to its empty heading.
      await gotoAiTutor(page, "/student?progress=completed");
      await expect(page.getByRole("heading", { name: /No courses/i })).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.getByText(seeded.name)).toHaveCount(0);
    } finally {
      await seeded.dispose();
    }
  });

  test("a past-the-end ?page= is corrected to the last real page", async ({ page, playwright }) => {
    // The loader clamps an out-of-range page and redirects, carrying the search
    // params, rather than rendering an empty grid.
    const { studentId } = await registerStudent(page);
    const seeded = await seedPublishedCourseAndEnroll(playwright, studentId, {
      name: "Pagination Clamp Course",
      codePrefix: "PGC",
    });
    try {
      await gotoAiTutor(page, "/student?page=99");
      // Redirected onto a valid page (page=1 for a single-page list) with the
      // course still visible.
      await expect(page).toHaveURL(/page=1/, { timeout: 20_000 });
      await expect(page.getByText(seeded.name).first()).toBeVisible();
    } finally {
      await seeded.dispose();
    }
  });
});

test.describe("AI Tutor STUDENT — course list enrolment/publish gate", () => {
  test("a published course the student is NOT enrolled in does not appear", async ({
    page,
    playwright,
  }) => {
    // A published course exists on the platform, but this student is enrolled in
    // nothing — the enrolment gate must keep it off their list, so the empty
    // state stands.
    await loginAsStudent(page, "at-student-list-gate");
    const seeded = await seedCourseWithActivity(playwright, {
      name: "Unenrolled Published Course",
      codePrefix: "UPC",
      publish: true,
    });
    try {
      await gotoAiTutor(page, "/student");
      await expect(page.getByRole("heading", { name: /No courses yet/i })).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.getByText("Unenrolled Published Course")).toHaveCount(0);
    } finally {
      await seeded.dispose();
    }
  });
});
