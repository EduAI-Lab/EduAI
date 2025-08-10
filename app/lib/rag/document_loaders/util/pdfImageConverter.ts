// PDF -> image conversion using pdfjs-dist and node-canvas, loaded dynamically at runtime
// to avoid build-time native dependencies unless OCR is explicitly used.

export class ConversionConfig {
  width?: number = 1000;
  height?: number = 1000;
  page_numbers?: number[] = [];
  base64?: boolean = false;
  scale?: number = 1;
  constructor(params: Partial<ConversionConfig> = {}) {
    Object.assign(this, params);
  }
}

export async function convert(pdf: string | Buffer, conversion_config: ConversionConfig = new ConversionConfig()) {
  // Lazy import native deps only when OCR is requested
  let pdfjs: any;
  let Canvas: any;
  try {
    pdfjs = await import("pdfjs-dist/legacy/build/pdf");
  } catch (e) {
    throw new Error("pdfjs-dist is required for PDF OCR. Install 'pdfjs-dist'.");
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    Canvas = require("canvas");
  } catch (e) {
    throw new Error(
      "node-canvas is required for PDF OCR. Install 'canvas' and system libs (cairo/pango). Or use parseAsPng=false."
    );
  }

  const { getDocument, GlobalWorkerOptions } = pdfjs;
  GlobalWorkerOptions.workerSrc = "pdfjs-dist/legacy/build/pdf.worker.js";

  const outputPages: any[] = [];
  let pdfData: Uint8Array<ArrayBuffer>;
  if (typeof pdf === "string") {
    if (/^https?:\/\//i.test(pdf)) {
      const m: any = await import("node-fetch");
      const resp = await (m.default || m)(pdf);
      pdfData = new Uint8Array(await resp.arrayBuffer());
    } else if (/pdfData:pdf\/.+;base64,.+/.test(pdf)) {
      pdfData = new Uint8Array(Buffer.from(pdf.split(",")[1], "base64"));
    } else {
      const fs = await import("fs");
      pdfData = new Uint8Array(fs.readFileSync(pdf));
    }
  } else {
    pdfData = new Uint8Array(pdf);
  }

  const pdfDocument = await getDocument({ data: pdfData, disableFontFace: true, verbosity: 0 }).promise;

  const pageNumbers =
    conversion_config.page_numbers && conversion_config.page_numbers.length > 0
      ? conversion_config.page_numbers
      : Array.from({ length: pdfDocument.numPages }, (_, i) => i + 1);

  for (const pageNo of pageNumbers) {
    const page = await pdfDocument.getPage(pageNo);
    const outputScale = conversion_config.scale || 1.0;
    let viewport = page.getViewport({ scale: outputScale });
    if (conversion_config.width) {
      const scale = conversion_config.width / viewport.width;
      viewport = page.getViewport({ scale });
    } else if (conversion_config.height) {
      const scale = conversion_config.height / viewport.height;
      viewport = page.getViewport({ scale });
    }

    // Create node-canvas
    const canvas = Canvas.createCanvas(viewport.width, viewport.height);
    const context = canvas.getContext("2d");
    const renderContext = {
      canvasContext: context,
      viewport,
    } as any;
    await page.render(renderContext).promise;
    const buf = canvas.toBuffer("image/png");
    outputPages.push(conversion_config.base64 ? buf.toString("base64") : new Uint8Array(buf));
  }

  return outputPages;
}




