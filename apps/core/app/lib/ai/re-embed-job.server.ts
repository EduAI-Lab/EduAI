import { randomUUID } from "node:crypto";
import type { ReEmbedJobStatus } from "@prisma/client";
import prisma from "../prisma.server";
import {
  ReEmbedInterruptedError,
  reEmbedCourseMaterials,
  type ReEmbedLeaseFence,
  type ReEmbedProgress,
} from "./embedding";
import {
  resolveEffectiveEmbeddingSettings,
  type EffectiveEmbeddingSettings,
} from "./embedding-config";
import { resolveReEmbedJobStatus } from "./re-embed-job-status";
import { isInfrastructureError, toQueueUnavailable } from "~/lib/queue/errors.server";
import { providerErrorDiagnostic } from "~/lib/ai/provider-errors.server";

export { resolveReEmbedJobStatus } from "./re-embed-job-status";

export type ReEmbedJobSnapshot = {
  id: string;
  courseId: string;
  /** Internal only; never exposed by `serializeReEmbedJob`. */
  idempotencyKey: string | null;
  status: ReEmbedJobStatus;
  embeddingProviderSnapshot: string;
  embeddingModelSnapshot: string;
  totalMaterials: number;
  processedCount: number;
  failedMaterialIds: string[];
  currentMaterialTitle: string | null;
  /** Stable public failure text only; provider diagnostics stay in redacted logs. */
  errorMessage: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type ReEmbedJobRecord = ReEmbedJobSnapshot & {
  leaseOwner: string | null;
  leaseHeartbeatAt: Date | null;
  leaseExpiresAt: Date | null;
  attemptCount: number;
};

export type ReEmbedJobStartOptions = {
  /** Retry-safe key scoped to one course. */
  idempotencyKey?: string;
};

export type StartReEmbedJobOptions = ReEmbedJobStartOptions;

export type StartReEmbedJobResult = {
  job: ReEmbedJobSnapshot;
  /** True when this call creates or recycles a durable run. */
  created: boolean;
  /** False only when a supplied key could not be attached to another active key. */
  keyHonored: boolean;
};

export type AcquireReEmbedJobResult = StartReEmbedJobResult;

const ACTIVE_JOB_STATUSES: ReEmbedJobStatus[] = ["PENDING", "RUNNING"];
const DEFAULT_LEASE_DURATION_MS = 120_000;
const MIN_LEASE_DURATION_MS = 15_000;
const MAX_LEASE_DURATION_MS = 15 * 60_000;
const STALE_RUNNING_MS = 30 * 60_000;
const STALE_PENDING_MS = 5 * 60_000;
const IDEMPOTENCY_KEY_REPLAY_TTL_MS = 24 * 60 * 60 * 1000;

export const RE_EMBED_PROVIDER_FAILURE_CODE = "EMBEDDING_PROVIDER_FAILED" as const;
export const RE_EMBED_PROVIDER_FAILURE_MESSAGE = "Embedding provider failed. Please try again.";
const RE_EMBED_STALE_JOB_MESSAGE = "Reclaimed stale re-embed job";

const SAFE_RE_EMBED_ERROR_MESSAGES = new Set([
  RE_EMBED_PROVIDER_FAILURE_MESSAGE,
  RE_EMBED_STALE_JOB_MESSAGE,
]);

function publicReEmbedErrorMessage(errorMessage: string | null | undefined): string | null {
  if (typeof errorMessage !== "string" || !errorMessage) return null;
  return SAFE_RE_EMBED_ERROR_MESSAGES.has(errorMessage)
    ? errorMessage
    : RE_EMBED_PROVIDER_FAILURE_MESSAGE;
}

function leaseDurationMs(): number {
  const configured = Number(process.env.RE_EMBED_JOB_LEASE_MS);
  if (!Number.isSafeInteger(configured) || configured < MIN_LEASE_DURATION_MS) {
    return DEFAULT_LEASE_DURATION_MS;
  }
  return Math.min(configured, MAX_LEASE_DURATION_MS);
}

function heartbeatIntervalMs(leaseMs: number): number {
  return Math.max(5_000, Math.floor(leaseMs / 3));
}

function addMilliseconds(date: Date, milliseconds: number): Date {
  return new Date(date.getTime() + milliseconds);
}

function reEmbedJobClient() {
  const client = prisma.courseReEmbedJob;
  if (!client) {
    throw new Error(
      "Prisma client is missing CourseReEmbedJob. Run: cd apps/core && npx prisma generate && npx prisma migrate deploy, then restart the dev server.",
    );
  }
  return client;
}

function toSnapshot(
  job: Partial<ReEmbedJobRecord> & Pick<ReEmbedJobRecord, "id" | "courseId">,
): ReEmbedJobSnapshot {
  return {
    id: job.id,
    courseId: job.courseId,
    idempotencyKey: job.idempotencyKey ?? null,
    status: job.status ?? "PENDING",
    embeddingProviderSnapshot: job.embeddingProviderSnapshot ?? "cloud",
    embeddingModelSnapshot: job.embeddingModelSnapshot ?? "openai/text-embedding-3-small",
    totalMaterials: job.totalMaterials ?? 0,
    processedCount: job.processedCount ?? 0,
    failedMaterialIds: job.failedMaterialIds ?? [],
    currentMaterialTitle: job.currentMaterialTitle ?? null,
    errorMessage: publicReEmbedErrorMessage(job.errorMessage),
    startedAt: job.startedAt ?? null,
    completedAt: job.completedAt ?? null,
    createdAt: job.createdAt ?? new Date(0),
    updatedAt: job.updatedAt ?? new Date(0),
  };
}

export function serializeReEmbedJob(job: ReEmbedJobSnapshot) {
  return {
    id: job.id,
    courseId: job.courseId,
    status: job.status,
    embeddingProvider: job.embeddingProviderSnapshot,
    embeddingModel: job.embeddingModelSnapshot,
    totalMaterials: job.totalMaterials,
    processedCount: job.processedCount,
    failed: job.failedMaterialIds,
    currentMaterialTitle: job.currentMaterialTitle,
    errorMessage: publicReEmbedErrorMessage(job.errorMessage),
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}

function settingsFromJob(job: ReEmbedJobRecord): EffectiveEmbeddingSettings {
  const provider = job.embeddingProviderSnapshot === "local" ? "local" : "cloud";
  return {
    provider,
    model: job.embeddingModelSnapshot,
    wantsLocal: provider === "local",
    source: { provider: "course", model: "course" },
  };
}

function isIdempotencyConflict(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    (cause as { code?: unknown }).code === "P2002" &&
    ((cause as { meta?: { target?: unknown } }).meta?.target as string[] | undefined)?.some(
      (value) => value === "idempotencyKey",
    ) === true
  );
}

function replayAnchor(job: ReEmbedJobSnapshot): Date {
  return job.completedAt ?? job.updatedAt ?? job.createdAt;
}

function isWithinReplayWindow(job: ReEmbedJobSnapshot): boolean {
  return Date.now() - replayAnchor(job).getTime() < IDEMPOTENCY_KEY_REPLAY_TTL_MS;
}

function isStaleJob(job: ReEmbedJobRecord | ReEmbedJobSnapshot): boolean {
  if (job.status === "RUNNING") {
    const record = job as ReEmbedJobRecord;
    if (record.leaseExpiresAt) return record.leaseExpiresAt.getTime() <= Date.now();
    const lastActivity = job.updatedAt ?? job.startedAt;
    return !!lastActivity && Date.now() - lastActivity.getTime() > STALE_RUNNING_MS;
  }
  if (job.status === "PENDING") {
    return Date.now() - job.createdAt.getTime() > STALE_PENDING_MS;
  }
  return false;
}

function claimNeeded(job: ReEmbedJobRecord): boolean {
  if (job.status === "PENDING") return true;
  if (job.status !== "RUNNING") return false;
  return !job.leaseOwner || !job.leaseExpiresAt || job.leaseExpiresAt.getTime() <= Date.now();
}

function isInfrastructureOrQueueError(cause: unknown): boolean {
  return isInfrastructureError(cause);
}

/**
 * Re-embed starts are serialized on the course row. This makes the active-row
 * decision, idempotency lookup/attachment, stale recycle, and snapshot capture
 * one durable operation; the partial unique index remains the last line of
 * defense for writers that bypass this helper.
 */
export async function acquireReEmbedJob(
  courseId: string,
  options: ReEmbedJobStartOptions = {},
): Promise<AcquireReEmbedJobResult> {
  const idempotencyKey = options.idempotencyKey?.trim() || undefined;

  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "courses" WHERE id = ${courseId} FOR UPDATE
    `;
    if (locked.length === 0) throw new Error(`Course not found: ${courseId}`);

    const now = new Date();
    const client = tx.courseReEmbedJob;
    let keyHonored = true;

    if (idempotencyKey) {
      const byKey = await client.findUnique({
        where: {
          courseId_idempotencyKey: { courseId, idempotencyKey },
        },
      });
      if (byKey) {
        const snapshot = toSnapshot(byKey);
        if (ACTIVE_JOB_STATUSES.includes(snapshot.status)) {
          if (isStaleJob(byKey)) {
            await client.update({
              where: { id: snapshot.id },
              data: {
                status: "FAILED",
                errorMessage: RE_EMBED_STALE_JOB_MESSAGE,
                completedAt: now,
                leaseOwner: null,
                leaseHeartbeatAt: null,
                leaseExpiresAt: null,
              },
            });
            const recycled = await client.update({
              where: { id: snapshot.id },
              data: {
                status: "PENDING",
                totalMaterials: 0,
                processedCount: 0,
                failedMaterialIds: [],
                currentMaterialTitle: null,
                errorMessage: null,
                startedAt: null,
                completedAt: null,
                leaseOwner: null,
                leaseHeartbeatAt: null,
                leaseExpiresAt: null,
              },
            });
            return { job: toSnapshot(recycled), created: true, keyHonored: true };
          }
          return { job: snapshot, created: false, keyHonored: true };
        }
        if (isWithinReplayWindow(snapshot)) {
          return { job: snapshot, created: false, keyHonored: true };
        }

        const recycled = await client.update({
          where: { id: snapshot.id },
          data: {
            status: "PENDING",
            totalMaterials: 0,
            processedCount: 0,
            failedMaterialIds: [],
            currentMaterialTitle: null,
            errorMessage: null,
            startedAt: null,
            completedAt: null,
            leaseOwner: null,
            leaseHeartbeatAt: null,
            leaseExpiresAt: null,
          },
        });
        return { job: toSnapshot(recycled), created: true, keyHonored: true };
      }
    }

    const active = await client.findFirst({
      where: { courseId, status: { in: ACTIVE_JOB_STATUSES } },
      orderBy: { createdAt: "desc" },
    });
    if (active) {
      const activeSnapshot = toSnapshot(active);
      if (isStaleJob(active)) {
        await client.update({
          where: { id: activeSnapshot.id },
          data: {
            status: "FAILED",
            errorMessage: RE_EMBED_STALE_JOB_MESSAGE,
            completedAt: now,
            leaseOwner: null,
            leaseHeartbeatAt: null,
            leaseExpiresAt: null,
          },
        });
        const recycled = await client.update({
          where: { id: activeSnapshot.id },
          data: {
            status: "PENDING",
            totalMaterials: 0,
            processedCount: 0,
            failedMaterialIds: [],
            currentMaterialTitle: null,
            errorMessage: null,
            startedAt: null,
            completedAt: null,
            leaseOwner: null,
            leaseHeartbeatAt: null,
            leaseExpiresAt: null,
            // Prisma skips an `undefined` column, so a row that already carries
            // a key keeps it instead of being overwritten by this recycle.
            idempotencyKey:
              idempotencyKey && !activeSnapshot.idempotencyKey ? idempotencyKey : undefined,
          },
        });
        return {
          job: toSnapshot(recycled),
          created: true,
          keyHonored:
            !idempotencyKey ||
            !activeSnapshot.idempotencyKey ||
            activeSnapshot.idempotencyKey === idempotencyKey,
        };
      }

      if (
        idempotencyKey &&
        activeSnapshot.idempotencyKey &&
        activeSnapshot.idempotencyKey !== idempotencyKey
      ) {
        keyHonored = false;
      } else if (idempotencyKey && !activeSnapshot.idempotencyKey) {
        try {
          const attached = await client.update({
            where: { id: activeSnapshot.id },
            data: { idempotencyKey },
          });
          return { job: toSnapshot(attached), created: false, keyHonored: true };
        } catch (error) {
          if (isIdempotencyConflict(error)) {
            keyHonored = false;
          } else {
            throw error;
          }
        }
      }
      return { job: activeSnapshot, created: false, keyHonored };
    }

    const course = await tx.course.findUniqueOrThrow({
      where: { id: courseId },
      select: {
        embeddingProvider: true,
        embeddingModel: true,
        embeddedWithProvider: true,
        embeddedWithModel: true,
        lastEmbeddedAt: true,
      },
    });
    const settings = resolveEffectiveEmbeddingSettings(course);
    const created = await client.create({
      data: {
        courseId,
        // No key means the column takes its default; an empty string must never
        // stand in for "none" against the unique index.
        idempotencyKey: idempotencyKey || undefined,
        status: "PENDING",
        embeddingProviderSnapshot: settings.provider,
        embeddingModelSnapshot: settings.model,
      },
    });
    return {
      job: toSnapshot(created),
      created: true,
      keyHonored: true,
    };
  });
}

function kickReEmbedJob(jobId: string): void {
  void resumeReEmbedJob(jobId).catch((error) => {
    console.error("[re-embed-job] failed to schedule durable job", {
      jobId,
      error: providerErrorDiagnostic(error),
    });
  });
}

export async function findActiveReEmbedJob(courseId: string): Promise<ReEmbedJobSnapshot | null> {
  const job = await reEmbedJobClient().findFirst({
    where: { courseId, status: { in: ACTIVE_JOB_STATUSES } },
    orderBy: { createdAt: "desc" },
  });
  if (!job) return null;
  kickReEmbedJob(job.id);
  return toSnapshot(job);
}

export async function getReEmbedJobForCourse(
  courseId: string,
  jobId: string,
): Promise<ReEmbedJobSnapshot | null> {
  const job = await reEmbedJobClient().findFirst({ where: { id: jobId, courseId } });
  if (!job) return null;
  if (ACTIVE_JOB_STATUSES.includes(job.status)) kickReEmbedJob(job.id);
  return toSnapshot(job);
}

type ClaimedReEmbedJob = {
  job: ReEmbedJobRecord;
  leaseOwner: string;
  leaseMs: number;
};

async function claimReEmbedJob(jobId: string): Promise<ClaimedReEmbedJob | null> {
  const client = reEmbedJobClient();
  const candidate = (await client.findUnique({ where: { id: jobId } })) as ReEmbedJobRecord | null;
  if (!candidate) return null;

  const leaseOwner = randomUUID();
  const leaseMs = leaseDurationMs();
  const claimedAt = new Date();
  const claim = await client.updateMany({
    where: {
      id: jobId,
      OR: [
        { status: "PENDING" },
        { status: "RUNNING", leaseExpiresAt: null },
        { status: "RUNNING", leaseExpiresAt: { lte: claimedAt } },
      ],
    },
    data: {
      status: "RUNNING",
      leaseOwner,
      leaseHeartbeatAt: claimedAt,
      leaseExpiresAt: addMilliseconds(claimedAt, leaseMs),
      attemptCount: { increment: 1 },
      startedAt: candidate.startedAt ?? claimedAt,
      completedAt: null,
      errorMessage: null,
    },
  });
  if (claim.count !== 1) return null;

  const claimed = (await client.findUniqueOrThrow({ where: { id: jobId } })) as ReEmbedJobRecord;
  return { job: claimed, leaseOwner, leaseMs };
}

async function compensatePendingStart(jobId: string): Promise<void> {
  const client = reEmbedJobClient() as any;
  try {
    if (typeof (client as { deleteMany?: unknown }).deleteMany === "function") {
      await (client as any).deleteMany({ where: { id: jobId, status: "PENDING" } });
    } else {
      await (client as any).delete({ where: { id: jobId } });
    }
  } catch (error) {
    console.error("[re-embed-job] failed to compensate pending start", {
      jobId,
      error: providerErrorDiagnostic(error),
    });
  }
}

async function updateJobProgress(
  jobId: string,
  leaseOwner: string,
  leaseMs: number,
  progress: ReEmbedProgress,
): Promise<boolean> {
  const now = new Date();
  const result = await reEmbedJobClient().updateMany({
    where: {
      id: jobId,
      status: "RUNNING",
      leaseOwner,
      leaseExpiresAt: { gt: now },
    },
    data: {
      totalMaterials: progress.total,
      processedCount: progress.processed,
      failedMaterialIds: progress.failed,
      currentMaterialTitle: progress.currentMaterialTitle ?? null,
      leaseHeartbeatAt: now,
      leaseExpiresAt: addMilliseconds(now, leaseMs),
    },
  });
  return result.count === 1;
}

async function executeClaimedReEmbedJob(claimed: ClaimedReEmbedJob): Promise<void> {
  const { job, leaseOwner, leaseMs } = claimed;
  let ownsLease = true;
  let leaseLost = false;
  let heartbeatQueue = Promise.resolve();
  const workerAbort = new AbortController();

  const loseLease = () => {
    leaseLost = true;
    ownsLease = false;
    if (!workerAbort.signal.aborted) {
      workerAbort.abort(new ReEmbedInterruptedError());
    }
  };

  const renewLease = async () => {
    if (!ownsLease) return;
    const now = new Date();
    const renewed = await reEmbedJobClient().updateMany({
      where: {
        id: job.id,
        status: "RUNNING",
        leaseOwner,
        leaseExpiresAt: { gt: now },
      },
      data: {
        leaseHeartbeatAt: now,
        leaseExpiresAt: addMilliseconds(now, leaseMs),
      },
    });
    if (renewed.count !== 1) loseLease();
  };

  const heartbeat = setInterval(() => {
    if (!ownsLease) return;
    heartbeatQueue = heartbeatQueue.then(renewLease).catch((error) => {
      // A rejected renewal is an ownership failure. Abort the provider before
      // it can finish and fence all future material/job writes.
      loseLease();
      console.error("[re-embed-job] lease heartbeat failed", {
        jobId: job.id,
        error: providerErrorDiagnostic(error),
      });
    });
  }, heartbeatIntervalMs(leaseMs));
  heartbeat.unref?.();

  try {
    const leaseFence: ReEmbedLeaseFence = { jobId: job.id, leaseOwner };
    const result = await reEmbedCourseMaterials(job.courseId, {
      embeddingSettings: settingsFromJob(job),
      leaseFence,
      shouldContinue: () => ownsLease,
      signal: workerAbort.signal,
      onProgress: async (progress) => {
        try {
          ownsLease = await updateJobProgress(job.id, leaseOwner, leaseMs, progress);
        } catch (error) {
          loseLease();
          throw error;
        }
        if (!ownsLease) {
          loseLease();
          throw new ReEmbedInterruptedError();
        }
      },
    });
    if (!ownsLease) throw new ReEmbedInterruptedError();
    const completedAt = new Date();
    const status = resolveReEmbedJobStatus(result);
    const finalized = await reEmbedJobClient().updateMany({
      where: {
        id: job.id,
        status: "RUNNING",
        leaseOwner,
        leaseExpiresAt: { gt: completedAt },
      },
      data: {
        status,
        totalMaterials: result.total,
        processedCount: result.processed,
        failedMaterialIds: result.failed,
        currentMaterialTitle: null,
        completedAt,
        leaseOwner: null,
        leaseHeartbeatAt: null,
        leaseExpiresAt: null,
      },
    });
    if (finalized.count !== 1) loseLease();
  } catch (error) {
    if (!(error instanceof ReEmbedInterruptedError)) {
      console.error("[re-embed-job] job failed", {
        jobId: job.id,
        courseId: job.courseId,
        code: RE_EMBED_PROVIDER_FAILURE_CODE,
        error: providerErrorDiagnostic(error),
      });
    }

    // If the heartbeat/ownership check failed, leave RUNNING until the last
    // confirmed lease expiry. A successor can reclaim it; this worker cannot
    // safely write FAILED after losing the fence.
    if (!leaseLost) {
      const failedAt = new Date();
      try {
        await reEmbedJobClient().updateMany({
          where: {
            id: job.id,
            status: "RUNNING",
            leaseOwner,
            leaseExpiresAt: { gt: failedAt },
          },
          data: {
            status: "FAILED",
            errorMessage: RE_EMBED_PROVIDER_FAILURE_MESSAGE,
            currentMaterialTitle: null,
            completedAt: failedAt,
            leaseOwner: null,
            leaseHeartbeatAt: null,
            leaseExpiresAt: null,
          },
        });
      } catch (writeError) {
        console.error("[re-embed-job] failed to persist terminal failure", {
          jobId: job.id,
          error: providerErrorDiagnostic(writeError),
        });
      }
    }
  } finally {
    clearInterval(heartbeat);
    await heartbeatQueue;
  }
}

/** Claim + execute a job for recovery/status callers. */
export async function resumeReEmbedJob(jobId: string): Promise<boolean> {
  const claimed = await claimReEmbedJob(jobId);
  if (!claimed) return false;
  await executeClaimedReEmbedJob(claimed);
  return true;
}

/**
 * Acquire and synchronously cross the durable scheduling boundary. The caller
 * never receives 202 while a newly-created row is still PENDING: the lease
 * claim must succeed first. Provider work is then detached behind the lease
 * fence so HTTP latency is independent of embedding duration.
 */
export async function startOrResumeReEmbedJob(
  courseId: string,
  options: ReEmbedJobStartOptions = {},
): Promise<StartReEmbedJobResult> {
  let acquired: AcquireReEmbedJobResult;
  try {
    acquired = await acquireReEmbedJob(courseId, options);
  } catch (error) {
    if (isInfrastructureOrQueueError(error)) {
      throw toQueueUnavailable(error, "Database unavailable while starting re-embed job");
    }
    throw error;
  }

  const record = acquired.job as ReEmbedJobRecord;
  if (!ACTIVE_JOB_STATUSES.includes(record.status) || !claimNeeded(record)) {
    return acquired;
  }

  let claimed: ClaimedReEmbedJob | null;
  try {
    claimed = await claimReEmbedJob(record.id);
  } catch (error) {
    if (acquired.created && record.status === "PENDING") {
      await compensatePendingStart(record.id);
    }
    if (isInfrastructureOrQueueError(error)) {
      throw toQueueUnavailable(error, "Failed to schedule re-embed job");
    }
    throw error;
  }
  if (!claimed) {
    if (acquired.created && record.status === "PENDING") {
      await compensatePendingStart(record.id);
      throw new Error("Failed to claim newly-created re-embed job");
    }
    // A concurrent worker won the lease. Return the durable row without
    // attempting a second provider execution.
    const current = await reEmbedJobClient().findUnique({ where: { id: record.id } });
    return {
      ...acquired,
      job: current ? toSnapshot(current) : acquired.job,
      created: false,
    };
  }

  void executeClaimedReEmbedJob(claimed).catch((error) => {
    console.error("[re-embed-job] unhandled background execution failure", {
      jobId: record.id,
      error: providerErrorDiagnostic(error),
    });
  });
  return {
    job: toSnapshot(claimed.job),
    created: acquired.created,
    keyHonored: acquired.keyHonored,
  };
}

/** Backward-compatible convenience for callers that only need the job row. */
export async function startReEmbedJob(
  courseId: string,
  options: ReEmbedJobStartOptions = {},
): Promise<StartReEmbedJobResult> {
  return startOrResumeReEmbedJob(courseId, options);
}
