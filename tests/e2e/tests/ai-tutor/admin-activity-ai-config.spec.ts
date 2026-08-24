/**
 * AI Tutor — ADMIN per-activity AI configuration, driven through the browser.
 *
 * This is the admin's most consequential AI surface and the one the epic ranks
 * first: what an admin sets here is exactly what a student is offered when they
 * open the activity and start a tutoring conversation.
 *
 * Per activity (`routes/instructor.lesson.tsx`, the "AI study buddy" panel):
 *   • which chat modes exist — Teach me / Guide me / Custom prompt
 *   • the custom prompt itself, plus the button title students see
 *   • the main topic and secondary topics the tutor is grounded in
 *
 * An admin holds `canManageContent` on every course, so all of it is reachable
 * on a course taught by someone else — which is how these specs seed it.
 *
 * Path inventory: `docs/end-to-end-user-workflows/ai-tutor-workflows.md`.
 */
import { test, expect, type Page } from "@playwright/test";
import { gotoAiTutor, loginAsAdmin } from "../helpers/at-ui";
import { seedCourseWithActivity } from "../helpers/at-admin-fixtures";

/** The mode chips are `aria-pressed` toggles, not checkboxes. */
function modeChip(page: Page, label: string) {
  return page.getByRole("button", { name: label, exact: true });
}

test.describe("AI Tutor ADMIN — activity chat modes", () => {
  test("an activity ships with Teach me and Guide me enabled", async ({ page, playwright }) => {
    const seeded = await seedCourseWithActivity(playwright, {
      name: "Modes Baseline Course",
      codePrefix: "AIMB",
    });
    try {
      await loginAsAdmin(page, "at-admin-modes-baseline");
      await gotoAiTutor(page, `/instructor/lesson/${seeded.lessonId}`);
      await expect(page.getByText(seeded.question)).toBeVisible({ timeout: 20_000 });

      await expect(page.getByText("AI study buddy")).toBeVisible();
      await expect(modeChip(page, "Teach me")).toHaveAttribute("aria-pressed", "true");
      await expect(modeChip(page, "Guide me")).toHaveAttribute("aria-pressed", "true");
      // The custom mode is opt-in, so its prompt editor stays hidden.
      await expect(modeChip(page, "Custom prompt")).toHaveAttribute("aria-pressed", "false");
      await expect(page.getByLabel(/Custom AI prompt/i)).toHaveCount(0);
    } finally {
      await seeded.dispose();
    }
  });

  test("turning a mode off is persisted, so students stop being offered it", async ({
    page,
    playwright,
  }) => {
    const seeded = await seedCourseWithActivity(playwright, {
      name: "Modes Toggle Course",
      codePrefix: "AIMT",
    });
    try {
      await loginAsAdmin(page, "at-admin-modes-toggle");
      await gotoAiTutor(page, `/instructor/lesson/${seeded.lessonId}`);
      await expect(page.getByText(seeded.question)).toBeVisible({ timeout: 20_000 });

      await modeChip(page, "Guide me").click();
      await expect(modeChip(page, "Guide me")).toHaveAttribute("aria-pressed", "false");

      // Server-side, not just the optimistic update.
      await page.reload();
      await expect(modeChip(page, "Guide me")).toHaveAttribute("aria-pressed", "false", {
        timeout: 20_000,
      });
      await expect(modeChip(page, "Teach me")).toHaveAttribute("aria-pressed", "true");

      // And back on again.
      await modeChip(page, "Guide me").click();
      await expect(modeChip(page, "Guide me")).toHaveAttribute("aria-pressed", "true");
      await page.reload();
      await expect(modeChip(page, "Guide me")).toHaveAttribute("aria-pressed", "true", {
        timeout: 20_000,
      });
    } finally {
      await seeded.dispose();
    }
  });

  test("the last remaining mode cannot be switched off", async ({ page, playwright }) => {
    // An activity with no AI mode would render a tutoring surface a student
    // could open but never use, so the client refuses it. The refusal is an
    // inline message under that activity's AI study buddy box — it used to be a
    // native `alert()`, which was modal, unstyled, and detached from the chip
    // that caused it.
    const seeded = await seedCourseWithActivity(playwright, {
      name: "Modes Guard Course",
      codePrefix: "AIMG",
    });
    try {
      await loginAsAdmin(page, "at-admin-modes-guard");
      await gotoAiTutor(page, `/instructor/lesson/${seeded.lessonId}`);
      await expect(page.getByText(seeded.question)).toBeVisible({ timeout: 20_000 });

      await modeChip(page, "Guide me").click();
      await expect(modeChip(page, "Guide me")).toHaveAttribute("aria-pressed", "false");

      // No native dialog should be raised at all — fail loudly if one is.
      const alerts: string[] = [];
      page.on("dialog", (dialog) => {
        alerts.push(dialog.message());
        void dialog.dismiss();
      });

      // Teach me is now the only one left; switching it off must be refused.
      await modeChip(page, "Teach me").click();

      await expect(page.getByText("At least one AI mode must be enabled.")).toBeVisible({
        timeout: 10_000,
      });
      expect(alerts).toEqual([]);
      await expect(modeChip(page, "Teach me")).toHaveAttribute("aria-pressed", "true");

      // Turning another mode back on clears the message rather than leaving it
      // stuck under the box.
      await modeChip(page, "Guide me").click();
      await expect(page.getByText("At least one AI mode must be enabled.")).toHaveCount(0);

      // The refusal is not just cosmetic — nothing was written.
      await page.reload();
      await expect(modeChip(page, "Teach me")).toHaveAttribute("aria-pressed", "true", {
        timeout: 20_000,
      });
    } finally {
      await seeded.dispose();
    }
  });
});

