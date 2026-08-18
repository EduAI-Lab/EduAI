// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimitsForTests } from "~/lib/auth/rate-limit.server";
import {
  CHAT_DAILY_WINDOW_MS,
  defaultChatDailyLimitSettings,
} from "~/lib/chat-daily-limits";
import {
  consumeLocalChatDailyCap,
  getChatDailyLimitSettings,
  invalidateChatDailyLimitSettingsCache,
  setChatDailyLimitSettings,
} from "~/lib/chat-daily-limits.server";

const prismaMock = vi.hoisted(() => ({
  systemConfig: { findMany: vi.fn(), upsert: vi.fn() },
}));

vi.mock("~/lib/prisma.server", () => ({ default: prismaMock }));

const originalStudentDailyLimit = process.env.CHAT_DAILY_STUDENT_LIMIT;
const originalInstructorDailyLimit = process.env.CHAT_DAILY_INSTRUCTOR_LIMIT;

function restoreDailyLimitEnv() {
  if (originalStudentDailyLimit === undefined) delete process.env.CHAT_DAILY_STUDENT_LIMIT;
  else process.env.CHAT_DAILY_STUDENT_LIMIT = originalStudentDailyLimit;
  if (originalInstructorDailyLimit === undefined) {
    delete process.env.CHAT_DAILY_INSTRUCTOR_LIMIT;
  } else {
    process.env.CHAT_DAILY_INSTRUCTOR_LIMIT = originalInstructorDailyLimit;
  }
}

describe("chat-daily-limits.server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitsForTests();
    delete process.env.CHAT_DAILY_STUDENT_LIMIT;
    delete process.env.CHAT_DAILY_INSTRUCTOR_LIMIT;
    invalidateChatDailyLimitSettingsCache();
    prismaMock.systemConfig.findMany.mockResolvedValue([]);
    prismaMock.systemConfig.upsert.mockResolvedValue({});
  });

  afterEach(() => {
    restoreDailyLimitEnv();
    invalidateChatDailyLimitSettingsCache();
  });

  it("defaults to 50 student / 200 instructor messages per day", async () => {
    await expect(getChatDailyLimitSettings()).resolves.toEqual(
      defaultChatDailyLimitSettings(),
    );
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

  it("enforces the student daily cap on local models", async () => {
    const settings = { studentLimit: 1, instructorLimit: 200 };
    await expect(
      consumeLocalChatDailyCap({
        userId: "student-1",
        role: "STUDENT",
        model: "vllm:test-model",
        settings,
      }),
    ).resolves.toEqual({ limited: false, retryAfter: 0 });
    await expect(
      consumeLocalChatDailyCap({
        userId: "student-1",
        role: "STUDENT",
        model: "vllm:test-model",
        settings,
      }),
    ).resolves.toMatchObject({ limited: true });
  });

  it("uses the instructor cap for staff roles", async () => {
    const settings = { studentLimit: 1, instructorLimit: 2 };
    await expect(
      consumeLocalChatDailyCap({
        userId: "instr-1",
        role: "INSTRUCTOR",
        model: "vllm:test-model",
        settings,
      }),
    ).resolves.toMatchObject({ limited: false });
    await expect(
      consumeLocalChatDailyCap({
        userId: "instr-1",
        role: "INSTRUCTOR",
        model: "vllm:test-model",
        settings,
      }),
    ).resolves.toMatchObject({ limited: false });
    await expect(
      consumeLocalChatDailyCap({
        userId: "instr-1",
        role: "INSTRUCTOR",
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
