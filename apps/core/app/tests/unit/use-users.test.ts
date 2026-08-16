import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/hooks/api/config", () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from "~/hooks/api/config";
import type { PlatformUser } from "~/hooks/api/types";
import { fetchUsersByIds, useUsers } from "~/hooks/api/use-users";

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

  it("surfaces a failed list read as an error", async () => {
    vi.mocked(apiFetch).mockRejectedValueOnce(new Error("boom"));

    const { result } = renderHook(() => useUsers());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe("boom");
    expect(result.current.users).toEqual([]);
  });

  it("falls back to a generic message when the thrown value is not an Error", async () => {
    vi.mocked(apiFetch).mockRejectedValueOnce("socket hangup");

    const { result } = renderHook(() => useUsers());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe("Failed to fetch users");
  });

  it("createUser POSTs then refetches", async () => {
    const page = (rows: PlatformUser[]) => ({
      data: rows,
      total: rows.length,
      page: 1,
      pageSize: 25,
      stats: { total: rows.length, active: rows.length },
    });

    vi.mocked(apiFetch)
      .mockResolvedValueOnce(page([]))
      .mockResolvedValueOnce(user)
      .mockResolvedValueOnce(page([user]));

    const { result } = renderHook(() => useUsers());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.createUser({
        email: user.email,
        name: user.name,
        role: "STUDENT",
      } as never);
    });

    expect(apiFetch).toHaveBeenNthCalledWith(2, "/api/users", {
      method: "POST",
      body: JSON.stringify({ email: user.email, name: user.name, role: "STUDENT" }),
    });
    expect(result.current.users).toEqual([user]);
  });

  it("deleteUser DELETEs then refetches", async () => {
    const page = (rows: PlatformUser[]) => ({
      data: rows,
      total: rows.length,
      page: 1,
      pageSize: 25,
      stats: { total: rows.length, active: rows.length },
    });

    vi.mocked(apiFetch)
      .mockResolvedValueOnce(page([user]))
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(page([]));

    const { result } = renderHook(() => useUsers());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.deleteUser(user.id);
    });

    expect(apiFetch).toHaveBeenNthCalledWith(2, "/api/users/" + user.id, { method: "DELETE" });
    expect(result.current.users).toEqual([]);
  });

  it("toggleUserActive flips isActive via updateUser", async () => {
    const page = (rows: PlatformUser[]) => ({
      data: rows,
      total: rows.length,
      page: 1,
      pageSize: 25,
      stats: { total: rows.length, active: rows.length },
    });
    const deactivated = { ...user, isActive: false };

    vi.mocked(apiFetch)
      .mockResolvedValueOnce(page([user]))
      .mockResolvedValueOnce(deactivated)
      .mockResolvedValueOnce(page([deactivated]));

    const { result } = renderHook(() => useUsers());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.toggleUserActive(user);
    });

    expect(apiFetch).toHaveBeenNthCalledWith(2, "/api/users/" + user.id, {
      method: "PATCH",
      body: JSON.stringify({ isActive: false }),
    });
    expect(result.current.users).toEqual([deactivated]);
  });
});

describe("fetchUsersByIds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mkUser = (id: string): PlatformUser => ({ ...user, id, email: `${id}@example.com` });
  const idPage = (rows: PlatformUser[]) => ({
    data: rows,
    total: rows.length,
    page: 1,
    pageSize: 200,
  });

  it("returns [] without a request for an empty id set", async () => {
    const result = await fetchUsersByIds([]);
    expect(result).toEqual([]);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("chunks id sets larger than the server cap (200) into multiple requests", async () => {
    // #1125: `?ids=` is capped at 200 server-side; a 250-id caller must be
    // chunked here or it 400s with IDS_TOO_MANY.
    const ids = Array.from({ length: 250 }, (_, i) => `u${i}`);
    const firstChunk = ids.slice(0, 200).map(mkUser);
    const secondChunk = ids.slice(200).map(mkUser);

    vi.mocked(apiFetch)
      .mockResolvedValueOnce(idPage(firstChunk))
      .mockResolvedValueOnce(idPage(secondChunk));

    const result = await fetchUsersByIds(ids);

    expect(apiFetch).toHaveBeenCalledTimes(2);
    expect(apiFetch).toHaveBeenNthCalledWith(1, `/api/users?ids=${ids.slice(0, 200).join("%2C")}`);
    expect(apiFetch).toHaveBeenNthCalledWith(2, `/api/users?ids=${ids.slice(200).join("%2C")}`);
    expect(result).toHaveLength(250);
    expect(result[249]?.id).toBe("u249");
  });

  it("de-duplicates ids before chunking", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(idPage([mkUser("a")]));

    await fetchUsersByIds(["a", "a", "a"]);

    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch).toHaveBeenCalledWith("/api/users?ids=a");
  });
});
