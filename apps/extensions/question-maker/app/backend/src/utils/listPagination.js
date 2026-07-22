/** Shared limit/offset parsing for QM list endpoints (#1040). */

export const DEFAULT_LIST_LIMIT = 50;
export const MAX_LIST_LIMIT = 200;

/**
 * Strips LIKE/ILIKE wildcards (`%`, `_`) from user search so they are not
 * interpreted as patterns (Postgres LIKE has no default backslash escape).
 */
export function sanitizeLikeLiteral(value) {
  return String(value).replace(/[%_]/g, '');
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
