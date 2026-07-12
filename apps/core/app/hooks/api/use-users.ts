import { useCallback, useEffect, useState } from "react";

import { apiFetch } from "~/hooks/api/config";
import type {
  CreateUserInput,
  PlatformUser,
  UpdateUserInput,
} from "~/hooks/api/types";

export function useUsers() {
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const data = await apiFetch<PlatformUser[]>("/api/users");
      setUsers(data);
    } catch (err) {
      console.error("Failed to fetch users:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch users");
    }
  }, []);

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
    isLoading,
    error,
    refresh,
    createUser,
    updateUser,
    deleteUser,
    toggleUserActive,
  };
}
