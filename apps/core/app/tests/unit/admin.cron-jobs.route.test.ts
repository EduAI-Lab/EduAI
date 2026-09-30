// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/api-keys/access.server", () => ({
  isActiveAdminUser: vi.fn(),
}));

vi.mock("~/lib/logging.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/logging.server")>()),
  logAuditAction: vi.fn().mockResolvedValue(undefined),
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
  startCronRun: vi.fn(),
  triggerCronJobAsync: vi.fn(),
  updateCronSchedule: vi.fn(),
  resetCronSchedule: vi.fn(),
  updateCronJobSetting: vi.fn(),
  resetCronJobSetting: vi.fn(),
  CronJobSettingError: class CronJobSettingError extends Error {
    readonly status = 400;
    constructor(message: string) {
      super(message);
      this.name = "CronJobSettingError";
    }
  },
}));

import { loader, action } from "~/routes/api/admin.cron-jobs";
import { auth } from "~/lib/auth/server";
import { isActiveAdminUser } from "~/lib/api-keys/access.server";
import {
  listCronJobStatuses,
  getRecentCronJobRuns,
  startCronRun,
  triggerCronJobAsync,
  updateCronSchedule,
  resetCronSchedule,
  updateCronJobSetting,
  resetCronJobSetting,
  CronJobSettingError,
} from "~/lib/db.cron-jobs.server";
import { logAuditAction } from "~/lib/logging.server";
import type { RouteRequestBody } from "../helpers/route-fixtures";

const ADMIN_USER = { id: "u-admin", role: "ADMIN", email: "admin@test.com" };
const STUDENT_USER = { id: "u-student", role: "STUDENT", email: "student@test.com" };

