/**
 * Unit tests for `topicsService` (#1546): read-only sync-status wrapper.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();

vi.mock("../../services/api", () => ({
  default: { get: (...args: unknown[]) => get(...args) },
}));

import { topicsService } from "../../services/topicsService";

afterEach(() => {
  vi.clearAllMocks();
});

describe("topicsService.getSyncStatus", () => {
  it("fetches the sync status for a course and unwraps data", async () => {
    const status = {
      inSync: true,
      localCount: 3,
      coreCount: 3,
      lastSyncedAt: "2026-01-01T00:00:00.000Z",
    };
    get.mockResolvedValue({ data: { data: status } });

    const result = await topicsService.getSyncStatus(42);

    expect(get).toHaveBeenCalledWith("/api/topics/sync-status/42");
    expect(result).toEqual(status);
  });

  it("propagates errors from the request", async () => {
    get.mockRejectedValue(new Error("boom"));
    await expect(topicsService.getSyncStatus(1)).rejects.toThrow("boom");
  });
});
