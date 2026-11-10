// @vitest-environment node
//
// #304 — §11: admin bug-report API (list with filters + anonymity masking,
// status triage) and the own-reports listing.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/auth/guards.server", () => ({
  requireServiceKey: vi.fn(),
}));

vi.mock("~/lib/prisma.server", () => ({
  default: {
    bugReport: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    user: { findUnique: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));

vi.mock("~/lib/email/mailer.server", () => ({
  sendEmail: vi.fn(),
}));

import { loader as adminLoader, action as adminAction } from "~/routes/api/admin.bug-reports";
import { sendEmail } from "~/lib/email/mailer.server";
import { loader as mineLoader } from "~/routes/api/bug-reports";
import { auth } from "~/lib/auth/server";
import prisma from "~/lib/prisma.server";
import type { RouteRequestBody } from "../helpers/route-fixtures";

const REPORT = {
  id: "br-1",
  source: "AI_TUTOR",
  status: "UNHANDLED",
  description: "It broke",
  bugType: null,
  isAnonymous: false,
  userId: "u1",
  user: { email: "reporter@test.com", name: "Reporter" },
  consoleLogs: null,
  networkLogs: null,
  screenshot: null,
  pageUrl: null,
  userAgent: null,
  context: null,
  createdAt: new Date("2026-06-01"),
  updatedAt: new Date("2026-06-01"),
};

/** List rows come from a single $queryRaw that includes has* + user email/name. */
const LIST_ROW = {
  id: "br-1",
  source: "AI_TUTOR",
  status: "UNHANDLED",
  description: "It broke",
  bugType: null,
  isAnonymous: false,
  userId: "u1",
  userEmail: "reporter@test.com",
  userName: "Reporter",
  pageUrl: null,
  userAgent: null,
  context: null,
  createdAt: new Date("2026-06-01"),
  updatedAt: new Date("2026-06-01"),
  hasConsoleLogs: false,
  hasNetworkLogs: false,
  hasScreenshot: false,
};

function makeArgs(
  path: string,
  method = "GET",
  body?: RouteRequestBody,
  params: Record<string, string> = {},
) {
  // A GET carries no body at all, so the key is added only when one is passed.
  const init: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body !== undefined) init.body = JSON.stringify(body);
  return {
    request: new Request(`http://localhost${path}`, init),
    params,
    context: {} as never,
  } as any;
}

function mockUser(role: string | null, id = "u1") {
  vi.mocked(auth.api.getSession).mockResolvedValue((role ? { user: { id, role } } : null) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.bugReport.findMany).mockResolvedValue([REPORT] as never);
  vi.mocked(prisma.bugReport.count).mockResolvedValue(1);
  vi.mocked(prisma.$queryRaw).mockResolvedValue([LIST_ROW] as never);
  // Default: an ADMIN-role session's account is also active in the DB
  // (`requireAdmin` re-checks this — #1571 pattern). The deactivated-admin
  // regression test below overrides it per call.
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: "ADMIN", isActive: true } as never);
});

