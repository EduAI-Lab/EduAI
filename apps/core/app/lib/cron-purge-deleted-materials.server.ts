import prisma from "~/lib/prisma.server";
import { getCronJobSetting } from "~/lib/db.cron-jobs.server";
import { logAuditAction } from "~/lib/logging.server";

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
 * and that material must survive. Only rows that are actually gone afterwards
 * are counted and audited, since the soft-delete audit entry now points at a
 * row that no longer exists and this is the last record of it.
 */
export async function purgeDeletedMaterials(
  now: Date = new Date(),
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
    const candidates = await prisma.courseMaterial.findMany({
      where: eligible,
      select: { id: true, courseId: true, title: true, deletedAt: true, deletedBy: true },
      orderBy: { deletedAt: "asc" },
      take: PURGE_BATCH_SIZE,
    });
    if (candidates.length === 0) return { purged, truncated: false, cutoff, retainDays };

    const ids = candidates.map((m) => m.id);
    await prisma.courseMaterial.deleteMany({ where: { id: { in: ids }, ...eligible } });
    const survivors = await prisma.courseMaterial.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    const survived = new Set(survivors.map((s) => s.id));

    for (const material of candidates) {
      if (survived.has(material.id)) continue;
      purged++;
      await logAuditAction({
        actorUserId: null,
        actorRole: null,
        actorType: "SYSTEM",
        actionCode: "MATERIAL_PURGED",
        category: "MATERIAL",
        entityType: "CourseMaterial",
        entityId: material.id,
        entityLabel: material.title,
        details: {
          courseId: material.courseId,
          deletedAt: material.deletedAt?.toISOString() ?? null,
          deletedBy: material.deletedBy,
          retainDays,
        },
      });
    }

    if (candidates.length < PURGE_BATCH_SIZE) {
      return { purged, truncated: false, cutoff, retainDays };
    }
  }
  return { purged, truncated: true, cutoff, retainDays };
}

/** The cron run's persisted summary line. */
export function formatPurgeMessage(result: PurgeDeletedMaterialsResult): string {
  const day = result.cutoff.toISOString().slice(0, 10);
  const base = `Purged ${result.purged} material(s) soft-deleted before ${day}`;
  return result.truncated ? `${base} (stopped at per-run limit; remainder next run)` : base;
}
