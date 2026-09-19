import type { Prisma } from "@prisma/client";
import type { JsonObject } from "~/lib/json-value";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("~/lib/prisma.server", () => ({
  default: {
    courseMaterial: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    materialUploadBlob: {
      upsert: vi.fn(),
      deleteMany: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("~/lib/ai/embedding", () => ({
  processMaterialEmbeddings: vi.fn().mockResolvedValue(undefined),
  // #1791: the job asks whether a dead embedding was transient, to record
  // MATERIAL_EMBED_RATE_LIMITED rather than a flat MATERIAL_EMBED_FAILED.
  isTransientEmbeddingError: vi.fn().mockReturnValue(false),
}));

vi.mock("~/lib/ai/file-processing", () => ({
  extractUploadedFileContent: vi.fn(),
  // A real class, not a stub: the job distinguishes capacity failures with
  // `instanceof` so it can release the row for a retry instead of failing it.
  PdfExtractionBusyError: class PdfExtractionBusyError extends Error {
    constructor(message = "PDF extraction busy") {
      super(message);
      this.name = "PdfExtractionBusyError";
    }
  },
}));

vi.mock("~/lib/logging.server", () => ({
  fireAndForget: vi.fn(),
  logSystemError: vi.fn(),
}));

// #1624: extraction now kicks off topic analysis once a material lands READY.
vi.mock("~/lib/topics/job.server", () => ({
  startTopicAnalysis: vi.fn(),
}));

import prisma from "~/lib/prisma.server";
import { isTransientEmbeddingError, processMaterialEmbeddings } from "~/lib/ai/embedding";
import { PdfExtractionBusyError, extractUploadedFileContent } from "~/lib/ai/file-processing";
import { startTopicAnalysis } from "~/lib/topics/job.server";
import {
  EXTRACTION_LEASE_MS,
  MAX_EXTRACTION_ATTEMPTS,
  claimExtraction,
  claimRestoreTarget,
  classifyRestoreTarget,
  ensureMaterialSweeperRunning,
  persistUploadBlob,
  resolveFailureCode,
  runMaterialExtraction,
  sweepStrandedMaterialExtractions,
  toBytesColumn,
} from "~/lib/materials/extraction-job.server";

/** The `File` the job hands the extractor; contents are irrelevant to it. */
function uploadFile(): File {
  return new File([new Uint8Array([1, 2, 3])], "L3.pdf", { type: "application/pdf" });
}

/**
 * Every `courseMaterial.update` call's `data`, for one row. The job settles
 * several rows per run — a receipt and the material it points at — so assertions
 * have to say which one they mean.
 */
type MaterialUpdateData = Prisma.CourseMaterialUpdateInput;

function updatesFor(materialId: string): MaterialUpdateData[] {
  return (
    vi
      .mocked(prisma.courseMaterial.update)
      // SAFETY: every call in this suite passes `where.id`; the mock is untyped,
      // so this names the shape the module actually sends.
      .mock.calls.map(([args]) => args as { where: { id: string }; data: MaterialUpdateData })
      .filter((args) => args.where.id === materialId)
      .map((args) => args.data)
  );
}

const CTX = { requestId: "req-1" } as never;

function blobRow(overrides: JsonObject = {}) {
  return {
    id: "mat-1",
    courseId: "course-1",
    uploadedBy: "user-1",
    extractionAttempts: 1,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.courseMaterial.updateMany).mockResolvedValue({ count: 1 } as never);
  vi.mocked(prisma.courseMaterial.update).mockResolvedValue({} as never);
  vi.mocked(prisma.courseMaterial.findFirst).mockResolvedValue(null as never);
  vi.mocked(prisma.courseMaterial.findUnique).mockResolvedValue({ failureCode: null } as never);
  vi.mocked(prisma.courseMaterial.findMany).mockResolvedValue([] as never);
  vi.mocked(isTransientEmbeddingError).mockReturnValue(false);
  vi.mocked(prisma.materialUploadBlob.upsert).mockResolvedValue({} as never);
  vi.mocked(prisma.materialUploadBlob.findUnique).mockResolvedValue({
    bytes: Buffer.from("hello"),
    fileName: "notes.pdf",
    mimeType: "application/pdf",
  } as never);
  vi.mocked(prisma.materialUploadBlob.deleteMany).mockResolvedValue({ count: 1 } as never);
  vi.mocked(processMaterialEmbeddings).mockResolvedValue(undefined as never);
  vi.mocked(extractUploadedFileContent).mockResolvedValue({
    checksum: "content-checksum",
    title: "notes",
    mimeType: "application/pdf",
    fileSize: 5,
    content: "text",
  } as never);
});

describe("claimExtraction", () => {
  it("puts the whole liveness predicate in the UPDATE's WHERE", async () => {
    await claimExtraction("mat-1");

    const [args] = vi.mocked(prisma.courseMaterial.updateMany).mock.calls[0] as [any];
    expect(args.where).toEqual(
      expect.objectContaining({
        id: "mat-1",
        status: "PROCESSING",
        OR: [{ extractionLeaseUntil: null }, { extractionLeaseUntil: { lt: expect.any(Date) } }],
      }),
    );
    // A claim is also an attempt — that counter is what bounds the retry loop.
    expect(args.data.extractionAttempts).toEqual({ increment: 1 });
    expect(args.data.extractionLeaseUntil).toBeInstanceOf(Date);
  });

  it("leases far enough ahead that a legitimate run cannot be swept mid-flight", async () => {
    const before = Date.now();
    await claimExtraction("mat-1");
    const [args] = vi.mocked(prisma.courseMaterial.updateMany).mock.calls[0] as [any];

    const leaseMs = (args.data.extractionLeaseUntil as Date).getTime() - before;
    expect(leaseMs).toBeGreaterThanOrEqual(EXTRACTION_LEASE_MS - 1000);
  });

  it("reports false when another worker already holds the lease", async () => {
    vi.mocked(prisma.courseMaterial.updateMany).mockResolvedValue({ count: 0 } as never);
    expect(await claimExtraction("mat-1")).toBe(false);
  });

  it("reports true for the single winner", async () => {
    expect(await claimExtraction("mat-1")).toBe(true);
  });
});

describe("persistUploadBlob", () => {
  it("upserts so a reclaimed row's stale bytes are replaced, not duplicated", async () => {
    await persistUploadBlob("mat-1", Buffer.from("abc"), "notes.pdf", "application/pdf");

    const [args] = vi.mocked(prisma.materialUploadBlob.upsert).mock.calls[0] as [any];
    expect(args.where).toEqual({ materialId: "mat-1" });
    expect(args.create).toEqual(
      expect.objectContaining({ materialId: "mat-1", fileName: "notes.pdf" }),
    );
    expect(args.update).toEqual(expect.objectContaining({ fileName: "notes.pdf" }));
  });

  it("normalises Buffer into a plain Uint8Array for the Bytes column", () => {
    const out = toBytesColumn(Buffer.from("abc"));
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out.buffer).toBeInstanceOf(ArrayBuffer);
    expect(Buffer.from(out).toString()).toBe("abc");
  });
});

describe("sweepStrandedMaterialExtractions", () => {
  it("only looks at direct uploads that are PROCESSING, unclaimed, and have bytes", async () => {
    await sweepStrandedMaterialExtractions(CTX);

    const [args] = vi.mocked(prisma.courseMaterial.findMany).mock.calls[0] as [any];
    expect(args.where).toEqual(
      expect.objectContaining({
        status: "PROCESSING",
        checksum: { startsWith: "pending:" },
        uploadBlob: { isNot: null },
      }),
    );
    // A Canvas import sitting in PROCESSING carries `canvas-pending:` and must
    // never be picked up by this sweeper.
    expect(args.where.checksum.startsWith).toBe("pending:");
  });

  it("sweeps rows that died before their lease was ever taken (#1494 review)", async () => {
    // The row and its blob commit before anything claims them, so a crash in
    // that window leaves a null lease. `{ lt: now }` cannot match null, which
    // used to make such a row invisible to every future sweep — and re-uploading
    // the same bytes answers 409, so nothing else would ever reach it either.
    await sweepStrandedMaterialExtractions(CTX);

    const [args] = vi.mocked(prisma.courseMaterial.findMany).mock.calls[0] as [any];
    expect(args.where.OR).toEqual([
      { extractionLeaseUntil: { lt: expect.any(Date) } },
      { extractionLeaseUntil: null, updatedAt: { lt: expect.any(Date) } },
    ]);

    // The null-lease arm is gated on age, so an upload still in the seconds
    // between its INSERT and its claim is not mistaken for a dead one: the
    // cutoff is a full lease period in the past, not "now".
    const [expiredLease, unclaimed] = args.where.OR as [any, any];
    const skew = expiredLease.extractionLeaseUntil.lt.getTime() - unclaimed.updatedAt.lt.getTime();
    expect(skew).toBe(EXTRACTION_LEASE_MS);
  });

  it("resumes an abandoned row from the persisted bytes", async () => {
    vi.mocked(prisma.courseMaterial.findMany).mockResolvedValue([blobRow()] as never);

    const result = await sweepStrandedMaterialExtractions(CTX);

    expect(result).toEqual({ resumed: 1, abandoned: 0 });
    // The rebuilt File is what the original request would have handed over, so
    // the resumed run produces the same content checksum.
    const [file] = vi.mocked(extractUploadedFileContent).mock.calls[0] as [File];
    expect(file.name).toBe("notes.pdf");
    expect(file.type).toBe("application/pdf");
    expect(await file.text()).toBe("hello");
    // It ran the whole job, not just the claim.
    expect(processMaterialEmbeddings).toHaveBeenCalledWith("mat-1", "text", {
      replace: true,
    });
  });

  it("re-embeds with replace so a crash before READY cannot double the chunks", async () => {
    // The embedding transaction commits before the READY update, so a crash
    // between them leaves a PROCESSING row that is already embedded. The sweeper
    // resumes it and lands back on the same call — with `replace: false` that
    // second pass would append a duplicate set of chunks and vectors (#1494
    // review).
    vi.mocked(prisma.courseMaterial.findMany).mockResolvedValue([blobRow()] as never);

    await sweepStrandedMaterialExtractions(CTX);
    await sweepStrandedMaterialExtractions(CTX);

    expect(processMaterialEmbeddings).toHaveBeenCalledTimes(2);
    for (const call of vi.mocked(processMaterialEmbeddings).mock.calls) {
      expect(call[2]).toEqual({ replace: true });
    }
  });

  it("skips a row whose lease another worker took first", async () => {
    vi.mocked(prisma.courseMaterial.findMany).mockResolvedValue([blobRow()] as never);
    vi.mocked(prisma.courseMaterial.updateMany).mockResolvedValue({ count: 0 } as never);

    const result = await sweepStrandedMaterialExtractions(CTX);

    expect(result).toEqual({ resumed: 0, abandoned: 0 });
    expect(extractUploadedFileContent).not.toHaveBeenCalled();
  });

  it("abandons a row that has burned through its attempts instead of looping", async () => {
    vi.mocked(prisma.courseMaterial.findMany).mockResolvedValue([
      blobRow({ extractionAttempts: MAX_EXTRACTION_ATTEMPTS }),
    ] as never);

    const result = await sweepStrandedMaterialExtractions(CTX);

    expect(result).toEqual({ resumed: 0, abandoned: 1 });
    expect(extractUploadedFileContent).not.toHaveBeenCalled();
    expect(prisma.courseMaterial.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "mat-1" },
        data: expect.objectContaining({ status: "FAILED", extractionLeaseUntil: null }),
      }),
    );
    // A file that reliably kills its worker must not keep its bytes around.
    expect(prisma.materialUploadBlob.deleteMany).toHaveBeenCalledWith({
      where: { materialId: "mat-1" },
    });
  });

  it("drops the persisted bytes once a resumed run lands READY", async () => {
    vi.mocked(prisma.courseMaterial.findMany).mockResolvedValue([blobRow()] as never);

    await sweepStrandedMaterialExtractions(CTX);

    expect(prisma.courseMaterial.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "READY", extractionLeaseUntil: null }),
      }),
    );
    expect(prisma.materialUploadBlob.deleteMany).toHaveBeenCalledWith({
      where: { materialId: "mat-1" },
    });
  });

  it("starts topic analysis for the material it just made READY (#1624)", async () => {
    vi.mocked(prisma.courseMaterial.findMany).mockResolvedValue([blobRow()] as never);

    await sweepStrandedMaterialExtractions(CTX);

    // Started only after READY, and scoped to the one material that reached it —
    // topic analysis reads rawText, which a PROCESSING row does not reliably have.
    expect(startTopicAnalysis).toHaveBeenCalledWith({
      courseId: "course-1",
      userId: "user-1",
      materialIds: ["mat-1"],
    });
  });

  it("does not start topic analysis when embedding fails before READY (#1624)", async () => {
    vi.mocked(prisma.courseMaterial.findMany).mockResolvedValue([blobRow()] as never);
    vi.mocked(processMaterialEmbeddings).mockRejectedValueOnce(new Error("embed failed"));

    await sweepStrandedMaterialExtractions(CTX);

    expect(startTopicAnalysis).not.toHaveBeenCalled();
  });

  it("keeps going after one row fails so a single bad upload cannot stall the sweep", async () => {
    vi.mocked(prisma.courseMaterial.findMany).mockResolvedValue([
      blobRow({ id: "mat-bad" }),
      blobRow({ id: "mat-good" }),
    ] as never);
    vi.mocked(extractUploadedFileContent)
      .mockRejectedValueOnce(new Error("worker killed"))
      .mockResolvedValue({
        checksum: "content-checksum",
        title: "notes",
        mimeType: "application/pdf",
        fileSize: 5,
        content: "text",
      } as never);

    const result = await sweepStrandedMaterialExtractions(CTX);

    // Both were claimed and run; the failure is terminal for its own row only.
    expect(result.resumed).toBe(2);
    expect(prisma.courseMaterial.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "mat-bad" },
        data: expect.objectContaining({ status: "FAILED" }),
      }),
    );
    expect(processMaterialEmbeddings).toHaveBeenCalledWith("mat-good", "text", {
      replace: true,
    });
  });

  it("never loads the batch's bytes at once (#1494 review)", async () => {
    // Selecting `uploadBlob.bytes` on the scan materialized every stranded
    // upload in one array: at the 50 MB upload cap and a batch of 20 that is
    // ~1 GB before the `File` copies, which can OOM the process and strand the
    // very backlog the sweep exists to drain. Ids only, one blob at a time.
    vi.mocked(prisma.courseMaterial.findMany).mockResolvedValue([
      blobRow({ id: "mat-1" }),
      blobRow({ id: "mat-2" }),
    ] as never);

    await sweepStrandedMaterialExtractions(CTX);

    const [args] = vi.mocked(prisma.courseMaterial.findMany).mock.calls[0] as [any];
    expect(args.select.uploadBlob).toBeUndefined();
    expect(
      vi.mocked(prisma.materialUploadBlob.findUnique).mock.calls.map(([c]: [any]) => c.where),
    ).toEqual([{ materialId: "mat-1" }, { materialId: "mat-2" }]);
  });

  it("skips a row whose blob is gone by the time the sweep reaches it", async () => {
    // A row finalized between the scan and the fetch has already dropped its
    // bytes; there is nothing to resume from and nothing to fail it over.
    vi.mocked(prisma.courseMaterial.findMany).mockResolvedValue([blobRow()] as never);
    vi.mocked(prisma.materialUploadBlob.findUnique).mockResolvedValue(null as never);

    const result = await sweepStrandedMaterialExtractions(CTX);

    expect(result).toEqual({ resumed: 0, abandoned: 0 });
    expect(extractUploadedFileContent).not.toHaveBeenCalled();
  });
});

