import type { LoaderFunctionArgs } from "react-router";
import { auth } from "~/lib/auth/server";
import { jsonResponse } from "~/lib/api/json-response.server";
import { requireServiceKey } from "~/lib/auth/guards.server";
import prisma from "~/lib/prisma.server";
import { getQueuePosition } from "~/lib/queue/queue-stats.server";
import { serializeAiJob } from "~/lib/queue/serialize.server";

/**
 * Return the caller's durable AI-job snapshot. Queue position is deliberately
 * recomputed from Postgres for every read so a status poll reflects jobs that
 * have drained since enqueue and remains correct after a Redis restart.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const session = await auth.api.getSession({ headers: request.headers });
  let userId = session?.user?.id;

  // The enqueue producer is also callable by Question Maker through the
  // existing service-key path. Those jobs are created under the synthetic
  // `service` user, so allow that same authenticated caller to poll them.
  if (!userId) {
    const serviceKeyError = await requireServiceKey(request);
    if (serviceKeyError) return serviceKeyError;
    userId = "service";
  }

  const jobId = params.jobId;
  if (!jobId) {
    return jsonResponse({ error: "Job ID is required" }, 400);
  }

  try {
    const job = await prisma.aiJob.findFirst({
      where: { id: jobId, userId },
    });
    if (!job) {
      return jsonResponse({ error: "AI job not found" }, 404);
    }

    const queuePosition = await getQueuePosition(job);
    return jsonResponse({ job: serializeAiJob(job, { queuePosition }) });
  } catch (error) {
    console.error("[ai-job] GET failed:", error);
    return jsonResponse({ error: "Unexpected server error" }, 500);
  }
}
