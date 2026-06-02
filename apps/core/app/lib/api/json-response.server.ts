type PrismaLikeError = {
  code?: string;
  message?: string;
  meta?: { column?: string; modelName?: string };
};

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Map Prisma / unknown errors to a JSON-safe API error payload. */
export function formatApiError(error: unknown): { error: string; hint?: string } {
  if (error && typeof error === "object") {
    const prisma = error as PrismaLikeError;
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

  if (error instanceof Error) {
    return { error: error.message };
  }

  return { error: "Unexpected server error" };
}
