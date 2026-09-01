/**
 * AI Tutor — TA on the per-activity AI-config page, through the browser.
 *
 * `/instructor/lesson/:id` (`routes/instructor.lesson.tsx`) admits a TA
 * (`requireClientUser(["INSTRUCTOR","UNIT_ADMIN","TA","ADMIN"])`). It is the
 * heaviest authoring surface in the app, so what a TA is and is NOT handed here
 * matters:
 *   - the activity list renders (a TA reads content, drafts included);
 *   - the per-activity edit / duplicate / remove affordances are behind the
 *     `canManageContent` PermissionGate and so are absent for a TA;
 *   - the "AI study buddy" mode/topic authoring controls and the Topics editor
 *     are also behind `canManageContent` (the U-TA-2 fix), so a TA sees the
 *     read-only "Question details" card, not dead controls. (The server backstop
 *     — `PATCH /activities/:id` 403 for a TA — is pinned in `ta-security.spec.ts`.)
 *
 * Path inventory: `docs/end-to-end-user-workflows/ai-tutor-workflows.md` (TA).
 */
import { test, expect, type Page } from "@playwright/test";
import { gotoAiTutor } from "../helpers/at-ui";
import { registerStudent, seedPublishedCourseAndEnroll } from "../helpers/at-student-fixtures";

type Pw = { request: { newContext: () => Promise<import("@playwright/test").APIRequestContext> } };

/** The AI mode chips are `aria-pressed` toggles, not checkboxes. */
function modeChip(page: Page, label: string) {
  return page.getByRole("button", { name: label, exact: true });
}

async function seedTaCourse(page: Page, playwright: Pw, codePrefix = "TAC") {
  const { studentId } = await registerStudent(page);
  const seeded = await seedPublishedCourseAndEnroll(playwright, studentId, {
    name: "TA Activity Config Course",
    codePrefix,
    role: "TA",
  });
  return { studentId, seeded };
}

test.describe("AI Tutor TA — per-activity AI config is read-only", () => {
  test("the activity renders but no authoring affordances are offered", async ({
    page,
    playwright,
  }) => {
    const { seeded } = await seedTaCourse(page, playwright, "TA1");
    try {
      await gotoAiTutor(page, `/instructor/lesson/${seeded.lessonId}`);
      // The activity content loads for the TA (route + read authorised).
      await expect(page.getByText(seeded.question)).toBeVisible({ timeout: 20_000 });

      // `canManageContent` is false, so the per-activity edit / duplicate /
      // remove buttons (behind the PermissionGate) are absent.
      await expect(page.getByRole("button", { name: "Edit activity" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Duplicate activity" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Remove activity" })).toHaveCount(0);
    } finally {
      await seeded.dispose();
    }
  });

  test("the AI study buddy authoring controls are withheld from a TA (U-TA-2 fixed)", async ({
    page,
    playwright,
  }) => {
    const { seeded } = await seedTaCourse(page, playwright, "TA2");
    try {
      await gotoAiTutor(page, `/instructor/lesson/${seeded.lessonId}`);
      await expect(page.getByText(seeded.question)).toBeVisible({ timeout: 20_000 });

      // The AI study buddy + Topics authoring sections are gated behind
      // `canManageContent`, so none of their controls render for a TA — no dead
      // mode chips, no topic selects, no Save-prompt.
      await expect(page.getByText("AI study buddy")).toHaveCount(0);
      await expect(modeChip(page, "Guide me")).toHaveCount(0);
      await expect(modeChip(page, "Teach me")).toHaveCount(0);

      // Instead the TA gets the read-only detail card the student player uses.
      await expect(page.getByRole("button", { name: /question details/i })).toBeVisible();
    } finally {
      await seeded.dispose();
    }
  });
});
