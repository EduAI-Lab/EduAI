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

  it("returns the user when no role is required", async () => {
    vi.mocked(api.me).mockResolvedValue({
      user: { id: "1", name: "A", email: "a@x.com", role: "STUDENT" },
    } as never);
    const user = await requireClientUser();
    expect(user).toEqual({ id: "1", name: "A", email: "a@x.com", role: "STUDENT" });
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

  it("redirects instead of rendering a loader error when the API reports a 401", async () => {
    vi.mocked(api.me).mockRejectedValue(new Error("Authentication required"));

    await expect(requireClientUser()).rejects.toMatchObject({ status: 302 });
  });

  it("allows a user whose role matches a single required role", async () => {
    vi.mocked(api.me).mockResolvedValue({
      user: { id: "1", name: "A", email: "a@x.com", role: "INSTRUCTOR" },
    } as never);
    const user = await requireClientUser("INSTRUCTOR");
    expect(user.role).toBe("INSTRUCTOR");
  });

  // A wrong role used to redirect to "/", which silently dropped the reader on
  // the dashboard with no explanation. It is now a 404, rendered by the route's
  // ErrorBoundary as the generic not-found page — which also avoids confirming
  // that a page exists to someone who may not open it.
  it("404s when the role does not match a single required role", async () => {
    vi.mocked(api.me).mockResolvedValue({
      user: { id: "student-1", name: "Student", role: "STUDENT" },
    } as never);

    await expect(requireClientUser("INSTRUCTOR")).rejects.toMatchObject({ status: 404 });
  });

  it("allows a user whose role is in a required-role array", async () => {
    vi.mocked(api.me).mockResolvedValue({
      user: { id: "1", name: "A", email: "a@x.com", role: "TA" },
    } as never);
    const user = await requireClientUser(["INSTRUCTOR", "TA"]);
    expect(user.role).toBe("TA");
  });

  it("404s an authenticated user whose role is not in a required-role array", async () => {
    vi.mocked(api.me).mockResolvedValue({
      user: { id: "student-1", name: "Student", role: "STUDENT" },
    } as never);

    await expect(requireClientUser(["INSTRUCTOR", "TA"])).rejects.toMatchObject({ status: 404 });
  });
});
