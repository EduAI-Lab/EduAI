import { useCallback, useEffect, useMemo, useState } from "react";

import { apiFetch } from "~/hooks/api/config";
import {
  DEFAULT_PAGE_SIZE,
  MAX_IDS_PER_REQUEST,
  paginationQuery,
  type PaginatedResponse,
  type PaginationState,
} from "~/hooks/api/pagination";
import type {
  CreateUserInput,
  PlatformUser,
  UpdateUserInput,
} from "~/hooks/api/types";

/** Sort fields accepted by `GET /api/users`. */
export type UserSortField =
  | "name"
  | "email"
  | "role"
  | "isActive"
  | "emailVerified"
  | "createdAt"
  | "updatedAt";

/**
 * Everything `GET /api/users` needs. The users table owns this state (it is
 * where the controls live) and hands it down; the hook only fetches.
 */
export type UsersQuery = {
  pagination: PaginationState;
  search: string;
  roles: string[];
  /** `null` means "both active and inactive". */
  isActive: boolean | null;
  sortBy: UserSortField;
  sortDir: "asc" | "desc";
};

export const defaultUsersQuery = (pageSize = DEFAULT_PAGE_SIZE): UsersQuery => ({
  pagination: { pageIndex: 0, pageSize },
  search: "",
  roles: [],
  isActive: null,
  sortBy: "name",
  sortDir: "asc",
});

export type UserStats = {
  total: number;
  active: number;
  /** Platform-wide count per role, for dashboard breakdowns. */
  byRole: Record<string, number>;
};

type UsersResponse = PaginatedResponse<PlatformUser> & { stats: UserStats };

export type UseUsersOptions = {
  /** Rows per request. Callers that only need `stats` should pass 1. */
  pageSize?: number;
};

/**
 * Server-paginated user list (#1041).
 *
 * `/api/users` requires `page`/`pageSize`, so the hook never holds more than one
 * page. `total` reflects the current filters; `stats` are platform-wide and
 * deliberately do not move as the admin searches.
 */
export function useUsers(options: UseUsersOptions = {}) {
  const initialQuery = useMemo(
    () => defaultUsersQuery(options.pageSize),
    [options.pageSize],
  );
  const [query, setQuery] = useState<UsersQuery>(initialQuery);

  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<UserStats>({ total: 0, active: 0, byRole: {} });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const search = paginationQuery(query.pagination, {
        search: query.search,
        role: query.roles.join(","),
        isActive: query.isActive === null ? undefined : String(query.isActive),
        sortBy: query.sortBy,
        sortDir: query.sortDir,
      });
      const response = await apiFetch<UsersResponse>(`/api/users?${search}`);
      setUsers(response.data);
      setTotal(response.total);
      setStats(response.stats);
    } catch (err) {
      console.error("Failed to fetch users:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch users");
    }
  }, [query]);

  useEffect(() => {
    void (async () => {
      await refresh();
      setIsLoading(false);
    })();
  }, [refresh]);

  const createUser = useCallback(
    async (data: CreateUserInput) => {
      await apiFetch<PlatformUser>("/api/users", {
        method: "POST",
        body: JSON.stringify(data),
      });
      await refresh();
    },
    [refresh],
  );

  const updateUser = useCallback(
    async (id: string, data: UpdateUserInput) => {
      await apiFetch<PlatformUser>(`/api/users/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
      await refresh();
    },
    [refresh],
  );

  const deleteUser = useCallback(
    async (id: string) => {
      await apiFetch<void>(`/api/users/${id}`, { method: "DELETE" });
      await refresh();
    },
    [refresh],
  );

  const toggleUserActive = useCallback(
    async (user: PlatformUser) => {
      await updateUser(user.id, { isActive: !user.isActive });
    },
    [updateUser],
  );

  return {
    users,
    total,
    stats,
    query,
    setQuery,
    isLoading,
    error,
    refresh,
    createUser,
    updateUser,
    deleteUser,
    toggleUserActive,
  };
}

/**
 * Resolve a known set of users by id via the unpaged `?ids=` lookup (#1125).
 *
 * Callers that previously fetched the whole table to build an id→user map use
 * this instead; under required paging that map could otherwise only be built by
 * page-looping.
 *
 * `?ids=` is capped server-side at {@link MAX_IDS_PER_REQUEST}, so callers with
 * a larger set (e.g. a course with >200 enrollments) are chunked here rather
 * than tripping `IDS_TOO_MANY`.
 */
export async function fetchUsersByIds(ids: string[]): Promise<PlatformUser[]> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return [];

  const users: PlatformUser[] = [];
  for (let start = 0; start < unique.length; start += MAX_IDS_PER_REQUEST) {
    const chunk = unique.slice(start, start + MAX_IDS_PER_REQUEST);
    const params = new URLSearchParams({ ids: chunk.join(",") });
    const response = await apiFetch<PaginatedResponse<PlatformUser>>(`/api/users?${params}`);
    users.push(...response.data);
  }
  return users;
}
