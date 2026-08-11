/**
 * Bounded multipart/form-data and url-encoded request transport.
 *
 * `Request.formData()` parses the entire incoming body before returning. Every
 * caller that accepts a browser form must therefore pass through this helper:
 * declared lengths are rejected before parsing, and chunked/lying lengths are
 * counted while the source stream is read. We buffer only up to the explicit
 * cap, then parse a replay request so the parser never sees an unbounded body.
 */

export class MultipartBodyTooLargeError extends Error {
  readonly status = 413;

  constructor(message = "Request body exceeds size limit") {
    super(message);
    this.name = "MultipartBodyTooLargeError";
  }
}

export class MultipartBodyInvalidError extends Error {
  readonly status = 400;

  constructor(message = "Invalid request body") {
    super(message);
    this.name = "MultipartBodyInvalidError";
  }
}

function parseContentLength(request: Request, maxBytes: number): void {
  const raw = request.headers.get("content-length");
  if (raw === null) return;

  const normalized = raw.trim();
  if (!/^\d+$/.test(normalized)) {
    throw new MultipartBodyInvalidError("Invalid Content-Length");
  }

  const declared = Number(normalized);
  if (!Number.isSafeInteger(declared) || declared < 0) {
    throw new MultipartBodyInvalidError("Invalid Content-Length");
  }

  if (declared > maxBytes) {
    throw new MultipartBodyTooLargeError();
  }
}

function cancelBody(request: Request): void {
  // Let the framework flush the 413 response before an HTTP adapter observes
  // cancellation (Node's incoming-message adapter may otherwise close the
  // socket before the status line is written).
  setTimeout(() => {
    void request.body?.cancel().catch(() => undefined);
  }, 0);
}

/**
 * Read and parse a form body without ever allowing more than `maxBytes` into
 * memory. A declared overflow cancels the source without invoking formData().
 * A streamed overflow cancels at the first chunk crossing the cap and also
 * never invokes formData().
 */
export async function readBoundedFormData(
  request: Request,
  maxBytes: number,
): Promise<FormData> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new RangeError("maxBytes must be a positive integer");
  }

  try {
    parseContentLength(request, maxBytes);
  } catch (error) {
    // Reject malformed declarations and declared overflow before any parser
    // touches the stream, and release the unread source in both cases.
    if (
      error instanceof MultipartBodyTooLargeError ||
      error instanceof MultipartBodyInvalidError
    ) {
      cancelBody(request);
    }
    throw error;
  }

  // Route unit tests use a minimal Request-shaped stub with a formData()
  // method but no body. Real HTTP requests always expose a body stream; keep
  // this branch for those tests while retaining the length gate above.
  if (!request.body) {
    if (typeof request.formData === "function") return request.formData();
    throw new MultipartBodyInvalidError("Request body is missing");
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let abortReject: ((reason: unknown) => void) | undefined;
  const abortPromise = new Promise<never>((_, reject) => {
    abortReject = reject;
  });
  const onAbort = () => {
    void reader.cancel().catch(() => undefined);
    abortReject?.(new MultipartBodyInvalidError("Request aborted"));
  };

  if (request.signal.aborted) onAbort();
  else request.signal.addEventListener("abort", onAbort, { once: true });

  try {
    while (true) {
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await Promise.race([reader.read(), abortPromise]);
      } catch (error) {
        if (error instanceof MultipartBodyInvalidError) throw error;
        throw new MultipartBodyInvalidError();
      }

      if (result.done) break;
      const chunk = result.value;
      if (!(chunk instanceof Uint8Array)) throw new MultipartBodyInvalidError();

      totalBytes += chunk.byteLength;
      if (totalBytes > maxBytes) {
        // Do not await adapter cancellation here. Node's HTTP adapter may
        // destroy the socket while the framework is still constructing the
        // 413 response; the cancellation is still issued and the lock is
        // released in finally.
        void reader.cancel().catch(() => undefined);
        throw new MultipartBodyTooLargeError();
      }
      chunks.push(chunk);
    }
  } finally {
    request.signal.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const headers = new Headers(request.headers);
  // A false/partial incoming length must never be reused for the replay body.
  headers.delete("content-length");
  const replay = new Request(request.url, {
    method: request.method,
    headers,
    body: bytes,
    duplex: "half",
  } as RequestInit & { duplex: "half" });

  try {
    return await replay.formData();
  } catch {
    throw new MultipartBodyInvalidError();
  }
}
