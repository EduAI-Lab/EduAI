// @vitest-environment node
// #1213 — admin.cron-jobs.tsx loader authz: unauthenticated → /auth/login,
// non-admin → /dashboard, ADMIN → loads job statuses.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/db.cron-jobs.server", () => ({
  listCronJobStatuses: vi.fn().mockResolvedValue([]),
}));

import { loader } from "~/routes/admin.cron-jobs";
import { auth } from "~/lib/auth/server";
import { listCronJobStatuses } from "~/lib/db.cron-jobs.server";

function makeArgs() {
  return {
    request: new Request("http://localhost/admin/cron-jobs"),
    params: {},
    context: {} as never,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("admin.cron-jobs loader", () => {
  it("redirects anonymous callers to /auth/login", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    const res = (await loader(makeArgs())) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/auth/login");
    expect(listCronJobStatuses).not.toHaveBeenCalled();
  });

  it("redirects a non-admin to /dashboard", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "INSTRUCTOR" },
    } as never);
    const res = (await loader(makeArgs())) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/dashboard");
    expect(listCronJobStatuses).not.toHaveBeenCalled();
  });

  it("returns the session user and job statuses for an ADMIN", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "admin-1", role: "ADMIN" },
    } as never);
    const jobs = [{ jobName: "notify-api-key-expiry", schedule: "0 * * * *" }];
    vi.mocked(listCronJobStatuses).mockResolvedValue(jobs as never);

    const result = await loader(makeArgs());
    expect(result).toEqual({ user: { id: "admin-1", role: "ADMIN" }, jobs });
  });
});
