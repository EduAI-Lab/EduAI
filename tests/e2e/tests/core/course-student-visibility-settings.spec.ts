/**
 * #2071, #2061: the course Settings tab's "What students see" card, clicked
 * through as the course's instructor. One "Show course materials to students"
 * checkbox shows or hides every file and topic after asking; "Choose by topic"
 * opens each topic; "Let students browse files" saves as soon as it is flipped.
 * Each test then checks what an enrolled student gets from the API, so a card
 * that only looks right cannot pass. Files under a hidden topic are covered
 * against real Postgres by student-file-visibility.integration.test.ts.
 *
 * Setup mirrors student-from-scratch-grounded-chat.spec.ts (createAdmin /
 * createInstructor / registerUser / enroll / publish / injectSession).
 */
import {
  test,
  expect,
  type APIRequestContext,
  type Page,
  type PlaywrightWorkerArgs,
} from "@playwright/test";
import { CORE_URL } from "../../playwright.config";
import { createAdmin, createInstructor, registerUser } from "../helpers/auth";

const TOPICS = ["Recursion", "Sorting"];

interface CourseSetup {
  courseId: string;
  instrCtx: APIRequestContext;
  studentCtx: APIRequestContext;
  dispose: () => Promise<void>;
}

async function getMyId(ctx: APIRequestContext): Promise<string> {
  const res = await ctx.get(`${CORE_URL}/api/me`);
  expect(res.status(), await res.text()).toBe(200);
  const profile = (await res.json()) as { id: string };
  return profile.id;
}