function makeRequest(path: string, method = "GET", body?: RouteRequestBody) {
  // A GET carries no body at all, so the key is added only when one is passed.
  const init: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request(`http://localhost${path}`, init);
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
  // Default: an ADMIN-role session's account is also active. The deactivated-
  // admin regression tests below override this per call.
  vi.mocked(isActiveAdminUser).mockResolvedValue(true);
  vi.mocked(listCronJobStatuses).mockResolvedValue([]);
  vi.mocked(getRecentCronJobRuns).mockResolvedValue([]);
  vi.mocked(startCronRun).mockResolvedValue({
    runId: "run-1",
    created: true,
    leaseOwner: "owner-1",
  });
  vi.mocked(triggerCronJobAsync).mockReturnValue(undefined);
  vi.mocked(updateCronSchedule).mockResolvedValue(undefined);
  vi.mocked(resetCronSchedule).mockResolvedValue(undefined);
  vi.mocked(updateCronJobSetting).mockResolvedValue({ previous: 90, value: 30 });
  vi.mocked(resetCronJobSetting).mockResolvedValue({ previous: 30, value: 90 });
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

  // #1571-pattern gap found in a #1669 deep-audit pass: this route's local
  // requireAdmin only checked the session's cached role, so a deactivated
  // admin's still-live session kept full cron trigger/schedule access until
  // the session naturally expired — unlike the shared `requireAdmin` guard,
  // which was fixed for #1571 to re-check `isActive` against the DB.
  it("returns 401 when the ADMIN-role session's account was deactivated (#1571)", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: ADMIN_USER } as any);
    vi.mocked(isActiveAdminUser).mockResolvedValue(false);
    const res = await loader(makeArgs(makeRequest("/api/admin/cron-jobs")));
    expect(status(res)).toBe(401);
    expect(isActiveAdminUser).toHaveBeenCalledWith(ADMIN_USER.id);
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
    const res = await action(
      makeArgs(
        makeRequest("/api/admin/cron-jobs", "POST", {
          intent: "trigger",
          jobName: "backup-nightly",
        }),
      ),
    );
    expect(status(res)).toBe(401);
  });

  it("returns 401 when user is not ADMIN", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: STUDENT_USER } as any);
    const res = await action(
      makeArgs(
        makeRequest("/api/admin/cron-jobs", "POST", {
          intent: "trigger",
          jobName: "backup-nightly",
        }),
      ),
    );
    expect(status(res)).toBe(401);
  });

  it("returns 401 when the ADMIN-role session's account was deactivated (#1571)", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: ADMIN_USER } as any);
    vi.mocked(isActiveAdminUser).mockResolvedValue(false);
    const res = await action(
      makeArgs(
        makeRequest("/api/admin/cron-jobs", "POST", {
          intent: "trigger",
          jobName: "backup-nightly",
        }),
      ),
    );
    expect(status(res)).toBe(401);
    expect(startCronRun).not.toHaveBeenCalled();
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
    const res = await action(
      makeArgs(
        makeRequest("/api/admin/cron-jobs", "POST", { intent: "trigger", jobName: "ghost-job" }),
      ),
    );
    expect(status(res)).toBe(400);
    const b = body(res);
    expect(b.error).toMatch(/Unknown job/);
  });

  it("returns 400 for a job managed by an extension server (triggerEnabled: false)", async () => {
    const res = await action(
      makeArgs(
        makeRequest("/api/admin/cron-jobs", "POST", {
          intent: "trigger",
          jobName: "ai-tutor-reconcile",
        }),
      ),
    );
    expect(status(res)).toBe(400);
    const b = body(res);
    expect(b.error).toMatch(/extension server/);
  });

  it("records a run for the worker to dispatch for a valid triggerable job", async () => {
    const res = await action(
      makeArgs(
        makeRequest("/api/admin/cron-jobs", "POST", {
          intent: "trigger",
          jobName: "backup-nightly",
        }),
      ),
    );
    expect(status(res)).toBe(200);
    expect(startCronRun).toHaveBeenCalledWith("backup-nightly", "ADMIN_UI");
    // The web process records the run; the cron worker's dispatchManualCronRuns
    // picks it up and dispatches it with the job's correct execution mode.
    expect(triggerCronJobAsync).not.toHaveBeenCalled();
    const b = body(res);
    expect(b.runId).toBe("run-1");
  });

  it("reuses an existing RUNNING run instead of spawning again", async () => {
    vi.mocked(startCronRun).mockResolvedValue({ runId: "run-existing", created: false });
    const res = await action(
      makeArgs(
        makeRequest("/api/admin/cron-jobs", "POST", {
          intent: "trigger",
          jobName: "backup-nightly",
        }),
      ),
    );
    expect(status(res)).toBe(200);
    expect(startCronRun).toHaveBeenCalledWith("backup-nightly", "ADMIN_UI");
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
    const res = await action(
      makeArgs(
        makeRequest("/api/admin/cron-jobs", "POST", {
          intent: "update-schedule",
          jobName: "backup-nightly",
          scheduleLabel: "Daily at 03:00 UTC",
        }),
      ),
    );
    expect(status(res)).toBe(400);
  });

  it("returns 400 when scheduleLabel is missing", async () => {
    const res = await action(
      makeArgs(
        makeRequest("/api/admin/cron-jobs", "POST", {
          intent: "update-schedule",
          jobName: "backup-nightly",
          schedule: "0 3 * * *",
        }),
      ),
    );
    expect(status(res)).toBe(400);
  });

  it("returns 400 for an invalid cron expression", async () => {
    const res = await action(
      makeArgs(
        makeRequest("/api/admin/cron-jobs", "POST", {
          intent: "update-schedule",
          jobName: "backup-nightly",
          schedule: "not-a-cron",
          scheduleLabel: "Bad",
        }),
      ),
    );
    expect(status(res)).toBe(400);
    const b = body(res);
    expect(b.error).toMatch(/Invalid cron expression/);
  });

  it("returns 400 for an unknown job", async () => {
    const res = await action(
      makeArgs(
        makeRequest("/api/admin/cron-jobs", "POST", {
          intent: "update-schedule",
          jobName: "ghost-job",
          schedule: "0 3 * * *",
          scheduleLabel: "Daily at 03:00 UTC",
        }),
      ),
    );
    expect(status(res)).toBe(400);
  });

  it("updates the schedule on valid input", async () => {
    const res = await action(
      makeArgs(
        makeRequest("/api/admin/cron-jobs", "POST", {
          intent: "update-schedule",
          jobName: "backup-nightly",
          schedule: "0 3 * * *",
          scheduleLabel: "Daily at 03:00 UTC",
        }),
      ),
    );
    expect(status(res)).toBe(200);
    expect(updateCronSchedule).toHaveBeenCalledWith(
      "backup-nightly",
      "0 3 * * *",
      "Daily at 03:00 UTC",
    );
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
    const res = await action(
      makeArgs(
        makeRequest("/api/admin/cron-jobs", "POST", {
          intent: "reset-schedule",
          jobName: "ghost-job",
        }),
      ),
    );
    expect(status(res)).toBe(400);
  });

  it("resets the override on valid input", async () => {
    const res = await action(
      makeArgs(
        makeRequest("/api/admin/cron-jobs", "POST", {
          intent: "reset-schedule",
          jobName: "backup-nightly",
        }),
      ),
    );
    expect(status(res)).toBe(200);
    expect(resetCronSchedule).toHaveBeenCalledWith("backup-nightly");
    const b = body(res);
    expect(b.jobs).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Action — intents: update-setting / reset-setting
// ---------------------------------------------------------------------------

describe("POST /api/admin/cron-jobs (action) — intent: update-setting", () => {
  beforeEach(() => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: ADMIN_USER } as any);
    vi.mocked(listCronJobStatuses).mockResolvedValue([{ name: "backup-nightly" } as any]);
  });

  function update(extra: Record<string, string | number | null>) {
    return action(
      makeArgs(
        makeRequest("/api/admin/cron-jobs", "POST", {
          intent: "update-setting",
          jobName: "purge-deleted-materials",
          ...extra,
        }),
      ),
    );
  }

  it("saves a numeric value, audits the change, and returns jobs", async () => {
    const res = await update({ key: "retainDays", value: 30 });
    expect(status(res)).toBe(200);
    expect(updateCronJobSetting).toHaveBeenCalledWith(
      "purge-deleted-materials",
      "retainDays",
      30,
      "u-admin",
    );
    expect(body(res).jobs).toBeDefined();
    await vi.waitFor(() =>
      expect(logAuditAction).toHaveBeenCalledWith(
        expect.objectContaining({
          actionCode: "CRON_SETTING_UPDATED",
          category: "SECURITY",
          entityType: "CronJobSetting",
          entityId: "purge-deleted-materials.retainDays",
          actorUserId: "u-admin",
          details: {
            jobName: "purge-deleted-materials",
            key: "retainDays",
            oldValue: 90,
            newValue: 30,
          },
        }),
      ),
    );
  });

  it("coerces a numeric string", async () => {
    await update({ key: "retainDays", value: "45" });
    expect(updateCronJobSetting).toHaveBeenCalledWith(
      "purge-deleted-materials",
      "retainDays",
      45,
      "u-admin",
    );
  });

  it("passes NaN through for a missing or null value so validation rejects it", async () => {
    await update({ key: "retainDays", value: null });
    expect(vi.mocked(updateCronJobSetting).mock.calls[0][2]).toBeNaN();
  });

  it("returns 400 when key is missing", async () => {
    const res = await update({ value: 30 });
    expect(status(res)).toBe(400);
    expect(body(res).error).toBe("key is required");
    expect(updateCronJobSetting).not.toHaveBeenCalled();
  });

  it("returns the validation message as a 400 and does not audit", async () => {
    vi.mocked(updateCronJobSetting).mockRejectedValue(
      new CronJobSettingError('"Delete after (days)" must be between 1 and 3650'),
    );
    const res = await update({ key: "retainDays", value: 0 });
    expect(status(res)).toBe(400);
    expect(body(res).error).toBe('"Delete after (days)" must be between 1 and 3650');
    expect(logAuditAction).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/cron-jobs (action) — intent: reset-setting", () => {
  beforeEach(() => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: ADMIN_USER } as any);
    vi.mocked(listCronJobStatuses).mockResolvedValue([{ name: "backup-nightly" } as any]);
  });

  it("resets the setting, audits it, and returns jobs", async () => {
    const res = await action(
      makeArgs(
        makeRequest("/api/admin/cron-jobs", "POST", {
          intent: "reset-setting",
          jobName: "purge-deleted-materials",
          key: "retainDays",
        }),
      ),
    );
    expect(status(res)).toBe(200);
    expect(resetCronJobSetting).toHaveBeenCalledWith("purge-deleted-materials", "retainDays");
    expect(body(res).jobs).toBeDefined();
    await vi.waitFor(() =>
      expect(logAuditAction).toHaveBeenCalledWith(
        expect.objectContaining({
          actionCode: "CRON_SETTING_RESET",
          details: {
            jobName: "purge-deleted-materials",
            key: "retainDays",
            oldValue: 30,
            newValue: 90,
          },
        }),
      ),
    );
  });

  it("returns 400 for an unknown setting", async () => {
    vi.mocked(resetCronJobSetting).mockRejectedValue(
      new CronJobSettingError('Unknown setting "nope" for job purge-deleted-materials'),
    );
    const res = await action(
      makeArgs(
        makeRequest("/api/admin/cron-jobs", "POST", {
          intent: "reset-setting",
          jobName: "purge-deleted-materials",
          key: "nope",
        }),
      ),
    );
    expect(status(res)).toBe(400);
    expect(body(res).error).toMatch(/Unknown setting/);
  });

  it("rejects a non-admin before touching settings", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: STUDENT_USER } as any);
    const res = await action(
      makeArgs(
        makeRequest("/api/admin/cron-jobs", "POST", {
          intent: "reset-setting",
          jobName: "purge-deleted-materials",
          key: "retainDays",
        }),
      ),
    );
    expect(status(res)).toBe(401);
    expect(resetCronJobSetting).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Action — unknown intent
// ---------------------------------------------------------------------------

describe("POST /api/admin/cron-jobs (action) — unknown intent", () => {
  it("returns 400 with an error message", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: ADMIN_USER } as any);
    const res = await action(
      makeArgs(makeRequest("/api/admin/cron-jobs", "POST", { intent: "unknown" })),
    );
    expect(status(res)).toBe(400);
    const b = body(res);
    expect(b.error).toBe("Unknown intent");
  });
});
