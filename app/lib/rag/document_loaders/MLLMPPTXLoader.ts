// PPTX reader that extracts text via JSZip + xmldom; no native deps.
import { Document } from "@langchain/core/documents";
import { BufferLoader } from "./modified_imports/BufferLoader";
import JSZip from "jszip";
import { DOMParser } from "xmldom";

type Metadata = Record<string, any>;

export class MLLMPPTXLoader extends BufferLoader {
  constructor(
    public file: string | Buffer | Blob,
    public type: "path" | "buffer" | "blob"
  ) {
    super(file, type);
  }

  protected async parse(buffer: Buffer, metadata: Metadata): Promise<Document[]> {
    const zip = await JSZip.loadAsync(buffer);
    const slides: Document[] = [];
    let index = 1;
    while (true) {
      const slideFile = zip.file(`ppt/slides/slide${index}.xml`);
      if (!slideFile) break;
      const xml = await slideFile.async("text");
      const doc = new DOMParser().parseFromString(xml, "application/xml");
      const nodes = doc.getElementsByTagName("a:t");
      let text = "";
      for (let i = 0; i < nodes.length; i++) {
        text += (nodes.item(i)?.textContent || "") + " ";
      }
      text = text.trim();
      if (text) {
        slides.push(new Document({ pageContent: text, metadata: { ...metadata, page: index } }));
      }
      index++;
    }
    return slides;
  }
}



