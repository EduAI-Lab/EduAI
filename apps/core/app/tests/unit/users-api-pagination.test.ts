// @vitest-environment node
//
// #1041/#1125 — the GET half of the users API: required paging, the `?ids=`
// unpaged escape hatch, and the filters that map the admin table's facets onto
// one request. The whitelists matter for more than tidiness: `sortBy` reaches
// Prisma's `orderBy` and `role` reaches a `where.role in`, so an unknown value
// has to 400 rather than be forwarded.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/auth/guards.server", () => ({
  enforceAdminIfApiKey: vi.fn(async () => ({ response: null, session: null })),
}));

vi.mock("~/lib/auth/course-access.server", () => ({
  resolveCourseAccessGate: vi.fn(),
}));

vi.mock("~/lib/logging.server", () => ({
  fireAndForget: vi.fn(),
  logAuditAction: vi.fn(),
  logSecurityEvent: vi.fn(),
}));

vi.mock("~/lib/prisma.server", () => ({
  default: {
    $transaction: vi.fn(),
    user: { findMany: vi.fn(), count: vi.fn() },
    enrollment: { findMany: vi.fn(async () => []) },
  },
}));

import { auth } from "~/lib/auth/server";
import { resolveCourseAccessGate } from "~/lib/auth/course-access.server";
import prisma from "~/lib/prisma.server";
import { handleUsersApiRequest } from "~/lib/api/users-api.server";

const ROW = {
  id: "u1",
  name: "Student One",
  email: "s1@example.com",
  role: "STUDENT",
  isActive: true,
  emailVerified: true,
  createdAt: new Date("2026-07-01"),
  updatedAt: new Date("2026-07-01"),
  authorizedUnits: [],
  _count: { enrolledCourses: 0, assistedCourses: 0, taughtCourses: 0, aiInteractions: 0 },
};

const get = (qs: string) =>
  handleUsersApiRequest(new Request(`http://core.test/api/users${qs}`, { method: "GET" }));

async function body(response: Response) {
  return JSON.parse(await response.text());
}

/** The paged branch runs count + findMany + the platform-wide aggregates in one $transaction. */
function mockPagedTransaction(rows = [ROW], total = rows.length) {
  vi.mocked(prisma.$transaction).mockResolvedValue([total, rows, 137, 130, 1, 2, 3, 4] as never);
}

/**
 * The `courseId` candidate branch runs a narrow `[count, findMany]`
 * $transaction only — no platform-wide aggregates.
 */
function mockCandidateTransaction(rows: Array<Pick<typeof ROW, "id" | "name" | "email">>, total = rows.length) {
  vi.mocked(prisma.$transaction).mockResolvedValue([total, rows] as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth.api.getSession).mockResolvedValue({
    user: { id: "admin-1", role: "ADMIN", email: "admin@example.com" },
  } as never);
  vi.mocked(prisma.enrollment.findMany).mockResolvedValue([] as never);
});

describe("GET /api/users — access", () => {
  it("403s a non-admin session", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u9", role: "STUDENT", email: "s@example.com" },
    } as never);

    expect((await get("?page=1&pageSize=25")).status).toBe(403);
  });

  it("403s an anonymous caller", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);

    expect((await get("?page=1&pageSize=25")).status).toBe(403);
  });
});

