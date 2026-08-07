// @vitest-environment node
// #1213 — dashboard.tsx loader: auth gate, onboarding redirect passthrough,
// and the TA-enrollment lookup that flips isTA.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/prisma.server", () => ({
  default: {
    enrollment: { count: vi.fn().mockResolvedValue(0) },
  },
}));

vi.mock("~/lib/canvas/onboarding.server", () => ({
  redirectToStudentIdOnboardingIfNeeded: vi.fn().mockResolvedValue(null),
}));

// The dashboard's data now resolves in this loader (#1220); its own reads are
// covered by dashboard-data.server.test.ts, so stub it out here to keep these
// cases on the auth gate, the onboarding passthrough, and the isTA lookup.
vi.mock("~/lib/dashboard/dashboard-data.server", () => ({
  loadDashboardData: vi.fn(),
}));

import { loader } from "~/routes/dashboard";
import { auth } from "~/lib/auth/server";
import prisma from "~/lib/prisma.server";
import { redirectToStudentIdOnboardingIfNeeded } from "~/lib/canvas/onboarding.server";
import { loadDashboardData } from "~/lib/dashboard/dashboard-data.server";

const DASHBOARD = { stats: {}, recentChats: [], courses: [], courseTotal: 0 };

function makeArgs() {
  return {
    request: new Request("http://localhost/dashboard"),
    params: {},
    context: {} as never,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(redirectToStudentIdOnboardingIfNeeded).mockResolvedValue(null);
  vi.mocked(prisma.enrollment.count).mockResolvedValue(0);
  vi.mocked(loadDashboardData).mockResolvedValue(DASHBOARD as never);
});

describe("dashboard loader", () => {
  it("redirects anonymous callers to /auth/login", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    const res = (await loader(makeArgs())) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/auth/login");
  });

  it("passes through the student-id onboarding redirect when needed", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "STUDENT" },
    } as never);
    const onboardingRedirect = new Response(null, {
      status: 302,
      headers: { Location: "/onboarding/student-id" },
    });
    vi.mocked(redirectToStudentIdOnboardingIfNeeded).mockResolvedValue(onboardingRedirect as never);

    const result = await loader(makeArgs());
    expect(result).toBe(onboardingRedirect);
    expect(prisma.enrollment.count).not.toHaveBeenCalled();
    expect(loadDashboardData).not.toHaveBeenCalled();
  });

  it("marks a STUDENT with an active TA enrollment as isTA", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "STUDENT" },
    } as never);
    vi.mocked(prisma.enrollment.count).mockResolvedValue(1);

    const result = await loader(makeArgs());
    expect(result).toEqual({
      user: { id: "u1", role: "STUDENT" },
      isTA: true,
      dashboard: DASHBOARD,
    });
  });

  it("does not check TA enrollment for non-STUDENT roles", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "admin-1", role: "ADMIN" },
    } as never);

    const result = await loader(makeArgs());
    expect(result).toEqual({
      user: { id: "admin-1", role: "ADMIN" },
      isTA: false,
      dashboard: DASHBOARD,
    });
    expect(prisma.enrollment.count).not.toHaveBeenCalled();
  });
});
