import type { LoaderFunctionArgs } from "react-router";
import { getAiServiceStatus } from "~/lib/ai/service-status.server";
import { getRequestSession } from "~/lib/auth/request-session.server";

/**
 * Dual AI-service status for the header indicators (issue #764). Auth-gated but
 * available to any signed-in user — it exposes only up/down state, no secrets —
 * so students can also see at a glance whether the AI is live.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getRequestSession(request);
  if (!session?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const status = await getAiServiceStatus();
  return new Response(JSON.stringify(status), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      // Let the browser reuse the response for a few seconds between polls.
      "Cache-Control": "private, max-age=15",
    },
  });
}
