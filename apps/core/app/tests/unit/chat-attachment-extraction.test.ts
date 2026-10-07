// @vitest-environment node
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import {
  ChatAttachmentError,
  extractChatAttachment,
} from "~/lib/chat/attachment-extraction.server";

const LIMITS = { maxBytes: 1024 * 1024, maxChars: 50 };

async function docx(text: string): Promise<File> {
  const zip = new JSZip();
  zip.file(
    "word/document.xml",
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
  );
  const buffer = await zip.generateAsync({ type: "arraybuffer" });
  return new File([buffer], "notes.docx", { type: "" });
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(ChatAttachmentError);
  await expect(promise).rejects.toMatchObject({ code });
}

describe("extractChatAttachment", () => {
  it("extracts a real DOCX through the isolated worker", async () => {
    const result = await extractChatAttachment(await docx("Hello from docx"), LIMITS);
    expect(result).toMatchObject({
      name: "notes.docx",
      contentType: "text/plain",
      truncated: false,
    });
    expect(result.text).toContain("Hello from docx");
  });

  it("decodes a code file as UTF-8 and keeps indentation", async () => {
    const file = new File(["def f():\n    return 'é'\n"], "main.py", { type: "text/x-python" });
    const result = await extractChatAttachment(file, LIMITS);
    expect(result.text).toBe("def f():\n    return 'é'");
  });

  it("truncates to maxChars and flags it", async () => {
    const file = new File(["x".repeat(80)], "long.txt", { type: "text/plain" });
    const result = await extractChatAttachment(file, LIMITS);
    expect(result).toMatchObject({ truncated: true, charCount: 50 });
    expect(result.text).toHaveLength(50);
  });

  it("rejects an unsupported extension", async () => {
    await expectCode(
      extractChatAttachment(new File(["x"], "photo.png", { type: "image/png" }), LIMITS),
      "ATTACHMENT_TYPE_UNSUPPORTED",
    );
  });

  it("rejects binary bytes behind a text extension", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    await expectCode(
      extractChatAttachment(new File([png], "notes.sql", { type: "" }), LIMITS),
      "ATTACHMENT_TYPE_UNSUPPORTED",
    );
  });

  it("rejects invalid UTF-8 behind a text extension", async () => {
    await expectCode(
      extractChatAttachment(new File([new Uint8Array([0xff, 0xfe, 0xfd])], "a.csv"), LIMITS),
      "ATTACHMENT_TYPE_UNSUPPORTED",
    );
  });

  it("rejects a non-PDF renamed .pdf via the signature check", async () => {
    await expectCode(
      extractChatAttachment(new File(["hello"], "fake.pdf"), LIMITS),
      "ATTACHMENT_TYPE_UNSUPPORTED",
    );
  });

  it("rejects an empty text file", async () => {
    await expectCode(
      extractChatAttachment(new File(["   \n\n"], "blank.txt"), LIMITS),
      "ATTACHMENT_EMPTY",
    );
  });

  it("rejects a file over maxBytes before reading it", async () => {
    await expectCode(
      extractChatAttachment(new File(["x".repeat(20)], "big.txt"), { maxBytes: 10, maxChars: 50 }),
      "ATTACHMENT_TOO_LARGE",
    );
  });

  it("maps a corrupt DOCX to ATTACHMENT_EXTRACT_FAILED", async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]);
    await expectCode(
      extractChatAttachment(new File([bytes], "broken.docx"), LIMITS),
      "ATTACHMENT_EXTRACT_FAILED",
    );
  });
});
