import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CronJobsAdminView } from "~/components/admin/cron-jobs-admin-view";
import type { CronJobEntry } from "~/lib/db.cron-jobs.server";
import type { ParsedJsonBody } from "../helpers/route-fixtures";

function job(overrides: Partial<CronJobEntry> = {}): CronJobEntry {
  return {
    name: "backup-nightly",
    description: "Full pg_dump of all three EduAI databases",
    schedule: "0 2 * * *",
    scheduleLabel: "Daily at 02:00 UTC",
    script: "backup-nightly.sh",
    lastRun: null,
    ...overrides,
  };
}

function mockFetchJson(body: ParsedJsonBody, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    json: () => Promise.resolve(body),
  });
}

/** Edit schedule opens from the row's schedule text; Edit settings from the History dialog. */
async function chooseRowAction(_jobName: string, item: "Edit schedule" | "Edit settings") {
  if (item === "Edit schedule") {
    fireEvent.click(screen.getByRole("button", { name: /\(edit schedule\)$/ }));
    return;
  }
  fireEvent.click(screen.getByRole("button", { name: /history/i }));
  const history = await screen.findByRole("dialog");
  fireEvent.click(within(history).getByRole("button", { name: "Edit settings" }));
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("CronJobsAdminView", () => {
  it("renders a row per job with name, plain-English schedule and 'never run' status", () => {
    vi.stubGlobal("fetch", mockFetchJson({ jobs: [] }));
    render(<CronJobsAdminView jobs={[job()]} />);

    expect(screen.getByText("backup-nightly")).toBeInTheDocument();
    expect(screen.getByText("Daily at 02:00 UTC")).toBeInTheDocument();
    // The cron expression and script moved to the run history dialog.
    expect(screen.queryByText("0 2 * * *")).not.toBeInTheDocument();
    expect(screen.queryByText("backup-nightly.sh")).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Script" })).not.toBeInTheDocument();
    expect(screen.getByText("Never run")).toBeInTheDocument();
    expect(screen.getByText("Total jobs")).toBeInTheDocument();
    // total jobs stat card
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("shows SUCCESS badge and duration for a completed run", () => {
    vi.stubGlobal("fetch", mockFetchJson({ jobs: [] }));
    render(
      <CronJobsAdminView
        jobs={[
          job({
            lastRun: {
              id: "run-1",
              jobName: "backup-nightly",
              status: "SUCCESS",
              startedAt: "2026-01-01T00:00:00.000Z",
              finishedAt: "2026-01-01T00:00:05.000Z",
              message: null,
              exitCode: 0,
              triggerSource: "SCHEDULE",
              triggeredByUserId: null,
            },
          }),
        ]}
      />,
    );

    expect(screen.getByText("Success")).toBeInTheDocument();
    expect(screen.getByText("5s")).toBeInTheDocument();
  });

  it("shows ERROR badge for a failed run", () => {
    vi.stubGlobal("fetch", mockFetchJson({ jobs: [] }));
    render(
      <CronJobsAdminView
        jobs={[
          job({
            lastRun: {
              id: "run-1",
              jobName: "backup-nightly",
              status: "ERROR",
              startedAt: "2026-01-01T00:00:00.000Z",
              finishedAt: "2026-01-01T00:00:01.000Z",
              message: "boom",
              exitCode: 1,
              triggerSource: "SCHEDULE",
              triggeredByUserId: null,
            },
          }),
        ]}
      />,
    );

    expect(screen.getByText("Error")).toBeInTheDocument();
  });

  it("shows an External badge and hides Run now for extension-managed jobs", () => {
    vi.stubGlobal("fetch", mockFetchJson({ jobs: [] }));
    render(
      <CronJobsAdminView
        jobs={[
          job({
            name: "ai-tutor-reconcile",
            triggerEnabled: false,
            lastRun: null,
          }),
        ]}
      />,
    );

    expect(screen.getByText("External")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /run now/i })).not.toBeInTheDocument();
    // no schedule edit for extension-managed jobs
    expect(screen.queryByRole("button", { name: /edit schedule/ })).not.toBeInTheDocument();
  });

  it("shows the running count with a currently-running indicator when a job is RUNNING", () => {
    vi.stubGlobal("fetch", mockFetchJson({ jobs: [] }));
    render(
      <CronJobsAdminView
        jobs={[
          job({
            lastRun: {
              id: "run-1",
              jobName: "backup-nightly",
              status: "RUNNING",
              startedAt: "2026-01-01T00:00:00.000Z",
              finishedAt: null,
              message: null,
              exitCode: null,
              triggerSource: "SCHEDULE",
              triggeredByUserId: null,
            },
          }),
        ]}
      />,
    );

    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("running…")).toBeInTheDocument();
    expect(screen.getByText("Currently running")).toBeInTheDocument();
    expect(screen.getByText(/auto-refreshing/)).toBeInTheDocument();
    // Run now button should be disabled while running
    expect(screen.getByRole("button", { name: /running…/i })).toBeDisabled();
  });

  it("shows an error count when at least one job's last run failed and none are running", () => {
    vi.stubGlobal("fetch", mockFetchJson({ jobs: [] }));
    render(
      <CronJobsAdminView
        jobs={[
          job({
            lastRun: {
              id: "run-1",
              jobName: "backup-nightly",
              status: "ERROR",
              startedAt: "2026-01-01T00:00:00.000Z",
              finishedAt: "2026-01-01T00:00:01.000Z",
              message: "boom",
              exitCode: 1,
              triggerSource: "SCHEDULE",
              triggeredByUserId: null,
            },
          }),
        ]}
      />,
    );

    expect(screen.getByText("Errors")).toBeInTheDocument();
  });

  it("triggers a job via POST and refetches statuses on success", async () => {
    const fetchMock = vi
      .fn()
      // Initial shared cron-status refresh on mount.
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => "application/json" },
        // Keep the supplied job visible after the shared initial refresh so
        // the action button remains available for this interaction test.
        json: () => Promise.resolve({ jobs: [job()] }),
      })
      // triggerJob POST
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ runId: "run-1" }) })
      // fetchStatuses GET after trigger
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => "application/json" },
        json: () =>
          Promise.resolve({
            jobs: [
              job({
                lastRun: {
                  id: "run-1",
                  jobName: "backup-nightly",
                  status: "SUCCESS",
                  startedAt: "2026-01-01T00:00:00.000Z",
                  finishedAt: "2026-01-01T00:00:01.000Z",
                  message: null,
                  exitCode: 0,
                  triggerSource: "SCHEDULE",
                  triggeredByUserId: null,
                },
              }),
            ],
          }),
      });
    vi.stubGlobal("fetch", fetchMock);

    render(<CronJobsAdminView jobs={[job()]} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: /run now/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/admin/cron-jobs",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ intent: "trigger", jobName: "backup-nightly" }),
      }),
    );
    // apiFetch adds a Headers object to the refresh request, so assert the
    // endpoint independently of wrapper implementation details.
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/api/admin/cron-jobs");

    await waitFor(() => expect(screen.getByText("Success")).toBeInTheDocument());
  });

  it("polls /api/admin/cron-jobs every 3s while a job is RUNNING and stops once resolved", async () => {
    const runningJobsResponse = {
      ok: true,
      json: () =>
        Promise.resolve({
          jobs: [
            job({
              lastRun: {
                id: "run-1",
                jobName: "backup-nightly",
                status: "SUCCESS",
                startedAt: "2026-01-01T00:00:00.000Z",
                finishedAt: "2026-01-01T00:00:01.000Z",
                message: null,
                exitCode: 0,
                triggerSource: "SCHEDULE",
                triggeredByUserId: null,
              },
            }),
          ],
        }),
    };
    const fetchMock = vi.fn().mockResolvedValue(runningJobsResponse);
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CronJobsAdminView
        jobs={[
          job({
            lastRun: {
              id: "run-0",
              jobName: "backup-nightly",
              status: "RUNNING",
              startedAt: "2026-01-01T00:00:00.000Z",
              finishedAt: null,
              message: null,
              exitCode: null,
              triggerSource: "SCHEDULE",
              triggeredByUserId: null,
            },
          }),
        ]}
      />,
    );

    await vi.advanceTimersByTimeAsync(3000);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // status flipped to SUCCESS, so polling should stop — no further calls.
    await vi.advanceTimersByTimeAsync(9000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("opens the run history dialog, loads runs, and shows the full message on click", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          runs: [
            {
              id: "run-1",
              jobName: "backup-nightly",
              status: "ERROR",
              startedAt: "2026-01-01T00:00:00.000Z",
              finishedAt: "2026-01-01T00:00:02.000Z",
              message: "full stack trace here",
              exitCode: 1,
              triggerSource: "SCHEDULE",
              triggeredByUserId: null,
            },
          ],
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CronJobsAdminView jobs={[job()]} />);

    fireEvent.click(screen.getByRole("button", { name: /history/i }));

    expect(fetchMock).toHaveBeenCalledWith("/api/admin/cron-jobs?job=backup-nightly");

    const dialog = await screen.findByRole("dialog");
    await waitFor(() =>
      expect(within(dialog).getByText("full stack trace here")).toBeInTheDocument(),
    );

    fireEvent.click(within(dialog).getByText("full stack trace here"));

    expect(await screen.findByText(/Run output — backup-nightly/)).toBeInTheDocument();
  });

  it("heads the run history dialog with the cron expression and script", async () => {
    vi.stubGlobal("fetch", mockFetchJson({ runs: [] }));
    render(<CronJobsAdminView jobs={[job({ scheduleOverridden: true })]} />);

    fireEvent.click(screen.getByRole("button", { name: /history/i }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("0 2 * * *")).toBeInTheDocument();
    expect(within(dialog).getByText("custom")).toBeInTheDocument();
    expect(within(dialog).getByText("backup-nightly.sh")).toBeInTheDocument();
  });

  it("shows the last run as relative time, with the full time on hover", () => {
    vi.stubGlobal("fetch", mockFetchJson({ jobs: [] }));
    const startedAt = new Date(Date.now() - 3 * 3_600_000).toISOString();
    render(
      <CronJobsAdminView
        jobs={[
          job({
            lastRun: {
              id: "r1",
              jobName: "backup-nightly",
              status: "SUCCESS",
              startedAt,
              finishedAt: startedAt,
              message: null,
              exitCode: 0,
              triggerSource: "SCHEDULE",
              triggeredByUserId: null,
            },
          }),
        ]}
      />,
    );
    expect(screen.getByText("3h ago")).toHaveAttribute("title");
  });

  it("shows an empty state in the run history dialog when there are no runs", async () => {
    vi.stubGlobal("fetch", mockFetchJson({ runs: [] }));
    render(<CronJobsAdminView jobs={[job()]} />);

    fireEvent.click(screen.getByRole("button", { name: /history/i }));

    expect(await screen.findByText("No runs recorded yet.")).toBeInTheDocument();
  });

  it("opens the edit schedule dialog, derives a label from the cron expression, and saves", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          jobs: [job({ schedule: "0 3 * * *", scheduleLabel: "Daily at 03:00 UTC" })],
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CronJobsAdminView jobs={[job()]} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await chooseRowAction("backup-nightly", "Edit schedule");

    const exprInput = await screen.findByLabelText("Cron expression");
    expect((exprInput as HTMLInputElement).value).toBe("0 2 * * *");

    fireEvent.change(exprInput, { target: { value: "0 3 * * *" } });

    const labelInput = screen.getByLabelText("Human-readable label") as HTMLInputElement;
    await waitFor(() => expect(labelInput.value).toBe("Daily at 03:00 UTC"));

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/cron-jobs",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            intent: "update-schedule",
            jobName: "backup-nightly",
            schedule: "0 3 * * *",
            scheduleLabel: "Daily at 03:00 UTC",
          }),
        }),
      ),
    );

    // dialog closes on success
    await waitFor(() => expect(screen.queryByLabelText("Cron expression")).not.toBeInTheDocument());
  });

  it("shows a validation error for an invalid cron expression instead of saving", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<CronJobsAdminView jobs={[job()]} />);

    await chooseRowAction("backup-nightly", "Edit schedule");
    const exprInput = await screen.findByLabelText("Cron expression");
    fireEvent.change(exprInput, { target: { value: "not-a-cron" } });

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    expect(await screen.findByText(/Invalid cron expression/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces a server error message returned from the update-schedule call", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "Schedule conflict" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CronJobsAdminView jobs={[job()]} />);

    await chooseRowAction("backup-nightly", "Edit schedule");
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    expect(await screen.findByText("Schedule conflict")).toBeInTheDocument();
  });

  it("shows a Reset to default button only for jobs with an overridden schedule, and resets it", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ jobs: [job()] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CronJobsAdminView jobs={[job({ scheduleOverridden: true })]} />);

    await chooseRowAction("backup-nightly", "Edit schedule");
    const resetButton = await screen.findByRole("button", { name: /reset to default/i });
    fireEvent.click(resetButton);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/cron-jobs",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ intent: "reset-schedule", jobName: "backup-nightly" }),
        }),
      ),
    );
  });

  it("does not show a Reset to default button for a non-overridden schedule", async () => {
    vi.stubGlobal("fetch", mockFetchJson({ jobs: [] }));
    render(<CronJobsAdminView jobs={[job({ scheduleOverridden: false })]} />);

    await chooseRowAction("backup-nightly", "Edit schedule");
    await screen.findByLabelText("Cron expression");
    expect(screen.queryByRole("button", { name: /reset to default/i })).not.toBeInTheDocument();
  });

  it("leaves an extension-managed job's schedule as plain text, not an edit button", () => {
    vi.stubGlobal("fetch", mockFetchJson({ jobs: [] }));
    render(<CronJobsAdminView jobs={[job({ triggerEnabled: false })]} />);
    expect(screen.getByText("Daily at 02:00 UTC")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit schedule/ })).not.toBeInTheDocument();
  });

  const RETAIN = {
    key: "retainDays",
    label: "Delete after (days)",
    description:
      "Materials soft-deleted longer than this are permanently removed along with their embeddings and cannot be restored.",
    type: "int" as const,
    min: 1,
    max: 3650,
    default: 90,
    value: 90,
    overridden: false,
  };

  function purgeJob(settingOverrides: Partial<typeof RETAIN> = {}) {
    return job({
      name: "purge-deleted-materials",
      description: "Permanently delete course materials soft-deleted more than N days ago",
      schedule: "0 5 * * *",
      scheduleLabel: "Daily at 05:00 UTC",
      script: "Core handler",
      execution: "CORE",
      settings: [{ ...RETAIN, ...settingOverrides }],
    });
  }

  it("shows each setting's current value and whether it is the default in run history", async () => {
    vi.stubGlobal("fetch", mockFetchJson({ runs: [] }));
    render(<CronJobsAdminView jobs={[purgeJob()]} />);
    expect(screen.queryByText(/Delete after \(days\):/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /history/i }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Delete after (days): 90 (default)")).toBeInTheDocument();
  });

  it("marks an overridden setting in run history", async () => {
    vi.stubGlobal("fetch", mockFetchJson({ runs: [] }));
    render(<CronJobsAdminView jobs={[purgeJob({ value: 30, overridden: true })]} />);
    fireEvent.click(screen.getByRole("button", { name: /history/i }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Delete after (days): 30 (overridden)")).toBeInTheDocument();
  });

  it("offers no Edit settings for a job without settings", async () => {
    vi.stubGlobal("fetch", mockFetchJson({ runs: [] }));
    render(<CronJobsAdminView jobs={[job()]} />);
    fireEvent.click(screen.getByRole("button", { name: /history/i }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("button", { name: "Edit settings" })).not.toBeInTheDocument();
  });

  it("edits a setting, posts update-setting with a number, and closes on success", async () => {
    // The mount-time status fetch returns the pre-save job and only the save returns
    // the override, so the row can show 30 only if the save response reaches onSaved.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ jobs: [purgeJob()] }),
      })
      .mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ jobs: [purgeJob({ value: 30, overridden: true })] }),
      });
    vi.stubGlobal("fetch", fetchMock);
    render(<CronJobsAdminView jobs={[purgeJob()]} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await chooseRowAction("purge-deleted-materials", "Edit settings");
    const input = (await screen.findByLabelText("Delete after (days)")) as HTMLInputElement;
    expect(input.value).toBe("90");
    expect(screen.getByText(RETAIN.description)).toBeInTheDocument();
    expect(screen.getByText("1–3650, default 90")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/cron-jobs",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            intent: "update-setting",
            jobName: "purge-deleted-materials",
            key: "retainDays",
            value: 30,
          }),
        }),
      ),
    );
    await waitFor(() =>
      expect(screen.queryByLabelText("Delete after (days)")).not.toBeInTheDocument(),
    );
    // Mount fetch plus the save; nothing else refetched the status list (the
    // History dialog's `?job=` run fetch, which led to Edit settings, aside).
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/admin/cron-jobs")).toHaveLength(2);
    // The saved value reached the job: reopening the dialog shows it.
    await chooseRowAction("purge-deleted-materials", "Edit settings");
    expect(((await screen.findByLabelText("Delete after (days)")) as HTMLInputElement).value).toBe(
      "30",
    );
  });

  it("does not post when Save is pressed without changes", async () => {
    // The mount-time status fetch publishes its result over the initial jobs, so it
    // must return the same job or the row (and its button) disappears.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ jobs: [purgeJob()] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<CronJobsAdminView jobs={[purgeJob()]} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await chooseRowAction("purge-deleted-materials", "Edit settings");
    await screen.findByLabelText("Delete after (days)");
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(screen.queryByLabelText("Delete after (days)")).not.toBeInTheDocument(),
    );
    // Only the mount fetch; the `?job=` run fetch is the History dialog's.
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/admin/cron-jobs")).toHaveLength(1);
  });

  it("shows the server's validation error and keeps the dialog open", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: '"Delete after (days)" must be between 1 and 3650' }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<CronJobsAdminView jobs={[purgeJob()]} />);

    await chooseRowAction("purge-deleted-materials", "Edit settings");
    const input = await screen.findByLabelText("Delete after (days)");
    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    expect(
      await screen.findByText('"Delete after (days)" must be between 1 and 3650'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Delete after (days)")).toBeInTheDocument();
  });

  it("shows a setting that saved even when a later one in the same Save fails", async () => {
    const BATCH = { ...RETAIN, key: "batchSize", label: "Batch size", default: 100, value: 100 };
    const twoSettings = (retain: Partial<typeof RETAIN>) =>
      job({ ...purgeJob(), settings: [{ ...RETAIN, ...retain }, BATCH] });
    const fetchMock = vi
      .fn()
      // Mount-time status fetch: nothing overridden yet.
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ jobs: [twoSettings({})] }),
      })
      // retainDays persists.
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ jobs: [twoSettings({ value: 30, overridden: true })] }),
      })
      // batchSize is refused.
      .mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: '"Batch size" must be between 1 and 3650' }),
      });
    vi.stubGlobal("fetch", fetchMock);
    render(<CronJobsAdminView jobs={[twoSettings({})]} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await chooseRowAction("purge-deleted-materials", "Edit settings");
    fireEvent.change(await screen.findByLabelText("Delete after (days)"), {
      target: { value: "30" },
    });
    fireEvent.change(screen.getByLabelText("Batch size"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    expect(await screen.findByText('"Batch size" must be between 1 and 3650')).toBeInTheDocument();
    // The dialog stays open on the failure.
    expect(screen.getByLabelText("Batch size")).toBeInTheDocument();
  });

  it("offers Reset to default only for an overridden setting and posts reset-setting", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ jobs: [purgeJob()] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<CronJobsAdminView jobs={[purgeJob({ value: 30, overridden: true })]} />);

    await chooseRowAction("purge-deleted-materials", "Edit settings");
    fireEvent.click(await screen.findByRole("button", { name: /reset to default/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/cron-jobs",
        expect.objectContaining({
          body: JSON.stringify({
            intent: "reset-setting",
            jobName: "purge-deleted-materials",
            key: "retainDays",
          }),
        }),
      ),
    );
  });

  it("hides Reset to default for a setting at its default", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ jobs: [purgeJob()] }) }),
    );
    render(<CronJobsAdminView jobs={[purgeJob()]} />);
    await chooseRowAction("purge-deleted-materials", "Edit settings");
    await screen.findByLabelText("Delete after (days)");
    expect(screen.queryByRole("button", { name: /reset to default/i })).not.toBeInTheDocument();
  });
});

