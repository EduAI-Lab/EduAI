// @vitest-environment node
/**
 * #1785: every file type the course-materials upload input advertises must
 * extract a planted phrase, and that phrase must survive into the RAG system
 * block under a **Source** header naming the file. Empty retrieval must use
 * EMPTY_COURSE_RAG_INSTRUCTION instead of world knowledge.
 *
 * Complements #1123 RAG coverage (retrieval/grounding) with a per-accepted-type
 * extraction → RAG-block round trip. Do not treat this as a substitute for #1123.
 */
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import {
  ACCEPTED_MATERIAL_MIME_TYPES,
  MATERIAL_INPUT_ACCEPT,
  type AcceptedMaterialMimeType,
} from "~/lib/materials/accepted-types";
import { extractUploadedFileContent } from "~/lib/ai/file-processing";
import {
  EMPTY_COURSE_RAG_INSTRUCTION,
  RAG_ANSWER_RULES,
  buildCappedRagContextText,
  buildEmptyCourseRagBlock,
  buildRagSystemBlock,
} from "~/lib/chat-rag";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

const PDF_PHRASE = "ZEBRAQUARK-PDF-1785";
const DOCX_PHRASE = "ZEBRAQUARK-DOCX-1785";
const PPTX_PHRASE = "ZEBRAQUARK-PPTX-1785";
const TXT_PHRASE = "ZEBRAQUARK-TXT-1785";
const MD_PHRASE = "ZEBRAQUARK-MD-1785";

function fileFromBytes(bytes: Buffer, name: string, mimeType: string): File {
  return new File([new Uint8Array(bytes)], name, { type: mimeType });
}

/**
 * One-page PDF with a Helvetica `Tj` text run. A `q Q` empty page has no text
 * layer and is the #1781/#1787 image-only case — this fixture is the opposite.
 */
