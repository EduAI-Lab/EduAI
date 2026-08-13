import { Prisma } from "@prisma/client";
import prisma from "../prisma.server";
import { reEmbedCourseMaterials, type ReEmbedProgress } from "./embedding";
import { resolveReEmbedJobStatus } from "./re-embed-job-status";
import type { ReEmbedJobStatus } from "@prisma/client";
import { isInfrastructureError, toQueueUnavailable } from "~/lib/queue/errors.server";
import { fireAndForget, logSystemError } from "~/lib/logging.server";

export { resolveReEmbedJobStatus } from "./re-embed-job-status";

export type ReEmbedJobSnapshot = {
  id: string;
  courseId: string;
  /** Internal only — never surfaced via `serializeReEmbedJob`. */
  idempotencyKey: string | null;
  status: ReEmbedJobStatus;
  totalMaterials: number;
  processedCount: number;
  failedMaterialIds: string[];
  currentMaterialTitle: string | null;
  errorMessage: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type StartReEmbedJobOptions = {
  /** Retry-safe start key (#1112). Reuses the existing row when present for this course. */
  idempotencyKey?: string;
};

function toSnapshot(job: ReEmbedJobSnapshot): ReEmbedJobSnapshot {
  return job;
}

export function serializeReEmbedJob(job: ReEmbedJobSnapshot) {
  return {
    id: job.id,
    courseId: job.courseId,
    status: job.status,
    totalMaterials: job.totalMaterials,
    processedCount: job.processedCount,
    failed: job.failedMaterialIds,
    currentMaterialTitle: job.currentMaterialTitle,
    errorMessage: job.errorMessage,
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}

const ACTIVE_JOB_STATUSES: ReEmbedJobStatus[] = ["PENDING", "RUNNING"];

/**
 * How long a terminal row on an idempotency key still answers a retry with
 * its own (already-finished) result, same convention as the admin-mutation
 * idempotency store's `DEFAULT_TTL_MS` (`~/lib/idempotency.server.ts`). An
 * immediate retry within this window must replay, not re-run the work
 * (#1269 review) — recycling on every retry double-runs an expensive
 * re-embed for a client that simply retried after a slow response. Only
 * once the window has passed do we treat the key as free to recycle, so a
 * caller reusing a stable key (e.g. `reembed-${courseId}`) is not stuck
 * replaying the same terminal result forever.
 */
const IDEMPOTENCY_KEY_REPLAY_TTL_MS = 24 * 60 * 60 * 1000;

function isWithinReplayWindow(job: ReEmbedJobSnapshot): boolean {
  const anchor = job.completedAt ?? job.updatedAt ?? job.createdAt;
  return Date.now() - anchor.getTime() < IDEMPOTENCY_KEY_REPLAY_TTL_MS;
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

function isIdempotencyConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002" &&
    (error.meta?.target as string[] | undefined)?.includes("idempotencyKey") === true
  );
}

/** Lookup + authorize: only reuse a row that belongs to the requested course. */
async function findReEmbedJobByIdempotencyKey(
  courseId: string,
  idempotencyKey: string,
): Promise<ReEmbedJobSnapshot | null> {
  const job = await reEmbedJobClient().findUnique({
    where: { courseId_idempotencyKey: { courseId, idempotencyKey } },
  });
  if (!job) return null;
  // Defense in depth — compound unique already scopes the lookup.
  if (job.courseId !== courseId) {
    return null;
  }
  return toSnapshot(job);
}

export async function findActiveReEmbedJob(
  courseId: string,
): Promise<ReEmbedJobSnapshot | null> {
  const job = await reEmbedJobClient().findFirst({
    where: { courseId, status: { in: ACTIVE_JOB_STATUSES } },
    orderBy: { createdAt: "desc" },
  });
  return job ? toSnapshot(job) : null;
}

/**
 * A RUNNING row with no progress update in this long is presumed to belong
 * to a crashed process, not genuine in-flight work (#1269 review: nothing
 * previously recovered a claim that never got followed through — e.g. a
 * crash in the window between `claimReEmbedJob` marking RUNNING and the
 * fire-and-forget `executeReEmbedJob` actually starting or finishing).
 * Generous relative to real re-embed durations so live jobs are never
 * reclaimed out from under themselves.
 */
const STALE_RUNNING_MS = 30 * 60 * 1000;

/**
 * A PENDING row this old was abandoned by a crash between `create()` and
 * `claimReEmbedJob` — most likely in the narrow window where both the claim
 * *and* its compensating delete failed (#1269 review: that delete failure
 * used to be swallowed silently, and nothing reclaimed a stuck PENDING row
 * the way `STALE_RUNNING_MS` already did for RUNNING, so every future
 * request for the course would find it via `findActiveReEmbedJob` and block
 * forever). A legitimate row transitions PENDING → RUNNING within
 * milliseconds of `create()`, so this only needs to be generous enough to
 * never reclaim a row still genuinely mid-claim.
 */
const STALE_PENDING_MS = 5 * 60 * 1000;

function isStaleJob(job: ReEmbedJobSnapshot): boolean {
  if (job.status === "RUNNING") {
    const lastActivity = job.updatedAt ?? job.startedAt;
    if (!lastActivity) return false;
    return Date.now() - lastActivity.getTime() > STALE_RUNNING_MS;
  }
  if (job.status === "PENDING") {
    return Date.now() - job.createdAt.getTime() > STALE_PENDING_MS;
  }
  return false;
}

/**
 * Mark a presumed-crashed PENDING/RUNNING row FAILED so it stops permanently
 * blocking retries for its course/key. Losing a race against a real
 * in-progress update (the job wasn't actually stale) is fine — that update
 * simply wins and this is a no-op FAILED-then-overwritten blip. A genuine
 * infra failure is NOT swallowed (#1269 review): the caller must not treat
 * the old row as reclaimed when this throws, or a second active job can get
 * created on top of a row that's still live.
 */
async function reclaimStaleReEmbedJob(job: ReEmbedJobSnapshot): Promise<void> {
  const staleFor =
    job.status === "RUNNING"
      ? `no progress for over ${Math.round(STALE_RUNNING_MS / 60000)} minutes`
      : `stuck PENDING for over ${Math.round(STALE_PENDING_MS / 60000)} minutes`;
  await reEmbedJobClient().update({
    where: { id: job.id },
    data: {
      status: "FAILED",
      errorMessage: `Reclaimed: ${staleFor}, presumed crashed`,
      completedAt: new Date(),
    },
  });
}

/** Reset a row (found by idempotencyKey — terminal past the replay window, or reclaimed-stale) to a fresh PENDING run under the same key. */
async function recycleReEmbedJob(id: string): Promise<ReEmbedJobSnapshot> {
  return toSnapshot(
    await reEmbedJobClient().update({
      where: { id },
      data: {
        status: "PENDING",
        totalMaterials: 0,
        processedCount: 0,
        failedMaterialIds: [],
        currentMaterialTitle: null,
        errorMessage: null,
        startedAt: null,
        completedAt: null,
      },
    }),
  );
}

export async function getReEmbedJobForCourse(
  courseId: string,
  jobId: string,
): Promise<ReEmbedJobSnapshot | null> {
  const job = await reEmbedJobClient().findFirst({
    where: { id: jobId, courseId },
  });
  return job ? toSnapshot(job) : null;
}

async function updateJobProgress(jobId: string, progress: ReEmbedProgress): Promise<void> {
  await reEmbedJobClient().update({
    where: { id: jobId },
    data: {
      totalMaterials: progress.total,
      processedCount: progress.processed,
      failedMaterialIds: progress.failed,
      currentMaterialTitle: progress.currentMaterialTitle ?? null,
    },
  });
}

/**
 * Durable scheduling boundary (#1112): claim the row as RUNNING so a rejected
 * initial DB update can be compensated before the HTTP handler returns 202.
 */
async function claimReEmbedJob(jobId: string): Promise<ReEmbedJobSnapshot> {
  return toSnapshot(
    await reEmbedJobClient().update({
      where: { id: jobId },
      data: { status: "RUNNING", startedAt: new Date(), errorMessage: null },
    }),
  );
}

/**
 * Background work after a successful claim — failures mark the row FAILED.
 * Never rejects (#1269 review): if the FAILED write itself throws, that
 * would otherwise surface as an unhandled rejection on the fire-and-forget
 * caller (`startReEmbedJob` never awaits this) — logged instead, since
 * there is no caller left to propagate it to.
 */
async function executeReEmbedJob(jobId: string, courseId: string): Promise<void> {
  try {
    const result = await reEmbedCourseMaterials(courseId, {
      onProgress: (progress) => updateJobProgress(jobId, progress),
    });

    const status = resolveReEmbedJobStatus(result);

    await reEmbedJobClient().update({
      where: { id: jobId },
      data: {
        status,
        totalMaterials: result.total,
        processedCount: result.processed,
        failedMaterialIds: result.failed,
        currentMaterialTitle: null,
        completedAt: new Date(),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[re-embed-job] job failed", { jobId, courseId, error: message });
    try {
      await reEmbedJobClient().update({
        where: { id: jobId },
        data: {
          status: "FAILED",
          errorMessage: message,
          currentMaterialTitle: null,
          completedAt: new Date(),
        },
      });
    } catch (updateError) {
      fireAndForget(
        logSystemError({
          source: "AI",
          code: "re_embed_job_failure_write_failed",
          message: `Re-embed job ${jobId} failed and the FAILED-status write also failed; row may be stuck RUNNING`,
          error: updateError,
          details: { jobId, courseId, originalError: message },
        }),
      );
    }
  }
}

export type StartReEmbedJobResult = {
  job: ReEmbedJobSnapshot;
  /** False when an active or idempotent row was reused. */
  created: boolean;
  /**
   * False when the caller supplied an `idempotencyKey` but it was not
   * attached to the returned job — only possible when an active job for the
   * course already carries a *different* key (#1269 review). The row itself
   * is still the correct answer (there is exactly one active job per
   * course), but a later retry on the caller's own key will not find it: a
   * single `idempotencyKey` column can only ever remember one key per row,
   * so supporting concurrent keys per job needs a separate request-key
   * mapping, which is out of scope here. Always true when no key was
   * supplied.
   */
  keyHonored: boolean;
};

/**
 * Create a background re-embed job and start processing without blocking the caller.
 *
 * Consistency (#1112 / #1269 review): the PENDING row is only retained when
 * the durable schedule boundary (`claimReEmbedJob` → RUNNING) succeeds. If
 * that claim fails, the row is deleted (compensate) so callers never see an
 * orphan PENDING; a failure of that delete itself is logged rather than
 * swallowed, and the row remains reachable by `findActiveReEmbedJob` until
 * `STALE_PENDING_MS` makes it eligible for reclaim on a later call (#1269
 * review — a silently-swallowed delete failure used to leave a PENDING row
 * with no recovery path at all). DB infrastructure failures surface as
 * `QueueUnavailableError` → HTTP 503.
 *
 * A RUNNING row is presumed crashed (not real in-flight work) once it has
 * gone `STALE_RUNNING_MS` with no progress update, and a PENDING row is
 * presumed crashed once it has sat `STALE_PENDING_MS` without being claimed
 * — the fire-and-forget `executeReEmbedJob` call after claim has no recovery
 * of its own otherwise, so a crash in that window would permanently block
 * every future start for the course/key. Reclaiming marks the row FAILED
 * and this function proceeds as if it were never active.
 *
 * A row bound to `idempotencyKey` is only reused as a dedupe hit while it's
 * PENDING/RUNNING. A *terminal* row on that key is recycled back to a fresh
 * PENDING run rather than returned as-is — otherwise a stable key (e.g.
 * `reembed-${courseId}`) would resolve to the same COMPLETED job forever and
 * a real re-embed would never run again after the first one. A *stale*
 * PENDING/RUNNING row found by key is recycled the same way, directly, at
 * the point it's reclaimed — not left to fall through to the general
 * active/create flow below, which would otherwise hit the compound
 * `(courseId, idempotencyKey)` conflict at create() and then replay the
 * reclaim's own fresh `completedAt` as if it were a real terminal result
 * (#1269 review).
 *
 * When an active job for the course is found via the courseId-only check
 * (not the key check — e.g. it was started without a key, or under a
 * different one) and the caller supplied a key that row doesn't have yet,
 * the key is attached to it best-effort so a later retry with the same key
 * can still find this job once it terminates, instead of starting a
 * duplicate. If the row already carries a *different* key, it is not
 * overwritten — `keyHonored: false` on the result says so explicitly instead
 * of silently returning success (#1269 review).
 *
 * Idempotency keys are scoped to `(courseId, idempotencyKey)` so a key from
 * another course cannot leak through an authorized endpoint.
 *
 * When BullMQ wiring lands for re-embed, swap the claim step for
 * `enqueue()` — the same create → push → compensate shape already used there.
 */
export async function startReEmbedJob(
  courseId: string,
  options: StartReEmbedJobOptions = {},
): Promise<StartReEmbedJobResult> {
  const { idempotencyKey } = options;
  const client = reEmbedJobClient();

  try {
    let job: ReEmbedJobSnapshot | undefined;

    if (idempotencyKey) {
      const byKey = await findReEmbedJobByIdempotencyKey(courseId, idempotencyKey);
      if (byKey && ACTIVE_JOB_STATUSES.includes(byKey.status)) {
        if (isStaleJob(byKey)) {
          await reclaimStaleReEmbedJob(byKey);
          // Recycle the same row directly instead of falling through: it
          // still holds `idempotencyKey` (compound-unique with courseId), so
          // a fresh create() would conflict, and the reclaim's own fresh
          // completedAt would otherwise make the general P2002 fallback
          // below replay this crashed row as a valid terminal result.
          job = await recycleReEmbedJob(byKey.id);
        } else {
          return { job: byKey, created: false, keyHonored: true };
        }
      } else if (byKey && isWithinReplayWindow(byKey)) {
        // Immediate retry on a key whose job already finished: replay the
        // same terminal result rather than starting a duplicate run
        // (#1269 review) — this is what an Idempotency-Key retry is for.
        return { job: byKey, created: false, keyHonored: true };
      }
    }

    if (!job) {
      const active = await findActiveReEmbedJob(courseId);
      if (active) {
        if (isStaleJob(active)) {
          await reclaimStaleReEmbedJob(active);
        } else if (idempotencyKey && active.idempotencyKey && active.idempotencyKey !== idempotencyKey) {
          // Already belongs to a different caller's key — do not silently
          // reassign it. A single idempotencyKey column can only remember
          // one key per row, so tell the caller their key was not honored
          // rather than implying it was saved (#1269 review).
          return { job: active, created: false, keyHonored: false };
        } else {
          if (idempotencyKey && !active.idempotencyKey) {
            try {
              await client.update({ where: { id: active.id }, data: { idempotencyKey } });
            } catch (attachError) {
              // A conflicting concurrent attach (another caller's key already
              // won the unique constraint) is a benign race — the active job
              // returned below is still the correct answer either way, just
              // not under our key. A real infra failure is not swallowed
              // (#1269 review): silently dropping it here would tell the
              // caller their key was saved when it wasn't.
              if (!isIdempotencyConflict(attachError)) throw attachError;
              return { job: active, created: false, keyHonored: false };
            }
          }
          return { job: active, created: false, keyHonored: true };
        }
      }
    }

    if (!job) {
      try {
        job = toSnapshot(
          await client.create({
            data: {
              courseId,
              status: "PENDING",
              ...(idempotencyKey ? { idempotencyKey } : {}),
            },
          }),
        );
      } catch (error) {
        if (idempotencyKey && isIdempotencyConflict(error)) {
          const existing = await findReEmbedJobByIdempotencyKey(courseId, idempotencyKey);
          if (existing && ACTIVE_JOB_STATUSES.includes(existing.status) && !isStaleJob(existing)) {
            return { job: existing, created: false, keyHonored: true };
          }
          if (existing && isWithinReplayWindow(existing)) {
            // Same retry-window replay as the byKey check above — a
            // concurrent create() lost the race, but this is still an
            // Idempotency-Key retry, not a request for new work.
            return { job: existing, created: false, keyHonored: true };
          }
          if (existing) {
            // Outside the replay window (or a reclaimed-stale row) — recycle
            // it into a fresh PENDING run under the same key rather than
            // leaving a stable key permanently pointed at old terminal state.
            job = await recycleReEmbedJob(existing.id);
          } else {
            if (isInfrastructureError(error)) {
              throw toQueueUnavailable(error, "Database unavailable while creating re-embed job");
            }
            throw error;
          }
        } else if (isInfrastructureError(error)) {
          throw toQueueUnavailable(error, "Database unavailable while creating re-embed job");
        } else {
          throw error;
        }
      }
    }

    try {
      // Await the durable schedule boundary so claim failures compensate and
      // never return 202 with a stuck PENDING row (#1112 review).
      const claimed = await claimReEmbedJob(job.id);
      executeReEmbedJob(job.id, courseId).catch((err) => {
        fireAndForget(
          logSystemError({
            source: "AI",
            code: "re_embed_job_unhandled_rejection",
            message: `Background re-embed work for job ${job!.id} rejected outside its own error handling`,
            error: err,
            details: { jobId: job!.id, courseId },
          }),
        );
      });
      return { job: claimed, created: true, keyHonored: true };
    } catch (error) {
      try {
        await client.delete({ where: { id: job.id } });
      } catch (deleteError) {
        // Not swallowed (#1269 review): if this also fails, the PENDING row
        // is left behind. It stays reachable via findActiveReEmbedJob and
        // becomes eligible for stale-PENDING reclaim after STALE_PENDING_MS,
        // but that recovery is on a *later* call — this one must not report
        // success, and the gap must be observable rather than silent.
        fireAndForget(
          logSystemError({
            source: "AI",
            code: "re_embed_job_compensate_delete_failed",
            message: `Failed to compensate (delete) PENDING re-embed job ${job.id} after claim failure`,
            error: deleteError,
            details: { jobId: job.id, courseId, claimError: error instanceof Error ? error.message : String(error) },
          }),
        );
      }
      if (isInfrastructureError(error)) {
        throw toQueueUnavailable(error, "Failed to schedule re-embed job");
      }
      throw error;
    }
  } catch (error) {
    if (isInfrastructureError(error)) {
      throw toQueueUnavailable(error, "Database unavailable while starting re-embed job");
    }
    throw error;
  }
}
