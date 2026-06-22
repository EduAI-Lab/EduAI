import { beforeEach, describe, it, expect, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  apikey: {
    findMany: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("~/lib/prisma.server", () => ({
  default: prismaMock,
}));

vi.mock("~/lib/email/mailer.server", () => ({
  sendEmail: vi.fn().mockResolvedValue({ delivered: true }),
}));

import { sendApiKeyExpirationReminders } from "~/lib/api-keys/reminders.server";
import { sendEmail } from "~/lib/email/mailer.server";

describe("sendApiKeyExpirationReminders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends a reminder and records metadata for matching keys", async () => {
    prismaMock.apikey.findMany.mockResolvedValue([
      {
        id: "key-1",
        name: "Prod key",
        enabled: true,
        expiresAt: new Date("2026-06-29T12:00:00.000Z"),
        metadata: null,
        user: { email: "admin@example.com", name: "Admin" },
      },
    ]);
    prismaMock.apikey.update.mockResolvedValue({});

    const result = await sendApiKeyExpirationReminders({
      now: new Date("2026-06-22T12:00:00.000Z"),
      reminderDays: [7],
    });

    expect(result.sent).toBe(1);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(prismaMock.apikey.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "key-1" },
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            expirationReminders: expect.objectContaining({ "7": expect.any(String) }),
          }),
        }),
      }),
    );
  });

  it("skips keys that already received the reminder window", async () => {
    prismaMock.apikey.findMany.mockResolvedValue([
      {
        id: "key-2",
        name: "Prod key",
        enabled: true,
        expiresAt: new Date("2026-06-29T12:00:00.000Z"),
        metadata: { expirationReminders: { "7": "2026-06-15T00:00:00.000Z" } },
        user: { email: "admin@example.com", name: "Admin" },
      },
    ]);

    const result = await sendApiKeyExpirationReminders({
      now: new Date("2026-06-22T12:00:00.000Z"),
      reminderDays: [7],
    });

    expect(result.sent).toBe(0);
    expect(result.skipped).toBe(1);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
