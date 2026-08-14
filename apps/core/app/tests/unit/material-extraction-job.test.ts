import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/prisma.server", () => ({
  default: {
    courseMaterial: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    materialUploadBlob: {
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock("~/lib/ai/embedding", () => ({
  processMaterialEmbeddings: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/lib/ai/file-processing", () => ({
  extractUploadedFileContent: vi.fn(),
}));

vi.mock("~/lib/logging.server", () => ({
  fireAndForget: vi.fn(),
  logSystemError: vi.fn(),
}));

import prisma from "~/lib/prisma.server";
import { processMaterialEmbeddings } from "~/lib/ai/embedding";
import { extractUploadedFileContent } from "~/lib/ai/file-processing";
import {
  EXTRACTION_LEASE_MS,
  MAX_EXTRACTION_ATTEMPTS,
  claimExtraction,
  persistUploadBlob,
  sweepStrandedMaterialExtractions,
  toBytesColumn,
} from "~/lib/materials/extraction-job.server";

const CTX = { requestId: "req-1" } as never;

function blobRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "mat-1",
    courseId: "course-1",
    uploadedBy: "user-1",
    extractionAttempts: 1,
    uploadBlob: {
      bytes: Buffer.from("hello"),
      fileName: "notes.pdf",
      mimeType: "application/pdf",
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.courseMaterial.updateMany).mockResolvedValue({ count: 1 } as never);
  vi.mocked(prisma.courseMaterial.update).mockResolvedValue({} as never);
  vi.mocked(prisma.courseMaterial.findFirst).mockResolvedValue(null as never);
  vi.mocked(prisma.courseMaterial.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.materialUploadBlob.upsert).mockResolvedValue({} as never);
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
        OR: [
          { extractionLeaseUntil: null },
          { extractionLeaseUntil: { lt: expect.any(Date) } },
        ],
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
  it("only looks at direct uploads that are PROCESSING, past their lease, and have bytes", async () => {
    await sweepStrandedMaterialExtractions(CTX);

    const [args] = vi.mocked(prisma.courseMaterial.findMany).mock.calls[0] as [any];
    expect(args.where).toEqual(
      expect.objectContaining({
        status: "PROCESSING",
        checksum: { startsWith: "pending:" },
        extractionLeaseUntil: { lt: expect.any(Date) },
        uploadBlob: { isNot: null },
      }),
    );
    // A Canvas import sitting in PROCESSING carries `canvas-pending:` and must
    // never be picked up by this sweeper.
    expect(args.where.checksum.startsWith).toBe("pending:");
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
    expect(processMaterialEmbeddings).toHaveBeenCalledWith("mat-1", "text");
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
    expect(processMaterialEmbeddings).toHaveBeenCalledWith("mat-good", "text");
  });
});
