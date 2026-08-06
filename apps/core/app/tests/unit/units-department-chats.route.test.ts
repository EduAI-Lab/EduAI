// @vitest-environment node
// #1213 — units.$department.chats.tsx loader: auth gate, role gate, the
// UNIT_ADMIN authorizedUnits scoping check, and department-label resolution.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/prisma.server", () => ({
  default: {
    user: { findUnique: vi.fn() },
    discipline: { findUnique: vi.fn() },
  },
}));

import { loader } from "~/routes/units.$department.chats";
import { auth } from "~/lib/auth/server";
import prisma from "~/lib/prisma.server";

function makeArgs(department?: string) {
  return {
    request: new Request("http://localhost/units/COSC/chats"),
    params: department === undefined ? { department: "COSC" } : { department },
    context: {} as never,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.discipline.findUnique).mockResolvedValue(null);
});

describe("units.$department.chats loader", () => {
  it("redirects anonymous callers to /auth/login", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    const res = (await loader(makeArgs())) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/auth/login");
  });

  it("redirects to /courses when the :department param is missing", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "admin-1", role: "ADMIN" },
    } as never);
    const res = (await loader(makeArgs(""))) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/courses");
  });

  it("redirects a STUDENT to /courses?access=denied", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "STUDENT" },
    } as never);
    const res = (await loader(makeArgs())) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/courses?access=denied");
  });

  it("redirects a UNIT_ADMIN not authorized for the department", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "ua-1", role: "UNIT_ADMIN" },
    } as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ authorizedUnits: ["MATH"] } as never);

    const res = (await loader(makeArgs())) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/courses?access=denied");
  });

  it("loads for a UNIT_ADMIN authorized for the department", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "ua-1", role: "UNIT_ADMIN" },
    } as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ authorizedUnits: ["COSC"] } as never);
    vi.mocked(prisma.discipline.findUnique).mockResolvedValue({ name: "Computer Science" } as never);

    const result = await loader(makeArgs());
    expect(result).toEqual({
      user: { id: "ua-1", role: "UNIT_ADMIN" },
      department: "COSC",
      departmentLabel: "Computer Science",
    });
  });

  it("skips the authorizedUnits check entirely for an ADMIN", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "admin-1", role: "ADMIN" },
    } as never);

    await loader(makeArgs());
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("falls back to the raw department code when no Discipline row matches", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "admin-1", role: "ADMIN" },
    } as never);
    vi.mocked(prisma.discipline.findUnique).mockResolvedValue(null);

    const result = (await loader(makeArgs())) as { departmentLabel: string };
    expect(result.departmentLabel).toBe("COSC");
  });
});
