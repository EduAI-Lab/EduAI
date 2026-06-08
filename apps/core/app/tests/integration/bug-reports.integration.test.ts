// @vitest-environment node
//
// Integration tests for POST /api/bug-reports.
// Auth layer is mocked; all other logic (Prisma, guards, createBugReport) runs
// against the real test database.

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import prisma from "~/lib/prisma.server";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

import { action } from "~/routes/api/bug-reports";

const VALID_SERVICE_KEY = "bug-reports-integration-key-xyz";

function makeActionArgs(body: unknown, authorization?: string) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (authorization) headers.set("Authorization", authorization);
  return {
    request: new Request("http://localhost/api/bug-reports", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
    params: {} as Record<string, string>,
    context: {} as never,
  };
}

// ---------------------------------------------------------------------------
// Seed / teardown
// ---------------------------------------------------------------------------

let aiTutorUserId: string;
let qmUserId: string;

beforeAll(async () => {
  vi.stubEnv("EDUAI_API_KEY", VALID_SERVICE_KEY);

  const aiUser = await prisma.user.create({
    data: {
      email: "ai-tutor-reporter@bug-test.com",
      name: "AI Tutor Reporter",
      role: "STUDENT",
      emailVerified: false,
    },
  });
  aiTutorUserId = aiUser.id;

  const qmUser = await prisma.user.create({
    data: {
      email: "qm-reporter@bug-test.com",
      name: "QM Reporter",
      role: "STUDENT",
      emailVerified: false,
    },
  });
  qmUserId = qmUser.id;
});

afterAll(async () => {
  await prisma.bugReport.deleteMany({
    where: { userId: { in: [aiTutorUserId, qmUserId] } },
  });
  await prisma.user.deleteMany({ where: { id: { in: [aiTutorUserId, qmUserId] } } });
  vi.unstubAllEnvs();
  await prisma.$disconnect();
});

beforeEach(() => vi.clearAllMocks());

// ---------------------------------------------------------------------------
// Auth guard tests
// ---------------------------------------------------------------------------

describe("POST /api/bug-reports — service key auth", () => {
  it("returns 401 MISSING_SERVICE_KEY when Authorization header is absent", async () => {
    const res = await action(makeActionArgs({ source: "AI_TUTOR", userId: aiTutorUserId, description: "test" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "MISSING_SERVICE_KEY" });
  });

  it("returns 403 INVALID_SERVICE_KEY for a wrong Bearer token", async () => {
    const res = await action(
      makeActionArgs({ source: "AI_TUTOR", userId: aiTutorUserId, description: "test" }, "Bearer wrong-key"),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "INVALID_SERVICE_KEY" });
  });
});

// ---------------------------------------------------------------------------
// Validation tests
// ---------------------------------------------------------------------------

describe("POST /api/bug-reports — validation", () => {
  it("returns 422 VALIDATION_ERROR when description exceeds 2000 chars", async () => {
    const res = await action(
      makeActionArgs(
        { source: "AI_TUTOR", userId: aiTutorUserId, description: "x".repeat(2001) },
        `Bearer ${VALID_SERVICE_KEY}`,
      ),
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: "VALIDATION_ERROR",
      fields: { description: "exceeds 2000 chars" },
    });
  });

  it("returns 422 VALIDATION_ERROR for an invalid source value", async () => {
    const res = await action(
      makeActionArgs(
        { source: "UNKNOWN_SOURCE", userId: aiTutorUserId, description: "valid description" },
        `Bearer ${VALID_SERVICE_KEY}`,
      ),
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("VALIDATION_ERROR");
    expect(body.fields.source).toBeDefined();
  });

  it("returns 422 USER_NOT_FOUND when userId does not exist in Core", async () => {
    const res = await action(
      makeActionArgs(
        { source: "AI_TUTOR", userId: "nonexistent-cuid-xyz", description: "valid description" },
        `Bearer ${VALID_SERVICE_KEY}`,
      ),
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "USER_NOT_FOUND" });
  });
});

// ---------------------------------------------------------------------------
// Source tagging — AI Tutor lands in Core's bug_reports table with correct tag
// ---------------------------------------------------------------------------

