import { BufferLoader } from "./BufferLoader";
import type { Document } from "@langchain/core/documents";
import { extractRawText } from "mammoth";

export class DocxLoader extends BufferLoader {
  constructor(
    public file: string | Buffer | Blob,
    public type: "path" | "buffer" | "blob"
  ) {
    super(file, type);
  }

  protected async parse(buffer: Buffer, metadata: Record<string, any>): Promise<Document[]> {
    const docx = await extractRawText({ buffer });
    if (!docx.value) return [];
    return [
      {
        pageContent: docx.value,
        metadata,
      } as any,
    ];
  }
}



