// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  bugReport: { create: vi.fn() },
}));

vi.mock("~/lib/prisma.server", () => ({ default: prismaMock }));

import { createBugReport, BUG_REPORT_FIELD_LIMITS } from "~/lib/bug-reports/server";

const VALID_USER = { id: "user-cuid-abc" };
const CREATED_REPORT = { id: "br-test-1" };
const OK_RESULT = { ok: true as const, report: { id: CREATED_REPORT.id } };

const BASE_PAYLOAD = {
  source: "AI_TUTOR" as const,
  userId: "user-cuid-abc",
  description: "Something is broken on the dashboard page.",
  isAnonymous: false,
};

describe("createBugReport — validation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects a null payload", async () => {
    const r = await createBugReport(null);
    expect(r).toMatchObject({ ok: false, error: "VALIDATION_ERROR" });
    expect(prismaMock.bugReport.create).not.toHaveBeenCalled();
  });

  it("rejects missing source", async () => {
    const r = await createBugReport({ ...BASE_PAYLOAD, source: undefined });
    expect(r).toMatchObject({ ok: false, error: "VALIDATION_ERROR", fields: { source: expect.any(String) } });
    expect(prismaMock.bugReport.create).not.toHaveBeenCalled();
  });

  it("rejects invalid source value", async () => {
    const r = await createBugReport({ ...BASE_PAYLOAD, source: "INVALID_SOURCE" });
    expect(r).toMatchObject({ ok: false, error: "VALIDATION_ERROR", fields: { source: expect.any(String) } });
    expect(prismaMock.bugReport.create).not.toHaveBeenCalled();
  });

  it("rejects missing userId", async () => {
    const r = await createBugReport({ ...BASE_PAYLOAD, userId: undefined });
    expect(r).toMatchObject({ ok: false, error: "VALIDATION_ERROR", fields: { userId: expect.any(String) } });
    expect(prismaMock.bugReport.create).not.toHaveBeenCalled();
  });

  it("rejects empty userId string", async () => {
    const r = await createBugReport({ ...BASE_PAYLOAD, userId: "   " });
    expect(r).toMatchObject({ ok: false, error: "VALIDATION_ERROR", fields: { userId: expect.any(String) } });
    expect(prismaMock.bugReport.create).not.toHaveBeenCalled();
  });

  it("rejects missing description", async () => {
    const r = await createBugReport({ ...BASE_PAYLOAD, description: undefined });
    expect(r).toMatchObject({ ok: false, error: "VALIDATION_ERROR", fields: { description: expect.any(String) } });
    expect(prismaMock.bugReport.create).not.toHaveBeenCalled();
  });

  it("rejects description exceeding 2000 chars", async () => {
    const r = await createBugReport({ ...BASE_PAYLOAD, description: "x".repeat(2001) });
    expect(r).toMatchObject({
      ok: false,
      error: "VALIDATION_ERROR",
      fields: { description: "exceeds 2000 chars" },
    });
    expect(prismaMock.bugReport.create).not.toHaveBeenCalled();
  });

  it("accepts description of exactly 2000 chars", async () => {
    prismaMock.user.findUnique.mockResolvedValue(VALID_USER);
    prismaMock.bugReport.create.mockResolvedValue(CREATED_REPORT);
    const r = await createBugReport({ ...BASE_PAYLOAD, description: "x".repeat(2000) });
    expect(r).toEqual(OK_RESULT);
  });
});

describe("createBugReport — USER_NOT_FOUND", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns USER_NOT_FOUND when userId does not exist in the DB", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    const r = await createBugReport(BASE_PAYLOAD);
    expect(r).toEqual({ ok: false, status: 422, error: "USER_NOT_FOUND" });
    expect(prismaMock.bugReport.create).not.toHaveBeenCalled();
  });

  it("queries by the exact trimmed userId", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    await createBugReport({ ...BASE_PAYLOAD, userId: "  padded-id  " });
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { id: "padded-id" },
      select: { id: true },
    });
  });
});

