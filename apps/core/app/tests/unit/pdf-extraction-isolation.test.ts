// @vitest-environment node
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actualFsPromises = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
const actualChildProcess = await vi.importActual<typeof import("node:child_process")>("node:child_process");

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    mkdtemp: vi.fn(actual.mkdtemp.bind(actual)),
  };
});

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: vi.fn(actual.spawn.bind(actual)),
  };
});

const fsPromises = await import("node:fs/promises");
const childProcess = await import("node:child_process");
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
    vi.mocked(childProcess.spawn).mockImplementation(actualChildProcess.spawn);
  });

  afterEach(() => {
    resetPdfExtractionConcurrencyForTests();
    delete process.env.PDF_EXTRACTION_MAX_CONCURRENT;
    delete process.env.PDF_EXTRACTION_MAX_QUEUED;
    vi.mocked(fsPromises.mkdtemp).mockReset();
    vi.mocked(childProcess.spawn).mockReset();
  });

  it("extracts a well-formed PDF in the isolated worker without throwing", async () => {
    const result = await extractPdfTextIsolated(buildEmptyPdf());
    expect(typeof result.content).toBe("string");
  });

  it("terminates the worker when a decompression-bomb PDF breaches the heap soft ceiling", async () => {
    // Precomputed compressed fixture (~78KB on disk); parent never materializes the
    // ~80MB inflated stream. Low maxOldSpaceMb makes V8 abort the worker.
    // Accept both termination forms: Unix typically signals (SIGABRT); Windows
    // reports V8 heap fatal errors as a plain exit code with OOM stderr — the
    // parent normalizes both to a "killed (signal …)" message.
    const bomb = readFileSync(BOMB_FIXTURE);

    await expect(
      extractPdfTextIsolated(bomb, { maxOldSpaceMb: 48, timeoutMs: 25_000 }),
    ).rejects.toThrow(/killed \(signal /i);
  }, 30_000);

  it("spawns the worker under an OS address-space ceiling on Unix", async () => {
    if (process.platform === "win32") return;

    const spawnMock = vi.mocked(childProcess.spawn);
    await extractPdfTextIsolated(buildEmptyPdf());

    expect(spawnMock).toHaveBeenCalled();
    const [command, args] = spawnMock.mock.calls[0]!;
    expect(command).toBe("sh");
    expect(args?.[0]).toBe("-c");
    expect(String(args?.[1])).toMatch(/ulimit -v \d+/);
  });

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

  it("hands off concurrency permits without overbooking on interleaved acquire", async () => {
    process.env.PDF_EXTRACTION_MAX_CONCURRENT = "1";
    process.env.PDF_EXTRACTION_MAX_QUEUED = "8";

    const releaseHeld = await holdPdfExtractionSlotForTests();

    let releaseWaiter: (() => void) | undefined;
    const waiterPromise = holdPdfExtractionSlotForTests().then((release) => {
      releaseWaiter = release;
    });

    // Waiter is queued behind the held slot.
    await new Promise((r) => setImmediate(r));
    expect(releaseWaiter).toBeUndefined();

    // Release + immediately try a concurrent fast-path acquire in the same turn.
    // Buggy decrement-then-wake lets this steal a second live slot; permit handoff
    // keeps active at 1 so this interleaved acquire must queue instead.
    releaseHeld();
    let releaseInterleaved: (() => void) | undefined;
    const interleavedPromise = holdPdfExtractionSlotForTests().then((release) => {
      releaseInterleaved = release;
    });

    await waiterPromise;
    expect(releaseWaiter).toBeDefined();
    expect(releaseInterleaved).toBeUndefined();

    releaseWaiter!();
    await interleavedPromise;
    expect(releaseInterleaved).toBeDefined();
    releaseInterleaved!();
  });

  it("kills the worker and waits for exit before rejecting on stdin failure", async () => {
    type FakeChild = EventEmitter & {
      stdin: EventEmitter & { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
      stderr: EventEmitter;
      exitCode: number | null;
      signalCode: NodeJS.Signals | null;
      kill: ReturnType<typeof vi.fn>;
    };

    const fakeStdin = new EventEmitter() as FakeChild["stdin"];
    fakeStdin.write = vi.fn(() => {
      queueMicrotask(() => {
        fakeStdin.emit("error", Object.assign(new Error("stdin broke"), { code: "EIO" }));
      });
      return true;
    });
    fakeStdin.end = vi.fn();

    const fakeChild = new EventEmitter() as FakeChild;
    fakeChild.stdin = fakeStdin;
    fakeChild.stderr = new EventEmitter();
    fakeChild.exitCode = null;
    fakeChild.signalCode = null;
    fakeChild.kill = vi.fn(() => {
      // Orphan path: process only exits after we SIGKILL it.
      queueMicrotask(() => {
        fakeChild.exitCode = 1;
        fakeChild.signalCode = "SIGKILL";
        fakeChild.emit("exit", 1, "SIGKILL");
      });
      return true;
    });

    vi.mocked(childProcess.spawn).mockReturnValue(fakeChild as unknown as ReturnType<typeof childProcess.spawn>);

    await expect(extractPdfTextIsolated(buildEmptyPdf())).rejects.toThrow(/stdin broke/i);
    expect(fakeChild.kill).toHaveBeenCalledWith("SIGKILL");

    // Slot must be released only after exit — a follow-up extraction can proceed.
    vi.mocked(childProcess.spawn).mockImplementation(actualChildProcess.spawn);
    const result = await extractPdfTextIsolated(buildEmptyPdf());
    expect(typeof result.content).toBe("string");
  });
});
