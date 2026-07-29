// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/prisma.server", () => ({
  default: {
    $transaction: vi.fn(async (queries: Promise<unknown>[]) => Promise.all(queries)),
    systemLog: {
      create: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

const prisma = ((await import("~/lib/prisma.server")) as any).default;
const {
  createSystemError,
  createSystemLog,
  deleteSystemLogsOlderThan,
  listSystemLogs,
  runSystemLogRetention,
} = await import("~/lib/db.systemlog.server");

describe("db.systemlog.server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.systemLog.create).mockResolvedValue({ id: "sys-1" } as any);
    vi.mocked(prisma.systemLog.count).mockResolvedValue(0 as any);
    vi.mocked(prisma.systemLog.findMany).mockResolvedValue([] as any);
    vi.mocked(prisma.systemLog.deleteMany).mockResolvedValue({ count: 0 } as any);
  });

  it("creates system logs for normal write path", async () => {
    await createSystemLog({
      level: "INFO",
      source: "AI",
      code: "EMBED_STARTED",
      message: "sync started",
    });

    expect(prisma.systemLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        level: "INFO",
        source: "AI",
        code: "EMBED_STARTED",
        message: "sync started",
      }),
    });
  });

  it("falls back to console.error when writes fail", async () => {
    vi.mocked(prisma.systemLog.create).mockRejectedValue(new Error("db down"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      createSystemLog({
        level: "ERROR",
        source: "DB",
        code: "DB_WRITE_FAILED",
        message: "write failed",
      }),
    ).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("derives system error metadata from Error objects", async () => {
    const err = new Error("mail failure");

    await createSystemError({
      source: "MAIL",
      code: "MAIL_SEND_FAILED",
      message: "failed to send",
      error: err,
    });

    expect(prisma.systemLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        level: "ERROR",
        errorName: "Error",
        stack: expect.any(String),
      }),
    });
  });

  // #976: message/stack previously had no sanitize pass at all.
  describe("secret redaction", () => {
    it("redacts secrets in message and stack on the direct write path", async () => {
      await createSystemLog({
        level: "ERROR",
        source: "API",
        code: "FETCH_FAILED",
        message: "GET https://canvas.test/api/v1/self?access_token=abc123def456 failed",
        stack: "Error: boom\n    at fetch (postgres://appuser:s3cr3t@db.internal:5432/eduai)",
      });

      expect(prisma.systemLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          message: "GET https://canvas.test/api/v1/self?access_token=[REDACTED] failed",
          stack: "Error: boom\n    at fetch (postgres://[REDACTED]@db.internal:5432/eduai)",
        }),
      });
    });

    it("redacts the stack derived from an Error object", async () => {
      const err = new Error("upstream https://ai.test/v1?api_key=sk-live-abcdef123456 rejected");

      await createSystemError({
        source: "AI",
        code: "AI_HTTP_ERROR",
        message: err.message,
        error: err,
      });

      const data = vi.mocked(prisma.systemLog.create).mock.calls[0]?.[0].data;
      expect(data.message).toBe("upstream https://ai.test/v1?api_key=[REDACTED] rejected");
      // `stack` embeds the message, so the derived copy must be scrubbed as well.
      expect(data.stack).toContain("api_key=[REDACTED]");
      expect(data.stack).not.toContain("sk-live-abcdef123456");
    });

    it("redacts a string error, which normalizeErrorMetadata routes into stack", async () => {
      await createSystemError({
        source: "CANVAS",
        code: "CANVAS_SYNC_FAILED",
        message: "sync failed",
        error: "boom at https://canvas.test/api?access_token=abc123def456",
      });

      expect(prisma.systemLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          stack: "boom at https://canvas.test/api?access_token=[REDACTED]",
        }),
      });
    });

    it("re-sanitizes details so direct callers are covered too", async () => {
      await createSystemLog({
        level: "WARN",
        source: "ROUTE",
        code: "SLOW_REQUEST",
        message: "slow",
        details: { note: "hit /cb?refresh_token=abc123def456", apiKey: "sk-live-1" },
      });

      expect(prisma.systemLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          details: { note: "hit /cb?refresh_token=[REDACTED]", apiKey: "[REDACTED]" },
        }),
      });
    });

    it("redacts message and driver credentials in the console fallback", async () => {
      // A DB outage is exactly when the driver error carries the connection string.
      vi.mocked(prisma.systemLog.create).mockRejectedValue(
        new Error("Can't reach database at postgres://appuser:s3cr3t@db.internal:5432/eduai"),
      );
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await createSystemLog({
        level: "ERROR",
        source: "DB",
        code: "DB_WRITE_FAILED",
        message: "write failed for /cb?access_token=abc123def456",
      });

      const payload = JSON.stringify(consoleSpy.mock.calls[0]?.[1]);
      expect(payload).toContain("access_token=[REDACTED]");
      expect(payload).not.toContain("abc123def456");
      expect(payload).not.toContain("s3cr3t");

      consoleSpy.mockRestore();
    });
  });

  it("lists system rows with pagination", async () => {
    vi.mocked(prisma.systemLog.count).mockResolvedValue(2 as any);
    vi.mocked(prisma.systemLog.findMany).mockResolvedValue([{ id: "sys-2" }] as any);

    const result = await listSystemLogs({ page: 2, pageSize: 5, level: "WARN" });

    expect(prisma.systemLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 5,
        take: 5,
        where: expect.objectContaining({ level: "WARN" }),
      }),
    );
    expect(result).toEqual({ rows: [{ id: "sys-2" }], total: 2 });
  });

  it("deletes old rows and supports retention helper", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-19T12:00:00.000Z"));
    vi.mocked(prisma.systemLog.deleteMany).mockResolvedValue({ count: 4 } as any);

    const explicitCutoff = new Date("2026-01-01T00:00:00.000Z");
    const explicit = await deleteSystemLogsOlderThan(explicitCutoff);
    const retention = await runSystemLogRetention(90);

    expect(prisma.systemLog.deleteMany).toHaveBeenNthCalledWith(1, {
      where: { createdAt: { lt: explicitCutoff } },
    });
    expect(prisma.systemLog.deleteMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ where: expect.objectContaining({ createdAt: expect.any(Object) }) }),
    );
    expect(explicit).toBe(4);
    expect(retention).toBe(4);

    vi.useRealTimers();
  });
});