/** A published course with this instructor and one enrolled student, and no topics yet. */
async function setUpCourse(playwright: PlaywrightWorkerArgs["playwright"]): Promise<CourseSetup> {
  const adminCtx = await playwright.request.newContext();
  const instrCtx = await playwright.request.newContext();
  const studentCtx = await playwright.request.newContext();
  const dispose = async () => {
    await adminCtx.dispose();
    await instrCtx.dispose();
    await studentCtx.dispose();
  };
  try {
    await createInstructor(instrCtx, { prefix: "sv-instr" });
    const instrId = await getMyId(instrCtx);
    await createAdmin(adminCtx, { prefix: "sv-admin" });
    await registerUser(studentCtx, { prefix: "sv-student" });
    const studentId = await getMyId(studentCtx);

    // Random per call: a retry re-enters in the same worker and would hit COURSE_IDENTITY_TAKEN.
    const code = `SVS-${Math.floor(Math.random() * 1e5)}`;
    const createRes = await adminCtx.post(`${CORE_URL}/api/courses`, {
      form: {
        name: "E2E Student Visibility",
        code,
        section: "001",
        term: "W1",
        year: "2026",
        startDate: "2026-09-08",
        department: "COSC",
        instructorUserIds: instrId,
      },
    });
    const createBody = await createRes.text();
    expect(createRes.status(), createBody).toBe(201);
    const courseId = (JSON.parse(createBody) as { id: string }).id;

    const enrollRes = await adminCtx.post(`${CORE_URL}/api/courses/${courseId}/enrollments`, {
      data: { userId: studentId, role: "STUDENT" },
    });
    expect(enrollRes.status(), await enrollRes.text()).toBe(201);
    const pubRes = await adminCtx.patch(`${CORE_URL}/api/courses/${courseId}/publish`);
    expect(pubRes.status(), await pubRes.text()).toBe(200);

    return { courseId, instrCtx, studentCtx, dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}

/** Instructor-created topics are approved on creation. */
async function addTopics(course: CourseSetup, names: string[]): Promise<void> {
  for (const name of names) {
    const res = await course.instrCtx.post(`${CORE_URL}/api/courses/${course.courseId}/topics`, {
      data: { name },
    });
    expect(res.status(), await res.text()).toBe(201);
  }
}

/** The topic names an enrolled student is given. */
async function studentTopics(course: CourseSetup): Promise<string[]> {
  const res = await course.studentCtx.get(`${CORE_URL}/api/courses/${course.courseId}/topics`);
  expect(res.status(), await res.text()).toBe(200);
  const body = (await res.json()) as { topics: { name: string }[] };
  return body.topics.map((topic) => topic.name).sort();
}

async function studentMaterialsStatus(course: CourseSetup): Promise<number> {
  const res = await course.studentCtx.get(`${CORE_URL}/api/courses/${course.courseId}/materials`);
  return res.status();
}

async function openSettings(page: Page, course: CourseSetup): Promise<void> {
  const { cookies } = await course.instrCtx.storageState();
  await page.context().addCookies(cookies);
  // The dashboard tour's overlay would intercept clicks (see core-admin-unitadmin-instructor-ui.spec.ts).
  await page.addInitScript(() => window.localStorage.setItem("eduai:tour:dashboard:v1", "1"));
  await page.goto(`${CORE_URL}/courses/${course.courseId}`);
  await expect(page).not.toHaveURL(/\/auth\/login/);
  await page.getByRole("tab", { name: "Settings" }).click();
  // Present whether or not the course has topics yet, once the card has loaded.
  await expect(browseSwitch(page)).toBeVisible({ timeout: 15_000 });
}

const allCheckbox = (page: Page) =>
  page.getByRole("checkbox", { name: "Show course materials to students" });
const browseSwitch = (page: Page) =>
  page.getByRole("switch", { name: "Let students browse files" });
const confirmDialog = (page: Page) => page.getByRole("alertdialog");

let course: CourseSetup;

test.beforeEach(async ({ playwright }) => {
  test.setTimeout(120_000);
  course = await setUpCourse(playwright);
});

test.afterEach(async () => {
  await course.dispose();
});

test.describe("What students see: one checkbox, then by topic (#2061)", () => {
  test("the checkbox hides everything from students after asking, and shows it again", async ({
    page,
  }) => {
    await addTopics(course, TOPICS);
    await openSettings(page, course);
    await expect(allCheckbox(page)).toHaveAttribute("data-state", "checked");

    await allCheckbox(page).click();
    await expect(confirmDialog(page)).toContainText("Hide all materials from students?");
    await confirmDialog(page).getByRole("button", { name: "Hide all materials" }).click();
    await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
    await expect(allCheckbox(page)).toHaveAttribute("data-state", "unchecked");
    expect(await studentTopics(course)).toEqual([]);

    // Stored, not just on screen.
    await page.reload();
    await page.getByRole("tab", { name: "Settings" }).click();
    await expect(allCheckbox(page)).toHaveAttribute("data-state", "unchecked");

    await allCheckbox(page).click();
    await expect(confirmDialog(page)).toContainText(
      "Every hidden topic will be shown to students.",
    );
    await confirmDialog(page).getByRole("button", { name: "Show files" }).click();
    await expect(allCheckbox(page)).toHaveAttribute("data-state", "checked");
    await expect.poll(() => studentTopics(course)).toEqual(TOPICS);
  });

  test("hiding one topic under Choose by topic leaves the checkbox part-ticked", async ({
    page,
  }) => {
    await addTopics(course, TOPICS);
    await openSettings(page, course);

    await page.getByRole("button", { name: "Choose by topic" }).click();
    const sorting = page.getByRole("checkbox", { name: "Sorting" });
    await sorting.click();

    await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
    await expect(sorting).toHaveAttribute("data-state", "unchecked");
    await expect(allCheckbox(page)).toHaveAttribute("data-state", "indeterminate");
    await expect(page.getByText("1 topic is hidden.", { exact: false })).toBeVisible();
    expect(await studentTopics(course)).toEqual(["Recursion"]);

    // Showing the topic again needs no confirmation: no file was hidden on its own.
    await sorting.click();
    await expect(sorting).toHaveAttribute("data-state", "checked");
    await expect.poll(() => studentTopics(course)).toEqual(TOPICS);
  });

  test("the browse switch lets students list the course's files, and nothing else changes", async ({
    page,
  }) => {
    await addTopics(course, TOPICS);
    expect(await studentMaterialsStatus(course)).toBe(403);
    await openSettings(page, course);

    await expect(browseSwitch(page)).not.toBeChecked();
    await browseSwitch(page).click();

    await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
    expect(await studentMaterialsStatus(course)).toBe(200);
    await expect(allCheckbox(page)).toHaveAttribute("data-state", "checked");
    expect(await studentTopics(course)).toEqual(TOPICS);
  });

  test("cancelling the confirmation changes nothing", async ({ page }) => {
    await addTopics(course, TOPICS);
    await openSettings(page, course);
    const saves: string[] = [];
    page.on("request", (request) => {
      if (request.url().endsWith("/student-visibility") && request.method() !== "GET") {
        saves.push(request.method());
      }
    });

    await allCheckbox(page).click();
    await confirmDialog(page).getByRole("button", { name: "Cancel" }).click();
    await expect(confirmDialog(page)).toBeHidden();

    await expect(allCheckbox(page)).toHaveAttribute("data-state", "checked");
    expect(saves).toEqual([]);
    expect(await studentTopics(course)).toEqual(TOPICS);
  });

  test("a course with no files or topics points to the Materials tab", async ({ page }) => {
    await openSettings(page, course);

    await expect(page.getByText("No files yet. Upload them on the Materials tab.")).toBeVisible();
    await expect(allCheckbox(page)).toHaveCount(0);

    await addTopics(course, ["Recursion"]);
    await page.reload();
    await page.getByRole("tab", { name: "Settings" }).click();
    await expect(allCheckbox(page)).toHaveAttribute("data-state", "checked");
  });
});
