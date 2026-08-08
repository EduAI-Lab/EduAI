// @vitest-environment node
// #1213 — admin.logs.tsx: highest-value admin surface (audit/security/system
// log viewer + retention policy). Covers loader authz, tab dispatch, filter
// allow-listing/date parsing, and the action's retention-policy intents.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/db.auditlog.server", () => ({
  listAuditLogs: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
  listSecurityLogs: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
  runAuditLogRetention: vi.fn().mockResolvedValue(0),
}));

vi.mock("~/lib/db.systemlog.server", () => ({
  listSystemLogs: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
  runSystemLogRetention: vi.fn().mockResolvedValue(0),
}));

vi.mock("~/lib/db.log-retention-policy.server", () => ({
  getLogRetentionPolicy: vi.fn().mockResolvedValue({ auditRetentionDays: 90, systemRetentionDays: 30 }),
  runConfiguredLogRetentionIfDue: vi.fn().mockResolvedValue(undefined),
  updateLogRetentionPolicy: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/lib/db.ai-interaction-stats.server", () => ({
  getInteractionCountsByServer: vi.fn().mockResolvedValue([]),
  getInteractionCountsByModel: vi.fn().mockResolvedValue([]),
}));

import { loader, action } from "~/routes/admin.logs";
import { auth } from "~/lib/auth/server";
import { listAuditLogs, listSecurityLogs, runAuditLogRetention } from "~/lib/db.auditlog.server";
import { listSystemLogs, runSystemLogRetention } from "~/lib/db.systemlog.server";
import { getLogRetentionPolicy, updateLogRetentionPolicy } from "~/lib/db.log-retention-policy.server";
import {
  getInteractionCountsByServer,
  getInteractionCountsByModel,
} from "~/lib/db.ai-interaction-stats.server";

function makeLoaderArgs(path: string) {
  return {
    request: new Request(`http://localhost${path}`),
    params: {},
    context: {} as never,
  } as never;
}

/** requireAdminUser() throws its redirect rather than returning it. */
async function expectThrownRedirect(promise: Promise<unknown>, location: string) {
  try {
    await promise;
    expect.unreachable("expected a thrown redirect Response");
  } catch (res) {
    expect((res as Response).status).toBe(302);
    expect((res as Response).headers.get("Location")).toBe(location);
  }
}

function makeActionArgs(form: Record<string, string>) {
  const body = new URLSearchParams(form);
  return {
    request: new Request("http://localhost/admin/logs", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    }),
    params: {},
    context: {} as never,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listAuditLogs).mockResolvedValue({ rows: [], total: 0 } as never);
  vi.mocked(listSecurityLogs).mockResolvedValue({ rows: [], total: 0 } as never);
  vi.mocked(listSystemLogs).mockResolvedValue({ rows: [], total: 0 } as never);
  vi.mocked(getLogRetentionPolicy).mockResolvedValue({
    auditRetentionDays: 90,
    systemRetentionDays: 30,
  } as never);
  vi.mocked(auth.api.getSession).mockResolvedValue({
    user: { id: "admin-1", role: "ADMIN" },
  } as never);
  vi.mocked(getInteractionCountsByServer).mockResolvedValue([] as never);
  vi.mocked(getInteractionCountsByModel).mockResolvedValue([] as never);
});

describe("admin.logs loader authz", () => {
  it("redirects anonymous callers to /auth/login", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    await expectThrownRedirect(loader(makeLoaderArgs("/admin/logs")), "/auth/login");
  });

  it("redirects a non-admin to /dashboard", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "UNIT_ADMIN" },
    } as never);
    await expectThrownRedirect(loader(makeLoaderArgs("/admin/logs")), "/dashboard");
  });
});

