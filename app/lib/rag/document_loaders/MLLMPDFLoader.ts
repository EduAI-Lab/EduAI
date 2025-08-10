import { Document } from "@langchain/core/documents";
import { MultiModalLLMService } from "../../rag/multimodal-llm.service";
import { BufferLoader } from "./modified_imports/BufferLoader";
import { convert } from "./util/pdfImageConverter";

type Metadata = Record<string, any>;

export class MLLMPDFLoader extends BufferLoader {
  constructor(
    public file: string | Buffer | Blob,
    public type: "path" | "buffer" | "blob",
    private multimodalLLMService: MultiModalLLMService
  ) {
    super(file, type);
  }

  protected async parse(buffer: Buffer, metadata: Metadata): Promise<Document[]> {
    const base64ImageSlides = await convert(buffer, { base64: true });
    const results: Document[] = [];
    if ((base64ImageSlides as any[]).length >= 100) {
      throw new Error(
        "Too many slides in the PDF. Please upload a PDF with fewer than 100 slides."
      );
    }
    for (let i = 0; i < (base64ImageSlides as any[]).length; i++) {
      const b64Slide: string | Uint8Array = (base64ImageSlides as any[])[i];
      const b64SlideArray: string[] =
        typeof b64Slide === "string"
          ? [b64Slide]
          : [Buffer.from(b64Slide).toString("base64")];
      const response = await this.multimodalLLMService.promptMLLM({
        imageBlobs: b64SlideArray,
        systemPrompt:
          "Please provide a detailed description of the content presented on the following slide/image. OCR any text that is present, and summarize any graphics or charts.",
      });
      if (response && (response as any).content) {
        results.push({
          pageContent: (response as any).content.toString(),
          metadata: {
            ...metadata,
            page: i + 1,
            loc: { pageNumber: i + 1 },
          },
        } as any);
      }
    }
    return results;
  }
}


