import type { LoaderFunctionArgs } from "react-router";
import { loadHistoryPayload } from "~/lib/ai/status/history.server";
import { getRequestSession } from "~/lib/auth/request-session.server";
import { withErrorResponse } from "~/lib/errors.server";

/**
 * GET /api/ai-status/history?hours=72 — per-model uptime history for the status
 * panel (#764 follow-on). Same auth as /api/ai-status: any signed-in user, and
 * the payload carries only labels and states, never hostnames or fleet ids.
 *
 * The read itself lives in `loadHistoryPayload`, shared with the `/status`
 * page loader so the two cannot drift on the window clamp.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  return withErrorResponse(
    async () => {
      const session = await getRequestSession(request);
      if (!session?.user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      const payload = await loadHistoryPayload({
        hours: Number(new URL(request.url).searchParams.get("hours")),
      });

      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "private, max-age=30",
        },
      });
    },
    { request },
  );
}
