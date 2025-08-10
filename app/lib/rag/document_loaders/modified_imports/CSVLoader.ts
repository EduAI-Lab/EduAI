import { TextLoader } from "./TextLoader";
import { parse as parseCSV } from "papaparse";

export class CSVLoader extends TextLoader {
  constructor(
    public file: string | Buffer | Blob,
    public type: "path" | "buffer" | "blob",
    public encoding: BufferEncoding = "utf-8",
    public fileType: string = "csv",
    private separator: string = ",",
    private header: boolean = true
  ) {
    super(file, type, encoding, fileType);
  }

  protected async parse(raw: string): Promise<string[]> {
    const parsed = parseCSV(raw.trim(), {
      header: this.header,
      delimiter: this.separator,
    });
    return (parsed.data as any[]).map((row) =>
      Object.keys(row)
        .map((key) => `${key.trim()}: ${String(row[key] ?? "").trim()}`)
        .join("\n")
    );
  }
}



