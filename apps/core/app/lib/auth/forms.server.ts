import {
  MultipartBodyInvalidError,
  MultipartBodyTooLargeError,
  readBoundedFormData,
} from "~/lib/multipart.server";

export const AUTH_FORM_BODY_MAX_BYTES = 64 * 1024;

export function readAuthFormData(request: Request): Promise<FormData> {
  return readBoundedFormData(request, AUTH_FORM_BODY_MAX_BYTES);
}

export function formBodyErrorResponse(cause: unknown): Response | null {
  if (cause instanceof MultipartBodyTooLargeError) {
    return new Response(JSON.stringify({ error: "PAYLOAD_TOO_LARGE" }), {
      status: 413,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (cause instanceof MultipartBodyInvalidError) {
    return new Response(JSON.stringify({ error: cause.message }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  return null;
}
