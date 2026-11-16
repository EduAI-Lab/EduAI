import type { LoaderFunctionArgs } from "react-router";

import { loadAdminNavCounts } from "~/lib/admin/nav-counts.server";
import { requireAdmin } from "~/lib/auth/guards.server";

/**
 * GET /api/admin/nav-counts — the Administration menu's badge counts
 * (unhandled bug reports, pending invitations). Fetched only on admin pages.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const { response: adminGuard } = await requireAdmin(request);
  if (adminGuard) return adminGuard;
  return Response.json(await loadAdminNavCounts());
}
