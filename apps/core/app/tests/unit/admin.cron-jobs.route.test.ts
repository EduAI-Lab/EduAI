// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/db.cron-jobs.server", () => ({
  KNOWN_CRON_JOBS: [
    {
      name: "backup-nightly",
      description: "Full pg_dump of all three EduAI databases",
      schedule: "0 2 * * *",
      scheduleLabel: "Daily at 02:00 UTC",
      script: "backup-nightly.sh",
    },
    {
      name: "ai-tutor-reconcile",
      description: "Nullify stale coreOfferingId references",
      schedule: "0 2 * * *",
      scheduleLabel: "Daily at 02:00 UTC (AI Tutor server)",
      script: "",
      triggerEnabled: false,
    },
  ],
  listCronJobStatuses: vi.fn(),
  getRecentCronJobRuns: vi.fn(),
  findRunningCronRun: vi.fn(),
  startCronRun: vi.fn(),
  triggerCronJobAsync: vi.fn(),
  updateCronSchedule: vi.fn(),
  resetCronSchedule: vi.fn(),
}));

import { loader, action } from "~/routes/api/admin.cron-jobs";
import { auth } from "~/lib/auth/server";
import {
  listCronJobStatuses,
  getRecentCronJobRuns,
  findRunningCronRun,
  startCronRun,
  triggerCronJobAsync,
  updateCronSchedule,
  resetCronSchedule,
} from "~/lib/db.cron-jobs.server";

const ADMIN_USER = { id: "u-admin", role: "ADMIN", email: "admin@test.com" };
const STUDENT_USER = { id: "u-student", role: "STUDENT", email: "student@test.com" };

function makeRequest(path: string, method = "GET", body?: unknown) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

function makeArgs(request: Request) {
  return { request, params: {}, context: {} as never } as any;
}

// react-router v7 `data()` returns { type, data, init } — not a Response.
function status(res: any): number {
  return res?.init?.status ?? 200;
}
function body(res: any): any {
  return res?.data;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listCronJobStatuses).mockResolvedValue([]);
  vi.mocked(getRecentCronJobRuns).mockResolvedValue([]);
  vi.mocked(findRunningCronRun).mockResolvedValue(null);
  vi.mocked(startCronRun).mockResolvedValue({ runId: "run-1", created: true });
  vi.mocked(triggerCronJobAsync).mockReturnValue(undefined);
  vi.mocked(updateCronSchedule).mockResolvedValue(undefined);
  vi.mocked(resetCronSchedule).mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

describe("GET /api/admin/cron-jobs (loader)", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    const res = await loader(makeArgs(makeRequest("/api/admin/cron-jobs")));
    expect(status(res)).toBe(401);
  });

  it("returns 401 when the user is not ADMIN", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: STUDENT_USER } as any);
    const res = await loader(makeArgs(makeRequest("/api/admin/cron-jobs")));
    expect(status(res)).toBe(401);
  });

  it("returns all job statuses when no job query param is present", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: ADMIN_USER } as any);
    vi.mocked(listCronJobStatuses).mockResolvedValue([{ name: "backup-nightly" } as any]);

    const res = await loader(makeArgs(makeRequest("/api/admin/cron-jobs")));

    expect(status(res)).toBe(200);
    const b = body(res);
    expect(b.jobs).toHaveLength(1);
    expect(listCronJobStatuses).toHaveBeenCalledOnce();
  });

  it("returns recent runs when the job query param is set", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: ADMIN_USER } as any);
    vi.mocked(getRecentCronJobRuns).mockResolvedValue([{ id: "run-1" } as any]);

    const res = await loader(makeArgs(makeRequest("/api/admin/cron-jobs?job=backup-nightly")));

    expect(status(res)).toBe(200);
    const b = body(res);
    expect(b.runs).toHaveLength(1);
    expect(getRecentCronJobRuns).toHaveBeenCalledWith("backup-nightly");
    expect(listCronJobStatuses).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Action — auth guard
// ---------------------------------------------------------------------------

describe("POST /api/admin/cron-jobs (action) — auth guard", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    const res = await action(makeArgs(makeRequest("/api/admin/cron-jobs", "POST", { intent: "trigger", jobName: "backup-nightly" })));
    expect(status(res)).toBe(401);
  });

  it("returns 401 when user is not ADMIN", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: STUDENT_USER } as any);
    const res = await action(makeArgs(makeRequest("/api/admin/cron-jobs", "POST", { intent: "trigger", jobName: "backup-nightly" })));
    expect(status(res)).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Action — intent: trigger
// ---------------------------------------------------------------------------

