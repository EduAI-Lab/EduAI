import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import JSZip from "jszip";
import {
  sanitizeTextContent,
  generateChecksum,
  validateFile,
  validateFileSignature,
  applySemanticChunking,
  applyChunkOverlap,
  enforceMaxChunkLength,
  isDocumentSectionBoundary,
  joinSemanticChunks,
  DEFAULT_SEMANTIC_CHUNK_OVERLAP,
  extractTextFromFile,
  findEquationSpans,
  enrichExtractedDocumentContent,
  assertZipWithinLimits,
  MAX_ZIP_ENTRIES,
  MAX_ZIP_ENTRY_UNCOMPRESSED_BYTES,
  MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES,
  MAX_EXTRACTED_CONTENT_CHARS,
  assertExtractedContentWithinLimit,
  readFileAsText,
  extractDocxText,
  extractPptxText,
  extractPdfText,
  extractPdfTextIsolated,
  processUploadedFile,
  resetPdfExtractionConcurrencyForTests,
  holdPdfExtractionSlotForTests,
  getPdfExtractionMaxConcurrent,
  getPdfExtractionMaxQueued,
  getPdfExtractionMaxRssMb,
  readChildRssBytes,
  PdfExtractionBusyError,
} from "~/lib/ai/file-processing";

// `mammoth`'s Node build only accepts `{ path }` / `{ buffer }` inputs (see its own
// index.d.ts: NodeJsInput = PathInput | BufferInput, BrowserInput = ArrayBufferInput).
// extractDocxText's real, unmocked call passes `{ arrayBuffer }` — see the bug note in
// the "extractDocxText" describe block below. mammoth is imported dynamically *inside*
// extractDocxText (call-time, not module-top-level), so mocking it here reliably
// intercepts that call and lets most DOCX tests exercise the downstream HTML->markdown
// conversion. (`node:child_process`/`node:fs`/`node:fs/promises`, by contrast, are
// imported statically at the top of file-processing.ts, which this test file also
// statically imports — that ordering means those Node-builtin mocks are not reliably
// applied here, so PDF-worker subprocess tests below use real spawn/fs instead.)
vi.mock("mammoth", () => ({ convertToHtml: vi.fn() }));

const mammothMock = await import("mammoth");

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PPTX_MIME =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

async function buildZipArrayBuffer(
  files: Record<string, string> = { "word/document.xml": "<xml/>" },
): Promise<ArrayBuffer> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) {
    zip.file(name, content);
  }
  return zip.generateAsync({ type: "arraybuffer" });
}

async function buildPptxZipArrayBuffer(slides: string[]): Promise<ArrayBuffer> {
  const zip = new JSZip();
  slides.forEach((text, i) => {
    zip.file(
      `ppt/slides/slide${i + 1}.xml`,
      `<p:sld><p:txBody>${text}</p:txBody></p:sld>`,
    );
  });
  return zip.generateAsync({ type: "arraybuffer" });
}

