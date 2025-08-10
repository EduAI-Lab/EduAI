import { BufferLoader } from "./BufferLoader";
import { getDocument, version } from "pdfjs-dist/legacy/build/pdf";
import type { Document } from "@langchain/core/documents";

export class PDFLoader extends BufferLoader {
  constructor(
    public file: string | Buffer | Blob,
    public type: "path" | "buffer" | "blob",
    private splitPages = true,
    private parsedItemSeparator: string = ", "
  ) {
    super(file, type);
  }

  protected async parse(buffer: Buffer, metadata: Record<string, any>): Promise<Document[]> {
    const pdf = await getDocument({
      data: new Uint8Array(buffer.buffer),
      useWorkerFetch: false,
      isEvalSupported: false,
      useSystemFonts: true,
    }).promise;

    const meta = await pdf.getMetadata().catch(() => null);
    const documents: Document[] = [] as any;
    for (let i = 1; i <= pdf.numPages; i += 1) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      if (content.items.length === 0) continue;
      let lastY = -1;
      const textItems: string[] = [];
      for (const item of content.items as any[]) {
        if ("str" in item) {
          if (lastY === item.transform[5] || !lastY) {
            textItems.push(item.str);
          } else {
            textItems.push(`\n${item.str}`);
          }
          lastY = item.transform[5];
        }
      }
      const text = textItems.join(this.parsedItemSeparator);
      documents.push({
        pageContent: text,
        metadata: {
          ...metadata,
          pdf: {
            version: version,
            info: (meta as any)?.info,
            metadata: (meta as any)?.metadata,
            totalPages: pdf.numPages,
          },
          loc: { pageNumber: i },
        },
      } as any);
    }
    if (this.splitPages) return documents as any;
    if (documents.length === 0) return [];
    return [
      {
        pageContent: (documents as any[]).map((d) => d.pageContent).join("\n\n"),
        metadata: {
          ...metadata,
          pdf: {
            version: version,
            info: (meta as any)?.info,
            metadata: (meta as any)?.metadata,
            totalPages: pdf.numPages,
          },
        },
      } as any,
    ];
  }
}



