/**
 * Bounded multipart/form-data and url-encoded request transport.
 *
 * `Request.formData()` parses the entire incoming body before returning. Every
 * caller that accepts a browser form must therefore pass through this helper:
 * declared lengths are rejected before parsing, and chunked/lying lengths are
 * counted while the source stream is read. We buffer only up to the explicit
 * cap, then parse a replay request so the parser never sees an unbounded body.
 */

import {
  BoundedBodyError,
  readBoundedBody,
  validateBoundedContentLength,
} from "~/lib/net/bounded-body.server";

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

/**
 * Read and parse a form body without ever allowing more than `maxBytes` into
 * memory. A declared overflow cancels the source without invoking formData().
 * A streamed overflow cancels at the first chunk crossing the cap and also
 * never invokes formData().
 */
export async function readBoundedFormData(request: Request, maxBytes: number): Promise<FormData> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new RangeError("maxBytes must be a positive integer");
  }

  // Route unit tests use a minimal Request-shaped stub with a formData()
  // method but no body. Real HTTP requests always expose a body stream; keep
  // this branch for those tests while retaining the length gate above.
  if (!request.body) {
    try {
      validateBoundedContentLength(request, maxBytes);
    } catch (error) {
      if (error instanceof BoundedBodyError && error.status === 413) {
        throw new MultipartBodyTooLargeError();
      }
      if (error instanceof BoundedBodyError) throw new MultipartBodyInvalidError(error.message);
      throw error;
    }
    if (request.formData instanceof Function) return request.formData();
    throw new MultipartBodyInvalidError("Request body is missing");
  }

  let bytes: Uint8Array;
  try {
    bytes = await readBoundedBody(request, maxBytes);
  } catch (error) {
    if (error instanceof BoundedBodyError && error.status === 413) {
      throw new MultipartBodyTooLargeError();
    }
    if (error instanceof BoundedBodyError) {
      throw new MultipartBodyInvalidError(error.message);
    }
    throw error;
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