describe("POST /api/bug-reports — AI Tutor reports land in Core DB", () => {
  it("persists source=AI_TUTOR in Core bug_reports table", async () => {
    const res = await action(
      makeActionArgs(
        {
          source: "AI_TUTOR",
          userId: aiTutorUserId,
          description: "AI Tutor integration: page crashed on submit.",
          isAnonymous: false,
          pageUrl: "https://tutor.example.com/activity/1",
        },
        `Bearer ${VALID_SERVICE_KEY}`,
      ),
    );

    expect(res.status).toBe(201);
    expect(res.body).toBeNull();

    const row = await prisma.bugReport.findFirst({
      where: { userId: aiTutorUserId, description: "AI Tutor integration: page crashed on submit." },
    });
    expect(row).not.toBeNull();
    expect(row!.source).toBe("AI_TUTOR");
    expect(row!.userId).toBe(aiTutorUserId);
    expect(row!.pageUrl).toBe("https://tutor.example.com/activity/1");
  });
});

// ---------------------------------------------------------------------------
// Source tagging — Question Maker lands in Core's bug_reports table with correct tag
// ---------------------------------------------------------------------------

describe("POST /api/bug-reports — Question Maker reports land in Core DB", () => {
  it("persists source=QUESTION_MAKER in Core bug_reports table", async () => {
    const res = await action(
      makeActionArgs(
        {
          source: "QUESTION_MAKER",
          userId: qmUserId,
          description: "QM integration: variant approval threw 500.",
          isAnonymous: false,
        },
        `Bearer ${VALID_SERVICE_KEY}`,
      ),
    );

    expect(res.status).toBe(201);

    const row = await prisma.bugReport.findFirst({
      where: { userId: qmUserId, description: "QM integration: variant approval threw 500." },
    });
    expect(row).not.toBeNull();
    expect(row!.source).toBe("QUESTION_MAKER");
    expect(row!.userId).toBe(qmUserId);
  });
});

// ---------------------------------------------------------------------------
// Anonymous — userId is always stored for audit
// ---------------------------------------------------------------------------

describe("POST /api/bug-reports — anonymous reports", () => {
  it("persists userId even when isAnonymous is true", async () => {
    const res = await action(
      makeActionArgs(
        {
          source: "AI_TUTOR",
          userId: aiTutorUserId,
          description: "Anonymous report: UI glitch on lesson page.",
          isAnonymous: true,
        },
        `Bearer ${VALID_SERVICE_KEY}`,
      ),
    );

    expect(res.status).toBe(201);

    const row = await prisma.bugReport.findFirst({
      where: { userId: aiTutorUserId, description: "Anonymous report: UI glitch on lesson page." },
    });
    expect(row).not.toBeNull();
    expect(row!.userId).toBe(aiTutorUserId);
    expect(row!.isAnonymous).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Optional fields round-trip
// ---------------------------------------------------------------------------

describe("POST /api/bug-reports — optional fields", () => {
  it("stores all optional fields when provided", async () => {
    const res = await action(
      makeActionArgs(
        {
          source: "QUESTION_MAKER",
          userId: qmUserId,
          description: "Optional fields round-trip test.",
          consoleLogs: "[{\"level\":\"error\"}]",
          networkLogs: "[{\"url\":\"/api/test\",\"status\":500}]",
          screenshot: "data:image/png;base64,abc==",
          pageUrl: "https://qm.example.com/variants/99",
          userAgent: "vitest/1.0",
          context: { variantId: "v-abc", courseId: "c-xyz" },
        },
        `Bearer ${VALID_SERVICE_KEY}`,
      ),
    );

    expect(res.status).toBe(201);

    const row = await prisma.bugReport.findFirst({
      where: { userId: qmUserId, description: "Optional fields round-trip test." },
    });
    expect(row).not.toBeNull();
    expect(row!.consoleLogs).toBe("[{\"level\":\"error\"}]");
    expect(row!.screenshot).toBe("data:image/png;base64,abc==");
    expect(row!.pageUrl).toBe("https://qm.example.com/variants/99");
    expect(row!.context).toEqual({ variantId: "v-abc", courseId: "c-xyz" });
  });
});
