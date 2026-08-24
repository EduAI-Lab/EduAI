type PrismaLikeError = {
  code?: string;
  message?: string;
  meta?: { column?: string; modelName?: string };
};

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

/**
 * A failure rendered for the client: what went wrong, and where a hint exists,
 * the operator action that fixes it.
 */
export type ApiErrorPayload = { error: string; hint?: string };

/** Map Prisma / unknown errors to a JSON-safe API error payload. */
export function formatApiError(cause: unknown): ApiErrorPayload {
  if (cause instanceof Object) {
    const prisma = cause as PrismaLikeError;
    if (prisma.code === "P2022") {
      return {
        error: "Database schema is out of date (missing course embedding columns).",
        hint: "On the server, run: cd apps/core && npx prisma migrate deploy",
      };
    }
    if (prisma.code === "P2021") {
      return {
        error: "Database table not found.",
        hint: "On the server, run: cd apps/core && npx prisma migrate deploy",
      };
    }
  }

  if (cause instanceof Error) {
    if (cause.message.includes("Unknown argument `embeddingProvider`")) {
      return {
        error:
          "Prisma client is out of date (course embedding fields missing from generated client).",
        hint: "On the server: cd apps/core && npx prisma generate, then restart the dev server (tmux: Ctrl+C, then npx turbo run dev --filter=edu-ai from repo root).",
      };
    }
    if (
      cause.message.includes("reading 'findFirst'") ||
      cause.message.includes('reading "findFirst"')
    ) {
      return {
        error: "Prisma client is out of date (missing generated models such as CourseReEmbedJob).",
        hint: "On the server: cd apps/core && npx prisma generate && npx prisma migrate deploy, then restart the dev server.",
      };
    }
    return { error: cause.message };
  }

  return { error: "Unexpected server error" };
}