/** Builds a syntactically valid, empty one-page PDF (accurate xref table) for real-subprocess tests. */
function buildTinyValidPdf(): Buffer {
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
 * Node's `Buffer.from(string)` / `Buffer.concat()` allocate small buffers from an
 * internal shared pool, so a raw `buf.buffer` can expose the *entire pool*
 * ArrayBuffer (wrong bytes/offset) rather than just this buffer's own bytes. Slice
 * to the buffer's actual view before handing it to a `file.arrayBuffer()` stand-in.
 */
function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// sanitizeTextContent
// ---------------------------------------------------------------------------

describe("sanitizeTextContent", () => {
  it("removes null bytes", () => {
    expect(sanitizeTextContent("hel\0lo")).toBe("hello");
  });

  it("removes control characters in the disallowed ranges", () => {
    const controlChars = "\x01\x02\x08\x0B\x0C\x0E\x1F\x7F";
    expect(sanitizeTextContent(controlChars)).toBe("");
  });

  it("preserves tabs and newlines", () => {
    const result = sanitizeTextContent("a\tb\nc");
    expect(result).toContain("\t");
    expect(result).toContain("\n");
  });

  it("normalises \\r\\n to \\n", () => {
    expect(sanitizeTextContent("a\r\nb")).toBe("a\nb");
  });

  it("normalises standalone \\r to \\n", () => {
    expect(sanitizeTextContent("a\rb")).toBe("a\nb");
  });

  it("collapses three or more consecutive newlines to two", () => {
    const result = sanitizeTextContent("a\n\n\n\nb");
    expect(result).toBe("a\n\nb");
  });

  it("trims leading and trailing whitespace", () => {
    expect(sanitizeTextContent("  hello  ")).toBe("hello");
  });

  it("returns an empty string for an empty input", () => {
    expect(sanitizeTextContent("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// generateChecksum
// ---------------------------------------------------------------------------

describe("generateChecksum", () => {
  it("returns a 64-character lowercase hex string", () => {
    const checksum = generateChecksum("hello");
    expect(checksum).toHaveLength(64);
    expect(checksum).toMatch(/^[0-9a-f]+$/);
  });

  it("returns the same value for the same input on repeated calls", () => {
    expect(generateChecksum("test")).toBe(generateChecksum("test"));
  });

  it("returns different values for different inputs", () => {
    expect(generateChecksum("foo")).not.toBe(generateChecksum("bar"));
  });
});

// ---------------------------------------------------------------------------
// validateFile
// ---------------------------------------------------------------------------

describe("validateFile", () => {
  const makeFile = (type: string, size: number) => ({ type, size });

  it("accepts text/plain", () => {
    expect(validateFile(makeFile("text/plain", 100)).isValid).toBe(true);
  });

  it("accepts text/markdown", () => {
    expect(validateFile(makeFile("text/markdown", 100)).isValid).toBe(true);
  });

  it("accepts application/pdf", () => {
    expect(validateFile(makeFile("application/pdf", 100)).isValid).toBe(true);
  });

  it("accepts DOCX MIME type", () => {
    expect(
      validateFile(
        makeFile(
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          100,
        ),
      ).isValid,
    ).toBe(true);
  });

  it("accepts PPTX MIME type", () => {
    expect(
      validateFile(
        makeFile(
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          100,
        ),
      ).isValid,
    ).toBe(true);
  });

  it("rejects an unsupported MIME type with a message naming the type", () => {
    const result = validateFile(makeFile("image/png", 100));
    expect(result.isValid).toBe(false);
    expect(result.error).toContain("image/png");
  });

  it("rejects files larger than 50 MB", () => {
    const tooBig = 50 * 1024 * 1024 + 1;
    const result = validateFile(makeFile("text/plain", tooBig));
    expect(result.isValid).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("accepts a file exactly at the 50 MB boundary", () => {
    const exactly50MB = 50 * 1024 * 1024;
    expect(validateFile(makeFile("text/plain", exactly50MB)).isValid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateFileSignature (#225 RAG-05 — declared MIME vs. actual bytes)
// ---------------------------------------------------------------------------

describe("validateFileSignature", () => {
  const buf = (bytes: number[]) => new Uint8Array(bytes).buffer;

  it("accepts a real PDF declared as application/pdf", async () => {
    const bytes = [...Buffer.from("%PDF-1.4\n%rest of file")];
    const file = new File([buf(bytes)], "doc.pdf", { type: "application/pdf" });
    const result = await validateFileSignature(file);
    expect(result.isValid).toBe(true);
  });

  it("rejects plain text mislabeled as application/pdf", async () => {
    const file = new File(["just some plain text, not a pdf"], "fake.pdf", {
      type: "application/pdf",
    });
    const result = await validateFileSignature(file);
    expect(result.isValid).toBe(false);
    expect(result.error).toContain("application/pdf");
  });

  it("accepts a real ZIP container declared as DOCX", async () => {
    const bytes = [0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0];
    const file = new File([buf(bytes)], "doc.docx", { type: DOCX_MIME });
    const result = await validateFileSignature(file);
    expect(result.isValid).toBe(true);
  });

  it("accepts a real ZIP container declared as PPTX", async () => {
    const bytes = [0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0];
    const file = new File([buf(bytes)], "slides.pptx", { type: PPTX_MIME });
    const result = await validateFileSignature(file);
    expect(result.isValid).toBe(true);
  });

  it("rejects plain text mislabeled as DOCX", async () => {
    const file = new File(["not actually a zip file"], "fake.docx", { type: DOCX_MIME });
    const result = await validateFileSignature(file);
    expect(result.isValid).toBe(false);
    expect(result.error).toContain(DOCX_MIME);
  });

  it("accepts plain ASCII text declared as text/plain", async () => {
    const file = new File(["Hello, this is normal course notes text."], "notes.txt", {
      type: "text/plain",
    });
    const result = await validateFileSignature(file);
    expect(result.isValid).toBe(true);
  });

  it("accepts plain text declared as text/markdown", async () => {
    const file = new File(["# Heading\n\nSome notes."], "notes.md", { type: "text/markdown" });
    const result = await validateFileSignature(file);
    expect(result.isValid).toBe(true);
  });

  it("rejects a PDF mislabeled as text/plain", async () => {
    const bytes = [...Buffer.from("%PDF-1.4\nbinary noise follows")];
    const file = new File([buf(bytes)], "renamed.txt", { type: "text/plain" });
    const result = await validateFileSignature(file);
    expect(result.isValid).toBe(false);
    expect(result.error).toContain("text/plain");
  });

  it("rejects a ZIP/Office file mislabeled as text/plain", async () => {
    const bytes = [0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0];
    const file = new File([buf(bytes)], "renamed.txt", { type: "text/plain" });
    const result = await validateFileSignature(file);
    expect(result.isValid).toBe(false);
  });

  it("rejects binary noise (NUL bytes) mislabeled as text/plain", async () => {
    const bytes = [0x01, 0x00, 0x02, 0x00, 0x03, 0x00, 0x04, 0x00];
    const file = new File([buf(bytes)], "renamed.txt", { type: "text/plain" });
    const result = await validateFileSignature(file);
    expect(result.isValid).toBe(false);
  });

  it("does not sniff unrecognized declared types (validateFile already rejects those)", async () => {
    const file = new File(["<binary>"], "image.png", { type: "image/png" });
    const result = await validateFileSignature(file);
    expect(result.isValid).toBe(true);
  });

  it("passes through when the file has no arrayBuffer method", async () => {
    const result = await validateFileSignature({ type: "text/plain", size: 10 });
    expect(result.isValid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// assertZipWithinLimits (zip-bomb guard) — issue #978
// ---------------------------------------------------------------------------

describe("assertZipWithinLimits", () => {
  // Mimics a JSZip instance loaded via loadAsync: entries carry a `_data`
  // object whose `uncompressedSize` comes from the ZIP central directory.
  const makeZip = (
    entries: Array<{ name: string; uncompressedSize?: number; dir?: boolean }>,
  ) => ({
    files: Object.fromEntries(
      entries.map((e) => [
        e.name,
        {
          dir: e.dir ?? false,
          _data:
            e.uncompressedSize === undefined
              ? undefined
              : { uncompressedSize: e.uncompressedSize },
        },
      ]),
    ),
  });

  it("accepts a normal small archive", () => {
    const zip = makeZip([
      { name: "ppt/slides/slide1.xml", uncompressedSize: 1024 },
      { name: "ppt/slides/slide2.xml", uncompressedSize: 2048 },
    ]);
    expect(() => assertZipWithinLimits(zip, "PPTX")).not.toThrow();
  });

  it("accepts an empty archive", () => {
    expect(() => assertZipWithinLimits(makeZip([]), "PPTX")).not.toThrow();
  });

  it("rejects an archive with too many entries", () => {
    const entries = Array.from({ length: MAX_ZIP_ENTRIES + 1 }, (_, i) => ({
      name: `entry${i}.xml`,
      uncompressedSize: 10,
    }));
    expect(() => assertZipWithinLimits(makeZip(entries), "PPTX")).toThrow(
      /exceeding the maximum of/,
    );
  });

  it("rejects a single entry over the per-entry uncompressed cap (zip bomb)", () => {
    const zip = makeZip([
      { name: "bomb.xml", uncompressedSize: MAX_ZIP_ENTRY_UNCOMPRESSED_BYTES + 1 },
    ]);
    expect(() => assertZipWithinLimits(zip, "PPTX")).toThrow(/per-entry limit/);
  });

  it("rejects an archive whose entries collectively exceed the total cap", () => {
    const chunk = MAX_ZIP_ENTRY_UNCOMPRESSED_BYTES; // 100MB each
    const count = Math.ceil(MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES / chunk) + 1;
    const entries = Array.from({ length: count }, (_, i) => ({
      name: `part${i}.bin`,
      uncompressedSize: chunk,
    }));
    expect(() => assertZipWithinLimits(makeZip(entries), "DOCX")).toThrow(
      /possible zip bomb/,
    );
  });

  it("ignores directory entries and entries with unknown size", () => {
    const zip = makeZip([
      { name: "ppt/", dir: true, uncompressedSize: 0 },
      { name: "ppt/slides/", dir: true },
      { name: "ppt/slides/slide1.xml", uncompressedSize: 512 },
      { name: "unknown.bin" }, // no _data → deferred to jszip inflate-time probe
    ]);
    expect(() => assertZipWithinLimits(zip, "PPTX")).not.toThrow();
  });

  it("names the format in the rejection message", () => {
    const zip = makeZip([
      { name: "bomb.xml", uncompressedSize: MAX_ZIP_ENTRY_UNCOMPRESSED_BYTES + 1 },
    ]);
    expect(() => assertZipWithinLimits(zip, "DOCX")).toThrow(/^DOCX rejected/);
  });
});

// ---------------------------------------------------------------------------
// applySemanticChunking
// ---------------------------------------------------------------------------

describe("applySemanticChunking", () => {
  it("returns an empty array for an empty string", () => {
    expect(applySemanticChunking("")).toEqual([]);
  });

  it("returns a single chunk for content shorter than maxChunkSize", () => {
    const chunks = applySemanticChunking("Short content.", 1500);
    expect(chunks).toHaveLength(1);
  });

  it("detects markdown content via heading markers", () => {
    const markdown = "# Heading\n\nSome paragraph text here.";
    const chunks = applySemanticChunking(markdown, 1500);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });

  it("splits long markdown at major heading boundaries before the size limit", () => {
    const section = "word ".repeat(200);
    const markdown = `# Section A\n\n${section}\n\n# Section B\n\n${section}`;
    const chunks = applySemanticChunking(markdown, 500);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("falls back to paragraph-based splitting for non-markdown content", () => {
    const para = "word ".repeat(200);
    const content = `${para}\n\n${para}`;
    const chunks = applySemanticChunking(content, 500);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("no returned chunk exceeds maxChunkSize by more than 20%", () => {
    const longText = "Each sentence adds a little content to the chunk. ".repeat(50);
    const chunks = applySemanticChunking(longText, 300);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(300 * 1.2);
    }
  });

  it("filters out empty or whitespace-only chunks", () => {
    const content = "# Title\n\n   \n\nActual content here.";
    const chunks = applySemanticChunking(content, 1500);
    for (const chunk of chunks) {
      expect(chunk.trim().length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// isDocumentSectionBoundary
// ---------------------------------------------------------------------------

describe("isDocumentSectionBoundary", () => {
  it("detects slide markers from PPTX extraction", () => {
    expect(isDocumentSectionBoundary("--- Slide 3 ---")).toBe(true);
  });

  it("detects Chapter/Section/Part headings", () => {
    expect(isDocumentSectionBoundary("Chapter 3: Advanced Topics")).toBe(true);
    expect(isDocumentSectionBoundary("Section 2")).toBe(true);
    expect(isDocumentSectionBoundary("Part 1")).toBe(true);
  });

  it("detects numbered headings", () => {
    expect(isDocumentSectionBoundary("3.1 Assignment Overview")).toBe(true);
    expect(isDocumentSectionBoundary("1) First question")).toBe(true);
  });

  it("detects all-caps short section titles", () => {
    expect(isDocumentSectionBoundary("GRADING RUBRIC")).toBe(true);
  });

  it("does not treat normal sentences as section boundaries", () => {
    expect(isDocumentSectionBoundary("This is a normal paragraph sentence.")).toBe(false);
    expect(isDocumentSectionBoundary("")).toBe(false);
  });

  it("detects SOAP note section markers", () => {
    expect(isDocumentSectionBoundary("S: Patient reports headache")).toBe(true);
    expect(isDocumentSectionBoundary("O: BP 120/80")).toBe(true);
    expect(isDocumentSectionBoundary("ASSESSMENT")).toBe(true);
    expect(isDocumentSectionBoundary("DISCHARGE SUMMARY")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// applyStandardChunking (via applySemanticChunking non-markdown path)
// ---------------------------------------------------------------------------

describe("applyStandardChunking section splits", () => {
  it("splits PDF-like text at Chapter boundaries", () => {
    const sectionA = "word ".repeat(120);
    const sectionB = "term ".repeat(120);
    const content = `Chapter 1\n\n${sectionA}\n\nChapter 2\n\n${sectionB}`;
    const chunks = applySemanticChunking(content, 500);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.some((c) => c.includes("Chapter 1"))).toBe(true);
    expect(chunks.some((c) => c.includes("Chapter 2"))).toBe(true);
  });

  it("splits at slide markers", () => {
    const slide1 = "Intro content here. ".repeat(30);
    const slide2 = "Details content here. ".repeat(30);
    const content = `--- Slide 1 ---\n${slide1}\n--- Slide 2 ---\n${slide2}`;
    const chunks = applySemanticChunking(content, 400);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.some((c) => c.includes("Slide 1"))).toBe(true);
    expect(chunks.some((c) => c.includes("Slide 2"))).toBe(true);
  });

  it("keeps consecutive heading lines with the following section body", () => {
    const body = "Actual content about the introduction topic. ".repeat(20);
    const content = `Chapter 1\n1.1 Introduction\n${body}`;
    const chunks = applySemanticChunking(content, 500);
    expect(chunks.some((c) => c.includes("Chapter 1") && c.includes("1.1 Introduction"))).toBe(true);
    expect(chunks.some((c) => c.includes("Actual content"))).toBe(true);
    expect(chunks.some((c) => c.trim() === "Chapter 1")).toBe(false);
  });

  it("still splits on paragraph breaks when no section markers exist", () => {
    const para = "word ".repeat(200);
    const content = `${para}\n\n${para}`;
    const chunks = applySemanticChunking(content, 500);
    expect(chunks.length).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// applyChunkOverlap
// ---------------------------------------------------------------------------

describe("applyChunkOverlap", () => {
  it("returns a single chunk unchanged", () => {
    expect(applyChunkOverlap(["Only chunk."])).toEqual(["Only chunk."]);
  });

  it("returns empty array for empty input", () => {
    expect(applyChunkOverlap([])).toEqual([]);
  });

  it("prefixes later chunks with trailing text from the previous chunk", () => {
    const first = "Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda.";
    const second = "Mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega.";
    const overlapped = applyChunkOverlap([first, second], 40);

    expect(overlapped).toHaveLength(2);
    expect(overlapped[0]).toBe(first);
    const endWords = first.split(" ").slice(-3).join(" ");
    expect(overlapped[1]).toContain(endWords.split(" ")[0]);
  });

  it("uses the default overlap constant", () => {
    expect(DEFAULT_SEMANTIC_CHUNK_OVERLAP).toBe(80);
  });

  it("does not inject the chunk separator into overlap text", () => {
    const chunks = ["First chunk content.", "Second chunk content."];
    const overlapped = applyChunkOverlap(chunks, DEFAULT_SEMANTIC_CHUNK_OVERLAP);
    const joined = joinSemanticChunks(overlapped);
    expect(joined).toContain("--- CHUNK SEPARATOR ---");
    expect(joined.split("--- CHUNK SEPARATOR ---")).toHaveLength(2);
  });

  it("does not duplicate a short previous chunk as overlap", () => {
    const shortHeading = "Chapter 1";
    const second = "Long body content here. ".repeat(30);
    const overlapped = applyChunkOverlap([shortHeading, second], DEFAULT_SEMANTIC_CHUNK_OVERLAP);
    expect(overlapped[1]).toBe(second.trim());
    expect(overlapped[1]).not.toContain("Chapter 1");
  });

  it("keeps overlapped chunks within the max size margin", () => {
    const maxChunkSize = 500;
    const nearLimit = "word ".repeat(115).trim();
    const second = "term ".repeat(115).trim();
    const overlapped = enforceMaxChunkLength(
      applyChunkOverlap([nearLimit, second], DEFAULT_SEMANTIC_CHUNK_OVERLAP),
      maxChunkSize,
    );
    const limit = Math.floor(maxChunkSize * 1.2);
    for (const chunk of overlapped) {
      expect(chunk.length).toBeLessThanOrEqual(limit);
    }
  });
});

// ---------------------------------------------------------------------------
// extractTextFromFile
// ---------------------------------------------------------------------------

describe("extractTextFromFile", () => {
  const makeFile = (name: string, type: string, size: number) => ({ name, type, size });

  it("strips the file extension to produce the title", async () => {
    const file = makeFile("lecture-notes.pdf", "application/pdf", 100);
    const info = await extractTextFromFile(file, "some content");
    expect(info.title).toBe("lecture-notes");
  });

  it("returns the correct mimeType from the file object", async () => {
    const file = makeFile("notes.txt", "text/plain", 200);
    const info = await extractTextFromFile(file, "hello");
    expect(info.mimeType).toBe("text/plain");
  });

  it("returns the correct fileSize from the file object", async () => {
    const file = makeFile("notes.txt", "text/plain", 1234);
    const info = await extractTextFromFile(file, "hello");
    expect(info.fileSize).toBe(1234);
  });

  it("sanitizes the content before computing the checksum", async () => {
    const file = makeFile("f.txt", "text/plain", 10);
    const dirty = "hello\0world";
    const info = await extractTextFromFile(file, dirty);
    expect(info.content).toBe("helloworld");
    expect(info.checksum).toBe(generateChecksum("helloworld"));
  });

  it("checksum matches generateChecksum called on the sanitized content", async () => {
    const file = makeFile("f.txt", "text/plain", 5);
    const info = await extractTextFromFile(file, "clean");
    expect(info.checksum).toBe(generateChecksum("clean"));
  });
});

// ---------------------------------------------------------------------------
// findEquationSpans / enrichExtractedDocumentContent
// ---------------------------------------------------------------------------

describe("findEquationSpans", () => {
  it("finds inline and display LaTeX spans", () => {
    const content = "Inline $x^2$ and display $$\na+b\n$$ end.";
    const spans = findEquationSpans(content);
    expect(spans).toHaveLength(2);
  });
});

describe("enrichExtractedDocumentContent", () => {
  it("converts HTML tables to markdown tables", () => {
    const html = `<table>
      <tr><th>Drug</th><th>Dose</th></tr>
      <tr><td>Ibuprofen</td><td>200 mg</td></tr>
    </table>`;
    const result = enrichExtractedDocumentContent(html);
    expect(result).toContain("| Drug | Dose |");
    expect(result).toContain("| Ibuprofen | 200 mg |");
  });

  it("normalizes LaTeX delimiter styles", () => {
    const result = enrichExtractedDocumentContent("Energy \\(E=mc^2\\) is famous.");
    expect(result).toContain("$E=mc^2$");
  });

  it("keeps display equations intact through chunking", () => {
    const equation = "$$\\frac{a}{b}$$";
    const filler = "word ".repeat(200);
    const content = `${filler}\n\n${equation}\n\n${filler}`;
    const chunks = applySemanticChunking(content, 500);
    expect(chunks.some((chunk) => chunk.includes("$$\\frac{a}{b}$$"))).toBe(true);
  });

  it("keeps display equations intact in later chunks after section splits", () => {
    const equation = "$$\\frac{a}{b}$$";
    const sectionA = "word ".repeat(200);
    const sectionB = "term ".repeat(200);
    const content = `Chapter 1\n\n${sectionA}\n\nChapter 2\n\n${sectionB}\n\n${equation}\n\n${sectionB}`;
    const chunks = applySemanticChunking(content, 500);
    expect(chunks.some((chunk) => chunk.includes("$$\\frac{a}{b}$$"))).toBe(true);
  });

  it("keeps display equations intact through markdown chunking", () => {
    const equation = "$$\\frac{a}{b}$$";
    const filler = "word ".repeat(200);
    const content = `# Section A\n\n${filler}\n\n${equation}\n\n${filler}`;
    const chunks = applySemanticChunking(content, 500);
    expect(chunks.some((chunk) => chunk.includes("$$\\frac{a}{b}$$"))).toBe(true);
  });

  it("does not split equations when enforceMaxChunkLength trims oversized chunks", () => {
    const equation = "$$\\frac{a}{b}$$";
    const filler = "word ".repeat(300);
    const content = `${filler}\n\n${equation}\n\n${filler}`;
    const chunks = enforceMaxChunkLength(applySemanticChunking(content, 500), 500);
    expect(chunks.some((chunk) => chunk.includes("$$\\frac{a}{b}$$"))).toBe(true);
  });

  it("does not hang on intro text followed by a long display equation", () => {
    const intro = "Short intro paragraph about math.\n\n";
    const longEq = `$$\\frac{a}{${"x".repeat(3000)}}$$`;
    const content = `${intro}${longEq}\n\n${"word ".repeat(100)}`;
    const started = Date.now();
    const chunks = applySemanticChunking(content, 500);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.some((chunk) => chunk.includes("$$"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// assertExtractedContentWithinLimit — flood guard (#225 RAG-06)
// ---------------------------------------------------------------------------

describe("assertExtractedContentWithinLimit (#225 RAG-06)", () => {
  it("accepts content exactly at the 20M character cap", () => {
    expect(() =>
      assertExtractedContentWithinLimit("a".repeat(MAX_EXTRACTED_CONTENT_CHARS)),
    ).not.toThrow();
  });

  it("rejects content one character over the 20M cap", () => {
    expect(() =>
      assertExtractedContentWithinLimit("a".repeat(MAX_EXTRACTED_CONTENT_CHARS + 1)),
    ).toThrow(
      `Extracted content of ${MAX_EXTRACTED_CONTENT_CHARS + 1} characters exceeds the maximum of ${MAX_EXTRACTED_CONTENT_CHARS}`,
    );
  });
});

// ---------------------------------------------------------------------------
// readFileAsText
// ---------------------------------------------------------------------------

describe("readFileAsText", () => {
  const originalFileReader = (globalThis as any).FileReader;

  afterEach(() => {
    (globalThis as any).FileReader = originalFileReader;
  });

  it("decodes content via arrayBuffer when available (server-side upload path)", async () => {
    const file = { arrayBuffer: async () => new TextEncoder().encode("hello world").buffer };
    await expect(readFileAsText(file)).resolves.toBe("hello world");
  });

  it("falls back to FileReader when arrayBuffer is unavailable (browser File path)", async () => {
    const file = new File(["browser text content"], "notes.txt", { type: "text/plain" });
    Object.defineProperty(file, "arrayBuffer", { value: undefined });
    await expect(readFileAsText(file)).resolves.toBe("browser text content");
  });

  it("rejects when FileReader completes with a non-string result", async () => {
    class FakeFileReader {
      onload: ((event: any) => void) | null = null;
      onerror: (() => void) | null = null;
      readAsText(_file: any) {
        queueMicrotask(() => this.onload?.({ target: { result: new ArrayBuffer(0) } }));
      }
    }
    (globalThis as any).FileReader = FakeFileReader;
    await expect(readFileAsText({ arrayBuffer: undefined })).rejects.toThrow(
      "Failed to read file as text",
    );
  });

  it("rejects when the FileReader reports an error", async () => {
    class FakeFileReader {
      onload: ((event: any) => void) | null = null;
      onerror: (() => void) | null = null;
      readAsText(_file: any) {
        queueMicrotask(() => this.onerror?.());
      }
    }
    (globalThis as any).FileReader = FakeFileReader;
    await expect(readFileAsText({ arrayBuffer: undefined })).rejects.toThrow("Failed to read file");
  });

  it("throws when neither arrayBuffer nor FileReader is available", async () => {
    (globalThis as any).FileReader = undefined;
    await expect(readFileAsText({ arrayBuffer: undefined })).rejects.toThrow(
      "File reading not supported in this environment",
    );
  });
});

// ---------------------------------------------------------------------------
// mathMlFragmentToLatex / convertMathHtmlToMarkdown (via enrichExtractedDocumentContent)
// ---------------------------------------------------------------------------

describe("mathML conversion via enrichExtractedDocumentContent", () => {
  it("converts a MathML fraction to LaTeX \\frac", () => {
    const result = enrichExtractedDocumentContent(
      "<math><m:fraction><m:num>a</m:num><m:den>b</m:den></m:fraction></math>",
    );
    expect(result).toContain("\\frac{a}{b}");
  });

  it("converts a MathML superscript to LaTeX ^", () => {
    const result = enrichExtractedDocumentContent(
      "<math><m:sSup><m:e>x</m:e><m:sup>2</m:sup></m:sSup></math>",
    );
    expect(result).toContain("x^{2}");
  });

  it("converts Office Math (m:oMath) fractions the same way as <math>", () => {
    const result = enrichExtractedDocumentContent(
      "<m:oMath><m:fraction><m:num>x</m:num><m:den>y</m:den></m:fraction></m:oMath>",
    );
    expect(result).toContain("\\frac{x}{y}");
  });

  it("falls back to stripped inline text for unrecognized math markup", () => {
    const result = enrichExtractedDocumentContent("<math><mi>x</mi><mo>+</mo><mi>y</mi></math>");
    expect(result).toContain("x+y");
  });

  it("produces no output for math markup that strips to nothing", () => {
    const result = enrichExtractedDocumentContent("Before.<math>   </math>After.");
    expect(result).not.toContain("$");
    expect(result).toContain("Before.");
    expect(result).toContain("After.");
  });
});

// ---------------------------------------------------------------------------
// extractDocxText
// ---------------------------------------------------------------------------

describe("extractDocxText", () => {
  it("converts mocked mammoth HTML output into markdown-like content", async () => {
    const html = `
      <h1>Title</h1>
      <p>Some <strong>bold</strong> and <em>italic</em> text.<br/>Next line.</p>
      <ul><li>First</li><li>Second</li></ul>
      <table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>
      <math><m:fraction><m:num>a</m:num><m:den>b</m:den></m:fraction></math>
    `;
    vi.mocked(mammothMock.convertToHtml).mockResolvedValue({ value: html, messages: [] });

    const buffer = await buildZipArrayBuffer();
    const file = {
      name: "notes.docx",
      type: DOCX_MIME,
      size: buffer.byteLength,
      arrayBuffer: async () => buffer,
    };

    const result = await extractDocxText(file as any);

    expect(result.content).toContain("# Title");
    expect(result.content).toContain("**bold**");
    expect(result.content).toContain("*italic*");
    expect(result.content).toContain("- First");
    expect(result.content).toContain("- Second");
    expect(result.content).toContain("| A | B |");
    expect(result.content).toContain("\\frac{a}{b}");
    expect(result.metadata?.processingMethod).toBe("mammoth.js + HTML conversion");
    expect(result.metadata?.isClientSide).toBe(true);
  });

  // Documents a pre-existing bug in `convertHtmlToMarkdown`'s <ol> handling: the inner
  // `content.replace(/<li.../, () => ...)` callback returns a literal "$1" (function
  // replacers don't get $-pattern substitution) instead of the actual list item text,
  // so ordered-list items are dropped and replaced with the literal string "$1".
  it("documents that ordered-list items currently render as a literal '$1' placeholder", async () => {
    vi.mocked(mammothMock.convertToHtml).mockResolvedValue({
      value: "<ol><li>One</li><li>Two</li></ol>",
      messages: [],
    });
    const buffer = await buildZipArrayBuffer();
    const file = {
      name: "list.docx",
      type: DOCX_MIME,
      size: buffer.byteLength,
      arrayBuffer: async () => buffer,
    };

    const result = await extractDocxText(file as any);
    expect(result.content).toContain("1. $1");
    expect(result.content).toContain("2. $1");
    expect(result.content).not.toContain("One");
  });

  it("surfaces mammoth extraction warnings in metadata without throwing", async () => {
    vi.mocked(mammothMock.convertToHtml).mockResolvedValue({
      value: "<p>Body</p>",
      messages: [{ type: "warning", message: "Unsupported style" }],
    });
    const buffer = await buildZipArrayBuffer();
    const file = {
      name: "notes.docx",
      type: DOCX_MIME,
      size: buffer.byteLength,
      arrayBuffer: async () => buffer,
    };

    const result = await extractDocxText(file as any);
    expect(result.metadata?.extractionWarnings).toHaveLength(1);
  });

  it("wraps errors when the uploaded bytes are not a valid ZIP container", async () => {
    const file = {
      name: "fake.docx",
      type: DOCX_MIME,
      size: 10,
      arrayBuffer: async () => new TextEncoder().encode("not a zip file").buffer,
    };
    await expect(extractDocxText(file as any)).rejects.toThrow(/Failed to extract text from DOCX/);
  });
});

// NOTE ON A REAL (SOURCE) BUG found while writing these tests, not fixed here per
// task scope ("expand tests, don't patch source"):
//
// Real (unmocked) mammoth on Node only accepts `{ path }` / `{ buffer }` inputs, not
// `{ arrayBuffer }` (see mammoth's own lib/index.d.ts: NodeJsInput = PathInput |
// BufferInput; BrowserInput = ArrayBufferInput). extractDocxText calls
// `mammoth.convertToHtml({ arrayBuffer })`, which throws "Could not find file in
// options" for every real DOCX upload processed server-side (this file is imported
// from app/lib/canvas/materials.server.ts, a server-only module). Verified directly:
// `require('mammoth').convertToHtml({ arrayBuffer: buf })` throws that exact error
// with the installed mammoth@1.12.0. A reliable in-repo regression test for this would
// need `vi.resetModules()` to get a real (unmocked) mammoth binding, which was found to
// destabilize *other* tests in this file (leaked pending extraction/mock state across
// unrelated describe blocks) — so it is intentionally omitted rather than shipped
// flaky. This is worth a real source fix (e.g. passing `{ buffer: Buffer.from(arrayBuffer) }`
// instead) — flagged for the code owner rather than patched here.

// ---------------------------------------------------------------------------
// extractPptxText
// ---------------------------------------------------------------------------

describe("extractPptxText", () => {
  it("extracts and numbers slide text from a real PPTX-shaped ZIP", async () => {
    const buffer = await buildPptxZipArrayBuffer([
      "<a:t>First slide text</a:t>",
      "<a:t>Second</a:t><a:t>slide</a:t><a:t>runs</a:t>",
    ]);
    const file = {
      name: "deck.pptx",
      type: PPTX_MIME,
      size: buffer.byteLength,
      arrayBuffer: async () => buffer,
    };

    const result = await extractPptxText(file as any);

    expect(result.pageCount).toBe(2);
    expect(result.content).toContain("--- Slide 1 ---");
    expect(result.content).toContain("First slide text");
    expect(result.content).toContain("--- Slide 2 ---");
    expect(result.content).toContain("Second slide runs");
    expect(result.metadata?.slideCount).toBe(2);
    expect(result.metadata?.processingMethod).toBe("client-side XML parsing");
  });

  it("falls back to a placeholder message when the presentation has no slides", async () => {
    const buffer = await buildZipArrayBuffer({ "docProps/core.xml": "<core/>" });
    const file = {
      name: "empty.pptx",
      type: PPTX_MIME,
      size: buffer.byteLength,
      arrayBuffer: async () => buffer,
    };

    const result = await extractPptxText(file as any);
    expect(result.pageCount).toBe(0);
    expect(result.content).toBe("No text content found in presentation");
  });

  it("falls back to the placeholder when slides exist but contain no <a:t> runs", async () => {
    const buffer = await buildPptxZipArrayBuffer(["<p:noText/>"]);
    const file = {
      name: "blank.pptx",
      type: PPTX_MIME,
      size: buffer.byteLength,
      arrayBuffer: async () => buffer,
    };

    const result = await extractPptxText(file as any);
    expect(result.pageCount).toBe(1);
    expect(result.content).toBe("No text content found in presentation");
  });

  it("wraps errors when the uploaded bytes are not a valid ZIP container", async () => {
    const file = {
      name: "fake.pptx",
      type: PPTX_MIME,
      size: 10,
      arrayBuffer: async () => new TextEncoder().encode("not a zip file").buffer,
    };
    await expect(extractPptxText(file as any)).rejects.toThrow(/Failed to extract text from PPTX/);
  });
});

// ---------------------------------------------------------------------------
// extractPdfText (real @opendocsg/pdf2md subprocess)
// ---------------------------------------------------------------------------

describe("extractPdfText", () => {
  it("extracts markdown content from a well-formed PDF via the isolated worker", async () => {
    const file = {
      name: "doc.pdf",
      type: "application/pdf",
      arrayBuffer: async () => toArrayBuffer(buildTinyValidPdf()),
    };
    const result = await extractPdfText(file as any);
    expect(typeof result.content).toBe("string");
    expect(result.pageCount).toBeGreaterThanOrEqual(1);
    expect(result.metadata?.processingMethod).toBe("@opendocsg/pdf2md");
  });

  it("wraps a worker failure as 'Failed to extract text from PDF'", async () => {
    const garbage = Buffer.from("%PDF-1.4\nthis is not a valid pdf body at all%%EOF");
    const file = {
      name: "broken.pdf",
      type: "application/pdf",
      arrayBuffer: async () => toArrayBuffer(garbage),
    };
    await expect(extractPdfText(file as any)).rejects.toThrow(/Failed to extract text from PDF/);
  });
});

// ---------------------------------------------------------------------------
// extractPdfTextIsolated — additional branches (real subprocess)
// ---------------------------------------------------------------------------
//
// Deep worker-failure branches (timeout, heap-OOM detection, RSS-breach messaging,
// spawn-error, stderr-cap slicing, mkdtemp failure) are intentionally NOT re-tested
// here via mocked `node:child_process`/`node:fs`: those Node builtins are imported
// statically at the top of file-processing.ts, which this test file also statically
// imports, and empirically `vi.mock` does not reliably intercept that combination in
// this suite (verified: mocked implementations were bypassed in favor of the real
// ones). Those branches are already covered end-to-end, with a working mock setup
// (SUT imported dynamically, avoiding the ordering issue), by
// app/tests/unit/pdf-extraction-isolation.test.ts.

describe("extractPdfTextIsolated additional branches", () => {
  beforeEach(() => {
    resetPdfExtractionConcurrencyForTests();
  });

  afterEach(() => {
    resetPdfExtractionConcurrencyForTests();
  });

  it("rejects when the extracted output exceeds the configured byte limit", async () => {
    await expect(
      extractPdfTextIsolated(buildTinyValidPdf(), { maxOutputBytes: 1 }),
    ).rejects.toThrow(/exceeds the maximum of 1/);
  });
});

// ---------------------------------------------------------------------------
// PDF extraction concurrency helpers / env-driven getters
// ---------------------------------------------------------------------------

describe("PDF extraction concurrency getters", () => {
  beforeEach(() => {
    resetPdfExtractionConcurrencyForTests();
    delete process.env.PDF_EXTRACTION_MAX_CONCURRENT;
    delete process.env.PDF_EXTRACTION_MAX_QUEUED;
    delete process.env.PDF_EXTRACTION_MAX_RSS_MB;
  });

  afterEach(() => {
    resetPdfExtractionConcurrencyForTests();
    delete process.env.PDF_EXTRACTION_MAX_CONCURRENT;
    delete process.env.PDF_EXTRACTION_MAX_QUEUED;
    delete process.env.PDF_EXTRACTION_MAX_RSS_MB;
  });

  it("getPdfExtractionMaxConcurrent falls back to the default when unset, empty, invalid, or below the min", () => {
    expect(getPdfExtractionMaxConcurrent()).toBe(4);
    process.env.PDF_EXTRACTION_MAX_CONCURRENT = "";
    expect(getPdfExtractionMaxConcurrent()).toBe(4);
    process.env.PDF_EXTRACTION_MAX_CONCURRENT = "not-a-number";
    expect(getPdfExtractionMaxConcurrent()).toBe(4);
    process.env.PDF_EXTRACTION_MAX_CONCURRENT = "0";
    expect(getPdfExtractionMaxConcurrent()).toBe(4);
    process.env.PDF_EXTRACTION_MAX_CONCURRENT = "7";
    expect(getPdfExtractionMaxConcurrent()).toBe(7);
  });

  it("getPdfExtractionMaxQueued respects a zero override and rejects negative values", () => {
    expect(getPdfExtractionMaxQueued()).toBe(16);
    process.env.PDF_EXTRACTION_MAX_QUEUED = "0";
    expect(getPdfExtractionMaxQueued()).toBe(0);
    process.env.PDF_EXTRACTION_MAX_QUEUED = "-1";
    expect(getPdfExtractionMaxQueued()).toBe(16);
  });

  it("getPdfExtractionMaxRssMb enforces the 64MB floor", () => {
    expect(getPdfExtractionMaxRssMb()).toBe(640);
    process.env.PDF_EXTRACTION_MAX_RSS_MB = "10";
    expect(getPdfExtractionMaxRssMb()).toBe(640);
    process.env.PDF_EXTRACTION_MAX_RSS_MB = "128";
    expect(getPdfExtractionMaxRssMb()).toBe(128);
  });

  it("rejects with PdfExtractionBusyError once capacity and the queue are exhausted", async () => {
    process.env.PDF_EXTRACTION_MAX_CONCURRENT = "1";
    process.env.PDF_EXTRACTION_MAX_QUEUED = "0";
    const release = await holdPdfExtractionSlotForTests();
    try {
      await expect(extractPdfTextIsolated(Buffer.from("dummy"))).rejects.toBeInstanceOf(
        PdfExtractionBusyError,
      );
      await expect(extractPdfTextIsolated(Buffer.from("dummy"))).rejects.toThrow(/busy|capacity/i);
    } finally {
      release();
    }
  });

  it("PdfExtractionBusyError uses a default message naming busy/capacity", () => {
    const error = new PdfExtractionBusyError();
    expect(error.name).toBe("PdfExtractionBusyError");
    expect(error.message).toMatch(/busy/i);
  });
});

// ---------------------------------------------------------------------------
// readChildRssBytes
// ---------------------------------------------------------------------------

// Note: only the platform-dispatch and real-failure (catch -> null) paths are
// exercised here without mocking `node:fs`/`node:child_process` (see the note above
// "extractPdfTextIsolated additional branches" for why mocking those builtins isn't
// reliable in this file). `Object.defineProperty(process, "platform", ...)` itself
// does take effect — confirmed by the real `readFileSync`/`execFileSync` calls
// actually running (and failing, since there's no real /proc or Unix `ps` on the
// Windows test host) inside the linux/darwin branches below.
describe("readChildRssBytes", () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform });
  });

  it("returns null on platforms without a dedicated RSS reader (e.g. win32)", () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    expect(readChildRssBytes(12345)).toBeNull();
  });

  it("returns null on the Linux branch when the /proc read fails", () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    expect(readChildRssBytes(999999)).toBeNull();
  });

  it("returns null on the Darwin branch when `ps` fails or is unavailable", () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    expect(readChildRssBytes(999999)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// processUploadedFile — full orchestration
// ---------------------------------------------------------------------------

describe("processUploadedFile", () => {
  it("rejects unsupported file types with the raw validateFile error (not wrapped)", async () => {
    const file = new File(["hi"], "image.png", { type: "image/png" });
    await expect(processUploadedFile(file)).rejects.toThrow(
      /File type image\/png is not supported/,
    );
    await expect(processUploadedFile(file)).rejects.not.toThrow(/Failed to process file/);
  });

  it("rejects a declared-type/actual-bytes mismatch with the raw signature error (not wrapped)", async () => {
    const file = new File(["not a pdf"], "fake.pdf", { type: "application/pdf" });
    await expect(processUploadedFile(file)).rejects.toThrow(/does not start with the PDF signature/);
  });

  it("processes a text/plain upload end-to-end with enhanced metadata", async () => {
    const file = new File(["Chapter 1\n\nSome course notes content here."], "notes.txt", {
      type: "text/plain",
    });

    const result = await processUploadedFile(file);

    expect(result.title).toBe("notes");
    expect(result.mimeType).toBe("text/plain");
    expect(result.checksum).toBe(generateChecksum(result.content));
    // These fields are set at runtime but fall outside FileInfo['metadata']'s declared shape.
    const metadata = result.metadata as Record<string, unknown> | undefined;
    expect(metadata?.isEnhanced).toBe(true);
    expect(metadata?.processingLibrary).toBe("Native text extraction");
    expect(typeof metadata?.chunkCount).toBe("number");
    expect(metadata?.extractedAt).toBeInstanceOf(Date);
  });

  it("processes a PDF upload end-to-end via the isolated worker", async () => {
    const pdfBuffer = buildTinyValidPdf();
    const file = new File([new Uint8Array(pdfBuffer)], "lecture.pdf", { type: "application/pdf" });

    const result = await processUploadedFile(file);

    expect(result.title).toBe("lecture");
    expect(result.mimeType).toBe("application/pdf");
    expect(result.pageCount).toBeGreaterThanOrEqual(1);
    expect((result.metadata as Record<string, unknown> | undefined)?.processingLibrary).toBe(
      "@opendocsg/pdf2md",
    );
  });

  it("wraps a PDF extraction failure as 'Failed to process file <name>'", async () => {
    const garbage = Buffer.from("%PDF-1.4\nnot really a pdf body%%EOF");
    const file = new File([new Uint8Array(garbage)], "broken.pdf", { type: "application/pdf" });

    await expect(processUploadedFile(file)).rejects.toThrow(/^Failed to process file broken\.pdf:/);
  });

  // The real (unmocked) DOCX path is not exercised end-to-end here — see the source-bug
  // note above the "extractPptxText" describe block for why (mammoth's Node build
  // rejects the `{ arrayBuffer }` shape extractDocxText passes it, and reliably testing
  // that via `vi.resetModules()` destabilized other tests in this file).

  it("processes a PPTX upload end-to-end with slide-derived pageCount/metadata", async () => {
    const zip = new JSZip();
    zip.file("ppt/slides/slide1.xml", "<p:sld><p:txBody><a:t>Intro to the course</a:t></p:txBody></p:sld>");
    zip.file("ppt/slides/slide2.xml", "<p:sld><p:txBody><a:t>Grading policy details</a:t></p:txBody></p:sld>");
    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
    const file = new File([new Uint8Array(zipBuffer)], "slides.pptx", { type: PPTX_MIME });

    const result = await processUploadedFile(file);

    expect(result.title).toBe("slides");
    expect(result.pageCount).toBe(2);
    const metadata = result.metadata as Record<string, unknown> | undefined;
    expect(metadata?.slideCount).toBe(2);
    expect(metadata?.processingLibrary).toBe("client-side XML parsing");
    expect(result.content).toContain("Intro to the course");
  });

  it("wraps a content-length overflow as 'Failed to process file <name>'", async () => {
    const hugeContent = "a".repeat(MAX_EXTRACTED_CONTENT_CHARS + 1);
    const file = new File([hugeContent], "huge.txt", { type: "text/plain" });

    await expect(processUploadedFile(file)).rejects.toThrow(
      /^Failed to process file huge\.txt: Extracted content of \d+ characters exceeds the maximum/,
    );
  }, 20_000);
});
