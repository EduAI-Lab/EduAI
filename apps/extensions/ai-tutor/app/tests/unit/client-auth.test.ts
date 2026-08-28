import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/api", () => ({
  default: { me: vi.fn() },
}));

import api from "~/lib/api";
import { requireClientUser } from "~/lib/client-auth";

describe("requireClientUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("propagates dependency outages instead of converting them to logout redirects", async () => {
    const outage = new Error("Authentication service unavailable");
    vi.mocked(api.me).mockRejectedValue(outage);

    await expect(requireClientUser()).rejects.toBe(outage);
  });

  it("redirects when the API returns no authenticated user", async () => {
    vi.mocked(api.me).mockResolvedValue({ user: null });

    await expect(requireClientUser()).rejects.toMatchObject({ status: 302 });
  });

  // A wrong role used to redirect to "/", which silently dropped the reader on
  // the dashboard with no explanation. It is now a 404, rendered by the route's
  // ErrorBoundary as the generic not-found page — which also avoids confirming
  // that a page exists to someone who may not open it.
  it("404s an authenticated user whose role is not allowed", async () => {
    vi.mocked(api.me).mockResolvedValue({
      user: { id: "student-1", name: "Student", role: "STUDENT" },
    } as never);

    await expect(requireClientUser(["INSTRUCTOR"])).rejects.toMatchObject({ status: 404 });
  });
});
