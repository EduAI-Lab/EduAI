// @vitest-environment node
//
// Regression test for the real (unmocked) mammoth DOCX path. mammoth now runs inside
// the isolated extraction worker (#1494 review), so this is the only place the full
// DOCX round trip — ZIP guard, worker spawn, mammoth conversion, HTML->markdown, and
// the warning plumbing back into `metadata.extractionWarnings` — is exercised end to
// end; file-processing.test.ts can only reach the in-process halves.
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { extractDocxText } from "~/lib/ai/file-processing";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

async function buildRealDocx(
  text: string,
  options: { paragraphStyle?: string } = {},
): Promise<Buffer> {
  const zip = new JSZip();
  const paragraphProps = options.paragraphStyle
    ? `<w:pPr><w:pStyle w:val="${options.paragraphStyle}"/></w:pPr>`
    : "";
  zip.file(
    "word/document.xml",
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p>${paragraphProps}<w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("extractDocxText (real mammoth, unmocked)", () => {
  it("extracts text from a real DOCX without throwing 'Could not find file in options'", async () => {
    const buffer = await buildRealDocx("Hello from a real docx");
    const file = {
      name: "notes.docx",
      type: DOCX_MIME,
      size: buffer.byteLength,
      arrayBuffer: async () =>
        buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    };

    const result = await extractDocxText(file as any);

    expect(result.content).toContain("Hello from a real docx");
  });

  it("surfaces mammoth extraction warnings in metadata without throwing", async () => {
    // An unmapped paragraph style makes mammoth emit a warning message rather than
    // fail; the worker forwards `result.messages` back to the parent, which exposes
    // them as `metadata.extractionWarnings`.
    const buffer = await buildRealDocx("Styled body", {
      paragraphStyle: "NotAStyleMammothKnows",
    });
    const file = {
      name: "styled.docx",
      type: DOCX_MIME,
      size: buffer.byteLength,
      arrayBuffer: async () =>
        buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    };

    const result = await extractDocxText(file as any);

    expect(result.content).toContain("Styled body");
    expect(result.metadata?.extractionWarnings?.length).toBeGreaterThan(0);
  });
});
