/**
 * A value `JSON.stringify` can render into a response body.
 *
 * Deliberately wider than `JsonValue` in `~/lib/json-value`: routes hand rows
 * straight from Prisma to this layer, those rows carry `Date`s, and
 * `stringify` renders them as ISO strings. `undefined` is admitted for the
 * same reason `JsonObject` admits it — that is how an absent key is spelled
 * before serialisation drops it.
 *
 * Members are `readonly` because serialisation never mutates, and several
 * routes answer with `as const` tables.
 *
 * What the type excludes is the point. A function, a `Map`, a `Set` or a
 * `bigint` reaching here either vanishes from the body or throws at runtime,
 * so a caller that has to widen to pass something is being told about a real
 * bug, not fighting the annotation.
 */
export type JsonResponseBody =
  | string
  | number
  | boolean
  | null
  | undefined
  | Date
  | readonly JsonResponseBody[]
  | { readonly [key: string]: JsonResponseBody };

export function jsonResponse(data: JsonResponseBody, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