test.describe("AI Tutor ADMIN — custom activity prompt", () => {
  test("enabling the custom mode reveals its prompt editor and saves both fields", async ({
    page,
    playwright,
  }) => {
    // The custom prompt is literally the instruction the tutor model follows
    // for this activity, and the title is the button a student clicks — so both
    // have to survive a round trip.
    const seeded = await seedCourseWithActivity(playwright, {
      name: "Custom Prompt Course",
      codePrefix: "AICP",
    });
    try {
      await loginAsAdmin(page, "at-admin-custom-prompt");
      await gotoAiTutor(page, `/instructor/lesson/${seeded.lessonId}`);
      await expect(page.getByText(seeded.question)).toBeVisible({ timeout: 20_000 });

      await modeChip(page, "Custom prompt").click();
      await expect(modeChip(page, "Custom prompt")).toHaveAttribute("aria-pressed", "true");

      const title = page.getByLabel(/Button title/i);
      const prompt = page.getByLabel(/Custom AI prompt/i);
      await expect(title).toBeVisible();
      await expect(prompt).toBeVisible();
      // The placeholders name the substitutions the loop performs.
      await expect(page.getByText("[INSERT TOPIC HERE]")).toBeVisible();

      await title.fill("Explain simply");
      await prompt.fill("Explain [INSERT TOPIC HERE] at [ENTER KNOWLEDGE LEVEL] level.");
      await page.getByRole("button", { name: /^save prompt$/i }).click();
      await expect(page.getByRole("button", { name: /^saved$/i })).toBeVisible({
        timeout: 20_000,
      });

      await page.reload();
      await expect(modeChip(page, "Custom prompt")).toHaveAttribute("aria-pressed", "true", {
        timeout: 20_000,
      });
      await expect(page.getByLabel(/Button title/i)).toHaveValue("Explain simply");
      await expect(page.getByLabel(/Custom AI prompt/i)).toHaveValue(
        "Explain [INSERT TOPIC HERE] at [ENTER KNOWLEDGE LEVEL] level.",
      );
    } finally {
      await seeded.dispose();
    }
  });

  test("the custom prompt refuses to save without a title or without prompt text", async ({
    page,
    playwright,
  }) => {
    const seeded = await seedCourseWithActivity(playwright, {
      name: "Custom Prompt Validation Course",
      codePrefix: "AICV",
    });
    try {
      await loginAsAdmin(page, "at-admin-custom-prompt-validation");
      await gotoAiTutor(page, `/instructor/lesson/${seeded.lessonId}`);
      await expect(page.getByText(seeded.question)).toBeVisible({ timeout: 20_000 });

      await modeChip(page, "Custom prompt").click();
      const title = page.getByLabel(/Button title/i);
      const prompt = page.getByLabel(/Custom AI prompt/i);
      await expect(title).toBeVisible();

      // Prompt text but no title.
      await prompt.fill("Some guidance for the tutor.");
      await page.getByRole("button", { name: /^save prompt$/i }).click();
      await expect(page.getByText(/provide a title for the custom prompt/i)).toBeVisible({
        timeout: 10_000,
      });

      // Title but no prompt text.
      await title.fill("Hint me");
      await prompt.fill("");
      await page.getByRole("button", { name: /^save prompt$/i }).click();
      await expect(page.getByText(/provide the custom prompt text/i)).toBeVisible({
        timeout: 10_000,
      });
    } finally {
      await seeded.dispose();
    }
  });

  test("the student-facing button title is capped at 20 characters", async ({
    page,
    playwright,
  }) => {
    // The cap is enforced in the change handler as well as by maxLength, because
    // the title has to fit the student's mode switcher.
    const seeded = await seedCourseWithActivity(playwright, {
      name: "Custom Prompt Cap Course",
      codePrefix: "AICC",
    });
    try {
      await loginAsAdmin(page, "at-admin-custom-prompt-cap");
      await gotoAiTutor(page, `/instructor/lesson/${seeded.lessonId}`);
      await expect(page.getByText(seeded.question)).toBeVisible({ timeout: 20_000 });

      await modeChip(page, "Custom prompt").click();
      const title = page.getByLabel(/Button title/i);
      await expect(title).toBeVisible();

      await title.fill("This title is far longer than twenty characters");
      await expect(title).toHaveValue("This title is far lo");
      await expect(page.getByText("20/20 characters")).toBeVisible();
    } finally {
      await seeded.dispose();
    }
  });
});