describe("ensureMaterialSweeperRunning", () => {
  beforeEach(() => {
    globalThis.__materialSweeperTimer = undefined;
  });

  afterEach(() => {
    if (globalThis.__materialSweeperTimer) clearInterval(globalThis.__materialSweeperTimer);
    globalThis.__materialSweeperTimer = undefined;
  });

  it("recovers stranded rows at startup with no upload to trigger it (#1494 review)", async () => {
    // The crash-before-claim case has no second actor: the row is invisible to
    // the old sweep predicate, and re-uploading the same bytes collides with it
    // and answers 409, so waiting for an upload to register the sweeper waits
    // forever. Startup registration takes no request context and sweeps at once.
    vi.mocked(prisma.courseMaterial.findMany).mockResolvedValue([
      blobRow({ id: "crashed-before-claim" }),
    ] as never);

    ensureMaterialSweeperRunning();
    await vi.waitFor(() => expect(extractUploadedFileContent).toHaveBeenCalled());

    expect(prisma.courseMaterial.findMany).toHaveBeenCalled();
  });

  it("registers one timer per process", () => {
    ensureMaterialSweeperRunning();
    const first = globalThis.__materialSweeperTimer;
    ensureMaterialSweeperRunning();

    expect(globalThis.__materialSweeperTimer).toBe(first);
    // Only the first registration sweeps; the second is a no-op.
    expect(prisma.courseMaterial.findMany).toHaveBeenCalledTimes(1);
  });
});