describe("GET /api/users — paging contract", () => {
  it("400s PAGINATION_REQUIRED without paging params", async () => {
    const response = await get("");

    expect(response.status).toBe(400);
    expect(JSON.stringify(await body(response))).toContain("PAGINATION_REQUIRED");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("returns the envelope plus platform-wide stats on a paged read", async () => {
    mockPagedTransaction();

    const payload = await body(await get("?page=1&pageSize=25"));

    expect(payload.total).toBe(1);
    expect(payload.page).toBe(1);
    expect(payload.pageSize).toBe(25);
    // `stats` is deliberately filter-independent — the header must not move as
    // the admin searches.
    expect(payload.stats).toMatchObject({ total: 137, active: 130 });
    expect(payload.stats.byRole).toBeDefined();
  });
});

describe("GET /api/users — filters", () => {
  beforeEach(() => mockPagedTransaction());

  /** The `where` handed to the page's findMany. */
  const whereFromFindMany = () => {
    const calls = vi.mocked(prisma.user.findMany).mock.calls;
    return (calls[0]?.[0] as { where?: Record<string, unknown> })?.where;
  };

  it("maps a comma-separated role facet onto one `in` filter", async () => {
    await get("?page=1&pageSize=25&role=STUDENT,INSTRUCTOR");

    expect(whereFromFindMany()?.role).toEqual({ in: ["STUDENT", "INSTRUCTOR"] });
  });

  it("400s an unknown role instead of forwarding it to Prisma", async () => {
    const response = await get("?page=1&pageSize=25&role=SUPERUSER");

    expect(response.status).toBe(400);
    expect(JSON.stringify(await body(response))).toContain("SUPERUSER");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("400s an unknown sortBy — the whitelist keeps orderBy off arbitrary columns", async () => {
    const response = await get("?page=1&pageSize=25&sortBy=passwordHash");

    expect(response.status).toBe(400);
    expect(JSON.stringify(await body(response))).toContain("passwordHash");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("searches name and email case-insensitively", async () => {
    await get("?page=1&pageSize=25&search=ali");

    expect(whereFromFindMany()?.OR).toEqual([
      { name: { contains: "ali", mode: "insensitive" } },
      { email: { contains: "ali", mode: "insensitive" } },
    ]);
  });

  it("ignores a blank search rather than filtering on an empty string", async () => {
    await get("?page=1&pageSize=25&search=%20%20");

    expect(whereFromFindMany()?.OR).toBeUndefined();
  });

  it("filters on isActive=true", async () => {
    await get("?page=1&pageSize=25&isActive=true");

    expect(whereFromFindMany()?.isActive).toBe(true);
  });

  it("filters on isActive=false", async () => {
    await get("?page=1&pageSize=25&isActive=false");

    expect(whereFromFindMany()?.isActive).toBe(false);
  });

  it("omits isActive entirely when the param is absent", async () => {
    await get("?page=1&pageSize=25");

    expect(whereFromFindMany()?.isActive).toBeUndefined();
  });
});

describe("GET /api/users — ?ids= lookup (#1125)", () => {
  it("resolves a known id set unpaged, with no page params required", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([ROW] as never);

    const response = await get("?ids=u1");
    const payload = await body(response);

    expect(response.status).toBe(200);
    expect(payload.data).toHaveLength(1);
    expect(payload.total).toBe(1);
    // The unpaged branch skips the count/stats transaction entirely.
    expect(prisma.$transaction).not.toHaveBeenCalled();
    const where = (vi.mocked(prisma.user.findMany).mock.calls[0][0] as { where: { id: unknown } })
      .where;
    expect(where.id).toEqual({ in: ["u1"] });
  });

  it("400s when ?ids= is combined with paging", async () => {
    const response = await get("?ids=u1&page=1&pageSize=25");

    expect(response.status).toBe(400);
    expect(JSON.stringify(await body(response))).toContain("IDS_AND_PAGE_EXCLUSIVE");
  });

  it("400s past the id cap so the escape hatch can't become a full-table read", async () => {
    const ids = Array.from({ length: 201 }, (_, i) => `u${i}`).join(",");

    const response = await get(`?ids=${ids}`);

    expect(response.status).toBe(400);
    expect(JSON.stringify(await body(response))).toContain("IDS_TOO_MANY");
  });

  it("combines ?ids= with a search filter", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as never);

    await get("?ids=u1,u2&search=ali");

    const where = (
      vi.mocked(prisma.user.findMany).mock.calls[0][0] as { where: Record<string, unknown> }
    ).where;
    expect(where.id).toEqual({ in: ["u1", "u2"] });
    expect(where.OR).toBeDefined();
  });
});

describe("GET /api/users course student candidates", () => {
  const candidateQuery =
    "?courseId=c1&exclude=enrolled&page=1&pageSize=25&role=STUDENT&isActive=true&search=ali";

  it("lets a course manager search only active students not already enrolled", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "instructor-1", role: "INSTRUCTOR", email: "instructor@example.com" },
    } as never);
    vi.mocked(resolveCourseAccessGate).mockResolvedValue({
      course: { id: "c1" },
      access: { level: "instructor", rank: 2 },
    } as never);
    mockCandidateTransaction([{ id: "u1", name: "Student One", email: "s1@example.com" }]);

    expect((await get(candidateQuery)).status).toBe(200);

    const where = (vi.mocked(prisma.user.findMany).mock.calls[0][0] as {
      where: Record<string, unknown>;
    }).where;
    expect(where).toMatchObject({
      role: { in: ["STUDENT"] },
      isActive: true,
      enrollments: { none: { courseId: "c1", isActive: true } },
      OR: [
        { name: { contains: "ali", mode: "insensitive" } },
        { email: { contains: "ali", mode: "insensitive" } },
      ],
    });
  });

  it("returns only the candidate fields for a course-scoped search", async () => {
    vi.mocked(resolveCourseAccessGate).mockResolvedValue({
      course: { id: "c1" },
      access: { level: "instructor", rank: 2 },
    } as never);
    mockCandidateTransaction([{ id: "u1", name: "Student One", email: "s1@example.com" }], 1);

    const response = await get(
      "?courseId=c1&exclude=enrolled&page=1&pageSize=25&role=STUDENT&isActive=true",
    );
    expect(await body(response)).toEqual({
      data: [{ id: "u1", name: "Student One", email: "s1@example.com" }],
      page: 1,
      pageSize: 25,
      total: 1,
    });
  });

  it("never runs the admin-shaped query for a courseId request — narrow select, no admin transaction", async () => {
    vi.mocked(resolveCourseAccessGate).mockResolvedValue({
      course: { id: "c1" },
      access: { level: "instructor", rank: 2 },
    } as never);
    mockCandidateTransaction([{ id: "u1", name: "Student One", email: "s1@example.com" }], 1);

    const response = await get(
      "?courseId=c1&exclude=enrolled&page=1&pageSize=25&role=STUDENT&isActive=true",
    );

    // The $transaction call is the narrow [count, findMany] pair only — no
    // platform-wide count()/isActive-count()/role-breakdown queries mixed in.
    const transactionArg = vi.mocked(prisma.$transaction).mock.calls[0][0] as unknown as unknown[];
    expect(transactionArg).toHaveLength(2);

    // The findMany's `select` — what Prisma is actually asked to load — must
    // be exactly the candidate-picker fields. No `stats`, `taCourseIds`,
    // `authorizedUnits`, `role`, `isActive`, `emailVerified`, `_count`, or any
    // other admin-only field or relation count may appear here, since those
    // leak the moment they're selected regardless of what the mapped response
    // later omits.
    const findManyArgs = vi.mocked(prisma.user.findMany).mock.calls[0][0] as {
      select?: Record<string, unknown>;
    };
    expect(findManyArgs.select).toEqual({ id: true, name: true, email: true });

    // The raw response body itself carries no admin metadata either.
    const payload = await body(response);
    expect(payload).toEqual({
      data: [{ id: "u1", name: "Student One", email: "s1@example.com" }],
      page: 1,
      pageSize: 25,
      total: 1,
    });
    expect(payload).not.toHaveProperty("stats");
    expect(payload.data[0]).not.toHaveProperty("taCourseIds");
    expect(payload.data[0]).not.toHaveProperty("authorizedUnits");
    expect(payload.data[0]).not.toHaveProperty("_count");
    expect(payload.data[0]).not.toHaveProperty("role");
    expect(payload.data[0]).not.toHaveProperty("isActive");
  });

  it("does not turn the endpoint into a general user directory for instructors", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "instructor-1", role: "INSTRUCTOR", email: "instructor@example.com" },
    } as never);

    expect((await get("?page=1&pageSize=25&role=STUDENT")).status).toBe(403);
  });

  it("requires the candidate mode to request active students", async () => {
    mockPagedTransaction();

    const response = await get("?courseId=c1&exclude=enrolled&page=1&pageSize=25&role=STUDENT");

    expect(response.status).toBe(400);
    expect(JSON.stringify(await body(response))).toContain("COURSE_CANDIDATES_REQUIRE_ACTIVE_STUDENTS");
  });
});
