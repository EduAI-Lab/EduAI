import { readFile } from "fs-extra";
import type { Document } from "@langchain/core/documents";

export abstract class BufferLoader {
  protected constructor(
    public file: string | Buffer | Blob,
    public type: "path" | "buffer" | "blob"
  ) {}

  async load() {
    const { buffer, metadata } = await this.loadBuffer();
    return this.parse(buffer, metadata);
  }

  protected async loadBuffer(): Promise<{ buffer: Buffer; metadata: Record<string, any> }> {
    let buffer: Buffer;
    let metadata: Record<string, any> = {};
    switch (this.type) {
      case "path":
        buffer = await readFile(this.file as unknown as string);
        metadata = { source: this.file };
        break;
      case "buffer":
        buffer = this.file as unknown as Buffer;
        break;
      case "blob":
        buffer = await (this.file as unknown as Blob)
          .arrayBuffer()
          .then((arrayBuffer: ArrayBuffer) => Buffer.from(arrayBuffer));
        metadata = { source: "blob", blobType: (this.file as Blob).type } as any;
        break;
    }
    return { buffer, metadata };
  }

  protected abstract parse(buffer: Buffer, metadata: Record<string, any>): Promise<Document[]>;
}