function buildPdfWithTextLayer(phrase: string): Buffer {
  if (/[()\\]/.test(phrase)) {
    throw new Error("PDF planted phrase must not contain (, ), or backslash");
  }
  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n")];
  const offsets: number[] = [];
  const push = (str: string) => {
    offsets.push(parts.reduce((n, b) => n + b.length, 0));
    parts.push(Buffer.from(str));
  };
  const stream = `BT /F1 12 Tf 72 700 Td (${phrase}) Tj ET\n`;

  push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  push("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
  push(
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n",
  );
  push(`4 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}endstream\nendobj\n`);
  push("5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n");

  const xrefOffset = parts.reduce((n, b) => n + b.length, 0);
  let xref = "xref\n0 6\n0000000000 65535 f \n";
  for (const off of offsets) {
    xref += `${String(off).padStart(10, "0")} 00000 n \n`;
  }
  parts.push(Buffer.from(xref));
  parts.push(Buffer.from(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`));
  return Buffer.concat(parts);
}

async function buildRealDocx(text: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "word/document.xml",
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

async function buildPptxWithSlideText(text: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("ppt/slides/slide1.xml", `<p:sld><p:txBody><a:t>${text}</a:t></p:txBody></p:sld>`);
  return zip.generateAsync({ type: "nodebuffer" });
}

async function expectExtractedPhraseNamedInRagSource(
  file: File,
  plantedPhrase: string,
): Promise<void> {
  const extracted = await extractUploadedFileContent(file);
  expect(extracted.content.trim().length).toBeGreaterThan(0);
  expect(extracted.content).toContain(plantedPhrase);

  const ragText = buildCappedRagContextText(
    [{ content: extracted.content, similarity: 0.95, materialTitle: extracted.title }],
    4,
    14_000,
  );
  expect(ragText).toContain(`**Source**: ${extracted.title}`);
  expect(ragText).toContain(plantedPhrase);

  const systemBlock = buildRagSystemBlock(ragText);
  expect(systemBlock).toContain(`**Source**: ${extracted.title}`);
  expect(systemBlock).toContain(plantedPhrase);
  expect(systemBlock).toContain("Cite the **Source** header");
}

interface RoundTripCase {
  label: string;
  fileName: string;
  mimeType: AcceptedMaterialMimeType;
  phrase: string;
  build: () => Promise<Buffer>;
}

/** One case per accepted type; the test above keeps this in step with the shared list. */
const ROUND_TRIP_CASES: RoundTripCase[] = [
  {
    label: "PDF with a real text layer",
    fileName: "lecture-notes.pdf",
    mimeType: "application/pdf",
    phrase: PDF_PHRASE,
    build: async () => buildPdfWithTextLayer(PDF_PHRASE),
  },
  {
    label: "DOCX",
    fileName: "reading.docx",
    mimeType: DOCX_MIME,
    phrase: DOCX_PHRASE,
    build: () => buildRealDocx(DOCX_PHRASE),
  },
  {
    label: "PPTX",
    fileName: "slides.pptx",
    mimeType: PPTX_MIME,
    phrase: PPTX_PHRASE,
    build: () => buildPptxWithSlideText(PPTX_PHRASE),
  },
  {
    label: "TXT file",
    fileName: "notes.txt",
    mimeType: "text/plain",
    phrase: TXT_PHRASE,
    build: async () => Buffer.from(`Course notes mention ${TXT_PHRASE} in week two.`),
  },
  {
    label: "Markdown file",
    fileName: "notes.md",
    mimeType: "text/markdown",
    phrase: MD_PHRASE,
    build: async () => Buffer.from(`# Week 2\n\nRemember ${MD_PHRASE} from the reading.`),
  },
];

describe("accepted course-material types → RAG path (#1785)", () => {
  it("advertises exactly pdf, docx, pptx, txt, and md on the upload input", () => {
    const extensions = MATERIAL_INPUT_ACCEPT.split(",").filter((token) => token.startsWith("."));
    expect(extensions).toEqual([".pdf", ".docx", ".pptx", ".txt", ".md"]);
    expect(MATERIAL_INPUT_ACCEPT).toContain("application/pdf");
    expect(MATERIAL_INPUT_ACCEPT).toContain(DOCX_MIME);
    expect(MATERIAL_INPUT_ACCEPT).toContain(PPTX_MIME);
    expect(MATERIAL_INPUT_ACCEPT).toContain("text/plain");
    expect(MATERIAL_INPUT_ACCEPT).toContain("text/markdown");
  });

  it("has an extraction case for every type on the shared accepted list, and no others", () => {
    // The extractor's switch cannot read the list, so this is what stops a type
    // being advertised (and accepted by validateFile) with no extractor branch
    // proven to work.
    expect(new Set(ROUND_TRIP_CASES.map((c) => c.mimeType))).toEqual(
      new Set(ACCEPTED_MATERIAL_MIME_TYPES),
    );
    expect(ROUND_TRIP_CASES).toHaveLength(ACCEPTED_MATERIAL_MIME_TYPES.length);
  });

  it.each(ROUND_TRIP_CASES)(
    "extracts a planted phrase from a $label and names the file in the RAG Source header",
    async ({ fileName, mimeType, phrase, build }) => {
      const file = fileFromBytes(await build(), fileName, mimeType);
      await expectExtractedPhraseNamedInRagSource(file, phrase);
    },
    30_000,
  );

  it("uses EMPTY_COURSE_RAG_INSTRUCTION when retrieval returns no excerpts, forbidding world knowledge", () => {
    expect(buildCappedRagContextText([], 4, 1000)).toBe("");
    expect(buildEmptyCourseRagBlock()).toBe(EMPTY_COURSE_RAG_INSTRUCTION);
    expect(buildEmptyCourseRagBlock()).toContain("did not return relevant excerpts");
    expect(buildEmptyCourseRagBlock()).toContain("Do not substitute general world knowledge");
    expect(RAG_ANSWER_RULES).toContain("Cite the **Source** header");
  });
});