describe("classifyRestoreTarget", () => {
  const NOW = new Date("2026-08-17T12:00:00Z");
  const LIVE = new Date(NOW.getTime() + 60_000);
  const EXPIRED = new Date(NOW.getTime() - 60_000);

  it("restores a soft-deleted target", () => {
    expect(
      classifyRestoreTarget(
        { status: "READY", deletedAt: new Date(), extractionLeaseUntil: null },
        NOW,
      ),
    ).toBe("restore");
  });

  it("resumes a restore whose worker died mid-flight (#1494 review)", () => {
    // The old code read "not soft-deleted" as "settled" and resolved the receipt
    // anyway, stranding the half-restored target forever — the receipt was the
    // only thing that would ever look at it, because the target keeps its
    // content checksum and so the sweeper's `pending:` scan cannot see it.
    expect(
      classifyRestoreTarget(
        { status: "PROCESSING", deletedAt: null, extractionLeaseUntil: EXPIRED },
        NOW,
      ),
    ).toBe("restore");
  });

  it("waits rather than resolving the receipt while a restore is live", () => {
    expect(
      classifyRestoreTarget(
        { status: "PROCESSING", deletedAt: null, extractionLeaseUntil: LIVE },
        NOW,
      ),
    ).toBe("busy");
  });

  it("will not restore a live target that was soft-deleted mid-flight (#1494 review)", () => {
    // DELETE only stamps `deletedAt`; it does not stop the worker already
    // restoring the row. Reading the flag first handed that target to a second
    // claimant, and both workers embedded and finalized the same material. The
    // live lease is checked first, for deleted and undeleted rows alike.
    expect(
      classifyRestoreTarget(
        { status: "PROCESSING", deletedAt: new Date(), extractionLeaseUntil: LIVE },
        NOW,
      ),
    ).toBe("busy");
    // Once that worker's lease lapses the target is reclaimable again.
    expect(
      classifyRestoreTarget(
        { status: "PROCESSING", deletedAt: new Date(), extractionLeaseUntil: EXPIRED },
        NOW,
      ),
    ).toBe("restore");
  });

  it("leaves an unleased PROCESSING row alone — that is a Canvas import", () => {
    // `extractionLeaseUntil` is only ever written by this module, so a
    // PROCESSING row that has never been leased belongs to something else.
    expect(
      classifyRestoreTarget(
        { status: "PROCESSING", deletedAt: null, extractionLeaseUntil: null },
        NOW,
      ),
    ).toBe("settled");
  });

  it("treats a live READY target as settled", () => {
    expect(
      classifyRestoreTarget({ status: "READY", deletedAt: null, extractionLeaseUntil: null }, NOW),
    ).toBe("settled");
  });

  it("reclaims a live FAILED target instead of calling it settled (#1791)", () => {
    // The bug behind the COSC 111 report. A material that died *after*
    // extraction holds the course's (courseId, checksum) slot with the real
    // content hash, so every re-upload of the file found it — and `settled`
    // turned that into "a file with identical content already exists", a
    // permanent refusal protecting a row that contains nothing. Re-uploading a
    // failed file means retry it.
    expect(
      classifyRestoreTarget({ status: "FAILED", deletedAt: null, extractionLeaseUntil: null }, NOW),
    ).toBe("restore");
  });

  it("reclaims a FAILED target whether or not it was also deleted", () => {
    // Deleting the failed row was the instructor's workaround, and it must not
    // change the answer: both shapes are a retry.
    expect(
      classifyRestoreTarget(
        { status: "FAILED", deletedAt: new Date(), extractionLeaseUntil: null },
        NOW,
      ),
    ).toBe("restore");
  });
});

