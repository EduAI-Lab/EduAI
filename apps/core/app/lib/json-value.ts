import { z } from "zod";

/**
 * A JSON value, as it exists after `JSON.parse` and before anything gives it a
 * domain meaning.
 *
 * Use this only where a payload is genuinely open-ended — a request body this
 * layer forwards without owning, a stored blob replayed verbatim, arguments an
 * external caller chose. Where the shape *is* known, name it or derive it from
 * the schema that parses it; reaching for `JsonValue` there just relabels
 * `unknown` and loses the same contract.
 */
export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;

/**
 * A JSON object. Values admit `undefined` so a TypeScript object with optional
 * properties satisfies it — that is how an absent key is spelled on this side
 * of the boundary, and `JSON.stringify` drops it either way.
 */
export type JsonObject = { [key: string]: JsonValue | undefined };

/** Decodes anything `JSON.parse` can produce. Fails only on values JSON cannot hold. */
export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema),
  ]),
);

/** Decodes a JSON object — a parsed body, not an array and not a bare scalar. */
export const jsonObjectSchema: z.ZodType<JsonObject> = z.record(jsonValueSchema);

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
