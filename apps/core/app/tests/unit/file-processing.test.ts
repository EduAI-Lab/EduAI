import { describe, it, expect } from "vitest";
import {
  sanitizeTextContent,
  generateChecksum,
  validateFile,
  applySemanticChunking,
  extractTextFromFile,
} from "~/lib/ai/file-processing";

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
