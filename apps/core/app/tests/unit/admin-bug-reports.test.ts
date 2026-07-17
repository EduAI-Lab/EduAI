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
      count: vi.fn(),
      update: vi.fn(),
    },
    user: { findUnique: vi.fn() },
  },
}));

import { loader as adminLoader, action as adminAction } from "~/routes/api/admin.bug-reports";
import { loader as mineLoader } from "~/routes/api/bug-reports";
import { auth } from "~/lib/auth/server";
import prisma from "~/lib/prisma.server";

const REPORT = {
  id: "br-1",
  source: "AI_TUTOR",
  status: "UNHANDLED",
  description: "It broke",
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

function makeArgs(path: string, method = "GET", body?: unknown, params: Record<string, string> = {}) {
  return {
    request: new Request(`http://localhost${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
    params,
    context: {} as never,
  } as any;
}

function mockUser(role: string | null, id = "u1") {
  vi.mocked(auth.api.getSession).mockResolvedValue(
    (role ? { user: { id, role } } : null) as never,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.bugReport.findMany).mockResolvedValue([REPORT] as never);
  vi.mocked(prisma.bugReport.count).mockResolvedValue(1);
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
    });
  });

  it("masks userId/email/name when isAnonymous=true (§11)", async () => {
    mockUser("ADMIN");
    vi.mocked(prisma.bugReport.findMany).mockResolvedValue([
      { ...REPORT, isAnonymous: true },
    ] as never);
    const res = await adminLoader(makeArgs("/api/admin/bug-reports"));
    const body = await res.json();
    expect(body.reports[0].userId).toBeNull();
    expect(body.reports[0].userEmail).toBeNull();
    expect(body.reports[0].userName).toBeNull();
    expect(body.reports[0].description).toBe("It broke"); // content still visible
  });

  it("forwards source and status filters to the query", async () => {
    mockUser("ADMIN");
    await adminLoader(
      makeArgs("/api/admin/bug-reports?source=QUESTION_MAKER&status=RESOLVED"),
    );
    expect(prisma.bugReport.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { source: "QUESTION_MAKER", status: "RESOLVED" },
      }),
    );
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

  it("paginates via limit/offset", async () => {
    mockUser("ADMIN");
    await adminLoader(makeArgs("/api/admin/bug-reports?limit=10&offset=20"));
    expect(prisma.bugReport.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 10, skip: 20 }),
    );
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
