import type { JsonObject, JsonValue } from "@eduai/types";
import { z } from "zod";

/**
 * `JsonValue` and `JsonObject` are declared in `@eduai/types` so every app that
 * renders or forwards a stored blob spells it the same way. They are re-exported
 * here because the decoders below live with zod, which that package does not
 * depend on, and callers want the type and its parser from one module.
 */
export type { JsonObject, JsonValue } from "@eduai/types";

/**
 * Decodes anything `JSON.parse` can produce. Fails only on values JSON cannot hold.
 *
 * The record arm's value is `.optional()` so the schema accepts exactly what
 * `JsonObject` declares: that type admits `undefined` values (an absent key
 * before serialisation drops it), and a decoder annotated `z.ZodType<JsonValue>`
 * must not reject a value its own type calls valid.
 */
export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema.optional()),
  ]),
);

/** Decodes a JSON object — a parsed body, not an array and not a bare scalar. */
export const jsonObjectSchema: z.ZodType<JsonObject> = z.record(jsonValueSchema.optional());

/**
 * `JSON.parse` for text that may not be JSON at all.
 *
 * Malformed text and text that parses to something JSON cannot hold both come
 * back as `undefined`, so a caller reading a stored blob or a stream frame
 * branches on the value instead of wrapping every read in its own `try`.
 */
export function parseJsonText(text: string): JsonValue | undefined {
  let raw: JsonValue;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  const decoded = jsonValueSchema.safeParse(raw);
  return decoded.success ? decoded.data : undefined;
}

/**
 * Reading one field out of a decoded JSON blob.
 *
 * A stored row, a provider response and a client body all arrive as `JsonValue`,
 * and the code that reads them needs to answer "is there a string here" before
 * it can do anything. These name that question once per JSON type, so a caller
 * branches on the decoded value it got back rather than on the shape of the raw
 * one. Each returns `null` for "not that type", which is the same answer as
 * "absent" — a field that is not a string is not a usable string either way.
 */
export function asText(value: JsonValue | undefined): string | null {
  const decoded = z.string().safeParse(value);
  return decoded.success ? decoded.data : null;
}

/**
 * Text that survives a round trip: present, and not only whitespace.
 *
 * Returns the trimmed value, because a caller that cares whether a field is
 * present almost always wants it trimmed too.
 */
export function asPresentText(value: JsonValue | undefined): string | null {
  const decoded = z.string().trim().min(1).safeParse(value);
  return decoded.success ? decoded.data : null;
}

/** A finite number, or null. `NaN` and `Infinity` are not measurements. */
export function asFiniteNumber(value: JsonValue | undefined): number | null {
  const decoded = z.number().finite().safeParse(value);
  return decoded.success ? decoded.data : null;
}

/** A boolean, or null when the field held something else. */
export function asBoolean(value: JsonValue | undefined): boolean | null {
  const decoded = z.boolean().safeParse(value);
  return decoded.success ? decoded.data : null;
}

/** A plain JSON object — not an array, not null, not a scalar — or null. */
export function asJsonObject(value: JsonValue | undefined): JsonObject | null {
  const decoded = jsonObjectSchema.safeParse(value);
  return decoded.success ? decoded.data : null;
}

/** A JSON array, or null. */
export function asJsonArray(value: JsonValue | undefined): JsonValue[] | null {
  const decoded = z.array(jsonValueSchema).safeParse(value);
  return decoded.success ? decoded.data : null;
}