describe("admin.logs loader tab dispatch", () => {
  it("defaults to the audit tab and queries listAuditLogs", async () => {
    const result = (await loader(makeLoaderArgs("/admin/logs"))) as { tab: string };
    expect(result.tab).toBe("audit");
    expect(listAuditLogs).toHaveBeenCalled();
    expect(listSecurityLogs).not.toHaveBeenCalled();
  });

  it("queries listSecurityLogs for tab=security, allow-listing outcome", async () => {
    const result = (await loader(
      makeLoaderArgs("/admin/logs?tab=security&outcome=DENIED&outcome2=bogus"),
    )) as { tab: string };
    expect(result.tab).toBe("security");
    expect(listSecurityLogs).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "DENIED" }),
    );
  });

  it("queries listSystemLogs for tab=system, dropping an unknown level", async () => {
    const result = (await loader(
      makeLoaderArgs("/admin/logs?tab=system&level=NOT_A_LEVEL"),
    )) as { tab: string };
    expect(result.tab).toBe("system");
    expect(listSystemLogs).toHaveBeenCalledWith(
      expect.objectContaining({ level: undefined }),
    );
  });

  it("drops an unknown audit category filter instead of passing it through", async () => {
    await loader(makeLoaderArgs("/admin/logs?category=NOT_REAL"));
    expect(listAuditLogs).toHaveBeenCalledWith(
      expect.objectContaining({ category: undefined }),
    );
  });

  it("parses valid YYYY-MM-DD date filters into UTC boundaries", async () => {
    await loader(makeLoaderArgs("/admin/logs?dateFrom=2026-01-15&dateTo=2026-01-20"));
    const call = vi.mocked(listAuditLogs).mock.calls[0][0] as { dateFrom: Date; dateTo: Date };
    expect(call.dateFrom.toISOString()).toBe("2026-01-15T00:00:00.000Z");
    expect(call.dateTo.toISOString()).toBe("2026-01-20T23:59:59.999Z");
  });

  it("drops an invalid calendar date (e.g. Feb 30) instead of rolling it over", async () => {
    await loader(makeLoaderArgs("/admin/logs?dateFrom=2026-02-30"));
    const call = vi.mocked(listAuditLogs).mock.calls[0][0] as { dateFrom: Date | undefined };
    expect(call.dateFrom).toBeUndefined();
  });

  it("computes hasMore from page * pageSize vs total", async () => {
    vi.mocked(listAuditLogs).mockResolvedValue({ rows: [], total: 100 } as never);
    const result = (await loader(
      makeLoaderArgs("/admin/logs?page=1&pageSize=25"),
    )) as { hasMore: boolean };
    expect(result.hasMore).toBe(true);
  });

  it("serializes Date createdAt fields to ISO strings for the client", async () => {
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    vi.mocked(listAuditLogs).mockResolvedValue({
      rows: [{ id: "log-1", createdAt }],
      total: 1,
    } as never);
    const result = (await loader(makeLoaderArgs("/admin/logs"))) as {
      rows: { createdAt: string }[];
    };
    expect(result.rows[0].createdAt).toBe(createdAt.toISOString());
  });
});

