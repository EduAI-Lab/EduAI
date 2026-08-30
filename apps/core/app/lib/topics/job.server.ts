import { createHash } from "node:crypto";

import { Prisma } from "@prisma/client";

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
 * Materials per job row. Mirrors the `materialIds` bound in `JobInputSchema`, and
 * is the reason a batch is chunked rather than rejected: a Canvas sync that
 * imports a thousand files must still get topics, and an "all files" selection
 * is a perfectly ordinary instructor action. Chunking keeps every job's payload
 * inside the schema while losing no material.
 */
export const MAX_MATERIALS_PER_JOB = 500;

/**
 * How long a claimed job may sit in RUNNING before another runner may take it
 * over.
 *
 * The row is written before the in-process run starts, so a deploy or a crash in
 * between leaves a PENDING or RUNNING row nothing will ever finish — and because
 * a later identical batch hashes to the same idempotency key, it would find that
 * row and exit, pinning the instructor's banner in flight forever. The lease is
 * what makes those rows reclaimable: past it, the next claimant wins the same
 * atomic `updateMany` a fresh claim uses, so recovery cannot double-run a job
 * that is merely slow.
 */
export const TOPIC_ANALYSIS_LEASE_MS = 10 * 60_000;

/** Most stale rows one recovery sweep will resume; a sweep runs on a request path. */
const MAX_RESUMED_PER_SWEEP = 5;

/** A job row this process may run: freshly minted, or reclaimed past its lease. */
export type RecordedTopicAnalysisJob = {
  jobId: string;
  created: boolean;
  /** An existing row whose lease has lapsed (or which never started). */
  resumable: boolean;
};

/** Rows older than this cutoff are no longer protected by a runner's lease. */
function leaseCutoff(now: number = Date.now()): Date {
  return new Date(now - TOPIC_ANALYSIS_LEASE_MS);
}

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
 * Create the durable job rows for a batch, one per chunk of at most
 * `MAX_MATERIALS_PER_JOB` materials, reusing any row that already exists.
 *
 * Returns `created: false` for a chunk that already has a job — that is the "one
 * sync batch does not create duplicate jobs when retried" guarantee, and it is
 * enforced by a unique index rather than by a check, so concurrent syncs cannot
 * both win. An existing row also reports whether it is `resumable`: a PENDING row
 * nothing ever picked up, or a RUNNING row past its lease, both of which this
 * caller may take over.
 *
 * Chunks are cut from an id-ordered read, so the same corpus always splits the
 * same way and each chunk's checksum key stays stable across resyncs.
 */
export async function recordTopicAnalysisJobs(
  args: StartTopicAnalysisArgs,
): Promise<RecordedTopicAnalysisJob[]> {
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
  if (ready.length === 0) return [];

  // Derived from the WHOLE batch, so every chunk of one sync shares it and a
  // resync of the same corpus derives the same key again — which matters when a
  // previous attempt already created some of the chunks: the pre-existing rows
  // and the new ones still end up in the same group.
  const batchKey = topicAnalysisIdempotencyKey(
    args.courseId,
    ready.map((material) => material.checksum),
  );

  const recorded: RecordedTopicAnalysisJob[] = [];
  for (let start = 0; start < ready.length; start += MAX_MATERIALS_PER_JOB) {
    const chunk = ready.slice(start, start + MAX_MATERIALS_PER_JOB);
    const job = await recordChunk(args, chunk, batchKey);
    if (job) recorded.push(job);
  }
  return recorded;
}

