// @vitest-environment node
//
// purge-deleted-materials against real Postgres: the cascade (chunks,
// embeddings, upload blobs, topic sources), SetNull on duplicate receipts, and
// the lease/restore guards can only be proven with real foreign keys. Other
// suites may leave old soft-deleted materials behind that this job also purges,
// so assertions are about this file's own rows, never the run's total.

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import prisma from "~/lib/prisma.server";
import { purgeDeletedMaterials } from "~/lib/cron-purge-deleted-materials.server";
import {
  getCronJobSetting,
  listCronJobStatuses,
  resetCronJobSetting,
  updateCronJobSetting,
} from "~/lib/db.cron-jobs.server";
import { seedCourse, cleanupRbac } from "../helpers/rbac";
import { seedMaterial, seedMaterialChunkWithEmbedding } from "../helpers/materials";

const JOB = "purge-deleted-materials";
const DAY_MS = 24 * 60 * 60 * 1000;
const EMBEDDING = Array.from({ length: 1024 }, () => 0.001);
const courseIds: string[] = [];

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * DAY_MS);
}

/**
 * Rows seeded (or updated) here get `updatedAt` = now, which the purge's
 * recently-touched guard treats as in flight. Backdate it for rows a test expects
 * to be judged only on `deletedAt` and the lease. Raw SQL, since a Prisma
 * `update` would bump `@updatedAt` right back to now.
 */
async function backdateUpdatedAt(id: string, at: Date): Promise<void> {
  await prisma.$executeRaw`UPDATE course_materials SET "updatedAt" = ${at} WHERE id = ${id}`;
}

async function exists(id: string): Promise<boolean> {
  return (await prisma.courseMaterial.count({ where: { id } })) === 1;
}

let courseId: string;

beforeAll(async () => {
  const course = await seedCourse();
  courseId = course.id;
  courseIds.push(course.id);
});

afterEach(async () => {
  await prisma.cronJobSetting.deleteMany({ where: { jobName: JOB } });
});

afterAll(async () => {
  await cleanupRbac({ courseIds });
});