describe("admin.logs loader — servers tab date defaulting", () => {
  it("defaults to a trailing-30-day window on first visit (no date params at all)", async () => {
    const result = (await loader(makeLoaderArgs("/admin/logs?tab=servers"))) as {
      query: { dateFrom?: string; dateTo?: string; datePreset?: string };
    };

    expect(result.query.datePreset).toBe("30");
    expect(result.query.dateFrom).toBeDefined();
    expect(result.query.dateTo).toBeDefined();

    const call = vi.mocked(getInteractionCountsByServer).mock.calls[0]?.[0] as {
      dateFrom?: Date;
      dateTo?: Date;
    };
    expect(call.dateFrom).toBeInstanceOf(Date);
    expect(call.dateTo).toBeInstanceOf(Date);
    const spanMs = call.dateTo!.getTime() - call.dateFrom!.getTime();
    // ~30 days, allowing slack for test execution time.
    expect(spanMs).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
    expect(spanMs).toBeLessThan(31 * 24 * 60 * 60 * 1000);
  });

  it("resolves a numeric datePreset to a fresh N-day window", async () => {
    await loader(makeLoaderArgs("/admin/logs?tab=servers&datePreset=7"));

    const call = vi.mocked(getInteractionCountsByServer).mock.calls[0]?.[0] as {
      dateFrom?: Date;
      dateTo?: Date;
    };
    const spanMs = call.dateTo!.getTime() - call.dateFrom!.getTime();
    expect(spanMs).toBeGreaterThan(6 * 24 * 60 * 60 * 1000);
    expect(spanMs).toBeLessThan(8 * 24 * 60 * 60 * 1000);
  });

  it('treats datePreset="" as an explicit All time selection (no date bound)', async () => {
    const result = (await loader(makeLoaderArgs("/admin/logs?tab=servers&datePreset="))) as {
      query: { dateFrom?: string; dateTo?: string; datePreset?: string };
    };

    expect(result.query.datePreset).toBe("");
    expect(result.query.dateFrom).toBeUndefined();
    expect(result.query.dateTo).toBeUndefined();

    const call = vi.mocked(getInteractionCountsByServer).mock.calls[0]?.[0] as {
      dateFrom?: Date;
      dateTo?: Date;
    };
    expect(call.dateFrom).toBeUndefined();
    expect(call.dateTo).toBeUndefined();
  });

  it("an explicit custom dateFrom/dateTo pair wins over any default", async () => {
    const result = (await loader(
      makeLoaderArgs("/admin/logs?tab=servers&dateFrom=2026-01-01&dateTo=2026-01-05"),
    )) as { query: { dateFrom?: string; dateTo?: string; datePreset?: string } };

    expect(result.query.dateFrom).toBe("2026-01-01");
    expect(result.query.dateTo).toBe("2026-01-05");

    const call = vi.mocked(getInteractionCountsByServer).mock.calls[0]?.[0] as {
      dateFrom?: Date;
      dateTo?: Date;
    };
    expect(call.dateFrom?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(call.dateTo?.toISOString()).toBe("2026-01-05T23:59:59.999Z");
  });

  it("does not apply the servers-tab date default to other tabs", async () => {
    await loader(makeLoaderArgs("/admin/logs?tab=audit"));
    const call = vi.mocked(listAuditLogs).mock.calls[0][0] as {
      dateFrom?: Date;
      dateTo?: Date;
    };
    expect(call.dateFrom).toBeUndefined();
    expect(call.dateTo).toBeUndefined();
  });
});

describe("admin.logs action", () => {
  it("redirects anonymous callers to /auth/login", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    await expectThrownRedirect(
      action(makeActionArgs({ intent: "updateLogRetentionPolicy" })),
      "/auth/login",
    );
  });

  it("updates the retention policy and returns a success message", async () => {
    const result = await action(
      makeActionArgs({
        intent: "updateLogRetentionPolicy",
        auditRetentionDays: "60",
        systemRetentionDays: "14",
      }),
    );
    expect(updateLogRetentionPolicy).toHaveBeenCalledWith({
      auditRetentionDays: 60,
      systemRetentionDays: 14,
    });
    expect(result).toEqual({
      success: expect.stringContaining("Audit: 60 days, System: 14 days"),
    });
  });

  it("cleans up audit logs now and reports the removed count", async () => {
    vi.mocked(runAuditLogRetention).mockResolvedValue(5);
    const result = await action(makeActionArgs({ intent: "cleanupAuditLogsNow" }));
    expect(runAuditLogRetention).toHaveBeenCalledWith(90);
    expect(result).toEqual({ success: expect.stringContaining("Deleted 5 audit log records") });
  });

  it("cleans up system logs now and reports the removed count", async () => {
    vi.mocked(runSystemLogRetention).mockResolvedValue(1);
    const result = await action(makeActionArgs({ intent: "cleanupSystemLogsNow" }));
    expect(runSystemLogRetention).toHaveBeenCalledWith(30);
    expect(result).toEqual({ success: expect.stringContaining("Deleted 1 system log record") });
  });

  it("returns an error for an unknown intent", async () => {
    const result = await action(makeActionArgs({ intent: "bogus" }));
    expect(result).toEqual({ error: "Unknown action." });
  });
});
