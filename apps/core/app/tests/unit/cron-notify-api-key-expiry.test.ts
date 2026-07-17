// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = vi.hoisted(() => ({
  userProviderSettings: { findMany: vi.fn() },
}));
vi.mock("~/lib/prisma.server", () => ({ default: prismaMock }));

const sendEmailMock = vi.hoisted(() => vi.fn());
vi.mock("~/lib/email/mailer.server", () => ({ sendEmail: sendEmailMock }));

vi.mock("~/lib/logging.server", () => ({
  fireAndForget: vi.fn(),
  logSystemError: vi.fn(),
}));

import { notifyExpiringApiKeys } from "~/lib/cron-notify-api-key-expiry.server";

const makeRow = (overrides: Partial<ReturnType<typeof defaultRow>> = {}) => ({
  ...defaultRow(),
  ...overrides,
});

function defaultRow() {
  return {
    id: "s1",
    userId: "u1",
    apiKeyExpiresAt: new Date("2026-07-13T00:00:00Z"),
    user: { email: "alice@test.local", name: "Alice" },
    provider: { displayName: "OpenAI" },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("notifyExpiringApiKeys", () => {
  it("returns { notified: 0 } when no keys are expiring in 7 days", async () => {
    prismaMock.userProviderSettings.findMany.mockResolvedValue([]);
    const result = await notifyExpiringApiKeys();
    expect(result).toEqual({ notified: 0 });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("queries for enabled, non-null keys with expiry in the 7-day window", async () => {
    prismaMock.userProviderSettings.findMany.mockResolvedValue([]);
    await notifyExpiringApiKeys();

    const [where] = prismaMock.userProviderSettings.findMany.mock.calls[0];
    expect(where.where.apiKey).toEqual({ not: null });
    expect(where.where.isEnabled).toBe(true);
    expect(where.where.apiKeyExpiresAt).toMatchObject({ gte: expect.any(Date), lt: expect.any(Date) });
  });

  it("the query window spans exactly one calendar day", async () => {
    prismaMock.userProviderSettings.findMany.mockResolvedValue([]);
    await notifyExpiringApiKeys();

    const { apiKeyExpiresAt } = prismaMock.userProviderSettings.findMany.mock.calls[0][0].where;
    const diffMs = apiKeyExpiresAt.lt.getTime() - apiKeyExpiresAt.gte.getTime();
    expect(diffMs).toBe(24 * 60 * 60 * 1000);
  });

  it("sends one email per expiring key", async () => {
    sendEmailMock.mockResolvedValue({ delivered: true });
    prismaMock.userProviderSettings.findMany.mockResolvedValue([
      makeRow({ id: "s1", userId: "u1", user: { email: "alice@test.local", name: "Alice" } }),
      makeRow({ id: "s2", userId: "u2", user: { email: "bob@test.local", name: "Bob" }, provider: { displayName: "Google AI" } }),
    ]);

    const result = await notifyExpiringApiKeys();

    expect(result).toEqual({ notified: 2 });
    expect(sendEmailMock).toHaveBeenCalledTimes(2);
  });

  it("passes correct recipient address to sendEmail", async () => {
    sendEmailMock.mockResolvedValue({ delivered: true });
    prismaMock.userProviderSettings.findMany.mockResolvedValue([makeRow()]);

    await notifyExpiringApiKeys();

    const [{ to }] = sendEmailMock.mock.calls[0];
    expect(to).toBe("alice@test.local");
  });

  it("counts only successfully sent emails when one send fails", async () => {
    sendEmailMock
      .mockResolvedValueOnce({ delivered: true })
      .mockRejectedValueOnce(new Error("SMTP down"));
    prismaMock.userProviderSettings.findMany.mockResolvedValue([
      makeRow({ id: "s1", userId: "u1" }),
      makeRow({ id: "s2", userId: "u2" }),
    ]);

    const result = await notifyExpiringApiKeys();

    expect(result).toEqual({ notified: 1 });
  });

  it("logs a system error when a send fails and continues processing", async () => {
    const { fireAndForget, logSystemError } = await import("~/lib/logging.server");
    sendEmailMock.mockRejectedValue(new Error("SMTP down"));
    prismaMock.userProviderSettings.findMany.mockResolvedValue([makeRow()]);

    await notifyExpiringApiKeys();

    expect(fireAndForget).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logSystemError)).toHaveBeenCalledWith(
      expect.objectContaining({ code: "API_KEY_EXPIRY_EMAIL_FAILED" }),
    );
  });
});
