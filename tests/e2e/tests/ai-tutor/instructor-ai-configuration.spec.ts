/**
 * AI Tutor INSTRUCTOR — per-activity AI configuration (browser-driven).
 *
 * This is the instructor's actual power over the tutor. A student meets the AI
 * only inside an activity, and which modes they get there — "Teach me" (explain
 * it), "Guide me" (hint toward it), and an optional third mode the instructor
 * names and writes the prompt for — is decided here, per activity, by the
 * instructor. Nothing else an instructor does changes what the model says.
 *
 * The rules the UI enforces are the point of these tests: at least one mode must
 * stay on, and enabling the custom mode reveals the two fields that give it
 * meaning (a student-facing button title and the prompt itself).
 */
import { test, expect } from "@playwright/test";
import { AI_TUTOR_API_URL, AI_TUTOR_URL } from "../../playwright.config";
import { signInThroughPage } from "../helpers/auth";
import {
  createTeachingInstructor,
  seedInstructorSpine,
  type InstructorFixture,
} from "../helpers/at-instructor";
import { gotoAiTutor } from "../helpers/at-ui";

let fx: InstructorFixture;

test.beforeAll(async ({ playwright }) => {
  const ctx = await playwright.request.newContext();
  try {
    fx = await createTeachingInstructor(playwright, ctx, {
      publishCourse: true,
      seedTopic: true,
    });
  } finally {
    await ctx.dispose();
  }
});

test.afterAll(async () => {
  await fx?.dispose();
});

/**
 * A private lesson + activity for one test.
 *
 * Every test here mutates the activity's AI modes, so a shared activity would
 * make each test's starting state depend on the order the others ran in.
 */
async function freshActivity(
  ctx: import("@playwright/test").APIRequestContext,
  label: string,
): Promise<{ lessonId: number; activityId: number; question: string }> {
  const spine = await seedInstructorSpine(ctx, fx, { question: `${label} — which case stops it?` });
  return { lessonId: spine.lessonId, activityId: spine.activityId, question: spine.question };
}

/**
 * The slice of an activity this file asserts on: the three AI-mode flags and
 * the custom prompt they gate. Named rather than a bare dictionary so a typo in
 * a field name is a compile error instead of a silently `undefined` poll that
 * times out thirty seconds later.
 */
type ActivityAiModes = {
  enableTeachMode?: boolean;
  enableGuideMode?: boolean;
  enableCustomMode?: boolean;
  customPromptTitle?: string | null;
  customPrompt?: string | null;
};

/** The current AI-mode flags, read from the API the page writes through. */
async function modes(
  page: import("@playwright/test").Page,
  lessonId: number,
  activityId: number,
): Promise<ActivityAiModes> {
  const res = await page.request.get(`${AI_TUTOR_API_URL}/api/lessons/${lessonId}/activities`);
  const body = await res.json();
  const rows = Array.isArray(body) ? body : (body.data ?? []);
  return rows.find((a: { id: number }) => a.id === activityId) ?? {};
}

