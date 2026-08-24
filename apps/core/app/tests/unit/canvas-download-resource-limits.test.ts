// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadCanvasFile } from "~/lib/canvas/client.server";

const MAX_CANVAS_FILE_SIZE = 50 * 1024 * 1024;
const ONE_MEBIBYTE = 1024 * 1024;
const PDF_HEADER = new TextEncoder().encode("%PDF-1.7\n");

const CREDENTIALS = {
  canvasUrl: "http://localhost:8080",
  apiKey: "test-token",
  isTestMode: false,
} as const;

function canvasFile(overrides: Record<string, unknown> = {}) {
  return {
    id: 101,
    url: "http://localhost:8080/files/101/download",
    filename: "lecture.pdf",
    "content-type": "application/pdf",
    ...overrides,
  };
}

function validPdfBytes(suffix = "bounded content"): Uint8Array {
  return new TextEncoder().encode(`%PDF-1.7\n${suffix}`);
}

function responseFetch(response: Response) {
  return vi.fn(async () => response) as typeof fetch;
}

function sizedPdfStream(
  totalBytes: number,
  options: { onCancel?: (reason: unknown) => void; chunkSize?: number } = {},
): ReadableStream<Uint8Array> {
  const chunkSize = options.chunkSize ?? ONE_MEBIBYTE;
  const repeatedChunk = new Uint8Array(chunkSize);
  const firstChunk = new Uint8Array(chunkSize);
  firstChunk.set(PDF_HEADER);
  let emitted = 0;

  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (emitted >= totalBytes) {
        controller.close();
        return;
      }

      const remaining = totalBytes - emitted;
      const nextLength = Math.min(chunkSize, remaining);
      const source = emitted === 0 ? firstChunk : repeatedChunk;
      controller.enqueue(nextLength === chunkSize ? source : source.subarray(0, nextLength));
      emitted += nextLength;
    },
    cancel(reason) {
      options.onCancel?.(reason);
    },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Canvas file download resource and content validation", () => {
  it("rejects an over-limit Content-Length before reading despite small Canvas metadata", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(validPdfBytes());
      },
      cancel,
    });
    const fetchImpl = responseFetch(
      new Response(body, {
        status: 200,
        headers: {
          "content-length": String(MAX_CANVAS_FILE_SIZE + 1),
          "content-type": "application/pdf",
        },
      }),
    );

    await expect(
      downloadCanvasFile(CREDENTIALS, canvasFile({ size: 1 }), fetchImpl),
    ).rejects.toMatchObject({ statusCode: 413 });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("accepts a valid document when Content-Length is absent", async () => {
    const body = "%PDF-1.7\nno declared length";
    const bytes = new TextEncoder().encode(body);
    const fetchImpl = responseFetch(
      new Response(body, {
        status: 200,
        headers: { "content-type": "application/pdf" },
      }),
    );

    await expect(downloadCanvasFile(CREDENTIALS, canvasFile(), fetchImpl)).resolves.toEqual(bytes);
  });

  it.each([
    {
      filename: "notes.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      packagePath: "word/document.xml",
    },
    {
      filename: "slides.pptx",
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      packagePath: "ppt/presentation.xml",
    },
  ])("accepts a $filename OOXML package signature", async ({ filename, mimeType, packagePath }) => {
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    zip.file("[Content_Types].xml", "<Types />");
    zip.file(packagePath, "<document />");
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const fetchImpl = responseFetch(
      new Response(Uint8Array.from(bytes).buffer, {
        status: 200,
        headers: { "content-type": mimeType },
      }),
    );

    await expect(
      downloadCanvasFile(
        CREDENTIALS,
        canvasFile({ filename, "content-type": mimeType }),
        fetchImpl,
      ),
    ).resolves.toEqual(bytes);
  });

  it("cancels a chunked response as soon as actual bytes exceed the absolute cap", async () => {
    const cancel = vi.fn();
    const fetchImpl = responseFetch(
      new Response(
        sizedPdfStream(MAX_CANVAS_FILE_SIZE + 2 * ONE_MEBIBYTE, {
          onCancel: cancel,
        }),
        { status: 200, headers: { "content-type": "application/pdf" } },
      ),
    );

    await expect(
      downloadCanvasFile(CREDENTIALS, canvasFile({ size: 1 }), fetchImpl),
    ).rejects.toMatchObject({ statusCode: 413 });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("accepts a streamed document exactly at the 50 MiB boundary", async () => {
    const fetchImpl = responseFetch(
      new Response(sizedPdfStream(MAX_CANVAS_FILE_SIZE), {
        status: 200,
        headers: {
          "content-length": String(MAX_CANVAS_FILE_SIZE),
          "content-type": "application/pdf",
        },
      }),
    );

    const bytes = await downloadCanvasFile(CREDENTIALS, canvasFile(), fetchImpl);

    expect(bytes.byteLength).toBe(MAX_CANVAS_FILE_SIZE);
    expect(bytes.subarray(0, PDF_HEADER.length)).toEqual(PDF_HEADER);
  });

  it("rejects and cancels when the body exceeds its declared Content-Length", async () => {
    const cancel = vi.fn();
    const bytes = validPdfBytes("longer than declared");
    let chunksSent = 0;
    const fetchImpl = responseFetch(
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            if (chunksSent >= 3) {
              controller.close();
              return;
            }
            chunksSent += 1;
            controller.enqueue(bytes);
          },
          cancel,
        }),
        {
          status: 200,
          headers: {
            "content-length": String(PDF_HEADER.length),
            "content-type": "application/pdf",
          },
        },
      ),
    );

    await expect(downloadCanvasFile(CREDENTIALS, canvasFile(), fetchImpl)).rejects.toMatchObject({
      statusCode: 502,
    });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("maps an upstream body abort to a Canvas API error", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(PDF_HEADER);
        controller.error(new DOMException("upstream aborted", "AbortError"));
      },
    });
    const fetchImpl = responseFetch(
      new Response(body, {
        status: 200,
        headers: { "content-type": "application/pdf" },
      }),
    );

    await expect(downloadCanvasFile(CREDENTIALS, canvasFile(), fetchImpl)).rejects.toMatchObject({
      name: "CanvasApiError",
      statusCode: 502,
    });
  });

  it("rejects an explicit response MIME that conflicts with the expected document type", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(validPdfBytes());
      },
      cancel,
    });
    const fetchImpl = responseFetch(
      new Response(body, {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );

    await expect(downloadCanvasFile(CREDENTIALS, canvasFile(), fetchImpl)).rejects.toMatchObject({
      statusCode: 415,
    });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("rejects bytes whose signature conflicts with a declared PDF", async () => {
    const fetchImpl = responseFetch(
      new Response(new TextEncoder().encode("<html>Canvas login</html>"), {
        status: 200,
        headers: { "content-type": "application/pdf" },
      }),
    );

    await expect(downloadCanvasFile(CREDENTIALS, canvasFile(), fetchImpl)).rejects.toMatchObject({
      statusCode: 415,
    });
  });
});