describe("GET /api/admin/bug-reports (#304)", () => {
  it("returns 401 for anonymous callers", async () => {
    mockUser(null);
    const res = await adminLoader(makeArgs("/api/admin/bug-reports"));
    expect(res.status).toBe(401);
  });

  it.each(["STUDENT", "INSTRUCTOR", "UNIT_ADMIN"])("returns 403 for %s", async (role) => {
    mockUser(role);
    const res = await adminLoader(makeArgs("/api/admin/bug-reports"));
    expect(res.status).toBe(403);
  });

  // #1571-pattern gap found in a #1669 deep-audit pass: this route's local
  // requireAdmin only checked the session's cached role, so a deactivated
  // admin's still-live session kept full bug-report triage access — including
  // full attachments, console/network logs, and status changes — until the
  // session naturally expired.
  it("returns 403 for an ADMIN-role session whose account was deactivated (#1571)", async () => {
    mockUser("ADMIN");
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      role: "ADMIN",
      isActive: false,
    } as never);
    const res = await adminLoader(makeArgs("/api/admin/bug-reports"));
    expect(res.status).toBe(403);
  });

  it("returns 200 with reporter identity for non-anonymous reports", async () => {
    mockUser("ADMIN");
    const res = await adminLoader(makeArgs("/api/admin/bug-reports"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.reports[0]).toMatchObject({
      id: "br-1",
      userId: "u1",
      userEmail: "reporter@test.com",
      userName: "Reporter",
      consoleLogs: null,
      networkLogs: null,
      screenshot: null,
      hasConsoleLogs: false,
      hasNetworkLogs: false,
      hasScreenshot: false,
    });
  });

  it("returns a single full report for GET /:id", async () => {
    mockUser("ADMIN");
    vi.mocked(prisma.bugReport.findUnique).mockResolvedValue({
      ...REPORT,
      consoleLogs: '[{"level":"error"}]',
      screenshot: "data:image/png;base64,abc",
    } as never);
    const res = await adminLoader(
      makeArgs("/api/admin/bug-reports/br-1", "GET", undefined, { id: "br-1" }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      id: "br-1",
      consoleLogs: '[{"level":"error"}]',
      screenshot: "data:image/png;base64,abc",
      hasConsoleLogs: true,
      hasScreenshot: true,
    });
  });

  it("returns 404 when GET /:id misses", async () => {
    mockUser("ADMIN");
    vi.mocked(prisma.bugReport.findUnique).mockResolvedValue(null);
    const res = await adminLoader(
      makeArgs("/api/admin/bug-reports/missing", "GET", undefined, { id: "missing" }),
    );
    expect(res.status).toBe(404);
  });

  it("treats empty-string attachments as absent on GET /:id (#1116 review)", async () => {
    mockUser("ADMIN");
    vi.mocked(prisma.bugReport.findUnique).mockResolvedValue({
      ...REPORT,
      consoleLogs: "",
      networkLogs: "",
      screenshot: "",
    } as never);
    const res = await adminLoader(
      makeArgs("/api/admin/bug-reports/br-1", "GET", undefined, { id: "br-1" }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      hasConsoleLogs: false,
      hasNetworkLogs: false,
      hasScreenshot: false,
    });
  });

  it("masks userId/email/name when isAnonymous=true (§11)", async () => {
    mockUser("ADMIN");
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ ...LIST_ROW, isAnonymous: true }] as never);
    const res = await adminLoader(makeArgs("/api/admin/bug-reports"));
    const body = await res.json();
    expect(body.reports[0].userId).toBeNull();
    expect(body.reports[0].userEmail).toBeNull();
    expect(body.reports[0].userName).toBeNull();
    expect(body.reports[0].description).toBe("It broke"); // content still visible
  });

  it("forwards source and status filters to the count query", async () => {
    mockUser("ADMIN");
    await adminLoader(makeArgs("/api/admin/bug-reports?source=QUESTION_MAKER&status=RESOLVED"));
    expect(prisma.bugReport.count).toHaveBeenCalledWith({
      where: { source: "QUESTION_MAKER", status: "RESOLVED" },
    });
    const listCall = vi.mocked(prisma.$queryRaw).mock.calls[0];
    expect(listCall).toBeDefined();
    // Tagged template: [strings, whereSql, clampedLimit, offset]
    const whereSql = listCall![1] as { values: unknown[] };
    expect(whereSql.values).toEqual(["QUESTION_MAKER", "RESOLVED"]);
    expect(listCall![2]).toBe(50); // default clampedLimit
    expect(listCall![3]).toBe(0); // default offset
  });

  it("rejects an unknown source filter with 400", async () => {
    mockUser("ADMIN");
    const res = await adminLoader(makeArgs("/api/admin/bug-reports?source=NOT_AN_APP"));
    expect(res.status).toBe(400);
  });

  it("rejects an unknown status filter with 400", async () => {
    mockUser("ADMIN");
    const res = await adminLoader(makeArgs("/api/admin/bug-reports?status=BOGUS"));
    expect(res.status).toBe(400);
  });

  it("paginates via limit/offset on the list query", async () => {
    mockUser("ADMIN");
    await adminLoader(makeArgs("/api/admin/bug-reports?limit=10&offset=20"));
    expect(prisma.bugReport.count).toHaveBeenCalled();
    const listCall = vi.mocked(prisma.$queryRaw).mock.calls[0];
    expect(listCall).toBeDefined();
    // Tagged template: [strings, whereSql, clampedLimit, offset]
    expect(listCall![2]).toBe(10);
    expect(listCall![3]).toBe(20);
  });

  it("clamps list limit to at most 200", async () => {
    mockUser("ADMIN");
    await adminLoader(makeArgs("/api/admin/bug-reports?limit=999&offset=5"));
    const listCall = vi.mocked(prisma.$queryRaw).mock.calls[0];
    expect(listCall![2]).toBe(200);
    expect(listCall![3]).toBe(5);
  });
});

