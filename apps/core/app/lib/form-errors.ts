/**
 * Helpers for turning server-side validation payloads into user-facing copy.
 *
 * API resource routes return Zod failures as `{ error: "Invalid input",
 * details: result.error.flatten() }`. `flatten()` shape:
 *   { formErrors: string[], fieldErrors: Record<string, string[]> }
 * The client error mappers collapse "Invalid input" to a generic message, which
 * hides specific reasons (e.g. the #567 UBC-email gate). `firstFieldError` digs
 * out the first concrete field message so the form can show it instead.
 */
export function firstFieldError(details: unknown): string | null {
  if (!details || typeof details !== "object") return null;
  const fieldErrors = (details as { fieldErrors?: unknown }).fieldErrors;
  if (!fieldErrors || typeof fieldErrors !== "object") return null;
  for (const messages of Object.values(fieldErrors as Record<string, unknown>)) {
    if (Array.isArray(messages) && typeof messages[0] === "string" && messages[0]) {
      return messages[0];
    }
  }
  return null;
}
