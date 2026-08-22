/**
 * AI Tutor — ADMIN console workflows (`/admin`), driven through the browser.
 *
 * Three tabs, all ADMIN-only except AI oversight (also UNIT_ADMIN):
 *   • Bug reports — triage queue: filter, sort, open, change status
 *   • AI settings — loop policy + the EduAI API key
 *   • AI oversight — recent AI tutoring traces
 *
 * These are the admin's AI-facing paths, which the epic prioritises first.
 * Path inventory: `docs/end-to-end-user-workflows/ai-tutor-workflows.md`.
 */
import { test, expect } from "@playwright/test";
import { createAdmin } from "../helpers/auth";
import { gotoAiTutor, loginAsAdmin, openTab } from "../helpers/at-ui";
import {
  captureAiPolicy,
  seedAiModelCatalogue,
  setAiPolicyBaseline,
} from "../helpers/at-admin-fixtures";

/**
 * Submit a bug report through the shell so triage has a row to act on.
 *
 * The type is chosen by its visible label rather than "first option" so a spec
 * can filter the queue on it afterwards, and `anonymous` drives the dialog's
 * "Submit anonymously" switch — the input to the server-side identity masking
 * in `bugReportMappers.js`.
 */
async function submitBugReport(
  page: import("@playwright/test").Page,
  description: string,
  opts: { type?: string; anonymous?: boolean } = {},
) {
  await page.getByRole("button", { name: /report a bug/i }).click();
  const dialog = page.locator('[role="dialog"]');
  await dialog.getByTestId("bug-type").click();
  // The dialog and the triage toolbar now read from one label map, so the same
  // words name the same type on both surfaces.
  await page.getByRole("option", { name: opts.type ?? "UI / display", exact: true }).click();
  await dialog.getByTestId("bug-description").fill(description);
  if (opts.anonymous) {
    await dialog.locator("#bug-report-anonymous").click();
    await expect(dialog.locator("#bug-report-anonymous")).toHaveAttribute("data-state", "checked");
  }
  await dialog.getByRole("button", { name: /submit report/i }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
}

test.describe("AI Tutor ADMIN — admin console shell", () => {
  test("offers the bug-report, AI-settings, and AI-oversight tabs", async ({ page }) => {
    await loginAsAdmin(page, "at-admin-console-tabs");
    await gotoAiTutor(page, "/admin");

    await expect(page.getByRole("heading", { name: "Admin console" })).toBeVisible();
    await expect(
      page.getByText("Triage bug reports, configure AI tutoring, and review AI oversight."),
    ).toBeVisible();
    for (const tab of ["Bug reports", "AI settings", "AI oversight"]) {
      await expect(page.getByRole("tab", { name: tab })).toBeVisible();
    }
  });
});

test.describe("AI Tutor ADMIN — bug-report triage", () => {
  test("a submitted report reaches the queue as Unhandled with its reporter shown", async ({
    page,
  }) => {
    const admin = await loginAsAdmin(page, "at-admin-triage-row");
    const description = `E2E triage row ${Date.now()}`;
    await submitBugReport(page, description);

    await gotoAiTutor(page, "/admin");
    const row = page.getByRole("row").filter({ hasText: description });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row).toContainText("Unhandled");
    await expect(row).toContainText(admin.email);
  });

  test("the status of a report can be moved to Resolved", async ({ page }) => {
    await loginAsAdmin(page, "at-admin-triage-status");
    const description = `E2E triage status ${Date.now()}`;
    await submitBugReport(page, description);

    await gotoAiTutor(page, "/admin");
    const row = page.getByRole("row").filter({ hasText: description });
    await expect(row).toBeVisible({ timeout: 30_000 });

    // The toolbar filter also has a "Resolved" option, so the choice has to
    // come from the row's own listbox. The retry is belt-and-braces around
    // Radix's open-then-choose; it is NOT what made this pass — the status
    // genuinely would not move until AI Tutor started sending the service key
    // on its PATCH to Core (see patchCoreAdminBugReportStatus).
    const trigger = row.locator('[aria-label^="Update status for report"]');
    await expect(async () => {
      await trigger.click();
      await page
        .getByRole("listbox")
        .getByRole("option", { name: "Resolved", exact: true })
        .click({ timeout: 3_000 });
      await expect(trigger).toContainText("Resolved", { timeout: 5_000 });
    }).toPass({ timeout: 20_000 });
    // The change is server-side, not just local state.
    await page.reload();
    await expect(page.getByRole("row").filter({ hasText: description })).toContainText("Resolved", {
      timeout: 30_000,
    });
  });

  test("a report opens a detail view carrying the description and reporter", async ({ page }) => {
    const admin = await loginAsAdmin(page, "at-admin-triage-detail");
    const description = `E2E triage detail ${Date.now()}`;
    await submitBugReport(page, description);

    await gotoAiTutor(page, "/admin");
    await page.getByText(description).first().click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await expect(dialog).toContainText(description);
    await expect(dialog).toContainText(admin.email);
  });

  test("the queue can be filtered by status, type, and reporter, and searched", async ({
    page,
  }) => {
    await loginAsAdmin(page, "at-admin-triage-filters");
    const description = `E2E triage filter ${Date.now()}`;
    await submitBugReport(page, description);
    await gotoAiTutor(page, "/admin");

    // Filters are present and offer the documented options.
    await page.getByRole("combobox").filter({ hasText: "All statuses" }).click();
    for (const option of ["All statuses", "Unhandled", "In progress", "Resolved"]) {
      await expect(page.getByRole("option", { name: option, exact: true })).toBeVisible();
    }
    await page.keyboard.press("Escape");

    // Type filter: the options are all present; the test below covers matching.
    await page.getByRole("combobox").filter({ hasText: "All types" }).click();
    for (const option of ["All types", "UI / display", "Performance", "Other"]) {
      await expect(page.getByRole("option", { name: option, exact: true })).toBeVisible();
    }
    await page.keyboard.press("Escape");

    await page.getByRole("combobox").filter({ hasText: "All reporters" }).click();
    for (const option of ["All reporters", "Named", "Anonymous"]) {
      await expect(page.getByRole("option", { name: option, exact: true })).toBeVisible();
    }
    await page.keyboard.press("Escape");

    // Searching by description narrows to the report just filed.
    await page.getByPlaceholder(/search description/i).fill(description);
    await expect(page.getByRole("row").filter({ hasText: description })).toBeVisible({
      timeout: 20_000,
    });

    // A term that matches nothing empties the table rather than ignoring input.
    await page.getByPlaceholder(/search description/i).fill(`no-such-report-${Date.now()}`);
    await expect(page.getByRole("row").filter({ hasText: description })).toHaveCount(0, {
      timeout: 20_000,
    });
  });

  test("a report keeps the type it was filed under, so the Type filter can match it", async ({
    page,
  }) => {
    // Regression (BUG-7): AI Tutor validated the chosen type and handed it to
    // `postCoreBugReport`, which rebuilt the Core payload field by field and
    // dropped `bugType` — so every AI-Tutor-sourced report landed in Core with
    // `bugType = NULL`, the Type column was always blank, and the Type filter
    // could never match anything.
    await loginAsAdmin(page, "at-admin-triage-typefilter");
    const description = `E2E triage type ${Date.now()}`;
    await submitBugReport(page, description, { type: "Performance" });
    await gotoAiTutor(page, "/admin");

    await expect(page.getByRole("row").filter({ hasText: description })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole("combobox").filter({ hasText: "All types" }).click();
    await page.getByRole("option", { name: "Performance", exact: true }).click();
    await expect(page.getByRole("row").filter({ hasText: description })).toBeVisible({
      timeout: 20_000,
    });
  });

  test("filtering to Resolved hides an Unhandled report", async ({ page }) => {
    await loginAsAdmin(page, "at-admin-triage-statusfilter");
    const description = `E2E triage status filter ${Date.now()}`;
    await submitBugReport(page, description);
    await gotoAiTutor(page, "/admin");

    await expect(page.getByRole("row").filter({ hasText: description })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole("combobox").filter({ hasText: "All statuses" }).click();
    await page.getByRole("option", { name: "Resolved", exact: true }).click();
    await expect(page.getByRole("row").filter({ hasText: description })).toHaveCount(0, {
      timeout: 20_000,
    });
  });
});

test.describe("AI Tutor ADMIN — AI settings", () => {
  test("the EduAI API key can be saved and cleared", async ({ page }) => {
    await loginAsAdmin(page, "at-admin-apikey");
    await gotoAiTutor(page, "/admin");
    await openTab(page, "AI settings");

    await expect(page.getByRole("heading", { name: "AI configuration" })).toBeVisible();

    // The stored key is a single global row, so a previous spec (or run) may
    // have left an override behind. Clear it and reload so the badge starts
    // from a known "From .env" — otherwise the staleness assertion below is
    // vacuous, because the badge would already read "Admin override".
    const clear = page.getByRole("button", { name: /clear key/i });
    if (await clear.isEnabled()) {
      await clear.click();
      await expect(page.getByText(/The default key will be used instead/i)).toBeVisible({
        timeout: 20_000,
      });
    }
    await page.reload();
    await openTab(page, "AI settings");
    await expect(page.getByText("From .env")).toBeVisible({ timeout: 20_000 });

    const keyField = page.getByPlaceholder("Paste EDUAI API key");
    await expect(keyField).toHaveAttribute("type", "password");

    // The Show toggle reveals what was typed before it is committed.
    await keyField.fill("e2e-admin-console-key");
    await page.getByRole("button", { name: /^show$/i }).click();
    await expect(keyField).toHaveAttribute("type", "text");

    await page.getByRole("button", { name: /save key/i }).click();
    await expect(page.getByText(/This key will be used instead of the default one/i)).toBeVisible({
      timeout: 20_000,
    });

    // Regression (BUG-4): the badge is rendered from the route loader, which is
    // never revalidated, so it used to keep reading "From .env" until a reload.
    // The panel now reports the new status up to the route.
    await expect(page.getByText("Admin override")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("From .env")).toHaveCount(0);

    await page.reload();
    await openTab(page, "AI settings");
    await expect(page.getByText("Admin override")).toBeVisible({ timeout: 20_000 });

    // Leave the environment as we found it — and the badge follows the clear
    // back down without a reload, the same way it followed the save.
    await page.getByRole("button", { name: /clear key/i }).click();
    await expect(page.getByText(/The default key will be used instead/i)).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText("From .env")).toBeVisible({ timeout: 10_000 });
  });

  test("the AI loop policy panel explains the tutor/supervisor split", async ({ page }) => {
    await loginAsAdmin(page, "at-admin-loop-policy");
    await gotoAiTutor(page, "/admin");
    await openTab(page, "AI settings");

    await expect(page.getByRole("heading", { name: "AI loop policy" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Allowed tutor models" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Loop defaults" })).toBeVisible();
    await expect(page.getByText("Enable dual loop")).toBeVisible();
    await expect(page.getByText("Max revision passes")).toBeVisible();
  });

  test("the loop policy cannot be saved until something is actually changed", async ({ page }) => {
    // `saveAiPolicy` is gated on `aiPolicyDirty` as well as on a non-empty
    // allowlist and both defaults, so an untouched panel must never offer to
    // write a policy — regardless of whether a catalogue exists.
    await loginAsAdmin(page, "at-admin-loop-clean");
    await gotoAiTutor(page, "/admin");
    await openTab(page, "AI settings");

    await expect(page.getByRole("heading", { name: "Allowed tutor models" })).toBeVisible();
    await expect(page.getByRole("button", { name: /save loop settings/i })).toBeDisabled();
    await expect(page.getByRole("button", { name: /reset changes/i })).toBeDisabled();
  });

  test("an empty catalogue fails closed with an explanation instead of an empty allowlist", async ({
    page,
    playwright,
  }) => {
    // Core owns the catalogue. With none published the allowlist cannot be
    // populated at all, so the panel must say so rather than rendering an empty
    // picker — and Save must stay disabled.
    //
    // The catalogue is platform-global state, so this only asserts the empty
    // branch when the environment is genuinely empty; a parallel spec that
    // seeds models would otherwise make this flake.
    await loginAsAdmin(page, "at-admin-loop-empty");
    await gotoAiTutor(page, "/admin");
    await openTab(page, "AI settings");

    const noModels = page.getByText("No AI models are available yet.");
    if (await noModels.count()) {
      await expect(noModels).toBeVisible();
      await expect(page.getByRole("button", { name: /save loop settings/i })).toBeDisabled();
    } else {
      test.skip(true, "AI model catalogue is populated in this environment");
    }
  });

  test("an admin allows a tutor model and the loop policy persists", async ({
    page,
    playwright,
  }) => {
    // The highest-value admin AI path: what the allowlist holds decides which
    // models students can pick in the tutor loop. It needs a catalogue, which
    // the e2e stack ships empty, so seed one through Core and take it away
    // again afterwards.
    const admin = await playwright.request.newContext();
    try {
      await createAdmin(admin, { prefix: "at-admin-policy-seed" });
      const policy = await captureAiPolicy(admin);
      const catalogue = await seedAiModelCatalogue(admin, { count: 2 });
      try {
        // The policy is one global SystemSetting row shared by the whole stack,
        // so pin a known baseline (only the first model allowed) instead of
        // inheriting whatever a previous run left behind.
        await setAiPolicyBaseline(admin, catalogue.models[0].tutorModelId);

        await loginAsAdmin(page, "at-admin-policy-save");
        await gotoAiTutor(page, "/admin");
        await openTab(page, "AI settings");

        const first = page.locator("label").filter({ hasText: catalogue.models[0].modelName });
        const second = page.locator("label").filter({ hasText: catalogue.models[1].modelName });
        await expect(first).toBeVisible({ timeout: 20_000 });
        await expect(first.locator('input[type="checkbox"]')).toBeChecked();
        await expect(second.locator('input[type="checkbox"]')).not.toBeChecked();

        // Untouched policy: Save is gated on `aiPolicyDirty`, so it stays
        // disabled until the admin actually changes something.
        const save = page.getByRole("button", { name: /save loop settings/i });
        await expect(save).toBeDisabled();

        // Widening the allowlist is the decision that matters: it is what
        // students may then pick from in the tutor loop.
        await second.locator('input[type="checkbox"]').check();
        await expect(save).toBeEnabled();
        await save.click();

        // Persisted server-side, not just held in component state.
        await page.reload();
        await openTab(page, "AI settings");
        await expect(
          page
            .locator("label")
            .filter({ hasText: catalogue.models[1].modelName })
            .locator('input[type="checkbox"]'),
        ).toBeChecked({ timeout: 20_000 });
      } finally {
        await policy.restore();
        await catalogue.dispose();
      }
    } finally {
      await admin.dispose();
    }
  });
});

test.describe("AI Tutor ADMIN — AI oversight", () => {
  test("lists the trace table with its course and row-count filters", async ({ page }) => {
    await loginAsAdmin(page, "at-admin-oversight");
    await gotoAiTutor(page, "/admin");
    await openTab(page, "AI oversight");

    await expect(
      page.getByText("Review recent AI tutoring interactions across your courses."),
    ).toBeVisible();
    for (const header of [
      "Student",
      "Course",
      "Activity",
      "Mode",
      "Model",
      "Iterations",
      "Outcome",
      "When",
    ]) {
      await expect(page.getByRole("columnheader", { name: header, exact: true })).toBeVisible();
    }
    await expect(page.locator('[aria-label="Filter by course"]')).toBeVisible();
    await expect(page.locator('[aria-label="Rows to show"]')).toBeVisible();
  });

  test("the row-count filter refetches with the new limit", async ({ page }) => {
    await loginAsAdmin(page, "at-admin-oversight-limit");
    await gotoAiTutor(page, "/admin");
    await openTab(page, "AI oversight");

    await page.locator('[aria-label="Rows to show"]').click();
    for (const option of ["Show 25", "Show 50", "Show 100", "Show 200"]) {
      await expect(page.getByRole("option", { name: option, exact: true })).toBeVisible();
    }

    // "Refetches" is the claim, so watch the request rather than the trigger
    // label: the panel must re-ask the server with limit=100, not slice a list
    // it already holds.
    const refetch = page.waitForRequest(
      (req) => req.url().includes("/api/admin/ai-traces") && req.url().includes("limit=100"),
      { timeout: 20_000 },
    );
    await page.getByRole("option", { name: "Show 100", exact: true }).click();
    await refetch;
    await expect(page.locator('[aria-label="Rows to show"]')).toContainText("Show 100");

    // No tutoring has happened in a fresh environment, so the empty state is
    // the correct outcome — an error banner here would mean the fetch failed.
    await expect(page.getByText(/No AI tutoring interactions yet\./i)).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText(/Could not load AI oversight data/i)).toHaveCount(0);
  });

  test("with no traces the course filter offers only the all-courses scope", async ({ page }) => {
    // `uniqueCourseOptions` derives the dropdown from the traces themselves, so
    // an environment that has never run the tutor loop has nothing to scope to.
    // That is the state of the e2e stack (no working provider key), and it is
    // what a reader of the workflow doc should expect to see here.
    await loginAsAdmin(page, "at-admin-oversight-course");
    await gotoAiTutor(page, "/admin");
    await openTab(page, "AI oversight");

    await page.locator('[aria-label="Filter by course"]').click();
    await expect(page.getByRole("option", { name: "All courses", exact: true })).toBeVisible();
    await expect(page.getByRole("option")).toHaveCount(1);
  });

  test("scoping to one course refetches for it and keeps every course selectable", async ({
    page,
  }) => {
    // The one admin path that cannot be reached with real data here: course
    // options come from traces, and a trace needs a working model provider key,
    // which the e2e stack does not have. Stubbing only the traces endpoint still
    // exercises the real panel — the option list captured from the unfiltered
    // load, the course-scoped refetch, and the guarantee that scoping does not
    // shrink the dropdown to whatever the current filter returned.
    let scopedRequests = 0;
    await page.route("**/api/admin/ai-traces*", async (route) => {
      const url = new URL(route.request().url());
      const courseId = url.searchParams.get("courseId");
      if (courseId) scopedRequests += 1;
      const rows = [
        {
          id: 1,
          userId: "stub-user-1",
          studentName: "Stub Student One",
          courseId: 8001,
          courseTitle: "Stub Oversight Course A",
          activityId: 1,
          activityTitle: "Stub activity A",
          mode: "TEACH",
          modelId: "stub:model",
          iterations: 1,
          status: "COMPLETED",
          createdAt: new Date().toISOString(),
        },
        {
          id: 2,
          userId: "stub-user-2",
          studentName: "Stub Student Two",
          courseId: 8002,
          courseTitle: "Stub Oversight Course B",
          activityId: 2,
          activityTitle: "Stub activity B",
          mode: "GUIDE",
          modelId: "stub:model",
          iterations: 2,
          status: "COMPLETED",
          createdAt: new Date().toISOString(),
        },
      ].filter((row) => !courseId || String(row.courseId) === courseId);

      await route.fulfill({ json: rows });
    });

    await loginAsAdmin(page, "at-admin-oversight-scope");
    await gotoAiTutor(page, "/admin");
    await openTab(page, "AI oversight");

    // Scope the assertions to table cells: the filter trigger renders the
    // selected course title too, so a bare getByText matches twice.
    const cell = (name: string) => page.getByRole("cell", { name, exact: true });
    await expect(cell("Stub Oversight Course A")).toBeVisible({ timeout: 20_000 });
    await expect(cell("Stub Oversight Course B")).toBeVisible();

    await page.locator('[aria-label="Filter by course"]').click();
    await page.getByRole("option", { name: "Stub Oversight Course A", exact: true }).click();

    await expect(cell("Stub Oversight Course B")).toHaveCount(0, { timeout: 20_000 });
    await expect(cell("Stub Oversight Course A")).toBeVisible();
    expect(scopedRequests).toBeGreaterThan(0);

    // Captured from the unfiltered load, so course B stays reachable even
    // though it is no longer in the table.
    await page.locator('[aria-label="Filter by course"]').click();
    await expect(
      page.getByRole("option", { name: "Stub Oversight Course B", exact: true }),
    ).toBeVisible();
  });
});