describe("PATCH /api/admin/bug-reports/:id (#304)", () => {
  beforeEach(() => {
    vi.mocked(prisma.bugReport.update).mockResolvedValue({
      id: "br-1",
      status: "IN_PROGRESS",
    } as never);
  });

  it("returns 403 for a non-admin", async () => {
    mockUser("STUDENT");
    const res = await adminAction(
      makeArgs("/api/admin/bug-reports/br-1", "PATCH", { status: "IN_PROGRESS" }, { id: "br-1" }),
    );
    expect(res.status).toBe(403);
  });

  it("changes the status for an ADMIN", async () => {
    mockUser("ADMIN");
    const res = await adminAction(
      makeArgs("/api/admin/bug-reports/br-1", "PATCH", { status: "IN_PROGRESS" }, { id: "br-1" }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "br-1", status: "IN_PROGRESS" });
    expect(prisma.bugReport.update).toHaveBeenCalledWith({
      where: { id: "br-1" },
      data: { status: "IN_PROGRESS" },
      select: { id: true, status: true },
    });
  });

  it("returns 403 for an ADMIN-role session whose account was deactivated (#1571)", async () => {
    mockUser("ADMIN");
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      role: "ADMIN",
      isActive: false,
    } as never);
    const res = await adminAction(
      makeArgs("/api/admin/bug-reports/br-1", "PATCH", { status: "IN_PROGRESS" }, { id: "br-1" }),
    );
    expect(res.status).toBe(403);
    expect(prisma.bugReport.update).not.toHaveBeenCalled();
  });

  it("rejects an invalid status with 422", async () => {
    mockUser("ADMIN");
    const res = await adminAction(
      makeArgs("/api/admin/bug-reports/br-1", "PATCH", { status: "DONE" }, { id: "br-1" }),
    );
    expect(res.status).toBe(422);
  });

  it("returns 404 for a missing report", async () => {
    mockUser("ADMIN");
    vi.mocked(prisma.bugReport.update).mockResolvedValue(null as never);
    const { Prisma } = await import("@prisma/client");
    vi.mocked(prisma.bugReport.update).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("not found", {
        code: "P2025",
        clientVersion: "5.0.0",
      }),
    );
    const res = await adminAction(
      makeArgs("/api/admin/bug-reports/ghost", "PATCH", { status: "RESOLVED" }, { id: "ghost" }),
    );
    expect(res.status).toBe(404);
  });

  it("returns 405 for non-PATCH methods", async () => {
    mockUser("ADMIN");
    const res = await adminAction(
      makeArgs("/api/admin/bug-reports/br-1", "PUT", {}, { id: "br-1" }),
    );
    expect(res.status).toBe(405);
  });
});