/** A finished run for the detail-panel tests. */
function lastRun(status: "SUCCESS" | "ERROR", message: string | null) {
  return {
    id: "run-1",
    jobName: "backup-nightly",
    status,
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:00:01.000Z",
    message,
    exitCode: status === "ERROR" ? 1 : 0,
    triggerSource: "SCHEDULE" as const,
    triggeredByUserId: null,
  };
}

describe("CronJobsAdminView — job detail panel", () => {
  it("opens from the row and shows a failed run's reason", () => {
    vi.stubGlobal("fetch", mockFetchJson({ jobs: [] }));
    render(<CronJobsAdminView jobs={[job({ lastRun: lastRun("ERROR", "pg_dump: disk full") })]} />);

    fireEvent.click(screen.getByRole("row", { name: "Open job: backup-nightly" }));

    const panel = screen.getByRole("dialog");
    expect(panel).toHaveTextContent("The last run failed.");
    expect(within(panel).getByLabelText("Failure reason")).toHaveTextContent("pg_dump: disk full");
  });

  it("says a successful run completed, and opens from the keyboard", () => {
    vi.stubGlobal("fetch", mockFetchJson({ jobs: [] }));
    render(<CronJobsAdminView jobs={[job({ lastRun: lastRun("SUCCESS", "done") })]} />);

    fireEvent.keyDown(screen.getByRole("row", { name: "Open job: backup-nightly" }), {
      key: "Enter",
    });

    expect(screen.getByRole("dialog")).toHaveTextContent("The last run completed successfully.");
  });

  it("says a job that never ran hasn't run yet", () => {
    vi.stubGlobal("fetch", mockFetchJson({ jobs: [] }));
    render(<CronJobsAdminView jobs={[job()]} />);

    fireEvent.click(screen.getByRole("row", { name: "Open job: backup-nightly" }));

    expect(screen.getByRole("dialog")).toHaveTextContent("This job hasn't run yet.");
  });

  it("does not open from the row's own buttons", async () => {
    vi.stubGlobal("fetch", mockFetchJson({ runs: [] }));
    render(<CronJobsAdminView jobs={[job()]} />);

    fireEvent.click(screen.getByRole("button", { name: /history/i }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Run history — backup-nightly");
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });
});
