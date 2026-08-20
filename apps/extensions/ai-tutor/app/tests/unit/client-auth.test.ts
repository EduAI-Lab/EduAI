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

  it("redirects an authenticated user whose role is not allowed", async () => {
    vi.mocked(api.me).mockResolvedValue({
      user: { id: "student-1", name: "Student", role: "STUDENT" },
    } as never);

    await expect(requireClientUser(["INSTRUCTOR"])).rejects.toMatchObject({ status: 302 });
  });
});
