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
    await expect(
      assessmentsPanel.getByText(/No questions yet — open to start building/),
    ).toBeVisible();
  } finally {
    await instructor.dispose();
  }
});
