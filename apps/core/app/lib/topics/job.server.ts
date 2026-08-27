import { createHash } from "node:crypto";

import { fireAndForget, logSystemError } from "~/lib/logging.server";
import prisma from "~/lib/prisma.server";
import { JobPayloadSchema, type JobPayload } from "~/lib/queue/job-schema";
import { runTopicAnalysisCompletion } from "~/lib/topics/completion.server";
import { ensureCourseHasTopic } from "~/lib/topics/fallback.server";
import { provisionCourseTopics, type RunTopicCompletion } from "~/lib/topics/provision.server";

/**
 * Topic analysis runs in-process against a durable `AiJob` row rather than on
 * the BullMQ pool, because that pool is deliberately closed before MVP
 * (`isAiJobQueueEnabled()` is a compile-time `false`, and `assertAiJobQueueEnabled`
 * always throws). This mirrors what material extraction already does for the
 * same reason: the row is the job record, and running it in-process is the
 * delivery mechanism.
 *
 * `queueName` is set to this sentinel so the existing `@@unique([queueName,
 * bullJobId])` index does the idempotency work for free, and so these rows are
 * trivially distinguishable from real queued ones once the pool opens. Moving to
 * BullMQ later means changing where `runTopicAnalysisJob` is called from, not
 * how the row is written.
 */
export const TOPIC_ANALYSIS_QUEUE_NAME = "inline:topic-analysis";

/** `source` recorded on the AiJob row — telemetry only. */
const TOPIC_ANALYSIS_SOURCE = "core:topic-analysis";

/**
 * Derive the idempotency key for a batch of materials.
 *
 * Keyed on content checksums, NOT material ids, and that distinction carries all
 * three of the issue's dedupe requirements at once:
 *
 *   - a retried sync hashes identically, so it reuses the existing job;
 *   - a resync of unchanged material also hashes identically, so it correctly
 *     does no work rather than re-deriving the same topics;
 *   - a material whose content actually changed has a new checksum, so the
 *     batch hashes differently and a fresh job runs.
 *
 * An id-keyed scheme would get the first two right and the third wrong, since a
 * re-imported file keeps its row id.
 */
export function topicAnalysisIdempotencyKey(courseId: string, checksums: string[]): string {
  const digest = createHash("sha256")
    .update([...checksums].sort().join("\n"))
    .digest("hex")
    .slice(0, 32);
  return `topic-analysis:${courseId}:${digest}`;
}

export type StartTopicAnalysisArgs = {
  courseId: string;
  userId: string;
  materialIds: string[];
  canvasCourseId?: string | null;
};

/**
 * Create the durable job row for a batch, or return the existing one.
 *
 * Returns `{ created: false }` when this batch already has a job — that is the
 * "one sync batch does not create duplicate jobs when retried" guarantee, and it
 * is enforced by a unique index rather than by a check, so concurrent syncs
 * cannot both win.
 */
export async function recordTopicAnalysisJob(
  args: StartTopicAnalysisArgs,
): Promise<{ jobId: string; created: boolean } | null> {
  const ready = await prisma.courseMaterial.findMany({
    where: {
      id: { in: args.materialIds },
      courseId: args.courseId,
      status: "READY",
      deletedAt: null,
    },
    select: { id: true, checksum: true },
    orderBy: { id: "asc" },
  });
  if (ready.length === 0) return null;

  const idempotencyKey = topicAnalysisIdempotencyKey(
    args.courseId,
    ready.map((material) => material.checksum),
  );

  const payload: JobPayload = JobPayloadSchema.parse({
    kind: "topic-analysis",
    type: "background",
    source: TOPIC_ANALYSIS_SOURCE,
    userId: args.userId,
    courseId: args.courseId,
    idempotencyKey,
    input: {
      kind: "topic-analysis",
      courseId: args.courseId,
      materialIds: ready.map((material) => material.id),
      canvasCourseId: args.canvasCourseId ?? null,
    },
  });

  try {
    const job = await prisma.aiJob.create({
      data: {
        kind: "topic-analysis",
        type: "background",
        source: TOPIC_ANALYSIS_SOURCE,
        status: "PENDING",
        payload,
        userId: args.userId,
        courseId: args.courseId,
        queueName: TOPIC_ANALYSIS_QUEUE_NAME,
        bullJobId: idempotencyKey,
      },
      select: { id: true },
    });
    return { jobId: job.id, created: true };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const existing = await prisma.aiJob.findUnique({
      where: {
        queueName_bullJobId: { queueName: TOPIC_ANALYSIS_QUEUE_NAME, bullJobId: idempotencyKey },
      },
      select: { id: true },
    });
    return existing ? { jobId: existing.id, created: false } : null;
  }
}

