// @vitest-environment node
/**
 * #1787 — PDF upload bug investigation (COSC 111).
 *
 * The existing PDF coverage (`file-processing.test.ts`, `pdf-extraction-isolation.test.ts`)
 * only ever fed the extractor a page whose content stream is `q Q` — a PDF with no text
 * operators at all — and asserted `expect.any(String)`. Nothing in the suite had ever put
 * text *into* a PDF and asserted it came back out, which is why the whole class of
 * "PDF parses fine but yields nothing" defects was invisible.
 *
 * These cases use the real `@opendocsg/pdf2md` subprocess (no mocks): the PDFs are built
 * byte-by-byte here so there is nothing to keep in sync with a committed fixture, except
 * the AES-encrypted one, which cannot reasonably be hand-assembled.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  extractPdfText,
  extractUploadedFileContent,
  generateChecksum,
} from "~/lib/ai/file-processing";

const PASSWORD_PROTECTED_FIXTURE = join(
  process.cwd(),
  "app/tests/fixtures/pdf-password-protected.pdf",
);

/** Assemble a single-page PDF from pre-rendered object bodies, with an accurate xref table. */
function buildPdf(objects: Array<Buffer | string>): Buffer {
  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n")];
  const offsets: number[] = [];

  for (const body of objects) {
    offsets.push(parts.reduce((total, part) => total + part.length, 0));
    parts.push(Buffer.isBuffer(body) ? body : Buffer.from(body));
  }

  const xrefOffset = parts.reduce((total, part) => total + part.length, 0);
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    xref += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  parts.push(Buffer.from(xref));
  parts.push(
    Buffer.from(
      `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`,
    ),
  );

  return Buffer.concat(parts);
}

/** A PDF that really does carry a text layer: Helvetica plus two `Tj` show-text operators. */
function buildTextLayerPdf(): Buffer {
  const stream =
    "BT /F1 12 Tf 72 700 Td (COSC 111 Lecture 1: variables bind names to values.) Tj ET\n" +
    "BT /F1 12 Tf 72 680 Td (A loop repeats a block until its condition is false.) Tj ET\n";

  return buildPdf([
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] " +
      "/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n",
    `4 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}endstream\nendobj\n`,
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
  ]);
}

/**
 * A scanned handout: one page holding nothing but a raw RGB image XObject. Structurally
 * valid, opens fine in any reader, and has no text layer whatsoever — the shape a lecturer
 * produces by running paper through a departmental scanner.
 *
 * `seed` varies the pixel bytes so two calls give genuinely different documents.
 */
function buildImageOnlyPdf(seed: number): Buffer {
  const width = 8;
  const height = 8;
  const pixels = Buffer.alloc(width * height * 3);
  for (let i = 0; i < pixels.length; i += 1) {
    pixels[i] = (i * 7 + seed * 31) % 256;
  }

  const stream = "q 400 0 0 400 100 200 cm /Im1 Do Q\n";
  const imageObject = Buffer.concat([
    Buffer.from(
      `6 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${pixels.length} >>\nstream\n`,
    ),
    pixels,
    Buffer.from("\nendstream\nendobj\n"),
  ]);

  return buildPdf([
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] " +
      "/Resources << /XObject << /Im1 6 0 R >> >> /Contents 4 0 R >>\nendobj\n",
    `4 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}endstream\nendobj\n`,
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    imageObject,
  ]);
}

function pdfUpload(bytes: Buffer, name: string): File {
  return new File([new Uint8Array(bytes)], name, { type: "application/pdf" });
}

/**
 * Settled outcome of one upload-path extraction.
 *
 * `expect(...).rejects.toSatisfy((error: unknown) => ...)` trips the anti-slop lint rules,
 * and these cases need to assert on *both* branches — what a rejection said and what a
 * resolution carried — so the outcome is captured as a value instead. A `catch` binding is
 * not a parameter, so it is allowed to be untyped here.
 */
type ExtractionOutcome =
  | { kind: "resolved"; checksum: string; content: string }
  | { kind: "rejected"; message: string };

async function runUploadExtraction(file: File): Promise<ExtractionOutcome> {
  try {
    const info = await extractUploadedFileContent(file);
    return { kind: "resolved", checksum: info.checksum, content: info.content };
  } catch (error) {
    return { kind: "rejected", message: error instanceof Error ? error.message : String(error) };
  }
}

describe("PDF text-layer extraction (#1787)", () => {
  it("returns the text of a PDF that has a text layer", async () => {
    const result = await extractPdfText(pdfUpload(buildTextLayerPdf(), "lecture-01.pdf"));

    expect(result.content).toContain("COSC 111 Lecture 1");
    expect(result.content).toContain("A loop repeats a block until its condition is false.");
  });

  it("fails an image-only PDF instead of reporting success with no extracted text", async () => {
    const scan = pdfUpload(buildImageOnlyPdf(1), "scanned-handout.pdf");

    await expect(extractPdfText(scan)).rejects.toThrow(/no extractable text layer/i);
  });

  it("fails an image-only PDF at extraction, before the row is given any rawText", async () => {
    const outcome = await runUploadExtraction(pdfUpload(buildImageOnlyPdf(1), "week-03-scan.pdf"));

    // A resolution here is the defect: `runMaterialExtraction` writes `fileInfo.content`
    // to `rawText` and only then embeds, so an empty resolution lands the row in FAILED
    // *with* rawText — which the team reads as "failed at embedding" when nothing was
    // ever extracted and no embedding provider was contacted.
    expect(outcome.kind).toBe("rejected");
    expect(outcome).toMatchObject({ message: expect.stringMatching(/no extractable text layer/i) });
  });

  it("never checksums two different image-only PDFs to the same empty-content hash", async () => {
    // sha256(""), the value `generateChecksum` returns for empty extracted text. It is a
    // constant, so every scanned PDF that extracts to nothing writes the *same* value to
    // CourseMaterial.checksum — the `(courseId, checksum)` dedup index then reports the
    // second unrelated scan as a duplicate of the first.
    const emptyContentChecksum = generateChecksum("");
    expect(emptyContentChecksum).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );

    const first = await runUploadExtraction(pdfUpload(buildImageOnlyPdf(1), "chapter-1-scan.pdf"));
    const second = await runUploadExtraction(pdfUpload(buildImageOnlyPdf(2), "chapter-2-scan.pdf"));

    expect([first.kind, second.kind]).toEqual(["rejected", "rejected"]);
  });

  it("names the password requirement when a PDF is encrypted", async () => {
    const encrypted = readFileSync(PASSWORD_PROTECTED_FIXTURE);
    const outcome = await runUploadExtraction(pdfUpload(encrypted, "midterm-review.pdf"));

    expect(outcome.kind).toBe("rejected");
    // Without the error's name/message the operator log reads "PDF extraction worker
    // failed: Error\n at BaseExceptionClosure (...)", which names neither the file nor
    // the cause — exactly the "no stack trace" complaint #1787 was filed over.
    expect(outcome).toMatchObject({ message: expect.stringMatching(/password/i) });
  });
});