describe("purgeDeletedMaterials (real Postgres)", () => {
  it("purges an old soft-deleted material with its chunks, embeddings, blob and topic links", async () => {
    const old = await seedMaterial({ courseId, deletedAt: daysAgo(120) });
    const chunk = await seedMaterialChunkWithEmbedding(old.id, EMBEDDING);
    await prisma.materialUploadBlob.create({
      data: {
        materialId: old.id,
        bytes: Buffer.from("x"),
        fileName: "a.txt",
        mimeType: "text/plain",
      },
    });
    const topic = await prisma.courseTopic.create({
      data: { courseId, name: `Purge topic ${old.id}` },
    });
    await prisma.courseTopicSource.create({ data: { topicId: topic.id, materialId: old.id } });
    await backdateUpdatedAt(old.id, daysAgo(120));

    const result = await purgeDeletedMaterials();

    expect(result.purged).toBeGreaterThanOrEqual(1);
    expect(await exists(old.id)).toBe(false);
    expect(await prisma.materialChunk.count({ where: { materialId: old.id } })).toBe(0);
    const [{ count }] = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count FROM material_embeddings WHERE "chunkId" = ${chunk.id}
    `;
    expect(Number(count)).toBe(0);
    expect(await prisma.materialUploadBlob.count({ where: { materialId: old.id } })).toBe(0);
    expect(await prisma.courseTopicSource.count({ where: { materialId: old.id } })).toBe(0);
    // The topic itself is course data, not the material's — it stays.
    expect(await prisma.courseTopic.count({ where: { id: topic.id } })).toBe(1);

    const audit = await prisma.auditLog.findFirst({
      where: { actionCode: "MATERIAL_PURGED", entityId: old.id },
    });
    expect(audit).toMatchObject({ category: "MATERIAL", entityType: "CourseMaterial" });
  });

  it("keeps live, recently deleted, and lease-held materials", async () => {
    const live = await seedMaterial({ courseId });
    const recent = await seedMaterial({ courseId, deletedAt: daysAgo(10) });
    const leased = await seedMaterial({ courseId, deletedAt: daysAgo(120) });
    await prisma.courseMaterial.update({
      where: { id: leased.id },
      data: { extractionLeaseUntil: new Date(Date.now() + 10 * 60 * 1000) },
    });
    // Old updatedAt on both, so each survives for its own reason, not the recent-touch guard.
    await backdateUpdatedAt(recent.id, daysAgo(10));
    await backdateUpdatedAt(leased.id, daysAgo(120));
    const unpublishedOnly = await seedMaterial({ courseId, unpublishedAt: daysAgo(400) });

    await purgeDeletedMaterials();

    expect(await exists(live.id)).toBe(true);
    expect(await exists(recent.id)).toBe(true);
    expect(await exists(leased.id)).toBe(true);
    expect(await exists(unpublishedOnly.id)).toBe(true);
  });

  it("purges a soft-deleted material whose lease has expired", async () => {
    const stale = await seedMaterial({ courseId, deletedAt: daysAgo(120) });
    await prisma.courseMaterial.update({
      where: { id: stale.id },
      data: { extractionLeaseUntil: daysAgo(1) },
    });
    await backdateUpdatedAt(stale.id, daysAgo(1));
    await purgeDeletedMaterials();
    expect(await exists(stale.id)).toBe(false);
  });

  it("clears duplicateOfId on a receipt instead of deleting it", async () => {
    const original = await seedMaterial({ courseId, deletedAt: daysAgo(120) });
    const receipt = await seedMaterial({ courseId });
    await prisma.courseMaterial.update({
      where: { id: receipt.id },
      data: { status: "FAILED", duplicateOfId: original.id },
    });
    await backdateUpdatedAt(original.id, daysAgo(120));

    await purgeDeletedMaterials();

    expect(await exists(original.id)).toBe(false);
    const after = await prisma.courseMaterial.findUniqueOrThrow({ where: { id: receipt.id } });
    expect(after.duplicateOfId).toBeNull();
  });

  it("keeps an old soft-deleted material touched within the last hour (Canvas restore in flight)", async () => {
    const restoring = await seedMaterial({ courseId, deletedAt: daysAgo(120) });
    await backdateUpdatedAt(restoring.id, daysAgo(120));
    // What a Canvas re-sync restore does first: flip to PROCESSING with no lease and
    // deletedAt still set. The update bumps updatedAt to now.
    await prisma.courseMaterial.update({
      where: { id: restoring.id },
      data: { status: "PROCESSING" },
    });

    await purgeDeletedMaterials();
    expect(await exists(restoring.id)).toBe(true);

    // The same row with an old updatedAt is purged: the guard, not the rest of the filter, kept it.
    await backdateUpdatedAt(restoring.id, daysAgo(120));
    await purgeDeletedMaterials();
    expect(await exists(restoring.id)).toBe(false);
  });

  it("audits each material exactly once when two runs overlap", async () => {
    const seeded = await Promise.all(
      Array.from({ length: 5 }, () => seedMaterial({ courseId, deletedAt: daysAgo(120) })),
    );
    const ids = seeded.map((m) => m.id);
    for (const id of ids) await backdateUpdatedAt(id, daysAgo(120));

    // Both runs select the same candidates; the row locks decide which one deletes each.
    await Promise.all([purgeDeletedMaterials(), purgeDeletedMaterials()]);

    for (const id of ids) expect(await exists(id)).toBe(false);
    const audits = await prisma.auditLog.findMany({
      where: { actionCode: "MATERIAL_PURGED", entityId: { in: ids } },
      select: { entityId: true },
    });
    expect(audits.map((a) => a.entityId).sort()).toEqual([...ids].sort());
  });

  it("honours an admin retainDays override", async () => {
    const twentyDays = await seedMaterial({ courseId, deletedAt: daysAgo(20) });
    await backdateUpdatedAt(twentyDays.id, daysAgo(20));

    await purgeDeletedMaterials();
    expect(await exists(twentyDays.id)).toBe(true);

    await updateCronJobSetting(JOB, "retainDays", 10, "admin-test");
    const result = await purgeDeletedMaterials();
    expect(result.retainDays).toBe(10);
    expect(await exists(twentyDays.id)).toBe(false);
  });
});

describe("cron job settings (real Postgres)", () => {
  it("round-trips update, list, and reset", async () => {
    await expect(getCronJobSetting(JOB, "retainDays")).resolves.toBe(90);

    await updateCronJobSetting(JOB, "retainDays", 30, "admin-test");
    await expect(getCronJobSetting(JOB, "retainDays")).resolves.toBe(30);
    const row = await prisma.cronJobSetting.findUniqueOrThrow({
      where: { jobName_key: { jobName: JOB, key: "retainDays" } },
    });
    expect(row).toMatchObject({ value: "30", updatedBy: "admin-test" });

    const listed = (await listCronJobStatuses()).find((j) => j.name === JOB)!;
    expect(listed.settings![0]).toMatchObject({ value: 30, overridden: true });

    await resetCronJobSetting(JOB, "retainDays");
    await expect(getCronJobSetting(JOB, "retainDays")).resolves.toBe(90);
    expect(await prisma.cronJobSetting.count({ where: { jobName: JOB } })).toBe(0);
  });
});
