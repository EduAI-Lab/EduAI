// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/prisma.server", () => ({
  default: {
    logRetentionPolicy: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    auditLog: {
      deleteMany: vi.fn(),
    },
    systemLog: {
      deleteMany: vi.fn(),
    },
  },
}));

const prisma = ((await import("~/lib/prisma.server")) as any).default;
const { getLogRetentionPolicy, updateLogRetentionPolicy, runConfiguredLogRetention } = await import(
  "~/lib/db.log-retention-policy.server"
);

describe("db.log-retention-policy.server", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(prisma.logRetentionPolicy.findUnique).mockResolvedValue({
      id: "default",
      auditRetentionDays: 365,
      systemRetentionDays: 90,
    } as any);

    vi.mocked(prisma.logRetentionPolicy.create).mockResolvedValue({
      id: "default",
      auditRetentionDays: 365,
      systemRetentionDays: 90,
    } as any);

    vi.mocked(prisma.logRetentionPolicy.update).mockResolvedValue({
      id: "default",
      auditRetentionDays: 180,
      systemRetentionDays: 45,
    } as any);

    vi.mocked(prisma.auditLog.deleteMany).mockResolvedValue({ count: 4 } as any);
    vi.mocked(prisma.systemLog.deleteMany).mockResolvedValue({ count: 2 } as any);
  });

  it("returns existing singleton policy when already present", async () => {
    const policy = await getLogRetentionPolicy();

    expect(prisma.logRetentionPolicy.findUnique).toHaveBeenCalledWith({
      where: { id: "default" },
    });
    expect(prisma.logRetentionPolicy.create).not.toHaveBeenCalled();
    expect(policy).toMatchObject({
      auditRetentionDays: 365,
      systemRetentionDays: 90,
    });
  });

  it("creates singleton policy when missing", async () => {
    vi.mocked(prisma.logRetentionPolicy.findUnique)
      .mockResolvedValueOnce(null as any)
      .mockResolvedValueOnce({
        id: "default",
        auditRetentionDays: 365,
        systemRetentionDays: 90,
      } as any);

    const policy = await getLogRetentionPolicy();

    expect(prisma.logRetentionPolicy.create).toHaveBeenCalledWith({
      data: {
        id: "default",
        auditRetentionDays: 365,
        systemRetentionDays: 90,
      },
    });
    expect(policy).toMatchObject({
      auditRetentionDays: 365,
      systemRetentionDays: 90,
    });
  });

  it("returns raced singleton policy after P2002 create collision", async () => {
    vi.mocked(prisma.logRetentionPolicy.findUnique).mockReset();
    vi.mocked(prisma.logRetentionPolicy.create).mockReset();

    vi.mocked(prisma.logRetentionPolicy.findUnique)
      .mockResolvedValueOnce(null as any)
      .mockResolvedValueOnce({
        id: "default",
        auditRetentionDays: 365,
        systemRetentionDays: 90,
      } as any);

    vi.mocked(prisma.logRetentionPolicy.create).mockRejectedValueOnce({
      code: "P2002",
    } as any);

    const policy = await getLogRetentionPolicy();

    expect(prisma.logRetentionPolicy.create).toHaveBeenCalledTimes(1);
    expect(prisma.logRetentionPolicy.findUnique).toHaveBeenCalledTimes(2);
    expect(policy).toMatchObject({
      auditRetentionDays: 365,
      systemRetentionDays: 90,
    });
  });

  it("updates retention windows with normalized integer values", async () => {
    await updateLogRetentionPolicy({
      auditRetentionDays: 180,
      systemRetentionDays: 45,
    });

    // Persisting sanitized day counts protects cleanup jobs from invalid form payloads.
    expect(prisma.logRetentionPolicy.update).toHaveBeenCalledWith({
      where: { id: "default" },
      data: {
        auditRetentionDays: 180,
        systemRetentionDays: 45,
      },
    });
  });

  it("runs configured retention for both audit and system logs", async () => {
    const result = await runConfiguredLogRetention({
      auditRetentionDays: 30,
      systemRetentionDays: 7,
    });

    // Running both cleanups together keeps observability storage policy consistent across log classes.
    expect(prisma.auditLog.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ createdAt: expect.any(Object) }) }),
    );
    expect(prisma.systemLog.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ createdAt: expect.any(Object) }) }),
    );
    expect(result).toMatchObject({
      deletedAuditRows: 4,
      deletedSystemRows: 2,
    });
  });
});
