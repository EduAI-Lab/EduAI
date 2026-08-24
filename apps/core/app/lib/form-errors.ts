import type { JsonValue } from "~/lib/json-value";
import { asJsonArray, asJsonObject, asPresentText } from "~/lib/json-value";
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
export function firstFieldError(details: JsonValue | undefined): string | null {
  const flattened = asJsonObject(details);
  if (!flattened) return null;
  const fieldErrors = asJsonObject(flattened.fieldErrors);
  if (!fieldErrors) return null;
  for (const messages of Object.values(fieldErrors)) {
    const first = asPresentText(asJsonArray(messages)?.[0]);
    if (first) return first;
  }
  return null;
}
