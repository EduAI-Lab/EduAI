import { Document } from "@langchain/core/documents";
import { MultiModalLLMService } from "./multimodal-llm.service";
import { MLLMPDFLoader } from "./document_loaders/MLLMPDFLoader";
import { MLLMPPTXLoader } from "./document_loaders/MLLMPPTXLoader";
import { DocxLoader } from "./document_loaders/modified_imports/DocxLoader";
import { TextLoader } from "./document_loaders/modified_imports/TextLoader";
import { CSVLoader } from "./document_loaders/modified_imports/CSVLoader";
import { PPTXLoader } from "./document_loaders/modified_imports/PPTXLoader";
import { PDFLoader } from "./document_loaders/modified_imports/PDFLoader";
import { BaseDocumentLoader } from "./document_loaders/modified_imports/BaseDocumentLoader";
import fse from "fs-extra";

export class UploadService {
  constructor(private mllmService: MultiModalLLMService) {}

  checkIfGithubBlob(rawUrl: string) {
    const url = new URL(rawUrl);
    if (!url.hostname.includes("github.com")) return false;
    const pathParts = url.pathname.split("/");
    return !!pathParts.find((p) => p === "blob");
  }

  replaceBlobWithRaw(rawUrl: string) {
    const url = new URL(rawUrl);
    const pathParts = url.pathname.split("/");
    const index = pathParts.findIndex((p) => p === "blob");
    pathParts[index] = "raw";
    url.pathname = `${pathParts.join("/")}`;
    return url.toString();
  }

  async bodyToBuffer(body: any): Promise<Buffer> {
    const stream = body as ReadableStream;
    const reader = stream.getReader();
    const chunks: any[] = [];
    let last: ReadableStreamReadResult<any> = { value: undefined, done: false };
    while (!last.done) {
      last = await reader.read();
      if (last.value) {
        chunks.push(last.value);
      }
    }
    return Buffer.concat(chunks);
  }

  getFileTypeAndName(file: string) {
    const type = file.includes(".") ? file.split(".").pop() : "";
    const name = file.replace(/\.[^/.]+$/, "");
    return { type, name };
    }

  async uploadFile(file: { buffer: Buffer; originalname: string }, dir: string) {
    await this.uploadBuffer(file.buffer, file.originalname, dir);
  }

  async uploadBuffer(buffer: Buffer, file: string, dir: string) {
    await this.createUploadDirectory(dir);
    fse.writeFileSync(`${dir}/${file}`, buffer, "utf-8");
  }

  async createUploadDirectory(path: string): Promise<string> {
    if (fse.existsSync(path)) {
      fse.removeSync(path);
    }
    fse.ensureDirSync(path);
    return Promise.resolve("Success");
  }

  async deleteDirectory(path: string) {
    await fse.remove(path);
  }

  async readFile(path: string): Promise<Buffer> {
    try {
      return await fse.readFile(path);
    } catch (error) {
      console.error("Error reading file:", error);
      throw error;
    }
  }

  async loadFileForChunking(
    file: { originalname: string; buffer: Buffer },
    parseAsPng = false
  ): Promise<Document[]> {
    return this.getFileLoader(file, parseAsPng).load();
  }

  getFileLoader(
    file: { originalname: string; buffer: Buffer },
    parseAsPng = false
  ): BaseDocumentLoader {
    const { type } = this.getFileTypeAndName(file.originalname);

    let loader: BaseDocumentLoader;
    switch (type) {
      case "pdf":
        loader = parseAsPng
          ? new MLLMPDFLoader(file.buffer, "buffer", this.mllmService)
          : new PDFLoader(file.buffer, "buffer");
        break;
      case "docx":
        loader = new DocxLoader(file.buffer, "buffer");
        break;
      case "txt":
        loader = new TextLoader(file.buffer, "buffer");
        break;
      case "csv":
        loader = new CSVLoader(file.buffer, "buffer");
        break;
      case "tsv":
        loader = new CSVLoader(file.buffer, "buffer", "utf-8", "tsv", "\t");
        break;
      case "pptx":
        loader = parseAsPng
          ? new MLLMPPTXLoader(file.buffer, "buffer", this.mllmService)
          : new PPTXLoader(file.buffer, "buffer");
        break;
      default:
        throw new Error(`Unsupported file type: ${type}`);
    }
    return loader;
  }

  async isFolderEmpty(folderPath: string): Promise<boolean> {
    const files = await fse.readdir(folderPath);
    return files.length === 0;
  }
}


