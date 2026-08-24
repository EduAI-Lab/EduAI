export class BoundedBodyError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 413 | 499,
  ) {
    super(message);
    this.name = "BoundedBodyError";
  }
}

export function validateBoundedContentLength(request: Request, maxBytes: number): void {
  const rawLength = request.headers.get("content-length");
  if (rawLength === null) return;
  const normalized = rawLength.trim();
  const declared = Number(normalized);
  if (!/^\d+$/.test(normalized) || !Number.isSafeInteger(declared) || declared < 0) {
    throw new BoundedBodyError("Invalid Content-Length", 400);
  }
  if (declared > maxBytes) throw new BoundedBodyError("Request body exceeds size limit", 413);
}

/**
 * Buffer a request body up to an explicit byte limit.
 *
 * A declared overflow is rejected without cancelling the incoming stream so
 * Node adapters can flush the 413 response. A streamed overflow cancels only
 * after bytes actually cross the limit. This is the single cancellation
 * policy for JSON and form ingress.
 */
export async function readBoundedBody(request: Request, maxBytes: number): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new RangeError("maxBytes must be a positive integer");
  }

  validateBoundedContentLength(request, maxBytes);

  if (!request.body) throw new BoundedBodyError("Request body is missing", 400);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let rejectAbort: ((reason: unknown) => void) | undefined;
  const abortPromise = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const onAbort = () => {
    void reader.cancel().catch(() => undefined);
    rejectAbort?.(new BoundedBodyError("Request aborted", 499));
  };

  if (request.signal.aborted) onAbort();
  else request.signal.addEventListener("abort", onAbort, { once: true });

  try {
    while (true) {
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await Promise.race([reader.read(), abortPromise]);
      } catch (error) {
        if (error instanceof BoundedBodyError) throw error;
        throw new BoundedBodyError("Invalid request body", 400);
      }
      if (result.done) break;
      if (!(result.value instanceof Uint8Array)) {
        throw new BoundedBodyError("Invalid request body", 400);
      }
      totalBytes += result.value.byteLength;
      if (totalBytes > maxBytes) {
        void reader.cancel().catch(() => undefined);
        throw new BoundedBodyError("Request body exceeds size limit", 413);
      }
      chunks.push(result.value);
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
  return bytes;
}
