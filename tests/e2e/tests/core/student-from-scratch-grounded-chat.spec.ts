/**
 * First-run student walk (#1786): a brand-new student reaches course chat
 * after an instructor uploads a material for this course — nothing is
 * pre-seeded for THIS student.
 *
 * Setup mirrors `chat-code-block.spec.ts` (createAdmin / createInstructor /
 * registerUser / enroll / publish / injectSession).
 *
 * Upload is real. A 202 from POST /api/courses/:id/materials means PROCESSING,
 * not READY (#949). This spec polls GET materials until READY or FAILED and
 * never stubs that status.
 *
 * The docker e2e stack has no embedding or LLM provider, so a live `/api/chat`
 * reply cannot cite **Source** from the planted phrase in CI. The chat step
 * therefore mocks `/api/chat` only to prove the student composer works.
 * Grounding is not asserted in CI; see #1799.
 */
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { CORE_URL } from "../../playwright.config";
import { createAdmin, createInstructor, registerUser } from "../helpers/auth";

const RUN_SUFFIX = Date.now().toString().slice(-5);
const PLANTED_PHRASE = "QUOKKA_MIGRATION_WINDOW_17";
const MATERIAL_TITLE = "Quokka Migration Policy";
const MATERIAL_FILENAME = "Quokka Migration Policy.txt";
const MATERIAL_BODY = [
  "Quokka relocation policy for COSC.",
  `The official quokka relocation window is ${PLANTED_PHRASE}.`,
  "This phrase does not appear in any other EduAI fixture.",
].join("\n");
const STUDENT_QUESTION = "What is the official quokka relocation window code?";
const READY_POLL_MS = 60_000;

interface MeProfile {
  id: string;
}

interface MaterialUploadAccepted {
  materialId: string;
  status: string;
}

interface CourseMaterialRow {
  id: string;
  title: string;
  status: string;
}

interface MaterialsListResponse {
  materials: CourseMaterialRow[];
}

interface CourseCreateResponse {
  id: string;
}

async function getMyId(ctx: APIRequestContext): Promise<string> {
  const res = await ctx.get(`${CORE_URL}/api/me`);
  const profile = (await res.json()) as MeProfile;
  return profile.id;
}

function coursePayload(instrId: string, code: string) {
  return {
    name: "E2E From-Scratch Grounded Chat",
    code,
    section: "001",
    term: "W1",
    year: "2026",
    startDate: "2026-09-08",
    department: "COSC",
    instructorUserIds: instrId,
  };
}

/** AI SDK data-stream body (same shape as `formatDataStreamPart` from `ai`). */
function buildMockStreamBody(text: string): string {
  return `0:${JSON.stringify(text)}\nd:${JSON.stringify({ finishReason: "stop" })}\n`;
}

async function injectSession(page: Page, requestCtx: APIRequestContext): Promise<void> {
  const { cookies } = await requestCtx.storageState();
  await page.context().addCookies(cookies);
}

async function skipStudentIdOnboarding(page: Page): Promise<void> {
  await page.context().addCookies([
    {
      name: "eduai_student_id_onboarding_skipped",
      value: "1",
      url: CORE_URL,
    },
  ]);
}

function readMaterialsList(body: string): CourseMaterialRow[] {
  const payload = JSON.parse(body) as MaterialsListResponse;
  if (!Array.isArray(payload.materials)) {
    throw new Error(`GET materials: expected a materials array. Body: ${body}`);
  }
  return payload.materials;
}

/**
 * Poll instructor GET /materials until this upload is READY.
 * FAILED fails the test with the response body — never treated as READY.
 */
async function waitUntilMaterialReady(
  ctx: APIRequestContext,
  courseId: string,
  materialId: string,
): Promise<CourseMaterialRow> {
  let lastBody = "";
  await expect
    .poll(
      async () => {
        const res = await ctx.get(`${CORE_URL}/api/courses/${courseId}/materials`);
        lastBody = await res.text();
        if (!res.ok()) {
          throw new Error(`GET materials failed ${res.status()}: ${lastBody}`);
        }
        const row = readMaterialsList(lastBody).find((material) => material.id === materialId);
        if (row?.status === "FAILED") {
          throw new Error(`Material ${materialId} FAILED: ${lastBody}`);
        }
        return row?.status ?? "MISSING";
      },
      { timeout: READY_POLL_MS },
    )
    .toBe("READY");

  const ready = readMaterialsList(lastBody).find((material) => material.id === materialId);
  if (!ready) {
    throw new Error(`Material ${materialId} READY poll passed but row is missing: ${lastBody}`);
  }
  return ready;
}