describe("createBugReport — source tagging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.user.findUnique.mockResolvedValue(VALID_USER);
    prismaMock.bugReport.create.mockResolvedValue(CREATED_REPORT);
  });

  it("persists with source AI_TUTOR", async () => {
    const r = await createBugReport({ ...BASE_PAYLOAD, source: "AI_TUTOR" });
    expect(r).toEqual(OK_RESULT);
    expect(prismaMock.bugReport.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ source: "AI_TUTOR" }) }),
    );
  });

  it("persists with source QUESTION_MAKER", async () => {
    const r = await createBugReport({ ...BASE_PAYLOAD, source: "QUESTION_MAKER" });
    expect(r).toEqual(OK_RESULT);
    expect(prismaMock.bugReport.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ source: "QUESTION_MAKER" }) }),
    );
  });
});

describe("createBugReport — anonymous vs. non-anonymous persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.user.findUnique.mockResolvedValue(VALID_USER);
    prismaMock.bugReport.create.mockResolvedValue(CREATED_REPORT);
  });

  it("persists userId even when isAnonymous is true", async () => {
    const r = await createBugReport({ ...BASE_PAYLOAD, isAnonymous: true });
    expect(r).toEqual(OK_RESULT);
    const createCall = prismaMock.bugReport.create.mock.calls[0][0];
    expect(createCall.data.userId).toBe(BASE_PAYLOAD.userId);
    expect(createCall.data.isAnonymous).toBe(true);
  });

  it("persists isAnonymous: false when not provided", async () => {
    const { isAnonymous: _, ...noAnonymous } = BASE_PAYLOAD;
    const r = await createBugReport(noAnonymous);
    expect(r).toEqual(OK_RESULT);
    expect(prismaMock.bugReport.create.mock.calls[0][0].data.isAnonymous).toBe(false);
  });

  it("persists userId for non-anonymous report", async () => {
    const r = await createBugReport({ ...BASE_PAYLOAD, isAnonymous: false });
    expect(r).toEqual(OK_RESULT);
    expect(prismaMock.bugReport.create.mock.calls[0][0].data.userId).toBe(BASE_PAYLOAD.userId);
  });
});

describe("createBugReport — bugType", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.user.findUnique.mockResolvedValue(VALID_USER);
    prismaMock.bugReport.create.mockResolvedValue(CREATED_REPORT);
  });

  it("persists a valid bugType", async () => {
    const r = await createBugReport({ ...BASE_PAYLOAD, bugType: "FEATURE_NOT_WORKING" });
    expect(r).toEqual(OK_RESULT);
    const data = prismaMock.bugReport.create.mock.calls[0][0].data;
    expect(data.bugType).toBe("FEATURE_NOT_WORKING");
  });

  it("persists null bugType when field is absent", async () => {
    const r = await createBugReport(BASE_PAYLOAD);
    expect(r).toEqual(OK_RESULT);
    const data = prismaMock.bugReport.create.mock.calls[0][0].data;
    expect(data.bugType).toBeNull();
  });

  it("persists null bugType when field is explicitly null", async () => {
    const r = await createBugReport({ ...BASE_PAYLOAD, bugType: null });
    expect(r).toEqual(OK_RESULT);
    const data = prismaMock.bugReport.create.mock.calls[0][0].data;
    expect(data.bugType).toBeNull();
  });

  it("returns VALIDATION_ERROR for an unrecognized bugType value", async () => {
    const r = await createBugReport({ ...BASE_PAYLOAD, bugType: "MADE_UP_TYPE" });
    expect(r).toMatchObject({
      ok: false,
      error: "VALIDATION_ERROR",
      fields: { bugType: expect.any(String) },
    });
    expect(prismaMock.bugReport.create).not.toHaveBeenCalled();
  });

  it("accepts all defined bugType values", async () => {
    const validTypes = [
      "UI_DISPLAY",
      "FEATURE_NOT_WORKING",
      "PERFORMANCE",
      "CONTENT_ERROR",
      "ACCESS_PERMISSION",
      "OTHER",
    ];
    for (const bugType of validTypes) {
      prismaMock.bugReport.create.mockClear();
      const r = await createBugReport({ ...BASE_PAYLOAD, bugType });
      expect(r).toEqual(OK_RESULT);
      expect(prismaMock.bugReport.create.mock.calls[0][0].data.bugType).toBe(bugType);
    }
  });
});