test.describe("AI Tutor ADMIN — activity topic grounding", () => {
  test("the main topic can be changed on an existing activity", async ({ page, playwright }) => {
    // The main topic is what the tutor loop grounds the conversation in, and it
    // is required at creation — but it is also editable afterwards, which the
    // authoring specs never exercised.
    const seeded = await seedCourseWithActivity(playwright, {
      name: "Main Topic Course",
      codePrefix: "AIMN",
      topics: ["Recursion", "Complexity"],
    });
    try {
      await loginAsAdmin(page, "at-admin-main-topic");
      await gotoAiTutor(page, `/instructor/lesson/${seeded.lessonId}`);
      await expect(page.getByText(seeded.question)).toBeVisible({ timeout: 20_000 });

      const mainTopic = page.locator(`#activity-${seeded.activityId}-main-topic`);
      // `atCourseTopicIds` does not promise an order, so read which of the two
      // course topics the activity was seeded with and switch to the other.
      const before = (await mainTopic.innerText()).trim();
      const after = before === "Recursion" ? "Complexity" : "Recursion";

      await mainTopic.click();
      await page.getByRole("option", { name: after, exact: true }).click();
      await expect(mainTopic).toContainText(after);

      await page.reload();
      await expect(page.locator(`#activity-${seeded.activityId}-main-topic`)).toContainText(after, {
        timeout: 20_000,
      });
    } finally {
      await seeded.dispose();
    }
  });

  test("secondary topics can be added and are kept out of the main-topic list", async ({
    page,
    playwright,
  }) => {
    const seeded = await seedCourseWithActivity(playwright, {
      name: "Secondary Topics Course",
      codePrefix: "AISC",
      topics: ["Recursion", "Complexity"],
    });
    try {
      await loginAsAdmin(page, "at-admin-secondary-topics");
      await gotoAiTutor(page, `/instructor/lesson/${seeded.lessonId}`);
      await expect(page.getByText(seeded.question)).toBeVisible({ timeout: 20_000 });

      await expect(page.getByText("Secondary topics", { exact: true })).toBeVisible();

      const mainTopicName = (
        await page.locator(`#activity-${seeded.activityId}-main-topic`).innerText()
      ).trim();
      const otherTopic = mainTopicName === "Recursion" ? "Complexity" : "Recursion";

      await page.getByText("Add secondary topics…").click();
      // The main topic is filtered out of the options, so the only choice left
      // is the course's other topic.
      await expect(page.getByRole("option", { name: mainTopicName, exact: true })).toHaveCount(0);
      await page.getByRole("option", { name: otherTopic, exact: true }).click();
      await page.keyboard.press("Escape");

      await page.reload();
      await expect(page.getByText(seeded.question)).toBeVisible({ timeout: 20_000 });
      await expect(
        page
          .locator('[data-slot="select-trigger"], button')
          .filter({ hasText: otherTopic })
          .first(),
      ).toBeVisible({ timeout: 20_000 });
    } finally {
      await seeded.dispose();
    }
  });
});
