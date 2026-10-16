// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { ExtractionBusyError } from "~/lib/ai/extraction-busy-error";
import {
  ChatAttachmentError,
  IMAGE_TRANSCRIPT_PREFIX,
  extractChatAttachment,
} from "~/lib/chat/attachment-extraction.server";

const vision = vi.hoisted(() => ({ extractImageText: vi.fn() }));
vi.mock("~/lib/ai/image-text-extraction.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/ai/image-text-extraction.server")>()),
  extractImageText: vision.extractImageText,
}));

const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const pngFile = (name = "shot.png") =>
  new File([new Uint8Array([...PNG_HEADER, 0, 0, 0, 0])], name, { type: "image/png" });

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

async function xlsx(rows: string): Promise<File> {
  const zip = new JSZip();
  const ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  zip.file(
    "xl/workbook.xml",
    `<workbook ${ns} xmlns:r="r"><sheets><sheet name="Lab" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    '<Relationships><Relationship Id="rId1" Type="ws" Target="worksheets/sheet1.xml"/></Relationships>',
  );
  zip.file("xl/sharedStrings.xml", `<sst ${ns}><si><t>Total</t></si></sst>`);
  zip.file(
    "xl/worksheets/sheet1.xml",
    `<worksheet ${ns}><sheetData>${rows}</sheetData></worksheet>`,
  );
  const buffer = await zip.generateAsync({ type: "arraybuffer" });
  return new File([buffer], "lab.xlsx", { type: "" });
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

  it("truncates within maxChars, flags it, and tells the model how much was kept", async () => {
    const file = new File(["x".repeat(1000)], "long.txt", { type: "text/plain" });
    const result = await extractChatAttachment(file, { maxBytes: 1024 * 1024, maxChars: 200 });
    const marker = /\n\n\[Only the first ([\d,]+) characters of this file were included\.\]$/u;
    const match = marker.exec(result.text);
    expect(match).not.toBeNull();
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(200);
    expect(result.charCount).toBe(result.text.length);
    expect(Number((match?.[1] ?? "").replace(/,/gu, ""))).toBe(result.text.indexOf("\n\n["));
  });

  it("formats the kept character count with thousands separators", async () => {
    const file = new File(["x".repeat(5000)], "long.txt", { type: "text/plain" });
    const result = await extractChatAttachment(file, { maxBytes: 1024 * 1024, maxChars: 2000 });
    expect(result.text).toMatch(/Only the first 1,9\d\d characters/u);
    expect(result.text.length).toBeLessThanOrEqual(2000);
  });

  it("just slices when maxChars is smaller than the marker", async () => {
    const file = new File(["x".repeat(80)], "long.txt", { type: "text/plain" });
    const result = await extractChatAttachment(file, LIMITS);
    expect(result).toMatchObject({ truncated: true, charCount: 50 });
    expect(result.text).toBe("x".repeat(50));
  });

  it("adds no marker when the file fits", async () => {
    const file = new File(["x".repeat(40)], "fits.txt", { type: "text/plain" });
    const result = await extractChatAttachment(file, LIMITS);
    expect(result.truncated).toBe(false);
    expect(result.text).toBe("x".repeat(40));
    expect(result.text).not.toContain("Only the first");
  });

  it("caps a long filename at 255 characters and keeps the extension", async () => {
    const file = new File(["hello"], `${"a".repeat(300)}.txt`, { type: "text/plain" });
    const result = await extractChatAttachment(file, LIMITS);
    expect(result.name).toHaveLength(255);
    expect(result.name.endsWith(".txt")).toBe(true);
  });

  it("leaves a name of exactly 255 characters alone", async () => {
    const name = `${"a".repeat(251)}.txt`;
    const result = await extractChatAttachment(new File(["hello"], name), LIMITS);
    expect(result.name).toBe(name);
  });

  it("rejects an unsupported extension", async () => {
    await expectCode(
      extractChatAttachment(new File(["x"], "animation.gif", { type: "image/gif" }), LIMITS),
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
      "ATTACHMENT_ENCODING_UNSUPPORTED",
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

  it("rejects invalid UTF-8 in a .txt instead of decoding leniently", async () => {
    await expectCode(
      extractChatAttachment(new File([new Uint8Array([0xff, 0xfe, 0xfd])], "a.txt"), LIMITS),
      "ATTACHMENT_ENCODING_UNSUPPORTED",
    );
  });

  it("rejects a NUL byte after the first 8 bytes in a .md", async () => {
    const bytes = new Uint8Array([...new TextEncoder().encode("# heading text"), 0, 0x61]);
    await expectCode(
      extractChatAttachment(new File([bytes], "notes.md"), LIMITS),
      "ATTACHMENT_TYPE_UNSUPPORTED",
    );
  });

  it("keeps the underlying cause on extraction failures and logs it", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]);
      const error = await extractChatAttachment(new File([bytes], "broken.docx"), LIMITS).catch(
        (e: Error) => e,
      );
      expect(error).toBeInstanceOf(ChatAttachmentError);
      expect((error as Error).cause).toBeInstanceOf(Error);
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("extractChatAttachment images (#1742)", () => {
  const ROOMY = { maxBytes: 1024 * 1024, maxChars: 20_000 };

  it("returns the vision model's transcript, labelled as an image, as plain text", async () => {
    vision.extractImageText.mockResolvedValueOnce({
      content: "```\nError in lm(y ~ x): object 'y' not found\n```",
      model: "qwen3.8-27b-instruct",
    });
    const result = await extractChatAttachment(pngFile(), ROOMY);
    expect(result).toMatchObject({ name: "shot.png", contentType: "text/plain", truncated: false });
    expect(result.text.startsWith(`${IMAGE_TRANSCRIPT_PREFIX}\n\n`)).toBe(true);
    expect(result.text).toContain("object 'y' not found");
  });

  it("asks for the chat transcription, not the material one", async () => {
    vision.extractImageText.mockResolvedValueOnce({ content: "text", model: "m" });
    await extractChatAttachment(pngFile(), ROOMY);
    const [bytes, mimeType, purpose] = vision.extractImageText.mock.lastCall ?? [];
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(mimeType).toBe("image/png");
    expect(purpose).toBe("chat");
  });

  it("rejects a file whose bytes are not the image its name claims, without calling the model", async () => {
    vision.extractImageText.mockClear();
    await expectCode(
      extractChatAttachment(new File(["not a png"], "fake.png"), ROOMY),
      "ATTACHMENT_TYPE_UNSUPPORTED",
    );
    expect(vision.extractImageText).not.toHaveBeenCalled();
  });

  it("maps a busy vision host to ATTACHMENT_BUSY so the chip offers a retry", async () => {
    vision.extractImageText.mockRejectedValueOnce(new ExtractionBusyError());
    await expectCode(extractChatAttachment(pngFile(), ROOMY), "ATTACHMENT_BUSY");
  });

  it("maps an image with nothing to read to ATTACHMENT_IMAGE_UNREADABLE", async () => {
    vision.extractImageText.mockRejectedValueOnce(
      new Error("No readable text or description could be extracted from this image"),
    );
    await expectCode(extractChatAttachment(pngFile(), ROOMY), "ATTACHMENT_IMAGE_UNREADABLE");
  });

  it("maps any other vision failure to ATTACHMENT_EXTRACT_FAILED", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vision.extractImageText.mockRejectedValueOnce(new Error("Image text extraction failed: 400"));
    await expectCode(extractChatAttachment(pngFile(), ROOMY), "ATTACHMENT_EXTRACT_FAILED");
    spy.mockRestore();
  });

  it("truncates a long transcript like any other attachment", async () => {
    vision.extractImageText.mockResolvedValueOnce({ content: "y".repeat(5000), model: "m" });
    const result = await extractChatAttachment(pngFile(), {
      maxBytes: 1024 * 1024,
      maxChars: 1000,
    });
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(1000);
  });
});

describe("extractChatAttachment spreadsheets (#1742)", () => {
  const ROOMY = { maxBytes: 1024 * 1024, maxChars: 20_000 };

  it("reads a real .xlsx through the isolated worker, formulas included", async () => {
    const file = await xlsx(
      '<row r="1"><c r="A1"><v>4</v></c><c r="B1"><v>6</v></c></row>' +
        '<row r="2"><c r="A2" t="s"><v>0</v></c><c r="B2"><f>SUM(A1:B1)</f><v>10</v></c></row>',
    );
    const result = await extractChatAttachment(file, ROOMY);
    expect(result).toMatchObject({ name: "lab.xlsx", contentType: "text/plain", truncated: false });
    expect(result.text).toBe("--- Sheet: Lab ---\n4 | 6\nTotal | 10 (=SUM(A1:B1))");
  });

  it("reads a filled-down column's formulas through the worker (#1990 review)", async () => {
    const file = await xlsx(
      '<row r="1"><c r="A1"><v>2</v></c><c r="B1"><f t="shared" ref="B1:B2" si="0">A1*10</f><v>20</v></c></row>' +
        '<row r="2"><c r="A2"><v>3</v></c><c r="B2"><f t="shared" si="0"/><v>30</v></c></row>',
    );
    const result = await extractChatAttachment(file, ROOMY);
    expect(result.text).toBe("--- Sheet: Lab ---\n2 | 20 (=A1*10)\n3 | 30 (=A2*10)");
  });

  it("maps a full extraction pool to ATTACHMENT_BUSY, not a broken file (#1990 review)", async () => {
    const processing = await import("~/lib/ai/file-processing");
    const spy = vi
      .spyOn(processing, "extractXlsxText")
      .mockRejectedValueOnce(new ExtractionBusyError("pool full"));
    await expectCode(extractChatAttachment(await xlsx(""), ROOMY), "ATTACHMENT_BUSY");
    spy.mockRestore();
  });

  it("rejects a non-ZIP file named .xlsx", async () => {
    await expectCode(
      extractChatAttachment(new File(["a,b\n1,2"], "fake.xlsx"), ROOMY),
      "ATTACHMENT_TYPE_UNSUPPORTED",
    );
  });

  it("rejects a workbook with no values as empty", async () => {
    await expectCode(extractChatAttachment(await xlsx(""), ROOMY), "ATTACHMENT_EMPTY");
  });

  it("maps a corrupt workbook to ATTACHMENT_EXTRACT_FAILED", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]);
    await expectCode(
      extractChatAttachment(new File([bytes], "broken.xlsx"), ROOMY),
      "ATTACHMENT_EXTRACT_FAILED",
    );
    spy.mockRestore();
  });
});
