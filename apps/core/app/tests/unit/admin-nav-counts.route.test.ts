// @vitest-environment node
/**
 * GET /api/admin/nav-counts: the Administration menu's badge counts, admins only.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  bugReportCount: vi.fn(),
  invitationCount: vi.fn(),
}));

vi.mock("~/lib/auth/guards.server", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("~/lib/prisma.server", () => ({
  default: {
    bugReport: { count: mocks.bugReportCount },
    invitation: { count: mocks.invitationCount },
  },
}));

import { loader } from "~/routes/api/admin.nav-counts";

const request = () => new Request("http://localhost/api/admin/nav-counts");

describe("GET /api/admin/nav-counts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.bugReportCount.mockResolvedValue(6);
    mocks.invitationCount.mockResolvedValue(3);
  });

  it("returns the unhandled bug report and pending invitation counts", async () => {
    mocks.requireAdmin.mockResolvedValue({ response: null, session: {} });
    const res = await loader({ request: request(), params: {}, context: {} } as never);

    expect(await res.json()).toEqual({ unhandledBugReports: 6, pendingInvitations: 3 });
    expect(mocks.bugReportCount).toHaveBeenCalledWith({ where: { status: "UNHANDLED" } });
    expect(mocks.invitationCount).toHaveBeenCalledWith({
      where: { status: "PENDING", expiresAt: { gt: expect.any(Date) } },
    });
  });

  it("returns the guard's response for a non-admin without counting", async () => {
    const forbidden = new Response(null, { status: 403 });
    mocks.requireAdmin.mockResolvedValue({ response: forbidden });
    const res = await loader({ request: request(), params: {}, context: {} } as never);

    expect(res.status).toBe(403);
    expect(mocks.bugReportCount).not.toHaveBeenCalled();
  });
});
