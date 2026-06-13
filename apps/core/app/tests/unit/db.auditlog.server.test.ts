// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/prisma.server", () => ({
  default: {
    $transaction: vi.fn(async (queries: Promise<unknown>[]) => Promise.all(queries)),
    auditLog: {
      create: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

const prisma = ((await import("~/lib/prisma.server")) as any).default;
const {
  createAuditLog,
  createSecurityLog,
  deleteAuditLogsOlderThan,
  getAuditLogById,
  listAuditLogs,
  listSecurityLogs,
  runAuditLogRetention,
} = await import("~/lib/db.auditlog.server");

describe("db.auditlog.server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.auditLog.create).mockResolvedValue({ id: "audit-1" } as any);
    vi.mocked(prisma.auditLog.count).mockResolvedValue(0 as any);
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([] as any);
    vi.mocked(prisma.auditLog.findUnique).mockResolvedValue(null as any);
    vi.mocked(prisma.auditLog.deleteMany).mockResolvedValue({ count: 0 } as any);
  });

  it("creates audit log rows with stable defaults", async () => {
    await createAuditLog({
      actionCode: "USER_CREATED",
      category: "USER",
      entityType: "User",
      entityId: "user-1",
    });

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actionCode: "USER_CREATED",
        category: "USER",
        outcome: "SUCCESS",
        actorType: "USER",
        entityType: "User",
        entityId: "user-1",
      }),
    });
  });

  it("forces SECURITY category for security events", async () => {
    await createSecurityLog({
      actionCode: "LOGIN_SUCCESS",
      entityType: "Auth",
      entityLabel: "login",
    });

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        category: "SECURITY",
        actionCode: "LOGIN_SUCCESS",
      }),
    });
  });

  it("lists audit rows excluding security by default", async () => {
    vi.mocked(prisma.auditLog.count).mockResolvedValue(3 as any);
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([{ id: "audit-2" }] as any);

    const result = await listAuditLogs({ page: 2, pageSize: 10 });

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 10,
        take: 10,
        where: expect.objectContaining({ category: { not: "SECURITY" } }),
      }),
    );
    expect(result).toEqual({ rows: [{ id: "audit-2" }], total: 3 });
  });

  it("lists security rows scoped to SECURITY category", async () => {
    await listSecurityLogs({ page: 1, pageSize: 25, actionCode: "LOGIN" });

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ category: "SECURITY" }),
      }),
    );
  });

  it("loads one audit row by id", async () => {
    vi.mocked(prisma.auditLog.findUnique).mockResolvedValue({ id: "audit-3" } as any);

    const row = await getAuditLogById("audit-3");

    expect(prisma.auditLog.findUnique).toHaveBeenCalledWith({
      where: { id: "audit-3" },
      include: { user: { select: { id: true, name: true, role: true } } },
    });
    expect(row).toEqual({ id: "audit-3" });
  });

  it("deletes old audit rows and supports retention helper", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-19T12:00:00.000Z"));
    vi.mocked(prisma.auditLog.deleteMany).mockResolvedValue({ count: 5 } as any);

    const explicitCutoff = new Date("2025-01-01T00:00:00.000Z");
    const explicit = await deleteAuditLogsOlderThan(explicitCutoff);
    const retention = await runAuditLogRetention(365);

    // Explicit and policy-based cleanup must both use timestamp cutoffs so recent rows remain queryable.
    expect(prisma.auditLog.deleteMany).toHaveBeenNthCalledWith(1, {
      where: { createdAt: { lt: explicitCutoff } },
    });
    expect(prisma.auditLog.deleteMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ where: expect.objectContaining({ createdAt: expect.any(Object) }) }),
    );
    expect(explicit).toBe(5);
    expect(retention).toBe(5);

    vi.useRealTimers();
  });
});