async function recordChunk(
  args: StartTopicAnalysisArgs,
  chunk: { id: string; checksum: string }[],
  batchKey: string,
): Promise<RecordedTopicAnalysisJob | null> {
  const idempotencyKey = topicAnalysisIdempotencyKey(
    args.courseId,
    chunk.map((material) => material.checksum),
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
      materialIds: chunk.map((material) => material.id),
      canvasCourseId: args.canvasCourseId ?? null,
      batchKey,
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
    return { jobId: job.id, created: true, resumable: false };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const existing = await prisma.aiJob.findUnique({
      where: {
        queueName_bullJobId: { queueName: TOPIC_ANALYSIS_QUEUE_NAME, bullJobId: idempotencyKey },
      },
      select: { id: true, status: true, startedAt: true },
    });
    if (!existing) return null;

    // A changed resync of the wider corpus derives a new batchKey, but an
    // unchanged chunk still hashes to the same bullJobId and reuses this row.
    // A prior FAILED row still carries its old batchKey and is neither created
    // nor resumable — so startTopicAnalysis would skip it, the status reader
    // would group only the new batchKey, and a sibling chunk completing would
    // hide the failure. Recycle the row into this batch and make it PENDING so
    // it is run again and counted with its siblings.
    if (existing.status === "FAILED") {
      await prisma.aiJob.update({
        where: { id: existing.id },
        data: {
          status: "PENDING",
          payload,
          errorMessage: null,
          completedAt: null,
          startedAt: null,
          result: Prisma.DbNull,
        },
      });
      return { jobId: existing.id, created: false, resumable: true };
    }

    return {
      jobId: existing.id,
      created: false,
      resumable: isReclaimable(existing),
    };
  }
}

/** Whether a row is one no runner still holds: never started, or past its lease. */
function isReclaimable(row: { status: string; startedAt: Date | null }): boolean {
  if (row.status === "PENDING") return true;
  if (row.status !== "RUNNING") return false;
  return row.startedAt === null || row.startedAt < leaseCutoff();
}

/**
 * Claim a job that no runner currently holds. Returns false when another runner
 * already took it, which is what stops a retried sync from provisioning the same
 * topics twice.
 *
 * The claim is one atomic `updateMany`, and reclaiming a lapsed lease goes
 * through that same statement rather than a separate reset — so a recovery sweep
 * and a live retry racing for the same stale row still produce exactly one
 * winner, and a job that is merely slow (lease intact) is never taken away.
 */
async function claimTopicAnalysisJob(jobId: string): Promise<boolean> {
  const { count } = await prisma.aiJob.updateMany({
    where: {
      id: jobId,
      OR: [
        { status: "PENDING" },
        { status: "RUNNING", startedAt: null },
        { status: "RUNNING", startedAt: { lt: leaseCutoff() } },
      ],
    },
    data: { status: "RUNNING", startedAt: new Date(), attempts: { increment: 1 } },
  });
  return count > 0;
}

/**
 * Resume topic-analysis jobs for a course that no runner is finishing.
 *
 * Called from the status read, which is exactly the moment an instructor is
 * looking at a banner that would otherwise be stuck: a process that died between
 * writing the row and finishing the work leaves nothing else to notice it, and
 * this project has no cron or worker pool to sweep from (see the file header).
 * Claiming is lease-guarded, so a sweep that overlaps a healthy run does nothing.
 */
export async function resumeStaleTopicAnalysisJobs(courseId: string): Promise<string[]> {
  const stale = await prisma.aiJob.findMany({
    where: {
      courseId,
      kind: "topic-analysis",
      OR: [
        { status: "PENDING" },
        { status: "RUNNING", startedAt: null },
        { status: "RUNNING", startedAt: { lt: leaseCutoff() } },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: MAX_RESUMED_PER_SWEEP,
    select: { id: true },
  });

  for (const row of stale) {
    void runTopicAnalysisJob(row.id).catch((cause: unknown) => {
      fireAndForget(
        logSystemError({
          source: "AI",
          code: "topic_analysis_resume_failed",
          message: `Failed to resume stale topic analysis job ${row.id}`,
          error: cause,
          details: { jobId: row.id, courseId },
        }),
      );
    });
  }

  return stale.map((row) => row.id);
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
 * Record the job rows for a batch and start them without awaiting, from a
 * request path that has already earned its response. A batch larger than one
 * job's material bound becomes several rows, run in order.
 *
 * Never throws: topic provisioning is layered on top of material sync, so a
 * failure here must degrade to "no topics generated", never to a failed import
 * that loses the instructor's materials.
 */
export function startTopicAnalysis(args: StartTopicAnalysisArgs): void {
  void (async () => {
    const recorded = await recordTopicAnalysisJobs(args);
    for (const job of recorded) {
      // A row that already exists and is still leased belongs to another runner;
      // anything else — brand new, or abandoned past its lease — is ours to run.
      if (!job.created && !job.resumable) continue;
      await runTopicAnalysisJob(job.jobId);
    }
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
  return cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2002";
}