describe("POST /api/admin/cron-jobs (action) — intent: trigger", () => {
  beforeEach(() => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: ADMIN_USER } as any);
  });

  it("returns 400 for an unknown job name", async () => {
    const res = await action(makeArgs(makeRequest("/api/admin/cron-jobs", "POST", { intent: "trigger", jobName: "ghost-job" })));
    expect(status(res)).toBe(400);
    const b = body(res);
    expect(b.error).toMatch(/Unknown job/);
  });

  it("returns 400 for a job managed by an extension server (triggerEnabled: false)", async () => {
    const res = await action(makeArgs(makeRequest("/api/admin/cron-jobs", "POST", { intent: "trigger", jobName: "ai-tutor-reconcile" })));
    expect(status(res)).toBe(400);
    const b = body(res);
    expect(b.error).toMatch(/extension server/);
  });

  it("starts a run and fires triggerCronJobAsync for a valid triggerable job", async () => {
    const res = await action(makeArgs(makeRequest("/api/admin/cron-jobs", "POST", { intent: "trigger", jobName: "backup-nightly" })));
    expect(status(res)).toBe(200);
    expect(findRunningCronRun).toHaveBeenCalledWith("backup-nightly");
    expect(startCronRun).toHaveBeenCalledWith("backup-nightly");
    expect(triggerCronJobAsync).toHaveBeenCalledWith("backup-nightly", "backup-nightly.sh", "run-1");
    const b = body(res);
    expect(b.runId).toBe("run-1");
  });

  it("reuses an existing RUNNING run instead of spawning again", async () => {
    vi.mocked(findRunningCronRun).mockResolvedValue({ id: "run-existing" });
    const res = await action(makeArgs(makeRequest("/api/admin/cron-jobs", "POST", { intent: "trigger", jobName: "backup-nightly" })));
    expect(status(res)).toBe(200);
    expect(startCronRun).not.toHaveBeenCalled();
    expect(triggerCronJobAsync).not.toHaveBeenCalled();
    const b = body(res);
    expect(b).toEqual({ runId: "run-existing", reused: true });
  });
});

// ---------------------------------------------------------------------------
// Action — intent: update-schedule
// ---------------------------------------------------------------------------

describe("POST /api/admin/cron-jobs (action) — intent: update-schedule", () => {
  beforeEach(() => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: ADMIN_USER } as any);
    vi.mocked(listCronJobStatuses).mockResolvedValue([{ name: "backup-nightly" } as any]);
  });

  it("returns 400 when schedule is missing", async () => {
    const res = await action(makeArgs(makeRequest("/api/admin/cron-jobs", "POST", {
      intent: "update-schedule",
      jobName: "backup-nightly",
      scheduleLabel: "Daily at 03:00 UTC",
    })));
    expect(status(res)).toBe(400);
  });

  it("returns 400 when scheduleLabel is missing", async () => {
    const res = await action(makeArgs(makeRequest("/api/admin/cron-jobs", "POST", {
      intent: "update-schedule",
      jobName: "backup-nightly",
      schedule: "0 3 * * *",
    })));
    expect(status(res)).toBe(400);
  });

  it("returns 400 for an invalid cron expression", async () => {
    const res = await action(makeArgs(makeRequest("/api/admin/cron-jobs", "POST", {
      intent: "update-schedule",
      jobName: "backup-nightly",
      schedule: "not-a-cron",
      scheduleLabel: "Bad",
    })));
    expect(status(res)).toBe(400);
    const b = body(res);
    expect(b.error).toMatch(/Invalid cron expression/);
  });

  it("returns 400 for an unknown job", async () => {
    const res = await action(makeArgs(makeRequest("/api/admin/cron-jobs", "POST", {
      intent: "update-schedule",
      jobName: "ghost-job",
      schedule: "0 3 * * *",
      scheduleLabel: "Daily at 03:00 UTC",
    })));
    expect(status(res)).toBe(400);
  });

  it("updates the schedule on valid input", async () => {
    const res = await action(makeArgs(makeRequest("/api/admin/cron-jobs", "POST", {
      intent: "update-schedule",
      jobName: "backup-nightly",
      schedule: "0 3 * * *",
      scheduleLabel: "Daily at 03:00 UTC",
    })));
    expect(status(res)).toBe(200);
    expect(updateCronSchedule).toHaveBeenCalledWith("backup-nightly", "0 3 * * *", "Daily at 03:00 UTC");
    const b = body(res);
    expect(b.jobs).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Action — intent: reset-schedule
// ---------------------------------------------------------------------------

describe("POST /api/admin/cron-jobs (action) — intent: reset-schedule", () => {
  beforeEach(() => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: ADMIN_USER } as any);
    vi.mocked(listCronJobStatuses).mockResolvedValue([{ name: "backup-nightly" } as any]);
  });

  it("returns 400 for an unknown job", async () => {
    const res = await action(makeArgs(makeRequest("/api/admin/cron-jobs", "POST", {
      intent: "reset-schedule",
      jobName: "ghost-job",
    })));
    expect(status(res)).toBe(400);
  });

  it("resets the override on valid input", async () => {
    const res = await action(makeArgs(makeRequest("/api/admin/cron-jobs", "POST", {
      intent: "reset-schedule",
      jobName: "backup-nightly",
    })));
    expect(status(res)).toBe(200);
    expect(resetCronSchedule).toHaveBeenCalledWith("backup-nightly");
    const b = body(res);
    expect(b.jobs).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Action — unknown intent
// ---------------------------------------------------------------------------

describe("POST /api/admin/cron-jobs (action) — unknown intent", () => {
  it("returns 400 with an error message", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: ADMIN_USER } as any);
    const res = await action(makeArgs(makeRequest("/api/admin/cron-jobs", "POST", { intent: "unknown" })));
    expect(status(res)).toBe(400);
    const b = body(res);
    expect(b.error).toBe("Unknown intent");
  });
});
