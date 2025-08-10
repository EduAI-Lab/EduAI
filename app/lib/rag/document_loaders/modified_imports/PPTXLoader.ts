import { BufferLoader } from "./BufferLoader";
import type { Document } from "@langchain/core/documents";
let parseOfficeAsync: ((buf: Buffer, opts?: any) => Promise<string>) | undefined;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  parseOfficeAsync = require("officeparser").parseOfficeAsync;
} catch {}

export class PPTXLoader extends BufferLoader {
  constructor(
    public file: string | Buffer | Blob,
    public type: "path" | "buffer" | "blob"
  ) {
    super(file, type);
  }

  protected async parse(buffer: Buffer, metadata: Record<string, any>): Promise<Document[]> {
    if (parseOfficeAsync) {
      const text = await parseOfficeAsync(buffer, { outputErrorToConsole: true });
      if (!text) return [];
      return [
        {
          pageContent: text,
          metadata,
        } as any,
      ];
    }
    return [];
  }
}



