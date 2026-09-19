// @vitest-environment node
//
// #1781 — "File upload failed in course Data 301", with no other detail.
//
// A file whose accepted format carries no *extractable text* (a single-page
// image-only PDF scan, a DOCX holding only figures, a blank .txt/.md) is not
// rejected by extraction: `extractUploadedFileContent` reports success and
// hands the pipeline an empty string. Two things then go wrong downstream, and
// neither is visible to the instructor:
//
//   1. The row is promoted with `rawText: ""` and the SHA-256 of the empty
//      string as its content checksum, and `processMaterialEmbeddings` is asked
//      to embed nothing — it throws `No content chunks generated`, so the row
//      is failed as MATERIAL_EMBED_FAILED. Nothing was ever wrong with
//      embedding: the file had no text. The stage named in the audit trail is
//      the wrong one, and (per #1794) the reason never reaches the row at all.
//   2. That checksum is a constant. Every text-free upload on a course hashes
//      to it, *across formats*, so the second one collides with the first in
//      the dedupe lookup and is failed as a duplicate of an unrelated file.
//
// These tests pin the extraction stage as the place the pipeline must stop.
import { describe, expect, it, beforeEach, vi } from "vitest";
import JSZip from "jszip";

vi.mock("~/lib/prisma.server", () => ({
  default: {
    courseMaterial: {
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    materialUploadBlob: {
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock("~/lib/ai/embedding", () => ({
  processMaterialEmbeddings: vi.fn(),
}));

vi.mock("~/lib/logging.server", () => ({
  fireAndForget: vi.fn(),
  logSystemError: vi.fn(),
}));

vi.mock("~/lib/topics/job.server", () => ({
  startTopicAnalysis: vi.fn(),
}));

import prisma from "~/lib/prisma.server";
import { processMaterialEmbeddings } from "~/lib/ai/embedding";
import { extractUploadedFileContent, generateChecksum } from "~/lib/ai/file-processing";
import { runMaterialExtraction } from "~/lib/materials/extraction-job.server";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** SHA-256 of the empty string — what every text-free extraction currently hashes to. */
const EMPTY_CONTENT_CHECKSUM = generateChecksum("");

const CTX = { requestId: "req-1781" } as never;

/**
 * A structurally valid single-page PDF whose content stream paints nothing and
 * holds no text operators — the shape a scanner produces when the page image
 * has no OCR text layer behind it.
 */
function buildScannedPdf(): Buffer {
  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n")];
  const offsets: number[] = [];
  const push = (body: string) => {
    offsets.push(parts.reduce((total, part) => total + part.length, 0));
    parts.push(Buffer.from(body));
  };

  push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  push("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
  push(
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents 4 0 R >>\nendobj\n",
  );
  push("4 0 obj\n<< /Length 3 >>\nstream\nq Q\nendstream\nendobj\n");

  const xrefOffset = parts.reduce((total, part) => total + part.length, 0);
  let xref = "xref\n0 5\n0000000000 65535 f \n";
  for (const offset of offsets) {
    xref += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  parts.push(Buffer.from(xref));
  parts.push(Buffer.from(`trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`));

  return Buffer.concat(parts);
}

/** A real DOCX container whose body holds one empty paragraph — figures only, no prose. */
async function buildImageOnlyDocx(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "word/document.xml",
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p/></w:body></w:document>',
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

function uploadFile(bytes: Buffer, name: string, mimeType: string): File {
  return new File([new Uint8Array(bytes)], name, { type: mimeType });
}

describe("#1781 upload of a file with no extractable text", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.courseMaterial.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.courseMaterial.update).mockResolvedValue({} as never);
    vi.mocked(prisma.courseMaterial.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.materialUploadBlob.deleteMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(processMaterialEmbeddings).mockResolvedValue(undefined as never);
  });

  it("stops a scanned PDF at extraction instead of reporting success with empty content", async () => {
    const file = uploadFile(buildScannedPdf(), "week3-lecture-scan.pdf", "application/pdf");

    // Extraction is the stage that knows the document had no text layer, so it
    // is the stage that must say so — naming the file, and in words an
    // instructor can act on.
    await expect(extractUploadedFileContent(file)).rejects.toThrow(
      /week3-lecture-scan\.pdf.*(no readable text|no extractable text)/i,
    );
  });

  it("never lets a text-free upload of any format reach the pipeline as the empty-string checksum", async () => {
    // The dedupe index is (courseId, checksum). If a scanned PDF, a figures-only
    // DOCX and a blank text file all hash to SHA-256("") then the second one
    // uploaded to a course is failed as a "duplicate" of the first even though
    // the two files have nothing whatsoever to do with each other.
    const candidates: Array<[string, File]> = [
      ["pdf", uploadFile(buildScannedPdf(), "scan.pdf", "application/pdf")],
      ["docx", uploadFile(await buildImageOnlyDocx(), "figures.docx", DOCX_MIME)],
      ["txt", uploadFile(Buffer.from("   \n\n\t \n"), "blank.txt", "text/plain")],
    ];

    for (const [label, file] of candidates) {
      let checksum: string | null = null;
      try {
        checksum = (await extractUploadedFileContent(file)).checksum;
      } catch {
        // Rejected at extraction: no checksum was ever produced, which is the
        // outcome this test is asking for.
      }
      expect(checksum, `${label} extracted to the empty-content checksum`).not.toBe(
        EMPTY_CONTENT_CHECKSUM,
      );
    }
  });

  it("fails the material at extraction without embedding it or persisting its checksum", async () => {
    const file = uploadFile(buildScannedPdf(), "week3-lecture-scan.pdf", "application/pdf");

    await runMaterialExtraction("mat-1781", file, "course-data-301", "user-1", CTX);

    // The embedding stage must never be handed an empty document: the file's
    // problem is upstream of it, and reaching it is what mislabels the failure
    // as MATERIAL_EMBED_FAILED.
    expect(processMaterialEmbeddings).not.toHaveBeenCalled();

    // Nothing extracted, so nothing may be promoted onto the row — in
    // particular not the empty-content checksum that poisons dedupe, and not a
    // `rawText` that makes a later reader conclude extraction succeeded.
    for (const [args] of vi.mocked(prisma.courseMaterial.update).mock.calls) {
      expect(args.data).not.toHaveProperty("checksum");
      expect(args.data).not.toHaveProperty("rawText");
    }

    // …and the row still has to reach a terminal state, so the instructor's
    // upload does not sit in PROCESSING forever.
    expect(prisma.courseMaterial.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "mat-1781" },
        data: expect.objectContaining({ status: "FAILED" }),
      }),
    );
  });
});
