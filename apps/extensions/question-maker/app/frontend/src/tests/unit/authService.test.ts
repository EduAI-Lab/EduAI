/**
 * Unit tests for `authService` (#1546): thin wrapper around `/api/auth/me`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();

vi.mock("../../services/api", () => ({
  default: { get: (...args: unknown[]) => get(...args) },
}));

import { authService } from "../../services/authService";

afterEach(() => {
  vi.clearAllMocks();
});

describe("authService.getCurrentUser", () => {
  it("fetches the current user and unwraps the user field", async () => {
    get.mockResolvedValue({ data: { user: { id: 1, email: "a@b.com" } } });

    const user = await authService.getCurrentUser();

    expect(get).toHaveBeenCalledWith("/api/auth/me");
    expect(user).toEqual({ id: 1, email: "a@b.com" });
  });

  it("propagates errors from the request", async () => {
    get.mockRejectedValue(new Error("network down"));
    await expect(authService.getCurrentUser()).rejects.toThrow("network down");
  });
});
