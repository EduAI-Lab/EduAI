import type { LoaderFunctionArgs } from "react-router";
import { classifyCloudStatus } from "~/lib/ai/service-status.server";
import { getUbcStatusFromSamples } from "~/lib/ai/status/read.server";
import { getRequestSession } from "~/lib/auth/request-session.server";
import { withErrorResponse } from "~/lib/errors.server";

/**
 * Dual AI-service status for the header indicators (issue #764).
 *
 * The UBC path is read from `ai_service_samples`, written every ~15 minutes by
 * the `ai-status-probe` cron job — NOT probed per request. `checkedAt` and
 * `stale` let the UI say how old the answer is rather than implying it is live.
 *
 * Auth-gated but available to any signed-in user: it exposes only up/down state,
 * no secrets and no internal hostnames.
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

      const cloud = classifyCloudStatus({
        openai: process.env.OPENAI_API_KEY,
        google: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
        openrouter: process.env.OPENROUTER_API_KEY,
      });
      const { status: ubc, checkedAt, stale } = await getUbcStatusFromSamples();

      return new Response(JSON.stringify({ cloud, ubc, checkedAt, stale }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          // The underlying sample only changes when the cron probe runs (~every
          // 15 min), so 30s is generous headroom for a burst of header polls to
          // share one response without ever serving data staler than the source.
          "Cache-Control": "private, max-age=30",
        },
      });
    },
    { request },
  );
}
