// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";

import {
  MultipartBodyInvalidError,
  MultipartBodyTooLargeError,
  readBoundedFormData,
} from "~/lib/multipart.server";

function streamRequest(
  chunks: string[],
  headers: Record<string, string> = {},
  close = true,
) {
  const cancel = vi.fn();
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index++];
      if (chunk !== undefined) controller.enqueue(new TextEncoder().encode(chunk));
      else if (close) controller.close();
    },
    cancel,
  }, { highWaterMark: 0 });
  // Keep the source stream directly on this Request-shaped fixture so the
  // cancellation assertion observes the adapter's reader.cancel() call.
  const request = {
    url: "http://localhost/auth/login",
    method: "POST",
    headers: new Headers(headers),
    body: stream,
    signal: new AbortController().signal,
  } as unknown as Request;
  return { request, cancel };
}

async function requestThroughNodeAdapter(
  headers: Record<string, string>,
  upload: ReadableStream<Uint8Array>,
): Promise<Response> {
  const server = createServer(async (incoming, outgoing) => {
    // Keep cancellation local to this adapter fixture: a production server
    // can flush its 413 while the client connection is being released.
    let bodyClosed = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        incoming.on("data", (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
        incoming.on("end", () => {
          if (!bodyClosed) {
            bodyClosed = true;
            controller.close();
          }
        });
        incoming.on("error", (error) => controller.error(error));
      },
      cancel() {
        bodyClosed = true;
      },
    });
    const request = new Request("http://localhost/auth/login", {
      method: incoming.method,
      headers: incoming.headers as Record<string, string>,
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    try {
      await readBoundedFormData(request, 96);
      outgoing.statusCode = 200;
    } catch (error) {
      outgoing.statusCode = error instanceof MultipartBodyTooLargeError ? 413 : 400;
    }
    outgoing.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("test server did not bind to a TCP port");
  }

  try {
    return await fetch(`http://127.0.0.1:${address.port}/auth/login`, {
      method: "POST",
      headers,
      body: upload,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

describe("readBoundedFormData", () => {
  it("rejects declared overflow before reading or parsing the body", async () => {
    const { request, cancel } = streamRequest([], {
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": "97",
    }, false);

    await expect(readBoundedFormData(request, 96)).rejects.toBeInstanceOf(
      MultipartBodyTooLargeError,
    );
    expect(cancel).not.toHaveBeenCalled();
  });

  it("cancels a body with a malformed declared length", async () => {
    const { request, cancel } = streamRequest([], {
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": "not-a-length",
    }, false);

    await expect(readBoundedFormData(request, 96)).rejects.toBeInstanceOf(
      MultipartBodyInvalidError,
    );
    expect(cancel).not.toHaveBeenCalled();
  });

  it("rejects chunked overflow and cancels the source stream", async () => {
    const { request, cancel } = streamRequest(
      ["a".repeat(80), "b".repeat(40)],
      { "Content-Type": "application/x-www-form-urlencoded" },
    );

    await expect(readBoundedFormData(request, 96)).rejects.toBeInstanceOf(
      MultipartBodyTooLargeError,
    );
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("parses an in-limit form through the real Request/formData boundary", async () => {
    const body = new URLSearchParams({ email: "a@ubc.ca", password: "safe-password" });
    const request = new Request("http://localhost/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    const form = await readBoundedFormData(request, 96);
    expect(form.get("email")).toBe("a@ubc.ca");
    expect(form.get("password")).toBe("safe-password");
  });

  it("returns 413 at a real HTTP adapter boundary for declared overflow", async () => {
    const upload = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("x".repeat(128)));
        controller.close();
      },
    });
    const response = await requestThroughNodeAdapter(
      {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": "128",
      },
      upload,
    );
    expect(response.status).toBe(413);
  });

  it("returns 413 at a real HTTP adapter boundary for a chunked upload", async () => {
    const upload = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("x".repeat(128)));
        controller.close();
      },
    });
    const response = await requestThroughNodeAdapter(
      { "Content-Type": "application/x-www-form-urlencoded" },
      upload,
    );
    expect(response.status).toBe(413);
  });
});
