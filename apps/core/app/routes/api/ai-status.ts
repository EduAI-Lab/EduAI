import type { LoaderFunctionArgs } from "react-router";
import { auth } from "~/lib/auth/server";
import { getAiServiceStatus } from "~/lib/ai/service-status.server";

/**
 * Dual AI-service status for the header indicators (issue #764). Auth-gated but
 * available to any signed-in user — it exposes only up/down state, no secrets —
 * so students can also see at a glance whether the AI is live.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const session = await auth.api.getSession({ headers: request.headers });
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
