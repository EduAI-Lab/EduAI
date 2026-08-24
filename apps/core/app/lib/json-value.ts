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
