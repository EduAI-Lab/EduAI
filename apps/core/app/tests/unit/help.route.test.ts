// @vitest-environment node
// #1213 — help.tsx loader: unauthenticated → /auth/login, else returns user.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/prisma.server", () => ({
  default: {
    enrollment: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

import { loader } from "~/routes/help";
import { auth } from "~/lib/auth/server";
import prisma from "~/lib/prisma.server";

function makeArgs() {
  return {
    request: new Request("http://localhost/help"),
    params: {},
    context: {} as never,
  } as never;
}

function signInAs(user: { id: string; role: string }) {
  vi.mocked(auth.api.getSession).mockResolvedValue({ user } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.enrollment.findMany).mockResolvedValue([]);
});

describe("help loader", () => {
  it("redirects anonymous callers to /auth/login", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    const res = (await loader(makeArgs())) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/auth/login");
  });

  it("returns the session user when signed in", async () => {
    signInAs({ id: "u1", role: "STUDENT" });
    const result = await loader(makeArgs());
    expect(result).toEqual({
      user: { id: "u1", role: "STUDENT" },
      isTA: false,
      isCourseInstructor: false,
    });
  });

  it("marks a STUDENT with an active TA enrollment as isTA", async () => {
    signInAs({ id: "u1", role: "STUDENT" });
    vi.mocked(prisma.enrollment.findMany).mockResolvedValue([{ role: "TA" }] as never);
    const result = await loader(makeArgs());
    expect(result).toMatchObject({ isTA: true, isCourseInstructor: false });
    expect(prisma.enrollment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "u1", role: { in: ["TA", "INSTRUCTOR"] }, isActive: true },
      }),
    );
  });

  it("marks a STUDENT with an active INSTRUCTOR enrollment as isCourseInstructor", async () => {
    signInAs({ id: "u1", role: "STUDENT" });
    vi.mocked(prisma.enrollment.findMany).mockResolvedValue([{ role: "INSTRUCTOR" }] as never);
    const result = await loader(makeArgs());
    expect(result).toMatchObject({ isTA: false, isCourseInstructor: true });
  });

  it("does not check course enrollments for non-STUDENT roles", async () => {
    signInAs({ id: "admin-1", role: "ADMIN" });
    const result = await loader(makeArgs());
    expect(result).toEqual({
      user: { id: "admin-1", role: "ADMIN" },
      isTA: false,
      isCourseInstructor: false,
    });
    expect(prisma.enrollment.findMany).not.toHaveBeenCalled();
  });
});
