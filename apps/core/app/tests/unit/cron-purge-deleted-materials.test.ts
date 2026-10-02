// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFindMany = vi.hoisted(() => vi.fn());
const mockDeleteMany = vi.hoisted(() => vi.fn());
const mockGetCronJobSetting = vi.hoisted(() => vi.fn());
const mockLogAuditAction = vi.hoisted(() => vi.fn());

vi.mock("~/lib/prisma.server", () => ({
  default: { courseMaterial: { findMany: mockFindMany, deleteMany: mockDeleteMany } },
}));
vi.mock("~/lib/db.cron-jobs.server", () => ({ getCronJobSetting: mockGetCronJobSetting }));
vi.mock("~/lib/logging.server", () => ({ logAuditAction: mockLogAuditAction }));

const {
  purgeDeletedMaterials,
  formatPurgeMessage,
  PURGE_BATCH_SIZE,
  PURGE_MAX_BATCHES,
  PURGE_DELETED_MATERIALS_JOB,
  RECENTLY_TOUCHED_MS,
} = await import("~/lib/cron-purge-deleted-materials.server");

const NOW = new Date("2026-09-30T05:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const TOUCHED_BEFORE = new Date(NOW.getTime() - 60 * 60 * 1000);

function material(id: string) {
  return {
    id,
    courseId: "course-1",
    title: `Title ${id}`,
    deletedAt: new Date("2026-01-01T00:00:00.000Z"),
    deletedBy: "user-1",
  };
}

/**
 * findMany is called twice per batch: first to select candidates (has `take`),
 * then to find which of them survived the delete (no `take`). `batches` feeds
 * the candidate calls; `survivors` lists ids that still exist after the delete.
 */
function scriptBatches(batches: Array<ReturnType<typeof material>[]>, survivors: string[] = []) {
  let candidateCall = 0;
  mockFindMany.mockImplementation(
    async (args: { take?: number; where: { id?: { in: string[] } } }) => {
      if (args.take !== undefined) return batches[candidateCall++] ?? [];
      const ids = args.where.id?.in ?? [];
      return ids.filter((id) => survivors.includes(id)).map((id) => ({ id }));
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCronJobSetting.mockResolvedValue(90);
  mockDeleteMany.mockResolvedValue({ count: 0 });
  mockLogAuditAction.mockResolvedValue(undefined);
});

describe("purgeDeletedMaterials", () => {
  it("reads retainDays for its own job and computes the cutoff from it", async () => {
    scriptBatches([[]]);
    const result = await purgeDeletedMaterials(NOW);
    expect(mockGetCronJobSetting).toHaveBeenCalledWith(PURGE_DELETED_MATERIALS_JOB, "retainDays");
    expect(result).toEqual({
      purged: 0,
      truncated: false,
      cutoff: new Date(NOW.getTime() - 90 * DAY_MS),
      retainDays: 90,
    });
    expect(mockDeleteMany).not.toHaveBeenCalled();
  });

  it("selects only soft-deleted rows past the cutoff with no live lease and no recent update", async () => {
    mockGetCronJobSetting.mockResolvedValue(30);
    scriptBatches([[]]);
    await purgeDeletedMaterials(NOW);
    const cutoff = new Date(NOW.getTime() - 30 * DAY_MS);
    expect(mockFindMany).toHaveBeenCalledWith({
      where: {
        deletedAt: { lt: cutoff },
        OR: [{ extractionLeaseUntil: null }, { extractionLeaseUntil: { lt: NOW } }],
        updatedAt: { lt: TOUCHED_BEFORE },
      },
      select: { id: true, courseId: true, title: true, deletedAt: true, deletedBy: true },
      orderBy: { deletedAt: "asc" },
      take: PURGE_BATCH_SIZE,
    });
  });

  it("skips rows touched within the last hour, such as a Canvas restore in progress", async () => {
    expect(RECENTLY_TOUCHED_MS).toBe(60 * 60 * 1000);
    scriptBatches([[material("m1")]]);
    await purgeDeletedMaterials(NOW);
    // The guard sits in the shared filter, so the select and the delete both carry it.
    expect(mockFindMany.mock.calls[0][0].where.updatedAt).toEqual({ lt: TOUCHED_BEFORE });
    expect(mockDeleteMany.mock.calls[0][0].where.updatedAt).toEqual({ lt: TOUCHED_BEFORE });
  });

  it("re-checks eligibility inside the delete and audits each purged material", async () => {
    scriptBatches([[material("m1"), material("m2")]]);
    const result = await purgeDeletedMaterials(NOW);
    const cutoff = new Date(NOW.getTime() - 90 * DAY_MS);
    expect(mockDeleteMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["m1", "m2"] },
        deletedAt: { lt: cutoff },
        OR: [{ extractionLeaseUntil: null }, { extractionLeaseUntil: { lt: NOW } }],
        updatedAt: { lt: TOUCHED_BEFORE },
      },
    });
    expect(result.purged).toBe(2);
    expect(mockLogAuditAction).toHaveBeenCalledTimes(2);
    expect(mockLogAuditAction).toHaveBeenCalledWith({
      actorUserId: null,
      actorRole: null,
      actorType: "SYSTEM",
      actionCode: "MATERIAL_PURGED",
      category: "MATERIAL",
      entityType: "CourseMaterial",
      entityId: "m1",
      entityLabel: "Title m1",
      details: {
        courseId: "course-1",
        deletedAt: "2026-01-01T00:00:00.000Z",
        deletedBy: "user-1",
        retainDays: 90,
      },
    });
  });

  it("does not count or audit a material restored between select and delete", async () => {
    scriptBatches([[material("m1"), material("restored")]], ["restored"]);
    const result = await purgeDeletedMaterials(NOW);
    expect(result.purged).toBe(1);
    expect(mockLogAuditAction).toHaveBeenCalledTimes(1);
    expect(mockLogAuditAction).toHaveBeenCalledWith(expect.objectContaining({ entityId: "m1" }));
  });

  it("keeps batching until a short batch and reports not truncated", async () => {
    const full = Array.from({ length: PURGE_BATCH_SIZE }, (_, i) => material(`a${i}`));
    scriptBatches([full, [material("b0")]]);
    const result = await purgeDeletedMaterials(NOW);
    expect(result).toMatchObject({ purged: PURGE_BATCH_SIZE + 1, truncated: false });
    expect(mockDeleteMany).toHaveBeenCalledTimes(2);
  });

  it("stops at the per-run batch cap and reports truncated", async () => {
    const batches = Array.from({ length: PURGE_MAX_BATCHES + 1 }, (_, b) =>
      Array.from({ length: PURGE_BATCH_SIZE }, (_, i) => material(`b${b}-${i}`)),
    );
    scriptBatches(batches);
    const result = await purgeDeletedMaterials(NOW);
    expect(result).toMatchObject({ purged: PURGE_MAX_BATCHES * PURGE_BATCH_SIZE, truncated: true });
    expect(mockDeleteMany).toHaveBeenCalledTimes(PURGE_MAX_BATCHES);
  });

  it("propagates a delete failure so the run is recorded as ERROR", async () => {
    scriptBatches([[material("m1")]]);
    mockDeleteMany.mockRejectedValue(new Error("db down"));
    await expect(purgeDeletedMaterials(NOW)).rejects.toThrow("db down");
  });
});

describe("formatPurgeMessage", () => {
  const cutoff = new Date("2026-07-02T05:00:00.000Z");

  it("reports the count and the cutoff date", () => {
    expect(formatPurgeMessage({ purged: 12, truncated: false, cutoff, retainDays: 90 })).toBe(
      "Purged 12 material(s) soft-deleted before 2026-07-02",
    );
  });

  it("says when the run stopped at the per-run limit", () => {
    expect(formatPurgeMessage({ purged: 5000, truncated: true, cutoff, retainDays: 90 })).toBe(
      "Purged 5000 material(s) soft-deleted before 2026-07-02 (stopped at per-run limit; remainder next run)",
    );
  });
});