test.describe("Student from scratch → grounded course chat (#1786)", () => {
  test("new student enrolls, sees a READY material, and can send a course-chat question", async ({
    page,
    playwright,
  }) => {
    test.setTimeout(180_000);

    const adminCtx = await playwright.request.newContext();
    const instrCtx = await playwright.request.newContext();
    const studentCtx = await playwright.request.newContext();

    try {
      await createInstructor(instrCtx, { prefix: "fs-instr" });
      const instrId = await getMyId(instrCtx);
      await createAdmin(adminCtx, { prefix: "fs-admin" });
      await registerUser(studentCtx, { prefix: "fs-student" });

      const meRes = await studentCtx.get(`${CORE_URL}/api/me`);
      const studentProfile = (await meRes.json()) as MeProfile;
      const studentId = studentProfile.id;

      const courseCode = `QKA-${RUN_SUFFIX}`;
      const createRes = await adminCtx.post(`${CORE_URL}/api/courses`, {
        form: coursePayload(instrId, courseCode),
      });
      const createBody = await createRes.text();
      expect(createRes.status(), createBody).toBe(201);
      const created = JSON.parse(createBody) as CourseCreateResponse;
      const courseId = created.id;

      const enrollRes = await adminCtx.post(`${CORE_URL}/api/courses/${courseId}/enrollments`, {
        data: { userId: studentId, role: "STUDENT" },
      });
      expect(enrollRes.status(), await enrollRes.text()).toBe(201);

      const pubRes = await adminCtx.patch(`${CORE_URL}/api/courses/${courseId}/publish`);
      expect(pubRes.status(), await pubRes.text()).toBe(200);

      const uploadRes = await instrCtx.post(`${CORE_URL}/api/courses/${courseId}/materials`, {
        multipart: {
          file: {
            name: MATERIAL_FILENAME,
            mimeType: "text/plain",
            buffer: Buffer.from(MATERIAL_BODY, "utf8"),
          },
        },
      });
      const uploadBody = await uploadRes.text();
      expect(uploadRes.status(), `upload: ${uploadBody}`).toBe(202);
      const accepted = JSON.parse(uploadBody) as MaterialUploadAccepted;
      expect(accepted.materialId).toBeTruthy();
      expect(accepted.status).toBe("PROCESSING");

      const readyMaterial = await waitUntilMaterialReady(instrCtx, courseId, accepted.materialId);
      expect(readyMaterial.title).toBe(MATERIAL_TITLE);
      expect(readyMaterial.status).toBe("READY");

      await injectSession(page, studentCtx);
      await skipStudentIdOnboarding(page);
      await page.addInitScript((userId: string) => {
        window.localStorage.setItem(`eduai:chat-privacy-notice:${userId}`, "1");
        window.localStorage.setItem("eduai:tour:dashboard:v1", "1");
      }, studentId);

      await page.goto(`${CORE_URL}/courses/${courseId}`);
      await expect(page).not.toHaveURL(/\/auth\/login/);
      await expect(page.getByRole("tab", { name: "Materials" })).toBeVisible({ timeout: 15_000 });
      await page.getByRole("tab", { name: "Materials" }).click();

      // Student empty state (documented, not redesigned): title "No materials yet",
      // description "Course materials will appear here once your instructor uploads them."
      await expect(page.getByText("No materials yet")).toHaveCount(0);
      await expect(page.getByText(MATERIAL_TITLE, { exact: true })).toBeVisible({
        timeout: 15_000,
      });

      const mockedReply = [
        `**Source**: ${MATERIAL_TITLE}`,
        `The official quokka relocation window is ${PLANTED_PHRASE}.`,
      ].join("\n\n");
      await page.route("**/api/chat", async (route) => {
        if (route.request().method() !== "POST") {
          await route.continue();
          return;
        }
        await route.fulfill({
          status: 200,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "X-Web-Tools-Enabled": "0",
          },
          body: buildMockStreamBody(mockedReply),
        });
      });

      await page.goto(`${CORE_URL}/chat?courseCode=${encodeURIComponent(courseCode)}`);
      const input = page.locator("#chat-message-input");
      await expect(input).toBeEnabled({ timeout: 15_000 });
      await input.fill(STUDENT_QUESTION);
      await page.getByRole("button", { name: "Send message" }).click();

      await expect(page.getByText("Source")).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(PLANTED_PHRASE)).toBeVisible();
    } finally {
      await adminCtx.dispose();
      await instrCtx.dispose();
      await studentCtx.dispose();
    }
  });
});
