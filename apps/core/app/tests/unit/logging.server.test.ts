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

  it("redacts secret-bearing key names missed by the pre-#973 deny-list", async () => {
    await logAuditAction({
      actionCode: "PROVIDER_CONFIG_SAVED",
      category: "AI_CONFIG",
      entityType: "Provider",
      details: {
        jwt: "eyJ...",
        encryptionKey: "ek-1",
        databaseUrl: "postgres://u:secret@host/db",
        connectionString: "Server=x;Password=y",
        dsn: "https://key@sentry.io/1",
        passwd: "p1",
        pwd: "p2",
        passcode: "pc-1",
        passphrase: "pp-1",
        dbUrl: "postgres://u:secret@host/db",
        databaseUri: "postgres://u:secret@host/db",
        otp: "123456",
        totp: "654321",
        mfa: "enabled",
        mfaSecret: "mfa-secret",
        mfaCode: "123456",
        mfaRecoveryCode: "rec-1",
        pin: "0000",
        userPin: "1111",
        auth: "Bearer xyz",
        authToken: "tok",
        authorization: "Bearer xyz",
        bearer: "xyz",
        signature: "sig-abc",
        sessionId: "sess-123",
        canvasUrl: "https://canvas.example.com",
      },
    });

    expect(auditDb.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        details: {
          jwt: "[REDACTED]",
          encryptionKey: "[REDACTED]",
          databaseUrl: "[REDACTED]",
          connectionString: "[REDACTED]",
          dsn: "[REDACTED]",
          passwd: "[REDACTED]",
          pwd: "[REDACTED]",
          passcode: "[REDACTED]",
          passphrase: "[REDACTED]",
          dbUrl: "[REDACTED]",
          databaseUri: "[REDACTED]",
          otp: "[REDACTED]",
          totp: "[REDACTED]",
          mfa: "[REDACTED]",
          mfaSecret: "[REDACTED]",
          mfaCode: "[REDACTED]",
          mfaRecoveryCode: "[REDACTED]",
          pin: "[REDACTED]",
          userPin: "[REDACTED]",
          auth: "[REDACTED]",
          authToken: "[REDACTED]",
          authorization: "[REDACTED]",
          bearer: "[REDACTED]",
          signature: "[REDACTED]",
          sessionId: "[REDACTED]",
          canvasUrl: "https://canvas.example.com",
        },
      }),
    );
  });

  it("uses segment-exact matching for short tokens and keeps ordinary fields visible", async () => {
    // Table-driven positive / negative cases: short needles (auth/pin/otp/dsn/totp/mfa) use
    // segment match; MFA status flags stay visible via the safe-key allowlist.
    const cases: Array<{ key: string; value: string; redact: boolean }> = [
      // positive — exact segment or longer unique substring
      { key: "auth", value: "secret", redact: true },
      { key: "auth_header", value: "secret", redact: true },
      { key: "userPin", value: "0000", redact: true },
      { key: "pin_code", value: "0000", redact: true },
      { key: "mfa", value: "on", redact: true },
      { key: "mfaCode", value: "123456", redact: true },
      { key: "mfaRecoveryCode", value: "rec-1", redact: true },
      { key: "mfa_secret", value: "s", redact: true },
      { key: "otp", value: "123456", redact: true },
      { key: "userOtp", value: "123456", redact: true },
      { key: "otp_code", value: "123456", redact: true },
      { key: "totp", value: "654321", redact: true },
      { key: "userTotp", value: "654321", redact: true },
      { key: "dsn", value: "https://key@sentry.io/1", redact: true },
      { key: "sentryDsn", value: "https://key@sentry.io/1", redact: true },
      { key: "database_dsn", value: "postgres://x", redact: true },
      { key: "passcode", value: "pc", redact: true },
      { key: "passphrase", value: "pp", redact: true },
      { key: "dbUrl", value: "postgres://x", redact: true },
      { key: "databaseUri", value: "postgres://x", redact: true },
      { key: "authorization", value: "Bearer x", redact: true },
      // negative — ordinary fields that previously false-positived on short substrings
      { key: "mfaEnabled", value: "true", redact: false },
      { key: "mfaRequired", value: "false", redact: false },
      { key: "mfaEnrolled", value: "true", redact: false },
      { key: "mfaStatus", value: "active", redact: false },
      { key: "authorId", value: "a-1", redact: false },
      { key: "authorName", value: "Ada", redact: false },
      { key: "mapping", value: "course-map", redact: false },
      { key: "shippingAddress", value: "1 Main St", redact: false },
      { key: "pinningPolicy", value: "none", redact: false },
      { key: "forceReauth", value: "false", redact: false },
      { key: "authorizedUnits", value: "3", redact: false },
      // otp/dsn substring collisions (must stay visible with segment matching)
      { key: "hotPath", value: "/api/hot", redact: false },
      { key: "footprint", value: "12kb", redact: false },
      { key: "fieldsName", value: "title", redact: false },
      { key: "needsNormalization", value: "true", redact: false },
      { key: "canvasUrl", value: "https://canvas.example.com", redact: false },
      { key: "role", value: "ADMIN", redact: false },
    ];

    const details: Record<string, unknown> = {};
    const expected: Record<string, unknown> = {};
    for (const c of cases) {
      details[c.key] = c.value;
      expected[c.key] = c.redact ? "[REDACTED]" : c.value;
    }

    await logAuditAction({
      actionCode: "PROVIDER_CONFIG_SAVED",
      category: "AI_CONFIG",
      entityType: "Provider",
      details,
    });

    expect(auditDb.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ details: expected }),
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

  // #976: key-level redaction alone left secrets under innocuous keys fully readable.
  describe("value-level redaction of detail strings", () => {
    it("redacts token query params hidden under an innocuous key", async () => {
      await logAuditAction({
        actionCode: "CANVAS_CALLBACK_RECEIVED",
        category: "AI_CONFIG",
        entityType: "Integration",
        details: {
          note: "retried https://canvas.test/api/v1/courses?access_token=abc123def456&page=2",
        },
      });

      expect(auditDb.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          details: {
            note: "retried https://canvas.test/api/v1/courses?access_token=[REDACTED]&page=2",
          },
        }),
      );
    });

    it("redacts connection-string credentials under an innocuous key", async () => {
      await logSecurityEvent({
        actionCode: "DB_CONNECT_FAILED",
        entityType: "Db",
        details: { reason: "cannot reach postgres://appuser:s3cr3t@db.internal:5432/eduai" },
      });

      expect(auditDb.createSecurityLog).toHaveBeenCalledWith(
        expect.objectContaining({
          details: { reason: "cannot reach postgres://[REDACTED]@db.internal:5432/eduai" },
        }),
      );
    });

    it("redacts authorization headers nested in arrays and objects", async () => {
      await logAuditAction({
        actionCode: "OUTBOUND_REQUEST_FAILED",
        category: "AI_CONFIG",
        entityType: "Integration",
        details: {
          request: {
            headerLines: [
              "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature",
              "Cookie: session=abc123; theme=dark",
            ],
          },
        },
      });

      expect(auditDb.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          details: {
            request: {
              headerLines: ["Authorization: Bearer [REDACTED]", "Cookie: [REDACTED]"],
            },
          },
        }),
      );
    });

    it("redacts detail strings on the system error path too", async () => {
      await logSystemError({
        source: "AI",
        code: "AI_HTTP_ERROR",
        message: "request failed",
        error: new Error("503"),
        details: { endpoint: "/v1/chat?api_key=sk-live-abcdef123456" },
      });

      expect(systemDb.createSystemError).toHaveBeenCalledWith(
        expect.objectContaining({
          details: { endpoint: "/v1/chat?api_key=[REDACTED]" },
        }),
      );
    });

    it("leaves ordinary prose untouched so log readability is preserved", async () => {
      await logAuditAction({
        actionCode: "COURSE_UPDATED",
        category: "COURSE",
        entityType: "Course",
        details: {
          summary: "Bearer of bad news: Basic setup complete for CPSC 100",
          url: "https://eduai.test/courses/42?page=2",
        },
      });

      expect(auditDb.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          details: {
            summary: "Bearer of bad news: Basic setup complete for CPSC 100",
            url: "https://eduai.test/courses/42?page=2",
          },
        }),
      );
    });
  });
});
