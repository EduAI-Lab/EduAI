// @vitest-environment node

vi.unmock("~/lib/chat-daily-limits.server");

import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimitsForTests } from "~/lib/auth/rate-limit.server";
import { CHAT_DAILY_WINDOW_MS, defaultChatDailyLimitSettings } from "~/lib/chat-daily-limits";
import {
  ChatDailyLimitSettingsUnavailableError,
  consumeLocalChatDailyCap,
  getChatDailyLimitSettings,
  invalidateChatDailyLimitSettingsCache,
  refundLocalChatDailyCap,
  setChatDailyLimitSettings,
} from "~/lib/chat-daily-limits.server";

const prismaMock = vi.hoisted(() => ({
  systemConfig: { findMany: vi.fn(), upsert: vi.fn() },
}));

vi.mock("~/lib/prisma.server", () => ({ default: prismaMock }));

describe("chat-daily-limits.server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitsForTests();
    invalidateChatDailyLimitSettingsCache();
    prismaMock.systemConfig.findMany.mockResolvedValue([]);
    prismaMock.systemConfig.upsert.mockResolvedValue({});
  });

  afterEach(() => {
    invalidateChatDailyLimitSettingsCache();
    vi.useRealTimers();
  });

  it("defaults to 50 student / 200 instructor messages per day", async () => {
    await expect(getChatDailyLimitSettings()).resolves.toEqual(defaultChatDailyLimitSettings());
  });

  it("applies persisted admin overrides", async () => {
    prismaMock.systemConfig.findMany.mockResolvedValue([
      { key: "chat.daily.studentLimit", value: "10" },
      { key: "chat.daily.instructorLimit", value: "80" },
    ]);

    await expect(getChatDailyLimitSettings()).resolves.toEqual({
      studentLimit: 10,
      instructorLimit: 80,
    });
  });

  it("persists settings and invalidates the read cache", async () => {
    await getChatDailyLimitSettings();
    prismaMock.systemConfig.findMany.mockResolvedValue([
      { key: "chat.daily.studentLimit", value: "25" },
      { key: "chat.daily.instructorLimit", value: "200" },
    ]);

    const saved = await setChatDailyLimitSettings(
      { studentLimit: 25, instructorLimit: 200 },
      "admin-1",
    );

    expect(prismaMock.systemConfig.upsert).toHaveBeenCalledTimes(2);
    expect(saved).toEqual({ studentLimit: 25, instructorLimit: 200 });
  });

  it("keeps last-known settings when Postgres fails after the cache TTL", async () => {
    prismaMock.systemConfig.findMany.mockResolvedValue([
      { key: "chat.daily.studentLimit", value: "1" },
      { key: "chat.daily.instructorLimit", value: "2" },
    ]);
    await expect(getChatDailyLimitSettings()).resolves.toEqual({
      studentLimit: 1,
      instructorLimit: 2,
    });

    prismaMock.systemConfig.findMany.mockRejectedValue(new Error("db down"));
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 11_000);
    await expect(getChatDailyLimitSettings()).resolves.toEqual({
      studentLimit: 1,
      instructorLimit: 2,
    });
  });

  it("throws when settings have never loaded and Postgres is down", async () => {
    prismaMock.systemConfig.findMany.mockRejectedValue(new Error("db down"));
    await expect(getChatDailyLimitSettings()).rejects.toBeInstanceOf(
      ChatDailyLimitSettingsUnavailableError,
    );
  });

  it("keeps enforcing a 1/day cap when Postgres fails after a successful load", async () => {
    prismaMock.systemConfig.findMany.mockResolvedValue([
      { key: "chat.daily.studentLimit", value: "1" },
      { key: "chat.daily.instructorLimit", value: "200" },
    ]);
    const userId = `outage-${randomUUID()}`;
    await expect(
      consumeLocalChatDailyCap({
        userId,
        role: "STUDENT",
        model: "vllm:test-model",
      }),
    ).resolves.toEqual({ limited: false, retryAfter: 0 });

    prismaMock.systemConfig.findMany.mockRejectedValue(new Error("db down"));
    const later = Date.now() + 11_000;
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(later);
    try {
      await expect(
        consumeLocalChatDailyCap({
          userId,
          role: "STUDENT",
          model: "vllm:test-model",
        }),
      ).resolves.toMatchObject({ limited: true });
    } finally {
      nowSpy.mockRestore();
    }
  });
});