describe("claimRestoreTarget", () => {
  it("un-deletes and leases in one statement, never on a null lease", async () => {
    await claimRestoreTarget("target-1", "user-1", "restored text");

    const [args] = vi.mocked(prisma.courseMaterial.updateMany).mock.calls[0] as [any];
    expect(args.where).toEqual({
      id: "target-1",
      OR: [
        // Soft-deleted is not on its own enough (#1494 review): a DELETE landing
        // mid-restore must not re-open a target whose worker is still running.
        { deletedAt: { not: null }, status: { not: "PROCESSING" } },
        // #1791: a live FAILED row is terminal, so nothing owns it — re-uploading
        // the file is a retry, not a duplicate.
        { deletedAt: null, status: "FAILED" },
        // An expired lease only — a PROCESSING row with a null lease is a
        // Canvas import, not an abandoned restore.
        { status: "PROCESSING", extractionLeaseUntil: { lt: expect.any(Date) } },
      ],
    });
    // The row is leaving FAILED, so the reason it failed goes with it (#1791).
    expect(args.data.failureCode).toBeNull();
    expect(args.data.duplicateResolution).toBeNull();
    // The un-delete and the lease are the same write, so there is no window in
    // which the target is PROCESSING with nothing claiming it.
    expect(args.data.deletedAt).toBeNull();
    expect(args.data.status).toBe("PROCESSING");
    expect(args.data.extractionLeaseUntil).toBeInstanceOf(Date);
    expect(args.data.rawText).toBe("restored text");
  });

  it("reports the loss when another worker already holds the restore", async () => {
    vi.mocked(prisma.courseMaterial.updateMany).mockResolvedValue({ count: 0 } as never);

    expect(await claimRestoreTarget("target-1", "user-1", "restored text")).toBe(false);
  });
});

