import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/hooks/api/config", () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from "~/hooks/api/config";
import type { PlatformUser } from "~/hooks/api/types";
import { useUsers } from "~/hooks/api/use-users";

const user = {
  id: "student-1",
  email: "student@example.com",
  name: "Student User",
  role: "STUDENT",
  isActive: true,
  emailVerified: true,
  authorizedUnits: [],
  taCourseIds: ["course-1"],
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
  _count: {
    enrolledCourses: 0,
    assistedCourses: 1,
    taughtCourses: 0,
    aiInteractions: 0,
  },
} satisfies PlatformUser;

const LIST_URL = "/api/users?page=1&pageSize=25&sortBy=name&sortDir=asc";

describe("useUsers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("performs the single users refresh after a successful update", async () => {
    const updatedUser = {
      ...user,
      taCourseIds: ["course-2"],
      _count: { ...user._count, assistedCourses: 1 },
    } satisfies PlatformUser;

    const page = (rows: PlatformUser[]) => ({
      data: rows,
      total: rows.length,
      page: 1,
      pageSize: 25,
      stats: { total: rows.length, active: rows.length },
    });

    vi.mocked(apiFetch)
      .mockResolvedValueOnce(page([user]))
      .mockResolvedValueOnce(updatedUser)
      .mockResolvedValueOnce(page([updatedUser]));

    const { result } = renderHook(() => useUsers());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.updateUser(user.id, { taCourseIds: ["course-2"] });
    });

    expect(apiFetch).toHaveBeenCalledTimes(3);
    // #1041: paging params are required and always present on the list read.
    expect(apiFetch).toHaveBeenNthCalledWith(1, LIST_URL);
    expect(apiFetch).toHaveBeenNthCalledWith(2, "/api/users/" + user.id, {
      method: "PATCH",
      body: JSON.stringify({ taCourseIds: ["course-2"] }),
    });
    expect(apiFetch).toHaveBeenNthCalledWith(3, LIST_URL);
    expect(result.current.users).toEqual([updatedUser]);
  });
});
