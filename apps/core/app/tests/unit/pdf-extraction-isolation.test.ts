// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actualFsPromises = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    mkdtemp: vi.fn(actual.mkdtemp.bind(actual)),
  };
});

const fsPromises = await import("node:fs/promises");
const {
  PdfExtractionBusyError,
  extractPdfTextIsolated,
  getPdfExtractionMaxConcurrent,
  holdPdfExtractionSlotForTests,
  resetPdfExtractionConcurrencyForTests,
} = await import("~/lib/ai/file-processing");

const BOMB_FIXTURE = join(process.cwd(), "app/tests/fixtures/pdf-decompression-bomb.pdf");

/**
 * Builds a syntactically valid, empty-content one-page PDF (accurate xref table)
 * for the happy-path check.
 */
function buildEmptyPdf(): Buffer {
  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n")];
  const offsets: number[] = [];
  const push = (str: string) => {
    offsets.push(parts.reduce((n, b) => n + b.length, 0));
    parts.push(Buffer.from(str));
  };

  push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  push("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
  push(
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents 4 0 R >>\nendobj\n",
  );
  push("4 0 obj\n<< /Length 3 >>\nstream\nq Q\nendstream\nendobj\n");

  const xrefOffset = parts.reduce((n, b) => n + b.length, 0);
  let xref = "xref\n0 5\n0000000000 65535 f \n";
  for (const off of offsets) {
    xref += `${String(off).padStart(10, "0")} 00000 n \n`;
  }
  parts.push(Buffer.from(xref));
  parts.push(Buffer.from(`trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`));

  return Buffer.concat(parts);
}

describe("extractPdfTextIsolated", () => {
  beforeEach(() => {
    resetPdfExtractionConcurrencyForTests();
    delete process.env.PDF_EXTRACTION_MAX_CONCURRENT;
    delete process.env.PDF_EXTRACTION_MAX_QUEUED;
    vi.mocked(fsPromises.mkdtemp).mockImplementation(actualFsPromises.mkdtemp);
  });

  afterEach(() => {
    resetPdfExtractionConcurrencyForTests();
    delete process.env.PDF_EXTRACTION_MAX_CONCURRENT;
    delete process.env.PDF_EXTRACTION_MAX_QUEUED;
    vi.mocked(fsPromises.mkdtemp).mockReset();
  });

  it("extracts a well-formed PDF in the isolated worker without throwing", async () => {
    const result = await extractPdfTextIsolated(buildEmptyPdf());
    expect(typeof result.content).toBe("string");
  });

  it("terminates the worker when a decompression-bomb PDF breaches the heap soft ceiling", async () => {
    // Precomputed compressed fixture (~78KB on disk); parent never materializes the
    // ~80MB inflated stream. Low maxOldSpaceMb makes V8 abort the worker.
    const bomb = readFileSync(BOMB_FIXTURE);

    await expect(
      extractPdfTextIsolated(bomb, { maxOldSpaceMb: 48, timeoutMs: 25_000 }),
    ).rejects.toThrow(/killed \(signal /i);
  }, 30_000);

  it("terminates the worker on wall-clock timeout instead of hanging forever", async () => {
    const bomb = readFileSync(BOMB_FIXTURE);

    // Vitest timeout (15s) is separate from (and above) the worker wall-clock limit (50ms).
    await expect(
      extractPdfTextIsolated(bomb, { maxOldSpaceMb: 4096, timeoutMs: 50 }),
    ).rejects.toThrow(/wall-clock limit/i);
  }, 15_000);

  it("rejects immediately with PdfExtractionBusyError when capacity is exhausted", async () => {
    process.env.PDF_EXTRACTION_MAX_CONCURRENT = "1";
    process.env.PDF_EXTRACTION_MAX_QUEUED = "0";
    expect(getPdfExtractionMaxConcurrent()).toBe(1);

    const release = await holdPdfExtractionSlotForTests();
    try {
      await expect(extractPdfTextIsolated(buildEmptyPdf(), { timeoutMs: 2_000 })).rejects.toBeInstanceOf(
        PdfExtractionBusyError,
      );
      await expect(extractPdfTextIsolated(buildEmptyPdf(), { timeoutMs: 2_000 })).rejects.toThrow(
        /busy|capacity/i,
      );
    } finally {
      release();
    }
  });

  it("releases the concurrency slot when mkdtemp fails", async () => {
    process.env.PDF_EXTRACTION_MAX_CONCURRENT = "1";
    process.env.PDF_EXTRACTION_MAX_QUEUED = "0";

    vi.mocked(fsPromises.mkdtemp).mockRejectedValueOnce(new Error("ENOSPC: mock mkdtemp failure"));

    await expect(extractPdfTextIsolated(buildEmptyPdf())).rejects.toThrow(/mkdtemp failure/i);

    // Slot must have been released — a subsequent extraction should succeed.
    const result = await extractPdfTextIsolated(buildEmptyPdf());
    expect(typeof result.content).toBe("string");
  });

  it("rejects when the worker output exceeds the distinct byte limit", async () => {
    await expect(extractPdfTextIsolated(buildEmptyPdf(), { maxOutputBytes: 1 })).rejects.toThrow(
      /exceeds the maximum of 1/i,
    );
  });
});