// ── #1791: a failed upload must stay retryable, and say why it failed ─────────
//
// The instructor-reported loop: L3 fails to process ("Processing failed for this
// file"), the second attempt is refused as a duplicate, deleting the file does
// not help, and the third attempt is refused again. Each test below pins one
// link in that chain.

describe("resolveFailureCode", () => {
  it("names a capacity failure rather than blaming the file", () => {
    expect(resolveFailureCode("MATERIAL_EXTRACT_FAILED", new PdfExtractionBusyError())).toBe(
      "MATERIAL_EXTRACT_BUSY",
    );
  });

  it("distinguishes a rate-limited embedding from an unindexable one", () => {
    vi.mocked(isTransientEmbeddingError).mockReturnValue(true);
    expect(resolveFailureCode("MATERIAL_EMBED_FAILED", new Error("429"))).toBe(
      "MATERIAL_EMBED_RATE_LIMITED",
    );
  });

  it("passes the stage code through when nothing refines it", () => {
    expect(resolveFailureCode("MATERIAL_EMBED_FAILED", new Error("boom"))).toBe(
      "MATERIAL_EMBED_FAILED",
    );
    expect(resolveFailureCode("MATERIAL_EXTRACT_FAILED", new Error("boom"))).toBe(
      "MATERIAL_EXTRACT_FAILED",
    );
    expect(resolveFailureCode("MATERIAL_EXTRACT_ABANDONED", new Error("boom"))).toBe(
      "MATERIAL_EXTRACT_ABANDONED",
    );
  });

  it("only refines the stage it belongs to", () => {
    // A transient *extraction* error is not an embedding rate limit: the
    // refinement is scoped to the stage that produced the failure.
    vi.mocked(isTransientEmbeddingError).mockReturnValue(true);
    expect(resolveFailureCode("MATERIAL_EXTRACT_FAILED", new Error("429"))).toBe(
      "MATERIAL_EXTRACT_FAILED",
    );
  });
});

