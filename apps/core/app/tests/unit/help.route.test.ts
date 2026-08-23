// @vitest-environment node
// #1213 — help.tsx loader: unauthenticated → /auth/login, else returns user.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/prisma.server", () => ({
  default: {
    enrollment: { count: vi.fn().mockResolvedValue(0) },
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.enrollment.count).mockResolvedValue(0);
});

describe("help loader", () => {
  it("redirects anonymous callers to /auth/login", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    const res = (await loader(makeArgs())) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/auth/login");
  });

  it("returns the session user when signed in", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "STUDENT" },
    } as never);
    const result = await loader(makeArgs());
    expect(result).toEqual({ user: { id: "u1", role: "STUDENT" }, isTA: false });
  });

  it("marks a STUDENT with an active TA enrollment as isTA", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "STUDENT" },
    } as never);
    vi.mocked(prisma.enrollment.count).mockResolvedValue(1);
    const result = await loader(makeArgs());
    expect(result).toEqual({ user: { id: "u1", role: "STUDENT" }, isTA: true });
  });

  it("does not check TA enrollment for non-STUDENT roles", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "admin-1", role: "ADMIN" },
    } as never);
    const result = await loader(makeArgs());
    expect(result).toEqual({ user: { id: "admin-1", role: "ADMIN" }, isTA: false });
    expect(prisma.enrollment.count).not.toHaveBeenCalled();
  });
});
