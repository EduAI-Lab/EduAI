import { useCallback, useEffect, useState } from "react";

import { apiFetch } from "~/hooks/api/config";
import { paginationQuery, type PaginatedResponse } from "~/hooks/api/pagination";
import type { PlatformUser } from "~/hooks/api/types";

/** One row of `GET /api/admin/api-access` (#2039), dates as ISO strings. */
export type ApiAccessGrantRow = {
  id: string;
  userId: string;
  purpose: string;
  expiresAt: string;
  dailyRequestLimit: number;
  dailyTokenLimit: number;
  revokedAt: string | null;
  createdAt: string;
  active: boolean;
  user: { id: string; name: string; email: string; role: string };
  usageLast24h: { requests: number; tokens: number };
};

export type ApiAccessDefaults = {
  dailyRequestLimit: number;
  dailyTokenLimit: number;
  /** The server's caps; a grant above them is refused. */
  maxDailyRequestLimit: number;
  maxDailyTokenLimit: number;
};

export type CreateApiAccessGrantInput = {
  userId: string;
  purpose: string;
  /** ISO date-time. */
  expiresAt: string;
  dailyRequestLimit: number;
  dailyTokenLimit: number;
};

type GrantsResponse = { grants: ApiAccessGrantRow[]; defaults: ApiAccessDefaults };

/** People an admin can grant API access to: active non-admins. */
const GRANTABLE_ROLES = "STUDENT,INSTRUCTOR,UNIT_ADMIN";

/** Grants for the admin API access page, with create and revoke. */
export function useApiAccessGrants() {
  const [includeInactive, setIncludeInactive] = useState(false);
  const [grants, setGrants] = useState<ApiAccessGrantRow[]>([]);
  const [defaults, setDefaults] = useState<ApiAccessDefaults>({
    dailyRequestLimit: 200,
    dailyTokenLimit: 200_000,
    maxDailyRequestLimit: 5_000,
    maxDailyTokenLimit: 5_000_000,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const response = await apiFetch<GrantsResponse>(
        `/api/admin/api-access${includeInactive ? "?all=1" : ""}`,
      );
      setGrants(response.grants);
      setDefaults(response.defaults);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load API access");
    } finally {
      setIsLoading(false);
    }
  }, [includeInactive]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createGrant = useCallback(
    async (input: CreateApiAccessGrantInput) => {
      await apiFetch("/api/admin/api-access", { method: "POST", body: JSON.stringify(input) });
      await refresh();
    },
    [refresh],
  );

  const revokeGrant = useCallback(
    async (grantId: string) => {
      await apiFetch(`/api/admin/api-access/${encodeURIComponent(grantId)}`, {
        method: "DELETE",
      });
      await refresh();
    },
    [refresh],
  );

  return {
    grants,
    defaults,
    includeInactive,
    setIncludeInactive,
    isLoading,
    error,
    refresh,
    createGrant,
    revokeGrant,
  };
}

/** Active non-admins matching `search`, for the grant dialog's person picker. */
export async function searchGrantableUsers(search: string): Promise<PlatformUser[]> {
  const query = paginationQuery(
    { pageIndex: 0, pageSize: 8 },
    { search, role: GRANTABLE_ROLES, isActive: "true", sortBy: "name", sortDir: "asc" },
  );
  const response = await apiFetch<PaginatedResponse<PlatformUser>>(`/api/users?${query}`);
  return response.data;
}

/** One user by id (the users table links here with `?grantFor=<id>`). */
export async function fetchUserById(userId: string): Promise<PlatformUser | null> {
  const response = await apiFetch<PaginatedResponse<PlatformUser>>(
    `/api/users?ids=${encodeURIComponent(userId)}`,
  );
  return response.data[0] ?? null;
}
