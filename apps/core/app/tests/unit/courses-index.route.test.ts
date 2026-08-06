// @vitest-environment node
// #1213 — courses.tsx loader: auth gate, parallel authorizedUnits/instructors/
// enrollment reads gated by role, and the TA/enrolled course id split (#499).
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/prisma.server", () => ({
  default: {
    user: { findUnique: vi.fn(), findMany: vi.fn() },
    enrollment: { findMany: vi.fn() },
  },
}));

import { loader } from "~/routes/courses";
import { auth } from "~/lib/auth/server";
import prisma from "~/lib/prisma.server";

function makeArgs() {
  return {
    request: new Request("http://localhost/courses"),
    params: {},
    context: {} as never,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
  vi.mocked(prisma.user.findMany).mockResolvedValue([]);
  vi.mocked(prisma.enrollment.findMany).mockResolvedValue([]);
});

describe("courses loader", () => {
  it("redirects anonymous callers to /auth/login", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    const res = (await loader(makeArgs())) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/auth/login");
  });

  it("skips the authorizedUnits and instructor reads for a plain STUDENT", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "STUDENT" },
    } as never);

    const result = await loader(makeArgs());
    expect(result).toMatchObject({ authorizedUnits: [], instructors: [] });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it("splits enrollment rows into TA and enrolled course id lists (#499)", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "STUDENT" },
    } as never);
    vi.mocked(prisma.enrollment.findMany).mockResolvedValue([
      { courseId: "course-ta", role: "TA" },
      { courseId: "course-student", role: "STUDENT" },
    ] as never);

    const result = (await loader(makeArgs())) as {
      taCourseIds: string[];
      enrolledCourseIds: string[];
    };
    expect(result.taCourseIds).toEqual(["course-ta"]);
    expect(result.enrolledCourseIds).toEqual(["course-student"]);
  });

  it("loads authorizedUnits and the instructor list for a UNIT_ADMIN", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "ua-1", role: "UNIT_ADMIN" },
    } as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ authorizedUnits: ["COSC"] } as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "instructor-1", name: "Prof", email: "prof@ubc.ca" },
    ] as never);

    const result = (await loader(makeArgs())) as {
      authorizedUnits: string[];
      instructors: unknown[];
    };
    expect(result.authorizedUnits).toEqual(["COSC"]);
    expect(result.instructors).toHaveLength(1);
  });

  it("loads the instructor list (but not authorizedUnits) for an ADMIN", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "admin-1", role: "ADMIN" },
    } as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "instructor-1", name: "Prof", email: "prof@ubc.ca" },
    ] as never);

    const result = (await loader(makeArgs())) as {
      authorizedUnits: string[];
      instructors: unknown[];
    };
    expect(result.authorizedUnits).toEqual([]);
    expect(result.instructors).toHaveLength(1);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});
