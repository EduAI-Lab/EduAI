// @vitest-environment node
//
// Regression test for the real (unmocked) mammoth DOCX path, kept in its own file so
// it never shares a module registry with file-processing.test.ts. That file mocks
// `mammoth` at the top for its other DOCX tests (see the comment there); mammoth is
// imported dynamically *inside* extractDocxText, so as long as this file never mocks
// or resets modules, `await import("mammoth")` here always resolves to the real
// package, exercising the exact call shape production DOCX uploads go through.
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { extractDocxText } from "~/lib/ai/file-processing";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

async function buildRealDocx(text: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "word/document.xml",
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
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
      arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    };

    const result = await extractDocxText(file as any);

    expect(result.content).toContain("Hello from a real docx");
  });
});
