// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db.auditlog.server", () => ({
  createAuditLog: vi.fn(),
  createSecurityLog: vi.fn(),
}));

vi.mock("~/lib/db.systemlog.server", () => ({
  createSystemError: vi.fn(),
}));

const auditDb = await import("~/lib/db.auditlog.server");
const systemDb = await import("~/lib/db.systemlog.server");
const { logAuditAction, logSecurityEvent, logSystemError } = await import("~/lib/logging.server");

describe("logging.server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auditDb.createAuditLog).mockResolvedValue(undefined as any);
    vi.mocked(auditDb.createSecurityLog).mockResolvedValue(undefined as any);
    vi.mocked(systemDb.createSystemError).mockResolvedValue(undefined as any);
  });

  it("redacts restricted audit fields while keeping accountability IDs", async () => {
    await logAuditAction({
      actionCode: "STUDENT_PROFILE_UPDATED",
      category: "USER",
      entityType: "User",
      details: {
        studentId: "10001",
        ubcEmployeeId: "1234567",
        email: "student@example.com",
        phone: "250-555-9999",
        password: "should-not-log",
      },
    });

    expect(auditDb.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        details: {
          studentId: "10001",
          ubcEmployeeId: "1234567",
          email: "[REDACTED]",
          phone: "[REDACTED]",
          password: "[REDACTED]",
        },
      }),
    );
  });

  it("forces security category and redacts security details", async () => {
    await logSecurityEvent({
      actionCode: "LOGIN_FAILED",
      entityType: "Auth",
      details: { email: "user@example.com", reason: "invalid" },
    });

    expect(auditDb.createSecurityLog).toHaveBeenCalledWith(
      expect.objectContaining({
        details: { email: "[REDACTED]", reason: "invalid" },
      }),
    );
  });

  it("routes system error writes through centralized helper", async () => {
    await logSystemError({
      source: "AI",
      code: "AI_HTTP_ERROR",
      message: "request failed",
      error: new Error("503"),
      details: { endpoint: "/courses", token: "secret-token" },
    });

    expect(systemDb.createSystemError).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "AI",
        code: "AI_HTTP_ERROR",
        details: { endpoint: "/courses", token: "[REDACTED]" },
      }),
    );
  });
});
