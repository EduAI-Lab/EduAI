/**
 * AI Tutor — a TA also holds the STUDENT learner surface, through the browser.
 *
 * A TA is enrolment-mirrored (`enrollmentSync.js` `MIRRORED_ROLES` includes TA),
 * so besides the staff oversight shell they keep the full `/student/*` learner
 * experience: the enrolled-course list (reached by direct URL — a TA's sidebar
 * "Courses" points at `/instructor`) and the lesson player. Two learner
 * capabilities are STUDENT-only and scoped to the course, so a course TA gets
 * them withheld (not merely disabled): MCQ answer submission (the answer route
 * 403s a TA — U-TA-1) and the AI study buddy (the tutoring routes 403 a
 * non-STUDENT enrollment — #1626). `student-ta-access.spec.ts` covers the bare
 * "a TA can open the lesson player" case; this spec walks the learner surface
 * the way a student uses it, and pins the fail-closed course-role gate that
 * keeps those controls off screen (mixed-role, delayed, and failed-breadcrumb).
 *
 * Path inventory: `docs/end-to-end-user-workflows/ai-tutor-workflows.md` (TA).
 */
import { test, expect, type Page } from "@playwright/test";
import { gotoAiTutor } from "../helpers/at-ui";
import {
  registerStudent,
  seedPublishedCourseAndEnroll,
  seedByokKey,
} from "../helpers/at-student-fixtures";

type Pw = { request: { newContext: () => Promise<import("@playwright/test").APIRequestContext> } };

async function seedTaLearner(page: Page, playwright: Pw, codePrefix = "TLR") {
  const { studentId } = await registerStudent(page);
  const seeded = await seedPublishedCourseAndEnroll(playwright, studentId, {
    name: "TA Learner Course",
    codePrefix,
    role: "TA",
  });
  return { studentId, seeded };
}

