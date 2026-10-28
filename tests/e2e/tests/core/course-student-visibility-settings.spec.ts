/**
 * #2071: the course Settings tab's "What students see" card, clicked through as
 * the course's instructor. One switch shows or hides every approved topic;
 * "File and topic settings" opens the file switch and the per-topic choices.
 * Each test then checks what an enrolled student gets from the API, so a card
 * that only looks right cannot pass.
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
  await expect(topicsSwitch(page)).toBeVisible({ timeout: 15_000 });
}

const topicsSwitch = (page: Page) => page.getByRole("switch", { name: "Show topics to students" });
const detailsDialog = (page: Page) => page.getByRole("dialog", { name: "File and topic settings" });

async function openDetails(page: Page): Promise<void> {
  await page.getByRole("button", { name: "File and topic settings" }).click();
  await expect(detailsDialog(page)).toBeVisible();
}

let course: CourseSetup;

test.beforeEach(async ({ playwright }) => {
  test.setTimeout(120_000);
  course = await setUpCourse(playwright);
});

test.afterEach(async () => {
  await course.dispose();
});

test.describe("What students see: one topics switch, the rest in File and topic settings (#2071)", () => {
  test("the switch hides every topic from students in one click, and shows them again", async ({
    page,
  }) => {
    await addTopics(course, TOPICS);
    await openSettings(page, course);

    await expect(topicsSwitch(page)).toBeChecked();
    await expect(
      page.getByText("Students see every approved topic", { exact: false }),
    ).toBeVisible();

    await topicsSwitch(page).click();
    await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
    await expect(topicsSwitch(page)).not.toBeChecked();
    await expect(
      page.getByText("Topic names are hidden from students", { exact: false }),
    ).toBeVisible();
    expect(await studentTopics(course)).toEqual([]);

    // Stored, not just on screen.
    await page.reload();
    await page.getByRole("tab", { name: "Settings" }).click();
    await expect(topicsSwitch(page)).not.toBeChecked();

    await topicsSwitch(page).click();
    await expect(topicsSwitch(page)).toBeChecked();
    await expect.poll(() => studentTopics(course)).toEqual(TOPICS);
  });

  test("hiding one topic in File and topic settings leaves the switch off and says how many are shown", async ({
    page,
  }) => {
    await addTopics(course, TOPICS);
    await openSettings(page, course);

    await openDetails(page);
    await detailsDialog(page).getByRole("checkbox", { name: "Sorting" }).click();
    await detailsDialog(page).getByRole("button", { name: "Save" }).click();

    await expect(detailsDialog(page)).toBeHidden();
    await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
    await expect(topicsSwitch(page)).not.toBeChecked();
    await expect(
      page.getByText("1 of 2 topics are shown. Choose which in File and topic settings."),
    ).toBeVisible();
    expect(await studentTopics(course)).toEqual(["Recursion"]);

    // From the mixed state, one click shows them all.
    await topicsSwitch(page).click();
    await expect(topicsSwitch(page)).toBeChecked();
    await expect.poll(() => studentTopics(course)).toEqual(TOPICS);
  });

  test("turning on course files in File and topic settings lets students list them", async ({
    page,
  }) => {
    await addTopics(course, TOPICS);
    expect(await studentMaterialsStatus(course)).toBe(403);
    await openSettings(page, course);

    await openDetails(page);
    const filesSwitch = detailsDialog(page).getByRole("switch", {
      name: "Let students see course files",
    });
    await expect(filesSwitch).not.toBeChecked();
    await filesSwitch.click();
    await detailsDialog(page).getByRole("button", { name: "Save" }).click();

    await expect(detailsDialog(page)).toBeHidden();
    await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
    expect(await studentMaterialsStatus(course)).toBe(200);
    // Only the file setting was sent: every topic is still shown.
    await expect(topicsSwitch(page)).toBeChecked();
    expect(await studentTopics(course)).toEqual(TOPICS);
  });

  test("closing File and topic settings without saving changes nothing", async ({ page }) => {
    await addTopics(course, TOPICS);
    await openSettings(page, course);
    const saves: string[] = [];
    page.on("request", (request) => {
      if (request.url().endsWith("/student-visibility")) saves.push(request.method());
    });

    await openDetails(page);
    await detailsDialog(page).getByRole("checkbox", { name: "Recursion" }).click();
    await detailsDialog(page)
      .getByRole("switch", { name: "Let students see course files" })
      .click();
    await detailsDialog(page).getByRole("button", { name: "Close" }).click();
    await expect(detailsDialog(page)).toBeHidden();

    await expect(topicsSwitch(page)).toBeChecked();
    await openDetails(page);
    await expect(detailsDialog(page).getByRole("checkbox", { name: "Recursion" })).toBeChecked();
    await expect(
      detailsDialog(page).getByRole("switch", { name: "Let students see course files" }),
    ).not.toBeChecked();
    await expect(detailsDialog(page).getByRole("button", { name: "Save" })).toBeDisabled();

    expect(saves).toEqual([]);
    expect(await studentTopics(course)).toEqual(TOPICS);
    expect(await studentMaterialsStatus(course)).toBe(403);
  });

  test("the switch is disabled until the course has an approved topic", async ({ page }) => {
    await openSettings(page, course);

    await expect(topicsSwitch(page)).toBeDisabled();
    await expect(page.getByText("No approved topics yet", { exact: false }).first()).toBeVisible();

    await addTopics(course, ["Recursion"]);
    await page.reload();
    await page.getByRole("tab", { name: "Settings" }).click();
    await expect(topicsSwitch(page)).toBeEnabled();
    await expect(topicsSwitch(page)).toBeChecked();
  });
});
