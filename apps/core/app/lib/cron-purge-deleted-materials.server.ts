import prisma from "~/lib/prisma.server";
import { getCronJobSetting } from "~/lib/db.cron-jobs.server";

export const PURGE_DELETED_MATERIALS_JOB = "purge-deleted-materials";

/** Materials selected and deleted per statement. */
export const PURGE_BATCH_SIZE = 100;

/**
 * Batches per run. Caps one run at 5,000 materials so a large backlog (e.g. the
 * first run after enabling the job) cannot hold the database for long; the rest
 * is picked up by the next scheduled run.
 */
export const PURGE_MAX_BATCHES = 50;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * One batch's deletes and audit rows share a transaction. Each delete cascades to
 * the row's chunks and embeddings, so the 5s interactive default is too tight.
 */
const BATCH_TRANSACTION_TIMEOUT_MS = 60_000;

/**
 * A soft-deleted row updated within this window is left alone. A Canvas re-sync
 * restores a soft-deleted material by flipping it to PROCESSING without taking a
 * lease or clearing `deletedAt`, then spends minutes downloading, extracting and
 * re-embedding before it finally clears `deletedAt`. Throughout that window the
 * row still looks old and unleased, so without this guard a purge could delete
 * it mid-restore. The PROCESSING write bumps `updatedAt`, which this checks.
 */
export const RECENTLY_TOUCHED_MS = 60 * 60 * 1000;

export type PurgeDeletedMaterialsResult = {
  purged: number;
  truncated: boolean;
  cutoff: Date;
  retainDays: number;
};

/**
 * Permanently deletes course materials soft-deleted more than `retainDays` ago.
 *
 * Only soft-deleted rows are eligible, and never one whose `extractionLeaseUntil`
 * is still live — a restore (`claimRestoreTarget`) or re-embed holds that lease
 * while it works on the row — nor one updated within `RECENTLY_TOUCHED_MS`, which
 * covers the lease-less Canvas re-sync restore. Chunks, embeddings, upload blobs and topic-source
 * links go with the row through `onDelete: Cascade`; receipts pointing at it via
 * `duplicateOfId` are set to null.
 *
 * The delete repeats the eligibility filter rather than trusting the select: a
 * Canvas re-sync or restore-on-re-upload can clear `deletedAt` between the two,
 * and that material must survive. Each candidate is deleted by its own statement
 * so its `count` says whether *this* run removed it: a row restored meanwhile, or
 * already removed by an overlapping run, comes back 0 and is neither counted nor
 * audited, so concurrent runs cannot produce duplicate `MATERIAL_PURGED` rows.
 *
 * The `MATERIAL_PURGED` entry is the last record of a purged material, so it is
 * written in the same transaction as the delete instead of through the
 * best-effort `logAuditAction`: if the audit write fails, the delete rolls back
 * and the run fails, rather than removing rows with no trace.
 */
export async function purgeDeletedMaterials(
  now: Date = new Date(),
  signal?: AbortSignal,
): Promise<PurgeDeletedMaterialsResult> {
  const retainDays = await getCronJobSetting(PURGE_DELETED_MATERIALS_JOB, "retainDays");
  const cutoff = new Date(now.getTime() - retainDays * DAY_MS);
  const eligible = {
    deletedAt: { lt: cutoff },
    OR: [{ extractionLeaseUntil: null }, { extractionLeaseUntil: { lt: now } }],
    updatedAt: { lt: new Date(now.getTime() - RECENTLY_TOUCHED_MS) },
  };

  let purged = 0;
  for (let batch = 0; batch < PURGE_MAX_BATCHES; batch++) {
    // The run lost its lease; stop before the next batch rather than overlap
    // whichever run now holds it. Committed batches stay purged and audited.
    if (signal?.aborted) {
      throw new Error(`Run lease lost after purging ${purged} material(s); stopped early`);
    }
    const candidates = await prisma.courseMaterial.findMany({
      where: eligible,
      select: { id: true, courseId: true, title: true, deletedAt: true, deletedBy: true },
      orderBy: { deletedAt: "asc" },
      take: PURGE_BATCH_SIZE,
    });
    if (candidates.length === 0) return { purged, truncated: false, cutoff, retainDays };

    const removed = await prisma.$transaction(
      async (tx) => {
        const gone: typeof candidates = [];
        for (const material of candidates) {
          const { count } = await tx.courseMaterial.deleteMany({
            where: { id: material.id, ...eligible },
          });
          if (count === 1) gone.push(material);
        }
        if (gone.length > 0) {
          await tx.auditLog.createMany({
            data: gone.map((material) => ({
              actorUserId: null,
              actorRole: null,
              actorType: "SYSTEM",
              actionCode: "MATERIAL_PURGED",
              category: "MATERIAL" as const,
              entityType: "CourseMaterial",
              entityId: material.id,
              entityLabel: material.title,
              details: {
                courseId: material.courseId,
                deletedAt: material.deletedAt?.toISOString() ?? null,
                deletedBy: material.deletedBy,
                retainDays,
              },
            })),
          });
        }
        return gone.length;
      },
      { timeout: BATCH_TRANSACTION_TIMEOUT_MS },
    );
    purged += removed;

    if (candidates.length < PURGE_BATCH_SIZE) {
      return { purged, truncated: false, cutoff, retainDays };
    }
  }
  // Every batch was full, but the last one may have taken exactly what was left.
  const remaining = await prisma.courseMaterial.findFirst({
    where: eligible,
    select: { id: true },
  });
  return { purged, truncated: remaining !== null, cutoff, retainDays };
}

/** The cron run's persisted summary line. */
export function formatPurgeMessage(result: PurgeDeletedMaterialsResult): string {
  const day = result.cutoff.toISOString().slice(0, 10);
  const base = `Purged ${result.purged} material(s) soft-deleted before ${day}`;
  return result.truncated ? `${base} (stopped at per-run limit; remainder next run)` : base;
}
