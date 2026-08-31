import { z } from "zod";

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

/**
 * The one field a caught throwable has to carry for a form to show its text.
 *
 * A caught value can be anything a thrower chose, including a null-prototype
 * object or one from another realm, so this decodes the shape rather than
 * testing the container: `instanceof Object` answers `false` for
 * `Object.create(null)` and for a cross-realm object, and a `typeof` test says
 * nothing about the field. Anything without a usable string `message` falls
 * back to the caller's copy (#1629).
 */
const causeMessageSchema = z.object({ message: z.string().trim().min(1) });

export function messageFromCause(cause: unknown, fallback: string): string {
  const parsed = causeMessageSchema.safeParse(cause);
  return parsed.success ? parsed.data.message : fallback;
}