/**
 * Claim a PENDING job. Returns false when another runner already took it, which
 * is what stops a retried sync from provisioning the same topics twice.
 */
async function claimTopicAnalysisJob(jobId: string): Promise<boolean> {
  const { count } = await prisma.aiJob.updateMany({
    where: { id: jobId, status: "PENDING" },
    data: { status: "RUNNING", startedAt: new Date(), attempts: { increment: 1 } },
  });
  return count > 0;
}

/**
 * Run one recorded topic-analysis job to completion, writing its outcome onto
 * the row. The row is the instructor-facing notification, so a failure is
 * recorded as FAILED with its message rather than swallowed.
 */
export async function runTopicAnalysisJob(
  jobId: string,
  runCompletion: RunTopicCompletion = runTopicAnalysisCompletion,
): Promise<void> {
  if (!(await claimTopicAnalysisJob(jobId))) return;

  const row = await prisma.aiJob.findUnique({
    where: { id: jobId },
    select: { payload: true, userId: true },
  });
  if (!row) return;

  const parsed = JobPayloadSchema.safeParse(row.payload);
  if (!parsed.success || parsed.data.input.kind !== "topic-analysis") {
    await failJob(jobId, "Topic analysis job payload is not a topic-analysis payload");
    return;
  }
  const { input } = parsed.data;

  try {
    const result = await provisionCourseTopics({
      courseId: input.courseId,
      materialIds: input.materialIds,
      canvasCourseId: input.canvasCourseId ?? null,
      userId: row.userId,
      jobId,
      runCompletion,
    });

    // The course must be authorable whatever the analysis produced — including
    // when it produced nothing at all.
    await ensureCourseHasTopic(input.courseId);

    await prisma.aiJob.update({
      where: { id: jobId },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        result: {
          kind: "topic-analysis",
          created: result.created,
          createdNames: result.createdNames,
          usedSource: result.usedSource,
          duplicatesSkipped: result.duplicatesSkipped,
        },
      },
    });
  } catch (error) {
    // A failed analysis must still leave the course authorable (#1624: "Question
    // creation remains possible while the background job is pending or failed").
    await ensureCourseHasTopic(input.courseId).catch(() => undefined);
    await failJob(jobId, error instanceof Error ? error.message : "Topic analysis failed");

    fireAndForget(
      logSystemError({
        source: "AI",
        code: "topic_analysis_failed",
        message: `Topic analysis failed for course ${input.courseId}`,
        error,
        actorUserId: row.userId,
        details: { jobId, courseId: input.courseId },
      }),
    );
  }
}

async function failJob(jobId: string, message: string): Promise<void> {
  await prisma.aiJob.update({
    where: { id: jobId },
    data: { status: "FAILED", completedAt: new Date(), errorMessage: message.slice(0, 1000) },
  });
}

/**
 * Record the job and start it without awaiting, from a request path that has
 * already earned its response.
 *
 * Never throws: topic provisioning is layered on top of material sync, so a
 * failure here must degrade to "no topics generated", never to a failed import
 * that loses the instructor's materials.
 */
export function startTopicAnalysis(args: StartTopicAnalysisArgs): void {
  void (async () => {
    const recorded = await recordTopicAnalysisJob(args);
    if (!recorded || !recorded.created) return;
    await runTopicAnalysisJob(recorded.jobId);
  })().catch((cause: unknown) => {
    fireAndForget(
      logSystemError({
        source: "AI",
        code: "topic_analysis_start_failed",
        message: `Failed to start topic analysis for course ${args.courseId}`,
        error: cause,
        actorUserId: args.userId,
        details: { courseId: args.courseId, materialCount: args.materialIds.length },
      }),
    );
  });
}

function isUniqueViolation(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    (cause as { code?: unknown }).code === "P2002"
  );
}
