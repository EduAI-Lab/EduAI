// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFindMany = vi.hoisted(() => vi.fn());
const mockFindFirst = vi.hoisted(() => vi.fn());
const mockDeleteMany = vi.hoisted(() => vi.fn());
const mockAuditCreateMany = vi.hoisted(() => vi.fn());
const mockTransaction = vi.hoisted(() => vi.fn());
const mockGetCronJobSetting = vi.hoisted(() => vi.fn());

vi.mock("~/lib/prisma.server", () => ({
  default: {
    courseMaterial: { findMany: mockFindMany, findFirst: mockFindFirst },
    $transaction: mockTransaction,
  },
}));
vi.mock("~/lib/db.cron-jobs.server", () => ({ getCronJobSetting: mockGetCronJobSetting }));

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

const tx = {
  courseMaterial: { deleteMany: mockDeleteMany },
  auditLog: { createMany: mockAuditCreateMany },
};

/**
 * `batches` feeds the candidate selects in order. Each candidate is then deleted
 * by its own `deleteMany`; ids in `notDeleted` come back with count 0, as a row
 * restored or already removed by an overlapping run would.
 */
function scriptBatches(batches: Array<ReturnType<typeof material>[]>, notDeleted: string[] = []) {
  let candidateCall = 0;
  mockFindMany.mockImplementation(async () => batches[candidateCall++] ?? []);
  mockDeleteMany.mockImplementation(async (args: { where: { id: string } }) => ({
    count: notDeleted.includes(args.where.id) ? 0 : 1,
  }));
}

/** Every audit row written across the run, in order. */
function auditedIds(): string[] {
  return mockAuditCreateMany.mock.calls.flatMap((call) =>
    // SAFETY: the handler only ever calls `auditLog.createMany({ data: [...] })`.
    (call[0] as { data: { entityId: string }[] }).data.map((row) => row.entityId),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCronJobSetting.mockResolvedValue(90);
  mockFindFirst.mockResolvedValue(null);
  mockAuditCreateMany.mockResolvedValue({ count: 0 });
  mockTransaction.mockImplementation(async (fn: (client: typeof tx) => Promise<number>) => fn(tx));
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
    expect(mockTransaction).not.toHaveBeenCalled();
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

  it("re-checks eligibility on each row's delete and audits it in the same transaction", async () => {
    scriptBatches([[material("m1"), material("m2")]]);
    const result = await purgeDeletedMaterials(NOW);
    const cutoff = new Date(NOW.getTime() - 90 * DAY_MS);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockDeleteMany).toHaveBeenCalledTimes(2);
    expect(mockDeleteMany).toHaveBeenCalledWith({
      where: {
        id: "m1",
        deletedAt: { lt: cutoff },
        OR: [{ extractionLeaseUntil: null }, { extractionLeaseUntil: { lt: NOW } }],
        updatedAt: { lt: TOUCHED_BEFORE },
      },
    });
    expect(result.purged).toBe(2);
    expect(mockAuditCreateMany).toHaveBeenCalledTimes(1);
    expect(mockAuditCreateMany.mock.calls[0][0].data[0]).toEqual({
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
    expect(auditedIds()).toEqual(["m1", "m2"]);
  });

  it("does not count or audit a row this run did not delete, whether restored or removed by an overlapping run", async () => {
    scriptBatches([[material("m1"), material("gone-elsewhere")]], ["gone-elsewhere"]);
    const result = await purgeDeletedMaterials(NOW);
    expect(result.purged).toBe(1);
    expect(auditedIds()).toEqual(["m1"]);
  });

  it("writes no audit rows when no candidate was deleted", async () => {
    scriptBatches([[material("m1")]], ["m1"]);
    const result = await purgeDeletedMaterials(NOW);
    expect(result.purged).toBe(0);
    expect(mockAuditCreateMany).not.toHaveBeenCalled();
  });

  it("fails the run when the audit write fails, so the transaction rolls the delete back", async () => {
    scriptBatches([[material("m1")]]);
    mockAuditCreateMany.mockRejectedValue(new Error("audit_logs unavailable"));
    await expect(purgeDeletedMaterials(NOW)).rejects.toThrow("audit_logs unavailable");
  });

  it("keeps batching until a short batch and reports not truncated", async () => {
    const full = Array.from({ length: PURGE_BATCH_SIZE }, (_, i) => material(`a${i}`));
    scriptBatches([full, [material("b0")]]);
    const result = await purgeDeletedMaterials(NOW);
    expect(result).toMatchObject({ purged: PURGE_BATCH_SIZE + 1, truncated: false });
    expect(mockTransaction).toHaveBeenCalledTimes(2);
  });

  it("stops at the per-run batch cap and reports truncated while eligible rows remain", async () => {
    const batches = Array.from({ length: PURGE_MAX_BATCHES + 1 }, (_, b) =>
      Array.from({ length: PURGE_BATCH_SIZE }, (_, i) => material(`b${b}-${i}`)),
    );
    scriptBatches(batches);
    mockFindFirst.mockResolvedValue({ id: "left-over" });
    const result = await purgeDeletedMaterials(NOW);
    expect(result).toMatchObject({ purged: PURGE_MAX_BATCHES * PURGE_BATCH_SIZE, truncated: true });
    expect(mockTransaction).toHaveBeenCalledTimes(PURGE_MAX_BATCHES);
  });

  it("does not report truncated when the capped run took exactly the whole backlog", async () => {
    const batches = Array.from({ length: PURGE_MAX_BATCHES }, (_, b) =>
      Array.from({ length: PURGE_BATCH_SIZE }, (_, i) => material(`b${b}-${i}`)),
    );
    scriptBatches(batches);
    const result = await purgeDeletedMaterials(NOW);
    expect(result).toMatchObject({
      purged: PURGE_MAX_BATCHES * PURGE_BATCH_SIZE,
      truncated: false,
    });
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({ deletedAt: { lt: new Date(NOW.getTime() - 90 * DAY_MS) } }),
      select: { id: true },
    });
  });

  it("stops before the next batch once the run's lease is lost", async () => {
    const controller = new AbortController();
    const full = Array.from({ length: PURGE_BATCH_SIZE }, (_, i) => material(`a${i}`));
    scriptBatches([full, full]);
    mockTransaction.mockImplementationOnce(async (fn: (client: typeof tx) => Promise<number>) => {
      const removed = await fn(tx);
      controller.abort();
      return removed;
    });
    await expect(purgeDeletedMaterials(NOW, controller.signal)).rejects.toThrow(
      `Run lease lost after purging ${PURGE_BATCH_SIZE} material(s)`,
    );
    expect(mockTransaction).toHaveBeenCalledTimes(1);
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