describe("createBugReport — optional fields", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.user.findUnique.mockResolvedValue(VALID_USER);
    prismaMock.bugReport.create.mockResolvedValue(CREATED_REPORT);
  });

  it("passes through all optional string fields", async () => {
    const r = await createBugReport({
      ...BASE_PAYLOAD,
      consoleLogs: "[]",
      networkLogs: "[]",
      screenshot: "data:image/png;base64,abc",
      pageUrl: "https://example.com/page",
      userAgent: "Mozilla/5.0",
      context: { courseId: "c1" },
    });
    expect(r).toEqual(OK_RESULT);
    const data = prismaMock.bugReport.create.mock.calls[0][0].data;
    expect(data.consoleLogs).toBe("[]");
    expect(data.networkLogs).toBe("[]");
    expect(data.screenshot).toBe("data:image/png;base64,abc");
    expect(data.pageUrl).toBe("https://example.com/page");
    expect(data.userAgent).toBe("Mozilla/5.0");
    expect(data.context).toEqual({ courseId: "c1" });
  });

  it("stores null for absent optional fields", async () => {
    const r = await createBugReport(BASE_PAYLOAD);
    expect(r).toEqual(OK_RESULT);
    const data = prismaMock.bugReport.create.mock.calls[0][0].data;
    expect(data.consoleLogs).toBeNull();
    expect(data.screenshot).toBeNull();
    expect(data.context).toEqual(Prisma.DbNull);
  });
});

describe("createBugReport — field caps and redaction (#979)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.user.findUnique.mockResolvedValue(VALID_USER);
    prismaMock.bugReport.create.mockResolvedValue({});
  });

  it("rejects oversized screenshots without truncating", async () => {
    const r = await createBugReport({
      ...BASE_PAYLOAD,
      screenshot: "x".repeat(BUG_REPORT_FIELD_LIMITS.screenshot + 1),
    });
    expect(r).toMatchObject({
      ok: false,
      error: "VALIDATION_ERROR",
      fields: { screenshot: expect.stringContaining("exceeds") },
    });
    expect(prismaMock.bugReport.create).not.toHaveBeenCalled();
  });

  it("truncates oversized console logs after redaction", async () => {
    const r = await createBugReport({
      ...BASE_PAYLOAD,
      consoleLogs: "y".repeat(BUG_REPORT_FIELD_LIMITS.consoleLogs + 50),
    });
    expect(r).toEqual({ ok: true });
    const data = prismaMock.bugReport.create.mock.calls[0][0].data;
    expect(data.consoleLogs).toHaveLength(BUG_REPORT_FIELD_LIMITS.consoleLogs);
  });

  it("redacts Authorization headers in network logs before persist", async () => {
    const r = await createBugReport({
      ...BASE_PAYLOAD,
      networkLogs: JSON.stringify([
        {
          url: "https://api.example.com/x",
          requestHeaders: { Authorization: "Bearer super-secret-token" },
        },
      ]),
    });
    expect(r).toEqual({ ok: true });
    const data = prismaMock.bugReport.create.mock.calls[0][0].data;
    const parsed = JSON.parse(data.networkLogs);
    expect(parsed[0].requestHeaders.Authorization).toBe("[REDACTED]");
  });

  it("redacts secrets embedded in context JSON", async () => {
    const r = await createBugReport({
      ...BASE_PAYLOAD,
      context: {
        courseId: "c1",
        apiKey: "should-not-persist",
        callback: "https://x.com?access_token=sekret",
      },
    });
    expect(r).toEqual({ ok: true });
    const data = prismaMock.bugReport.create.mock.calls[0][0].data;
    expect(data.context).toEqual({
      courseId: "c1",
      apiKey: "[REDACTED]",
      callback: "https://x.com?access_token=[REDACTED]",
    });
  });

  it("rejects oversized context objects", async () => {
    const r = await createBugReport({
      ...BASE_PAYLOAD,
      context: { blob: "z".repeat(BUG_REPORT_FIELD_LIMITS.contextJson) },
    });
    expect(r).toMatchObject({
      ok: false,
      error: "VALIDATION_ERROR",
      fields: { context: expect.stringContaining("exceeds") },
    });
  });
});
