import type { Document } from "@langchain/core/documents";

export abstract class BaseDocumentLoader {
  protected constructor(
    public file: string | Buffer | Blob,
    public type: "path" | "buffer" | "blob"
  ) {}

  abstract load(): Promise<Document[]>;
}



