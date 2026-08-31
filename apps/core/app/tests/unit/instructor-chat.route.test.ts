// @vitest-environment node
//
// #1659 review: the /instructor/chat loader must list EXACTLY the courses a
// dual-role caller (ADMIN, or in-unit UNIT_ADMIN) would also pass the
// /api/chat instructor-mode guard for. That guard (course-access.server.ts's
// resolveAccess) decides access by PLATFORM role first — every ADMIN gets
// `admin`-level access and every in-unit UNIT_ADMIN gets `unit`-level access,
// regardless of a real INSTRUCTOR enrollment, since enrollment is only
// consulted once neither short-circuit applies. A loader keyed on a raw
// enrollment lookup alone would list a course here that the guard then always
// 403s on every turn — these tests pin the fix that keeps the two in
// lockstep.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/prisma.server", () => ({
  default: {
    course: { findMany: vi.fn() },
    aIModel: { findMany: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));

import { loader } from "~/routes/instructor.chat";
import { auth } from "~/lib/auth/server";
import prisma from "~/lib/prisma.server";

function makeArgs(url = "http://localhost/instructor/chat") {
  return {
    request: new Request(url),
    params: {},
    context: {} as never,
  } as never;
}

const COURSE_ROW = {
  id: "course-1",
  code: "COSC 121",
  name: "Intro to CS",
  startDate: new Date("2026-01-01T12:00:00Z"),
  section: "001",
  department: "COSC",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.aIModel.findMany).mockResolvedValue([]);
});

describe("instructor.chat loader auth (#1659)", () => {
  it("redirects anonymous callers to /auth/login", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    const res = (await loader(makeArgs())) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/auth/login");
  });
});

describe("instructor.chat loader — dual-role visibility matches the /api/chat guard (#1659 review)", () => {
  it("never lists any course for an ADMIN, even one with a real INSTRUCTOR enrollment — resolveAccess always resolves ADMIN to admin-level, never instructor-level", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "admin-1", role: "ADMIN" },
    } as never);

    const res = (await loader(makeArgs())) as Response;

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/dashboard");
    // The ADMIN short-circuit must never even issue the enrollment query.
    expect(prisma.course.findMany).not.toHaveBeenCalled();
  });

  it("excludes an in-unit UNIT_ADMIN's course from the dropdown — resolveAccess resolves that course to unit-level, never instructor-level, for them", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "ua-1", role: "UNIT_ADMIN", authorizedUnits: ["COSC"] },
    } as never);
    vi.mocked(prisma.course.findMany).mockResolvedValue([COURSE_ROW] as never);

    const res = (await loader(makeArgs())) as Response;

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/dashboard");
  });

  it("still lists a UNIT_ADMIN's course OUTSIDE their authorized units — resolveAccess falls through to their real INSTRUCTOR enrollment there", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "ua-1", role: "UNIT_ADMIN", authorizedUnits: ["MATH"] },
    } as never);
    vi.mocked(prisma.course.findMany).mockResolvedValue([COURSE_ROW] as never);

    const result = await loader(makeArgs());

    expect(result).toMatchObject({
      courses: [{ id: "course-1", code: "COSC 121", name: "Intro to CS" }],
    });
  });

  it("lists a plain INSTRUCTOR's own course — the common, non-dual-role case", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "instr-1", role: "INSTRUCTOR" },
    } as never);
    vi.mocked(prisma.course.findMany).mockResolvedValue([COURSE_ROW] as never);

    const result = await loader(makeArgs());

    expect(result).toMatchObject({
      courses: [{ id: "course-1", code: "COSC 121", name: "Intro to CS" }],
    });
  });

  it("labels duplicate-code offerings with the full start date + section so the id-keyed selector stays distinguishable (#1659 review)", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "instr-1", role: "INSTRUCTOR" },
    } as never);
    vi.mocked(prisma.course.findMany).mockResolvedValue([
      COURSE_ROW,
      {
        ...COURSE_ROW,
        id: "course-2",
        startDate: new Date("2026-09-01T12:00:00Z"),
        section: "002",
      },
    ] as never);

    const result = (await loader(makeArgs())) as {
      courses: Array<{ id: string; code: string; name: string; label?: string }>;
    };

    expect(result.courses).toEqual([
      {
        id: "course-1",
        code: "COSC 121",
        name: "Intro to CS",
        label: "COSC 121 — Jan 1, 2026 Sec 001",
      },
      {
        id: "course-2",
        code: "COSC 121",
        name: "Intro to CS",
        label: "COSC 121 — Sep 1, 2026 Sec 002",
      },
    ]);
  });

  // #1666 review: a calendar-year-only label collapsed two same-code,
  // same-section offerings that start on different dates in the same year
  // (e.g. a Spring and Fall re-run) back into identical text. The selector
  // was still safely id-keyed, but an instructor had no way to tell the rows
  // apart before clicking.
  it("distinguishes same-code, same-section offerings that start on different dates within the same year (#1666 review)", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "instr-1", role: "INSTRUCTOR" },
    } as never);
    vi.mocked(prisma.course.findMany).mockResolvedValue([
      { ...COURSE_ROW, startDate: new Date("2026-01-05T00:00:00Z") },
      { ...COURSE_ROW, id: "course-2", startDate: new Date("2026-09-08T00:00:00Z") },
    ] as never);

    const result = (await loader(makeArgs())) as {
      courses: Array<{ id: string; code: string; name: string; label?: string }>;
    };

    expect(result.courses[0].label).toBe("COSC 121 — Jan 5, 2026 Sec 001");
    expect(result.courses[1].label).toBe("COSC 121 — Sep 8, 2026 Sec 001");
    expect(result.courses[0].label).not.toBe(result.courses[1].label);
  });
});
