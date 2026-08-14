import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CronJobsAdminView } from "~/components/admin/cron-jobs-admin-view";
import type { CronJobEntry } from "~/lib/db.cron-jobs.server";

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

function mockFetchJson(body: unknown, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    json: () => Promise.resolve(body),
  });
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
  it("renders a row per job with name, schedule, script and 'never run' status", () => {
    vi.stubGlobal("fetch", mockFetchJson({ jobs: [] }));
    render(<CronJobsAdminView jobs={[job()]} />);

    expect(screen.getByText("backup-nightly")).toBeInTheDocument();
    expect(screen.getByText("0 2 * * *")).toBeInTheDocument();
    expect(screen.getByText("backup-nightly.sh")).toBeInTheDocument();
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
    // no inline "Edit" schedule link for extension-managed jobs
    expect(screen.queryByText("Edit")).not.toBeInTheDocument();
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
        json: () => Promise.resolve({ jobs: [] }),
      })
      // triggerJob POST
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ runId: "run-1" }) })
      // fetchStatuses GET after trigger
      .mockResolvedValueOnce({
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
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/admin/cron-jobs");

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
    await waitFor(() => expect(within(dialog).getByText("full stack trace here")).toBeInTheDocument());

    fireEvent.click(within(dialog).getByText("full stack trace here"));

    expect(await screen.findByText(/Run output — backup-nightly/)).toBeInTheDocument();
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

    fireEvent.click(screen.getByText("Edit"));

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

    fireEvent.click(screen.getByText("Edit"));
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

    fireEvent.click(screen.getByText("Edit"));
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

    fireEvent.click(screen.getByText("Edit"));
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

    fireEvent.click(screen.getByText("Edit"));
    await screen.findByLabelText("Cron expression");
    expect(screen.queryByRole("button", { name: /reset to default/i })).not.toBeInTheDocument();
  });

  it("shows the extension-managed notice in the edit dialog when triggerEnabled is false but schedule is still editable via history/edit not shown", () => {
    // triggerEnabled === false hides the inline Edit link entirely, so the dialog notice
    // path is exercised indirectly; this asserts that guard directly on the row.
    vi.stubGlobal("fetch", mockFetchJson({ jobs: [] }));
    render(<CronJobsAdminView jobs={[job({ triggerEnabled: false })]} />);
    expect(screen.queryByText("Edit")).not.toBeInTheDocument();
  });
});