describe("consumeLocalChatDailyCap", () => {
  beforeEach(() => {
    resetRateLimitsForTests();
  });

  it("skips cloud providers with a user-supplied key", async () => {
    await expect(
      consumeLocalChatDailyCap({
        userId: "user-1",
        role: "STUDENT",
        model: "openai:gpt-4o",
        settings: defaultChatDailyLimitSettings(),
      }),
    ).resolves.toBeNull();
  });

  it("skips Auto sentinels until routing has resolved a provider", async () => {
    await expect(
      consumeLocalChatDailyCap({
        userId: "user-1",
        role: "STUDENT",
        model: "auto",
        settings: defaultChatDailyLimitSettings(),
      }),
    ).resolves.toBeNull();
  });

  it("enforces the student daily cap on local models", async () => {
    const settings = { studentLimit: 1, instructorLimit: 200 };
    const userId = `student-${randomUUID()}`;
    await expect(
      consumeLocalChatDailyCap({
        userId,
        role: "STUDENT",
        model: "vllm:test-model",
        settings,
      }),
    ).resolves.toEqual({ limited: false, retryAfter: 0 });
    await expect(
      consumeLocalChatDailyCap({
        userId,
        role: "STUDENT",
        model: "vllm:test-model",
        settings,
      }),
    ).resolves.toMatchObject({ limited: true });
  });

  it("uses the instructor cap for staff roles including UNIT_ADMIN", async () => {
    const settings = { studentLimit: 1, instructorLimit: 2 };
    const userId = `unit-admin-${randomUUID()}`;
    await expect(
      consumeLocalChatDailyCap({
        userId,
        role: "UNIT_ADMIN",
        model: "vllm:test-model",
        settings,
      }),
    ).resolves.toMatchObject({ limited: false });
    await expect(
      consumeLocalChatDailyCap({
        userId,
        role: "UNIT_ADMIN",
        model: "vllm:test-model",
        settings,
      }),
    ).resolves.toMatchObject({ limited: false });
    await expect(
      consumeLocalChatDailyCap({
        userId,
        role: "UNIT_ADMIN",
        model: "vllm:test-model",
        settings,
      }),
    ).resolves.toMatchObject({ limited: true });
  });

  it("treats a cap of 0 as unlimited", async () => {
    await expect(
      consumeLocalChatDailyCap({
        userId: "student-1",
        role: "STUDENT",
        model: "vllm:test-model",
        settings: { studentLimit: 0, instructorLimit: 200 },
      }),
    ).resolves.toBeNull();
  });

  it("uses a 24-hour window", () => {
    expect(CHAT_DAILY_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
  });
});

describe("refundLocalChatDailyCap", () => {
  beforeEach(() => {
    resetRateLimitsForTests();
  });

  it("undoes a charge so the same slot can be spent again (Bedrock overflow, #1547/#1441)", async () => {
    const settings = { studentLimit: 1, instructorLimit: 200 };
    const userId = `student-${randomUUID()}`;
    const request = { userId, role: "STUDENT", model: "vllm:test-model", settings };

    // Spends the student's only slot for the day.
    await expect(consumeLocalChatDailyCap(request)).resolves.toEqual({
      limited: false,
      retryAfter: 0,
    });
    // This turn actually ran on Bedrock overflow, not the local model — refund it.
    await refundLocalChatDailyCap(request);
    // The refunded slot is available again, not double-charged.
    await expect(consumeLocalChatDailyCap(request)).resolves.toEqual({
      limited: false,
      retryAfter: 0,
    });
  });

  it("is a no-op for cloud providers, Auto, and uncapped roles", async () => {
    const userId = `student-${randomUUID()}`;
    await expect(
      refundLocalChatDailyCap({ userId, role: "STUDENT", model: "openai:gpt-4o" }),
    ).resolves.toBeUndefined();
    await expect(
      refundLocalChatDailyCap({ userId, role: "STUDENT", model: "auto" }),
    ).resolves.toBeUndefined();
    await expect(
      refundLocalChatDailyCap({
        userId,
        role: "STUDENT",
        model: "vllm:test-model",
        settings: { studentLimit: 0, instructorLimit: 200 },
      }),
    ).resolves.toBeUndefined();
  });
});
