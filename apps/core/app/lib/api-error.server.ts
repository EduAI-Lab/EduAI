import type { z } from "zod";

import type { ErrorEnvelope } from "@eduai/types";

import type { JsonResponseBody } from "~/lib/api/json-response.server";

const JSON_HEADERS = { "Content-Type": "application/json" } as const;

/** Standard JSON response for Core API routes. */
export function jsonResponse(status: number, body: JsonResponseBody): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}

export function apiError(status: number, error: string, fields?: Record<string, string>): Response {
  const body: ErrorEnvelope = { error };
  if (fields) body.fields = fields;
  return jsonResponse(status, body);
}

export function validationErrorFromZod(zodError: z.ZodError, status = 422): Response {
  const fieldErrors = zodError.flatten().fieldErrors;
  const fields: Record<string, string> = {};
  for (const [key, messages] of Object.entries(fieldErrors)) {
    if (messages && messages.length > 0) fields[key] = messages[0];
  }
  return apiError(status, "VALIDATION_ERROR", fields);
}