test.describe("AI Tutor ADMIN — anonymous bug reports", () => {
  test("an anonymous report is masked in the queue and in its detail view", async ({ page }) => {
    // The masking is server-side (`bugReportMappers.js` drops reporterName and
    // reporterEmail when `isAnonymous`), and it is the only privacy promise the
    // bug-report flow makes — so it is worth exercising end to end rather than
    // only asserting that the switch exists.
    const admin = await loginAsAdmin(page, "at-admin-anon-report");
    const description = `E2E anonymous report ${Date.now()}`;
    await submitBugReport(page, description, { anonymous: true });

    await gotoAiTutor(page, "/admin");
    const row = page.getByRole("row").filter({ hasText: description });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row).toContainText("Anonymous");
    await expect(row).not.toContainText(admin.email);

    await page.getByText(description).first().click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await expect(dialog).toContainText(description);
    await expect(dialog).not.toContainText(admin.email);
  });

  test("the reporter filter separates anonymous from named reports", async ({ page }) => {
    const admin = await loginAsAdmin(page, "at-admin-anon-filter");
    const named = `E2E named report ${Date.now()}`;
    await submitBugReport(page, named);
    const anonymous = `E2E anon filter report ${Date.now()}`;
    await submitBugReport(page, anonymous, { anonymous: true });

    await gotoAiTutor(page, "/admin");
    await expect(page.getByRole("row").filter({ hasText: named })).toBeVisible({
      timeout: 30_000,
    });

    await page.getByRole("combobox").filter({ hasText: "All reporters" }).click();
    await page.getByRole("option", { name: "Anonymous", exact: true }).click();
    await expect(page.getByRole("row").filter({ hasText: anonymous })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole("row").filter({ hasText: named })).toHaveCount(0);

    await page.getByRole("combobox").filter({ hasText: "Anonymous" }).click();
    await page.getByRole("option", { name: "Named", exact: true }).click();
    await expect(page.getByRole("row").filter({ hasText: named })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole("row").filter({ hasText: anonymous })).toHaveCount(0);
    await expect(page.getByRole("row").filter({ hasText: named })).toContainText(admin.email);
  });
});