describe("PATCH /api/admin/bug-reports/:id — reporter note", () => {
  const NOTE = { subject: "Update on your EduAI bug report", body: "We're working on it." };
  const patchNote = (reporterNote: RouteRequestBody, id = "br-1") =>
    adminAction(makeArgs(`/api/admin/bug-reports/${id}`, "PATCH", { reporterNote }, { id }));

  beforeEach(() => {
    vi.mocked(prisma.bugReport.findUnique).mockResolvedValue({
      description: "It broke",
      createdAt: new Date("2026-06-01T00:00:00Z"),
      user: { email: "reporter@test.com" },
    } as never);
    vi.mocked(prisma.bugReport.update).mockResolvedValue({} as never);
    vi.mocked(sendEmail).mockResolvedValue({ delivered: true });
  });

  it("saves the note and emails the admin's subject and message to the reporter", async () => {
    mockUser("ADMIN", "admin-1");
    const res = await patchNote(NOTE);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      delivery: "sent",
      reporterNoteSubject: NOTE.subject,
      reporterNote: NOTE.body,
      reporterReachable: true,
    });
    expect(body.reporterNoteEmailedAt).not.toBeNull();
    expect(prisma.bugReport.update).toHaveBeenCalledWith({
      where: { id: "br-1" },
      data: expect.objectContaining({
        reporterNoteSubject: NOTE.subject,
        reporterNote: NOTE.body,
        reporterNoteEmailedAt: null,
      }),
    });
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "reporter@test.com",
        subject: NOTE.subject,
        text: expect.stringContaining("We're working on it."),
      }),
    );
    // The reporter's own report is quoted so they know which one it answers.
    expect(vi.mocked(sendEmail).mock.calls[0][0].text).toContain('"It broke"');
  });

  it("keeps the note but reports not-sent when the email fails", async () => {
    mockUser("ADMIN");
    vi.mocked(sendEmail).mockRejectedValue(new Error("SMTP down"));
    const res = await patchNote(NOTE);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ delivery: "not-sent", reporterNoteEmailedAt: null });
    expect(prisma.bugReport.update).toHaveBeenCalledTimes(1);
  });

  it("saves without emailing when the reporter has no address", async () => {
    mockUser("ADMIN");
    vi.mocked(prisma.bugReport.findUnique).mockResolvedValue({
      description: "It broke",
      createdAt: new Date("2026-06-01T00:00:00Z"),
      user: null,
    } as never);
    const res = await patchNote(NOTE);

    expect(await res.json()).toMatchObject({ delivery: "no-recipient", reporterReachable: false });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("does not leak the reporter's address in the response", async () => {
    mockUser("ADMIN");
    const res = await patchNote(NOTE);
    expect(JSON.stringify(await res.json())).not.toContain("reporter@test.com");
  });

  it("rejects an empty subject or message with 422", async () => {
    mockUser("ADMIN");
    const res = await patchNote({ subject: "  ", body: "" });

    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      error: "VALIDATION_ERROR",
      fields: { subject: "required", body: "required" },
    });
    expect(prisma.bugReport.update).not.toHaveBeenCalled();
  });

  it("returns 404 for a missing report", async () => {
    mockUser("ADMIN");
    vi.mocked(prisma.bugReport.findUnique).mockResolvedValue(null);
    const res = await patchNote(NOTE, "ghost");
    expect(res.status).toBe(404);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("returns 403 for a non-admin", async () => {
    mockUser("INSTRUCTOR");
    const res = await patchNote(NOTE);
    expect(res.status).toBe(403);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe("GET /api/bug-reports?mine=true (#304)", () => {
  it("returns 400 without mine=true", async () => {
    mockUser("STUDENT");
    const res = await mineLoader(makeArgs("/api/bug-reports"));
    expect(res.status).toBe(400);
  });

  it("returns 401 for anonymous callers", async () => {
    mockUser(null);
    const res = await mineLoader(makeArgs("/api/bug-reports?mine=true"));
    expect(res.status).toBe(401);
  });

  it("returns the caller's own reports for any role", async () => {
    mockUser("STUDENT", "reporter-1");
    vi.mocked(prisma.bugReport.findMany).mockResolvedValue([
      { id: "br-9", source: "CORE", status: "UNHANDLED" },
    ] as never);
    const res = await mineLoader(makeArgs("/api/bug-reports?mine=true"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reports).toHaveLength(1);
    expect(prisma.bugReport.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "reporter-1" } }),
    );
  });
});