describe("runMaterialExtraction failure recording (#1791)", () => {
  it("records why a material failed, so the UI is not left guessing", async () => {
    vi.mocked(isTransientEmbeddingError).mockReturnValue(true);
    vi.mocked(processMaterialEmbeddings).mockRejectedValue(new Error("429 rate limit"));

    await runMaterialExtraction("mat-1", uploadFile(), "course-1", "user-1", CTX);

    expect(updatesFor("mat-1")).toContainEqual(
      expect.objectContaining({
        status: "FAILED",
        failureCode: "MATERIAL_EMBED_RATE_LIMITED",
      }),
    );
  });

  it("clears a stale reason when a row lands READY", async () => {
    await runMaterialExtraction("mat-1", uploadFile(), "course-1", "user-1", CTX);

    // A resumed run may be re-finalizing a row an earlier attempt failed; the
    // old reason must not outlive the failure it described.
    expect(updatesFor("mat-1")).toContainEqual(
      expect.objectContaining({ status: "READY", failureCode: null }),
    );
  });

  it("releases a capacity failure for a later sweep instead of failing it", async () => {
    vi.mocked(extractUploadedFileContent).mockRejectedValue(new PdfExtractionBusyError());

    await runMaterialExtraction("mat-1", uploadFile(), "course-1", "user-1", CTX);

    const [data] = updatesFor("mat-1");
    // Still PROCESSING with an already-expired lease: the next sweep (<=5 min)
    // picks it up, rather than the 15 minutes a null lease would cost. Failing
    // it here is what turned a burst of uploads into broken materials.
    expect(data.status).toBe("PROCESSING");
    expect(data.extractionLeaseUntil).toBeInstanceOf(Date);
    expect((data.extractionLeaseUntil as Date).getTime()).toBeLessThan(Date.now());
    expect(updatesFor("mat-1")).not.toContainEqual(expect.objectContaining({ status: "FAILED" }));
  });
});

