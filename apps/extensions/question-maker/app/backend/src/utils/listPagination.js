/** Shared limit/offset parsing for QM list endpoints (#1040). */

export const DEFAULT_LIST_LIMIT = 50;
export const MAX_LIST_LIMIT = 200;

/**
 * Escapes LIKE/ILIKE metacharacters (`\`, `%`, `_`) in user search text so they
 * are matched literally instead of interpreted as patterns. Postgres LIKE/ILIKE
 * defaults to `\` as the escape character, so no `ESCAPE` clause is needed at
 * the call site. Backslash must be escaped first so a literal backslash in the
 * input isn't re-interpreted as escaping the `%`/`_` we add after it.
 */
export function escapeLikeLiteral(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/**
 * Parses and clamps `limit`/`offset` query values.
 * Invalid or missing limit → defaultLimit; limit is capped at maxLimit.
 * Invalid or missing offset → 0.
 */
export function parseLimitOffset(
  query = {},
  { defaultLimit = DEFAULT_LIST_LIMIT, maxLimit = MAX_LIST_LIMIT } = {},
) {
  const rawLimit = Number.parseInt(query.limit, 10);
  const rawOffset = Number.parseInt(query.offset, 10);
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(rawLimit, maxLimit)
      : defaultLimit;
  const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
  return { limit, offset };
}
