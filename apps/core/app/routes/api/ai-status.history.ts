import type { LoaderFunctionArgs } from "react-router";
import { resolveLoadThresholds } from "~/lib/ai/service-status.server";
import { MAX_WINDOW_HOURS, retentionDays } from "~/lib/ai/status/config.server";
import { bucketSamples } from "~/lib/ai/status/history.server";
import { resolveStatusHosts } from "~/lib/ai/status/hosts.server";
import { getRequestSession } from "~/lib/auth/request-session.server";
import { withErrorResponse } from "~/lib/errors.server";
import prisma from "~/lib/prisma.server";

const DEFAULT_WINDOW_HOURS = 72;

/**
 * GET /api/ai-status/history?hours=72 — per-model uptime history for the status
 * panel (#764 follow-on). Same auth as /api/ai-status: any signed-in user, and
 * the payload carries only labels and states, never hostnames or fleet ids.
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

      const requested = Number(new URL(request.url).searchParams.get("hours"));
      const asked = Number.isFinite(requested) && requested > 0 ? requested : DEFAULT_WINDOW_HOURS;
      // Clamp to the retention actually in force, and report what was applied,
      // so a short retention reads as configuration rather than as downtime.
      const windowHours = Math.min(asked, MAX_WINDOW_HOURS, retentionDays() * 24);

      const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);
      const samples = await prisma.aiServiceSample.findMany({
        where: { observedAt: { gte: since } },
        orderBy: { observedAt: "asc" },
        select: {
          serverId: true,
          modelId: true,
          state: true,
          reachable: true,
          waiting: true,
          cacheUsage: true,
          intervalMinutes: true,
          observedAt: true,
        },
      });

      const payload = bucketSamples(samples, {
        windowHours,
        now: new Date(),
        thresholds: resolveLoadThresholds(),
        liveServerIds: resolveStatusHosts().map((h) => h.serverId),
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
