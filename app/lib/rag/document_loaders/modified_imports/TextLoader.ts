import type { Document } from "@langchain/core/documents";
import { readFile } from "fs-extra";
import { BaseDocumentLoader } from "./BaseDocumentLoader";

export class TextLoader extends BaseDocumentLoader {
  constructor(
    public file: string | Buffer | Blob,
    public type: "path" | "buffer" | "blob",
    public encoding: BufferEncoding = "utf-8",
    public fileType: string = "txt"
  ) {
    super(file, type);
  }

  async load(): Promise<Document[]> {
    const { text, metadata } = await this.loadText();
    const parsed = await this.parse(text);
    parsed.forEach((pageContent, i) => {
      if (typeof pageContent !== "string") {
        throw new Error(`Expected string, at position ${i} got ${typeof pageContent}`);
      }
    });
    return parsed.map((pageContent, i) =>
      ({
        pageContent,
        metadata: parsed.length === 1 ? metadata : { ...metadata, line: i + 1 },
      } as any)
    );
  }

  protected async loadText(): Promise<{ text: string; metadata: Record<string, any> }> {
    let text = "";
    let metadata: Record<string, any> = {};
    switch (this.type) {
      case "path":
        text = await readFile(this.file as unknown as string, this.encoding);
        metadata = { source: this.file } as any;
        break;
      case "buffer":
        text = (this.file as unknown as Buffer).toString(this.encoding);
        break;
      case "blob":
        text = await (this.file as unknown as Blob).text();
        metadata = { source: "blob", blobType: this.fileType } as any;
        break;
    }
    return { text, metadata };
  }

  protected async parse(raw: string): Promise<string[]> {
    return [raw];
  }
}



