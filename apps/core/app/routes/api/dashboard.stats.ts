import type { LoaderFunctionArgs } from "react-router";
import { computeDashboardStats } from "~/lib/dashboard/dashboard-data.server";
import { getRequestSession } from "~/lib/auth/request-session.server";

/**
 * GET /api/dashboard/stats — role-scoped dashboard statistics.
 *
 * The dashboard itself now resolves these in its SSR loader (#1220); this route
 * remains for any other client caller. The computation lives in
 * `lib/dashboard/dashboard-data.server.ts` so both paths share one source.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getRequestSession(request);
  if (!session?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const stats = await computeDashboardStats(session.user);

  return new Response(JSON.stringify(stats), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
