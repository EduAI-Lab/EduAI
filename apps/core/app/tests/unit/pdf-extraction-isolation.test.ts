// @vitest-environment node
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { extractPdfTextIsolated } from "~/lib/ai/file-processing";

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

/**
 * Builds a decompression-bomb PDF: a single FlateDecode content stream that expands
 * to `repeats * 4` bytes of harmless "q Q\n" no-op operators. Highly repetitive input
 * compresses to a few KB regardless of `repeats`, so this stays far under any upload
 * size cap while still exploding in memory once pdf2md inflates it — the same shape
 * of attack #1018 isolates against. No xref table is needed: pdfjs's recovery-scan
 * fallback finds the objects by scanning for `N G obj` markers.
 */
function buildDecompressionBombPdf(repeats: number): Buffer {
  const raw = Buffer.concat(Array(repeats).fill(Buffer.from("q Q\n")));
  const compressed = deflateSync(raw);

  return Buffer.concat([
    Buffer.from("%PDF-1.4\n"),
    Buffer.from("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"),
    Buffer.from("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n"),
    Buffer.from(
      "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents 4 0 R >>\nendobj\n",
    ),
    Buffer.from(`4 0 obj\n<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`),
    compressed,
    Buffer.from("\nendstream\nendobj\n"),
    Buffer.from("trailer\n<< /Root 1 0 R /Size 5 >>\n%%EOF"),
  ]);
}

describe("extractPdfTextIsolated", () => {
  it("extracts a well-formed PDF in the isolated worker without throwing", async () => {
    const result = await extractPdfTextIsolated(buildEmptyPdf());
    expect(typeof result.content).toBe("string");
  });

  it("kills the worker and the parent survives when a decompression-bomb PDF breaches the memory ceiling", async () => {
    // ~80MB of repeated no-op operators from a <1KB compressed stream, well past a 48MB heap cap.
    const bomb = buildDecompressionBombPdf(20_000_000);

    await expect(extractPdfTextIsolated(bomb, { maxOldSpaceMb: 48, timeoutMs: 20_000 })).rejects.toThrow(
      /memory limit/i,
    );
  }, 20_000);

  it("terminates the worker on wall-clock timeout instead of hanging forever", async () => {
    // Same bomb, but with enough headroom that it wouldn't OOM within the timeout window —
    // the timeout must fire and kill the worker before the memory ceiling would.
    const bomb = buildDecompressionBombPdf(20_000_000);

    await expect(extractPdfTextIsolated(bomb, { maxOldSpaceMb: 4096, timeoutMs: 50 })).rejects.toThrow(
      /wall-clock limit/i,
    );
  });
});
