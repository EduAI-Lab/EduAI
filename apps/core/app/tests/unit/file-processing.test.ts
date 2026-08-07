import { describe, it, expect } from "vitest";
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
} from "~/lib/ai/file-processing";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PPTX_MIME =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

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