test.describe("AI Tutor TA — learner surface", () => {
  test("the /student enrolled-course list shows the TA's course by direct URL", async ({
    page,
    playwright,
  }) => {
    const { seeded } = await seedTaLearner(page, playwright, "TL1");
    try {
      // A TA has no sidebar entry for `/student`, but the learner list still
      // renders their enrolments when reached directly.
      await gotoAiTutor(page, "/student");
      await expect(page.getByRole("link", { name: new RegExp(seeded.name) }).first()).toBeVisible({
        timeout: 20_000,
      });
    } finally {
      await seeded.dispose();
    }
  });

  test("a TA drills course → module → lesson on the learner surface", async ({
    page,
    playwright,
  }) => {
    const { seeded } = await seedTaLearner(page, playwright, "TL1b");
    try {
      // The learner course/module pages admit a TA (their loaders allow TA and
      // the enrolment mirror lets them read published content), so the same
      // drill-down a student walks works for a TA.
      await gotoAiTutor(page, `/student/courses/${seeded.atCourseId}`);
      await expect(page.getByRole("heading", { name: seeded.name })).toBeVisible({
        timeout: 20_000,
      });

      await page.getByText("Spine module").first().click();
      await expect(page).toHaveURL(new RegExp(`/student/module/${seeded.moduleId}$`), {
        timeout: 20_000,
      });
      await expect(page.getByText("Spine lesson").first()).toBeVisible();

      await page.getByText("Spine lesson").first().click();
      await expect(page.getByText(seeded.question)).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText("Your answer")).toBeVisible();
    } finally {
      await seeded.dispose();
    }
  });

  test("the lesson player renders the question, answer card, and study buddy", async ({
    page,
    playwright,
  }) => {
    const { seeded } = await seedTaLearner(page, playwright, "TL2");
    try {
      await gotoAiTutor(page, `/student/lesson/${seeded.lessonId}`);
      await expect(page.getByText(seeded.question)).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText("Your answer")).toBeVisible();
      await expect(page.getByText("AI study buddy", { exact: true })).toBeVisible();
      // Both quiz controls are disabled for a TA — recording an attempt and the
      // study buddy are STUDENT paths (U-TA-1 / #1626) — with one label, instead
      // of dead-but-enabled buttons.
      await expect(page.getByRole("button", { name: /submit answer/i })).toBeDisabled();
      await expect(page.getByRole("button", { name: /guide me/i })).toBeDisabled();
      // Scope to the answer-card gate note: the withheld study buddy renders a
      // second `role="note"` on this page (#1626), so an un-scoped match is
      // ambiguous in strict mode.
      await expect(
        page
          .getByRole("note")
          .filter({ hasText: /only students of this course can interact with quizzes/i }),
      ).toBeVisible();
    } finally {
      await seeded.dispose();
    }
  });

  test("the player disables the quiz controls for a TA and explains why (U-TA-1 fixed)", async ({
    page,
    playwright,
  }) => {
    const { seeded } = await seedTaLearner(page, playwright, "TL3");
    try {
      await gotoAiTutor(page, `/student/lesson/${seeded.lessonId}`);
      await expect(page.getByText(seeded.question)).toBeVisible({ timeout: 20_000 });

      // Both quiz actions are STUDENT-enrolment paths (`POST /questions/:id/answer`
      // is 403 for a TA — see `ta-security.spec.ts` — and Guide me drives the
      // withheld study buddy). The whole quiz renders disabled with one label,
      // rather than dead-but-enabled buttons (U-TA-1 / #1626).
      await expect(page.getByRole("button", { name: /submit answer/i })).toBeDisabled();
      await expect(page.getByRole("button", { name: /guide me/i })).toBeDisabled();
      // Scope to the answer-card gate note: the withheld study buddy renders a
      // second `role="note"` on this page (#1626), so an un-scoped match is
      // ambiguous in strict mode.
      await expect(
        page
          .getByRole("note")
          .filter({ hasText: /only students of this course can interact with quizzes/i }),
      ).toBeVisible();
      // The MCQ options are disabled — a TA cannot even stage an attempt.
      await expect(page.getByRole("radio", { name: "Option A" })).toBeDisabled();
      // The quiz cards render visually disabled, but Prev/Next stay usable so a
      // TA can page through and review every question.
      await expect(page.locator('[data-tour="student-answer-card"]')).toHaveAttribute(
        "aria-disabled",
        "true",
      );
    } finally {
      await seeded.dispose();
    }
  });

  test("a mixed-role account submits where it is a STUDENT and is withheld where it TAs (#1626)", async ({
    page,
    playwright,
  }) => {
    // One account enrolled as TA in course A and STUDENT in course B. `/api/me`
    // promotes the *global* effective role to "TA" (TA anywhere), so a submit
    // gate keyed on that global role would wrongly disable submission in course
    // B as well. The capability must instead come from the per-course
    // enrollment the breadcrumb resolves, so the two courses diverge.
    const { studentId } = await registerStudent(page);
    const taCourse = await seedPublishedCourseAndEnroll(playwright, studentId, {
      name: "Mixed TA Course",
      codePrefix: "MXA",
      role: "TA",
    });
    const studentCourse = await seedPublishedCourseAndEnroll(playwright, studentId, {
      name: "Mixed Student Course",
      codePrefix: "MXB",
      role: "STUDENT",
    });
    try {
      // Course B — enrolled as STUDENT: submission is offered and records an
      // attempt, even though the account's global effective role is "TA".
      await gotoAiTutor(page, `/student/lesson/${studentCourse.lessonId}`);
      await expect(page.getByText(studentCourse.question)).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole("note")).toHaveCount(0);
      await page.getByRole("radio", { name: "Option A" }).click();
      const submit = page.getByRole("button", { name: /submit answer/i });
      await expect(submit).toBeEnabled();
      await submit.click();
      // The seed's correct answer is Option A (0), so the attempt is accepted —
      // proving the STUDENT-in-B path reaches `POST /questions/:id/answer`.
      await expect(page.getByText(/correct/i)).toBeVisible({ timeout: 20_000 });

      // Course A — enrolled as TA: the quiz is disabled on the same account,
      // exactly as the single-course TA cases above.
      await gotoAiTutor(page, `/student/lesson/${taCourse.lessonId}`);
      await expect(page.getByText(taCourse.question)).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole("button", { name: /submit answer/i })).toBeDisabled();
      // Scope to the answer-card gate note: the withheld study buddy renders a
      // second `role="note"` on this page (#1626), so an un-scoped match is
      // ambiguous in strict mode.
      await expect(
        page
          .getByRole("note")
          .filter({ hasText: /only students of this course can interact with quizzes/i }),
      ).toBeVisible();
      await expect(page.getByRole("radio", { name: "Option A" })).toBeDisabled();
    } finally {
      await Promise.all([taCourse.dispose(), studentCourse.dispose()]);
    }
  });

  test("the study buddy is withheld for a TA with no BYOK key (#1626)", async ({
    page,
    playwright,
  }) => {
    const { seeded } = await seedTaLearner(page, playwright, "TL4");
    try {
      // The study buddy is a STUDENT-in-this-course capability, so a TA is
      // withheld before the BYOK question even arises — no connect-a-provider
      // state, no Add-API-key CTA, just the withheld note.
      await gotoAiTutor(page, `/student/lesson/${seeded.lessonId}`);
      const chat = page.locator('[data-tour="student-ai-chat"]');
      await expect(chat.getByText("AI study buddy", { exact: true })).toBeVisible({
        timeout: 20_000,
      });
      await expect(chat.getByText(/study buddy is available to students enrolled/i)).toBeVisible();
      await expect(
        chat.getByRole("heading", { name: /Connect an AI provider to start/i }),
      ).toHaveCount(0);
      await expect(chat.getByRole("button", { name: /Add API key/i })).toHaveCount(0);
    } finally {
      await seeded.dispose();
    }
  });

  test("the study buddy is withheld for a TA even with a BYOK key (#1626)", async ({
    page,
    playwright,
  }) => {
    const { studentId, seeded } = await seedTaLearner(page, playwright, "TL5");
    try {
      // A BYOK key flips `hasApiKey`, but the tutoring routes (`/teach`,
      // `/guide`, `/custom`) and chat-session listing 403 a TA's non-STUDENT
      // enrollment — so an unlocked composer would be a dead control. The panel
      // withholds it: the title stays, but a note explains the study buddy is
      // for enrolled students, with no connect state and no composer.
      await seedByokKey(page, studentId);
      await gotoAiTutor(page, `/student/lesson/${seeded.lessonId}`);
      const chat = page.locator('[data-tour="student-ai-chat"]');
      await expect(chat.getByText("AI study buddy", { exact: true })).toBeVisible({
        timeout: 20_000,
      });
      await expect(chat.getByText(/study buddy is available to students enrolled/i)).toBeVisible();
      await expect(chat.getByText(/Connect an AI provider to start/i)).toHaveCount(0);
      await expect(chat.getByRole("button", { name: /send message/i })).toHaveCount(0);
      await expect(chat.getByPlaceholder(/Connect a provider to start chatting/i)).toHaveCount(0);
    } finally {
      await seeded.dispose();
    }
  });

  test("the study buddy stays withheld for a TA + BYOK key while the breadcrumb is in flight (#1626)", async ({
    page,
    playwright,
  }) => {
    // Fail-closed twin of the Submit gate for the study buddy: while the
    // per-course breadcrumb is still resolving, a TA holding a BYOK key must not
    // get a live composer — the tutoring routes 403 the TA enrollment, so it
    // would be a dead control. The panel shows a "checking access" note during
    // the delay and settles on the enrolled-students note once the TA role
    // resolves; a composer never appears in either window.
    const { studentId, seeded } = await seedTaLearner(page, playwright, "TL6");
    try {
      await seedByokKey(page, studentId);
      await page.route("**/api/lessons/*/breadcrumb", async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        await route.continue();
      });
      await gotoAiTutor(page, `/student/lesson/${seeded.lessonId}`);
      const chat = page.locator('[data-tour="student-ai-chat"]');
      await expect(chat.getByText("AI study buddy", { exact: true })).toBeVisible({
        timeout: 20_000,
      });
      // Pre-resolution: a "checking access" note, and crucially no composer even
      // though a BYOK key is present.
      await expect(
        chat.getByRole("note").filter({ hasText: /checking your access/i }),
      ).toBeVisible();
      await expect(chat.getByRole("button", { name: /send message/i })).toHaveCount(0);
      // Once the TA role resolves the panel settles on the enrolled-students
      // note — still withheld, still no composer.
      await expect(chat.getByText(/study buddy is available to students enrolled/i)).toBeVisible({
        timeout: 20_000,
      });
      await expect(chat.getByRole("button", { name: /send message/i })).toHaveCount(0);
    } finally {
      await page.unroute("**/api/lessons/*/breadcrumb");
      await seeded.dispose();
    }
  });

  test("a delayed breadcrumb withholds Submit until the course role resolves (#1626)", async ({
    page,
    playwright,
  }) => {
    // The submit gate reads the per-course enrollment role the breadcrumb
    // resolves, and fails closed while it is in flight — it must NOT fall back
    // to the global `/api/me` role, which returns the base STUDENT role when
    // Core course discovery fails. A STUDENT here sees a "checking access" note
    // during the delay, and Submit only once the role lands.
    const { studentId } = await registerStudent(page);
    const seeded = await seedPublishedCourseAndEnroll(playwright, studentId, {
      name: "Delayed Breadcrumb Course",
      codePrefix: "TLD",
      role: "STUDENT",
    });
    try {
      await page.route("**/api/lessons/*/breadcrumb", async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        await route.continue();
      });
      await gotoAiTutor(page, `/student/lesson/${seeded.lessonId}`);
      await expect(page.getByText(seeded.question)).toBeVisible({ timeout: 20_000 });
      // Pre-resolution: disabled with the pending note, never an enabled Submit.
      await expect(page.getByRole("note")).toContainText(/checking your access/i);
      await expect(page.getByRole("button", { name: /submit answer/i })).toBeDisabled();
      // Once the delayed breadcrumb resolves the STUDENT role, the note clears
      // and the quiz becomes interactive — selecting an option enables Submit.
      await expect(page.getByRole("note")).toHaveCount(0, { timeout: 20_000 });
      await page.getByRole("radio", { name: "Option A" }).click();
      await expect(page.getByRole("button", { name: /submit answer/i })).toBeEnabled();
    } finally {
      await page.unroute("**/api/lessons/*/breadcrumb");
      await seeded.dispose();
    }
  });

  test("a failed breadcrumb fails closed — no dead Submit, an explicit note (#1626)", async ({
    page,
    playwright,
  }) => {
    // If the breadcrumb lookup fails the course role cannot be confirmed, so the
    // gate stays closed rather than trusting the global role — a TA whose
    // `/api/me` fell back to STUDENT must never get a Submit the answer route
    // then 403s. The learner sees a "couldn't verify" note instead.
    const { studentId } = await registerStudent(page);
    const seeded = await seedPublishedCourseAndEnroll(playwright, studentId, {
      name: "Failed Breadcrumb Course",
      codePrefix: "TLF",
      role: "STUDENT",
    });
    try {
      await page.route("**/api/lessons/*/breadcrumb", (route) =>
        route.fulfill({ status: 500, contentType: "application/json", body: "{}" }),
      );
      await gotoAiTutor(page, `/student/lesson/${seeded.lessonId}`);
      await expect(page.getByText(seeded.question)).toBeVisible({ timeout: 20_000 });
      // Scope to the answer-card note: the withheld study buddy renders a
      // second `role="note"` on this page (#1626), so an un-scoped match is
      // ambiguous in strict mode.
      await expect(
        page.getByRole("note").filter({ hasText: /couldn.t verify your access/i }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: /submit answer/i })).toBeDisabled();
    } finally {
      await page.unroute("**/api/lessons/*/breadcrumb");
      await seeded.dispose();
    }
  });
});