describe("runMaterialExtraction duplicate resolution (#1791)", () => {
  /**
   * A settled row the re-upload's content checksum collides with. Only the four
   * fields `classifyRestoreTarget` reads matter, so this names exactly those.
   */
  type DuplicateRow = {
    id: string;
    status: string;
    deletedAt: Date | null;
    extractionLeaseUntil: Date | null;
  };

  function duplicateRow(overrides: Partial<DuplicateRow> = {}): DuplicateRow {
    return {
      id: "winner-1",
      status: "FAILED",
      deletedAt: null,
      extractionLeaseUntil: null,
      ...overrides,
    };
  }

  it("retries a FAILED twin rather than refusing the upload as a duplicate", async () => {
    vi.mocked(prisma.courseMaterial.findFirst).mockResolvedValue(duplicateRow() as never);

    await runMaterialExtraction("receipt-1", uploadFile(), "course-1", "user-1", CTX);

    // The whole point: the second upload of a failed file re-embeds it.
    expect(processMaterialEmbeddings).toHaveBeenCalledWith("winner-1", "text", {
      replace: true,
    });
    expect(updatesFor("winner-1")).toContainEqual(
      expect.objectContaining({ status: "READY", failureCode: null }),
    );
  });

  it("marks the receipt RESTORED so a successful retry reads as a success", async () => {
    vi.mocked(prisma.courseMaterial.findFirst).mockResolvedValue(duplicateRow() as never);

    await runMaterialExtraction("receipt-1", uploadFile(), "course-1", "user-1", CTX);

    expect(updatesFor("receipt-1")).toContainEqual(
      expect.objectContaining({
        duplicateOfId: "winner-1",
        duplicateResolution: "RESTORED",
      }),
    );
  });

  it("marks an untouched winner EXISTING - nothing was added", async () => {
    vi.mocked(prisma.courseMaterial.findFirst).mockResolvedValue(
      duplicateRow({ status: "READY" }) as never,
    );

    await runMaterialExtraction("receipt-1", uploadFile(), "course-1", "user-1", CTX);

    expect(processMaterialEmbeddings).not.toHaveBeenCalled();
    expect(updatesFor("receipt-1")).toContainEqual(
      expect.objectContaining({
        duplicateOfId: "winner-1",
        duplicateResolution: "EXISTING",
      }),
    );
  });

  it("reports a failed restore as a failure, not as an existing duplicate", async () => {
    // Attempt 3 of the original report. The restore's embedding failed, and the
    // code then fell through to the duplicate receipt anyway - so the client was
    // told the content was already there while the only copy of it sat FAILED,
    // and it deleted the receipt, erasing the attempt. There was no way out.
    vi.mocked(prisma.courseMaterial.findFirst).mockResolvedValue(
      duplicateRow({ deletedAt: new Date() }) as never,
    );
    vi.mocked(isTransientEmbeddingError).mockReturnValue(true);
    vi.mocked(processMaterialEmbeddings).mockRejectedValue(new Error("429 rate limit"));
    vi.mocked(prisma.courseMaterial.findUnique).mockResolvedValue({
      failureCode: "MATERIAL_EMBED_RATE_LIMITED",
    } as never);

    await runMaterialExtraction("receipt-1", uploadFile(), "course-1", "user-1", CTX);

    // A receipt carrying a reason is how the client tells a failed restore from
    // a duplicate; without the code it would report "already exists" again.
    expect(updatesFor("receipt-1")).toContainEqual(
      expect.objectContaining({
        status: "FAILED",
        duplicateOfId: "winner-1",
        failureCode: "MATERIAL_EMBED_RATE_LIMITED",
      }),
    );
  });

  it("falls back to a generic embed failure when the target's code is unreadable", async () => {
    vi.mocked(prisma.courseMaterial.findFirst).mockResolvedValue(duplicateRow() as never);
    vi.mocked(processMaterialEmbeddings).mockRejectedValue(new Error("boom"));
    vi.mocked(prisma.courseMaterial.findUnique).mockRejectedValue(new Error("db down"));

    await runMaterialExtraction("receipt-1", uploadFile(), "course-1", "user-1", CTX);

    expect(updatesFor("receipt-1")).toContainEqual(
      expect.objectContaining({ status: "FAILED", failureCode: "MATERIAL_EMBED_FAILED" }),
    );
  });

  it("still waits rather than resolving a receipt against a live restore", async () => {
    vi.mocked(prisma.courseMaterial.findFirst).mockResolvedValue(
      duplicateRow({
        status: "PROCESSING",
        extractionLeaseUntil: new Date(Date.now() + 60_000),
      }) as never,
    );

    await runMaterialExtraction("receipt-1", uploadFile(), "course-1", "user-1", CTX);

    expect(updatesFor("receipt-1")).toEqual([]);
  });
});
