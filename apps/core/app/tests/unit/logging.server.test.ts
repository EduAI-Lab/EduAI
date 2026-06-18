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

  it("redacts restricted audit fields while keeping accountability IDs and full emails", async () => {
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
          // Emails are intentionally logged in full (temporary product decision).
          email: "student@example.com",
          phone: "[REDACTED]",
          password: "[REDACTED]",
        },
      }),
    );
  });

  it("forces security category and logs full emails while redacting other restricted fields", async () => {
    await logSecurityEvent({
      actionCode: "LOGIN_FAILED",
      entityType: "Auth",
      details: { email: "user@example.com", reason: "invalid" },
    });

    expect(auditDb.createSecurityLog).toHaveBeenCalledWith(
      expect.objectContaining({
        details: { email: "user@example.com", reason: "invalid" },
      }),
    );
  });

  it("redacts credential-shaped keys missed by the original deny-list", async () => {
    await logAuditAction({
      actionCode: "CANVAS_INTEGRATION_SAVED",
      category: "AI_CONFIG",
      entityType: "Course",
      details: {
        apiKey: "ak-123",
        secret: "shh",
        clientSecret: "cs-456",
        privateKey: "pk-789",
        accessKey: "AKIA",
        credential: "cred",
        canvasUrl: "https://canvas.example.com",
      },
    });

    expect(auditDb.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        details: {
          apiKey: "[REDACTED]",
          secret: "[REDACTED]",
          clientSecret: "[REDACTED]",
          privateKey: "[REDACTED]",
          accessKey: "[REDACTED]",
          credential: "[REDACTED]",
          canvasUrl: "https://canvas.example.com",
        },
      }),
    );
  });

  it("does not overflow on circular details and still redacts the rest", async () => {
    const details: Record<string, unknown> = { password: "nope", note: "ok" };
    details.self = details;

    await logAuditAction({
      actionCode: "USER_UPDATED",
      category: "USER",
      entityType: "User",
      details,
    });

    expect(auditDb.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        details: { password: "[REDACTED]", note: "ok", self: "[CIRCULAR]" },
      }),
    );
  });

  it("sanitizes Map and Set values instead of dropping them to empty objects", async () => {
    await logAuditAction({
      actionCode: "USER_UPDATED",
      category: "USER",
      entityType: "User",
      details: {
        asMap: new Map<string, unknown>([
          ["token", "secret-token"],
          ["role", "ADMIN"],
        ]),
        asSet: new Set(["a", "b"]),
      },
    });

    expect(auditDb.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        details: {
          asMap: { token: "[REDACTED]", role: "ADMIN" },
          asSet: ["a", "b"],
        },
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
