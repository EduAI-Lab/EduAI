import { useEffect, useState } from "react";

import { apiFetch } from "~/hooks/api/config";
import type { AdminNavCounts } from "~/lib/admin/nav-counts.server";

/**
 * The Administration menu's badge counts. Fetched again on every admin page
 * change, so triaging a report or cancelling an invitation shows up on the
 * next page. A failed fetch leaves the badges off rather than showing stale
 * or zero counts.
 */
export function useAdminNavCounts(enabled: boolean, pathname: string): AdminNavCounts | null {
  const [counts, setCounts] = useState<AdminNavCounts | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    apiFetch<AdminNavCounts>("/api/admin/nav-counts")
      .then((next) => {
        if (!cancelled) setCounts(next);
      })
      .catch(() => {
        if (!cancelled) setCounts(null);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, pathname]);

  return enabled ? counts : null;
}