test.describe("INSTRUCTOR per-activity AI configuration", () => {
  test("the activity card exposes the three AI study-buddy modes", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);
    // `page.request` shares the browser context's cookies, so the seed is
    // authored by the very instructor whose screen is then driven.
    const seeded = await freshActivity(page.request, "Modes");
    await gotoAiTutor(page, `/instructor/lesson/${seeded.lessonId}`);

    await expect(page.getByText("AI STUDY BUDDY")).toBeVisible({ timeout: 30_000 });
    for (const mode of ["Teach me", "Guide me", "Custom prompt"]) {
      await expect(page.getByRole("button", { name: mode })).toBeVisible();
    }
    // The seeded activity ships with both stock modes on, and the toggles say so
    // through `aria-pressed` rather than colour alone.
    await expect(page.getByRole("button", { name: "Teach me" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("turning off one stock mode leaves the other on", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);
    const seeded = await freshActivity(page.request, "Toggle");
    await gotoAiTutor(page, `/instructor/lesson/${seeded.lessonId}`);

    const teach = page.getByRole("button", { name: "Teach me" });
    await expect(teach).toHaveAttribute("aria-pressed", "true", { timeout: 30_000 });
    await teach.click();

    await expect(teach).toHaveAttribute("aria-pressed", "false", { timeout: 15_000 });
    // The write reaches the server, not just the toggle's own state.
    await expect
      .poll(async () => (await modes(page, seeded.lessonId, seeded.activityId)).enableTeachMode, {
        timeout: 20_000,
      })
      .toBe(false);
    await expect(page.getByRole("button", { name: "Guide me" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("the last remaining mode cannot be turned off", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);
    const seeded = await freshActivity(page.request, "Last Mode");
    await gotoAiTutor(page, `/instructor/lesson/${seeded.lessonId}`);

    const teach = page.getByRole("button", { name: "Teach me" });
    const guide = page.getByRole("button", { name: "Guide me" });
    await expect(teach).toHaveAttribute("aria-pressed", "true", { timeout: 30_000 });

    await teach.click();
    await expect(teach).toHaveAttribute("aria-pressed", "false", { timeout: 15_000 });

    // An activity with no AI mode at all would silently strip the tutor from
    // the student's screen, so the UI refuses and says why rather than
    // disabling the control and leaving the reason to be guessed.
    await guide.click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(guide).toHaveAttribute("aria-pressed", "true");
    await expect
      .poll(async () => (await modes(page, seeded.lessonId, seeded.activityId)).enableGuideMode, {
        timeout: 20_000,
      })
      .toBe(true);
  });

  test("enabling the custom mode reveals its title and prompt fields", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);
    const seeded = await freshActivity(page.request, "Custom Reveal");
    await gotoAiTutor(page, `/instructor/lesson/${seeded.lessonId}`);

    // Hidden until the mode is on: a prompt with no mode to run it is dead
    // configuration, and a title with no prompt names an empty button.
    await expect(page.getByLabel("Custom AI prompt")).toHaveCount(0);

    await page.getByRole("button", { name: "Custom prompt" }).click();

    await expect(page.getByLabel("Button title (shown to students, max 20 chars)")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByLabel("Custom AI prompt")).toBeVisible();
    // The placeholders the prompt may use are documented right where it is
    // written, not in separate docs.
    await expect(page.getByText("[INSERT TOPIC HERE]")).toBeVisible();
    await expect(page.getByText("[ENTER KNOWLEDGE LEVEL]")).toBeVisible();
  });

  test("saves a custom AI prompt and the student-facing button title", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);
    const seeded = await freshActivity(page.request, "Custom Save");
    await gotoAiTutor(page, `/instructor/lesson/${seeded.lessonId}`);

    await page.getByRole("button", { name: "Custom prompt" }).click();
    const title = page.getByLabel("Button title (shown to students, max 20 chars)");
    await expect(title).toBeVisible({ timeout: 15_000 });

    const promptText =
      "Explain [INSERT TOPIC HERE] to a [ENTER KNOWLEDGE LEVEL] learner in three sentences.";
    await title.fill("Explain simply");
    await page.getByLabel("Custom AI prompt").fill(promptText);
    await page.getByRole("button", { name: /^Save prompt/ }).click();

    // The write really lands — this is configuration the student's tutor will
    // read, so an optimistic UI is not evidence.
    await expect
      .poll(
        async () => {
          const activity = await modes(page, seeded.lessonId, seeded.activityId);
          return {
            title: activity.customPromptTitle,
            // The prompt body is the half the tutor actually runs — a saved
            // title with an unsaved prompt would name an empty button.
            prompt: activity.customPrompt,
            enabled: activity.enableCustomMode,
          };
        },
        { timeout: 30_000, message: "the custom prompt was never persisted" },
      )
      .toEqual({ title: "Explain simply", prompt: promptText, enabled: true });

    // And it survives a reload rather than living only in the open form.
    await page.reload();
    await expect(page.getByLabel("Button title (shown to students, max 20 chars)")).toHaveValue(
      "Explain simply",
      { timeout: 30_000 },
    );
  });

  test("the button title is capped at the length students will see", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);
    const seeded = await freshActivity(page.request, "Custom Cap");
    await gotoAiTutor(page, `/instructor/lesson/${seeded.lessonId}`);

    await page.getByRole("button", { name: "Custom prompt" }).click();
    const title = page.getByLabel("Button title (shown to students, max 20 chars)");
    await expect(title).toBeVisible({ timeout: 15_000 });

    // Capped as it is typed, with a live counter, rather than truncated on save
    // — the author sees the button the student will get.
    await title.fill("a".repeat(40));
    await expect(title).toHaveValue("a".repeat(20));
    await expect(page.getByText("20/20 characters")).toBeVisible();
  });

  test("the header reports whether the AI backends are reachable at all", async ({ page }) => {
    await signInThroughPage(page, fx, `${AI_TUTOR_URL}/dashboard`);

    // Configuring modes is pointless if no provider is up, and this is the only
    // in-app signal of that. Both chips are present and named for their service.
    const ubc = page.getByRole("button", { name: /^UBC-hosted AI: / });
    const cloud = page.getByRole("button", { name: /^Cloud AI: / });
    await expect(ubc).toBeVisible();
    await expect(cloud).toBeVisible();

    // The state word comes from `STATE_WORD` in `@eduai/ui`'s
    // `ai-service-indicators.tsx`, and the chip can only ever say one of those
    // five words: `aiStatusSchema` (`app/lib/api-schemas.ts`) parses `state`
    // against exactly the same set, so an out-of-set value never reaches the
    // component — a payload the schema rejects leaves the chips on their
    // initial `loading` state, which reads as "Checking…". Asserting the
    // alternation pins that contract without pinning whichever backend happens
    // to be up in the stack under test.
    //
    // Two earlier versions of this assertion were wrong (PR #1623 review):
    // `Online`/`Offline`, words the component emits for no state at all, and
    // then the literal `undefined`, which was read off a prebuilt e2e image
    // predating the schema and cannot occur on this code. Findings #5 was
    // withdrawn with them.
    const STATE_WORD = "(?:Operational|Degraded|Outage|Checking…|Unknown)";
    await expect(ubc).toHaveAccessibleName(new RegExp(`^UBC-hosted AI: ${STATE_WORD}$`));
    await expect(cloud).toHaveAccessibleName(new RegExp(`^Cloud AI: ${STATE_WORD}$`));
  });
});
