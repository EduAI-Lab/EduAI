/** UI regression for the Instructor assessment-authoring happy path (#1429, #1530). */
import { test, expect } from "@playwright/test";
import { QM_FRONTEND_URL } from "../../playwright.config";
import { createInstructor, signInThroughPage } from "../helpers/auth";
import { createQmCourseForInstructor } from "../helpers/qm-courses";

test("INSTRUCTOR creates an assessment blueprint through the Question Maker UI", async ({
  page,
  playwright,
}) => {
  const instructor = await playwright.request.newContext();
  try {
    const user = await createInstructor(instructor, { prefix: "qm-assessment-ui" });
    const { qmCourseId } = await createQmCourseForInstructor(playwright, instructor, {
      name: "QM Assessment UI Workflow",
      code: "QM-ASSESS-UI",
    });
    await signInThroughPage(page, user, `${QM_FRONTEND_URL}/courses/${qmCourseId}?tab=assessments`);
    const assessmentsPanel = page.getByTestId("assessments-panel");
    await assessmentsPanel.getByRole("button", { name: "New assessment" }).click();
    await page.getByRole("textbox", { name: "Assessment name *" }).fill("E2E Assessment Blueprint");
    await page.getByRole("button", { name: "Create Blueprint" }).click();

    await expect(
      assessmentsPanel.getByText("E2E Assessment Blueprint", { exact: true }),
    ).toBeVisible();

    // Scope the empty-state assertion to the card this test just created. The
    // panel is never empty to begin with: `createQmCourseForInstructor` goes
    // through QM's Core-import flow, which seeds a starter "Practice Exam"
    // (#578), and `AssessmentSection` renders this same <p> inside *every*
    // card with no questions. A panel-wide `getByText` therefore matches both
    // cards and trips strict mode.
    const blueprintCard = assessmentsPanel.getByRole("button", {
      name: /E2E Assessment Blueprint/,
    });
    await expect(
      blueprintCard.getByText(/No questions yet — open to start building/),
    ).toBeVisible();
  } finally {
    await instructor.dispose();
  }
});
