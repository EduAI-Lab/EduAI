import type { z } from "zod";

const JSON_HEADERS = { "Content-Type": "application/json" } as const;

/** Standard JSON response for Core API routes. */
export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}

/**
 * MCP-ready error envelope: `{ error: "CODE", fields?: { field: "message" } }`.
 * See docs/rag-ai/MCP_INTEGRATION_PLAN.md.
 */
export function apiError(
  status: number,
  error: string,
  fields?: Record<string, string>,
): Response {
  return jsonResponse(status, fields ? { error, fields } : { error });
}

export function validationErrorFromZod(
  zodError: z.ZodError,
  status = 422,
): Response {
  const fieldErrors = zodError.flatten().fieldErrors;
  const fields: Record<string, string> = {};
  for (const [key, messages] of Object.entries(fieldErrors)) {
    if (messages && messages.length > 0) fields[key] = messages[0];
  }
  return apiError(status, "VALIDATION_ERROR", fields);
}
