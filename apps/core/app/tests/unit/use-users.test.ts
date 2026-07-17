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

    vi.mocked(apiFetch)
      .mockResolvedValueOnce([user])
      .mockResolvedValueOnce(updatedUser)
      .mockResolvedValueOnce([updatedUser]);

    const { result } = renderHook(() => useUsers());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.updateUser(user.id, { taCourseIds: ["course-2"] });
    });

    expect(apiFetch).toHaveBeenCalledTimes(3);
    expect(apiFetch).toHaveBeenNthCalledWith(1, "/api/users");
    expect(apiFetch).toHaveBeenNthCalledWith(2, "/api/users/" + user.id, {
      method: "PATCH",
      body: JSON.stringify({ taCourseIds: ["course-2"] }),
    });
    expect(apiFetch).toHaveBeenNthCalledWith(3, "/api/users");
    expect(result.current.users).toEqual([updatedUser]);
  });
});
