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
    if (error.message.includes("Unknown argument `embeddingProvider`")) {
      return {
        error: "Prisma client is out of date (course embedding fields missing from generated client).",
        hint:
          "On the server: cd apps/core && npx prisma generate, then restart the dev server (tmux: Ctrl+C, then npx turbo run dev --filter=edu-ai from repo root).",
      };
    }
    if (
      error.message.includes("reading 'findFirst'") ||
      error.message.includes('reading "findFirst"')
    ) {
      return {
        error: "Prisma client is out of date (missing generated models such as CourseReEmbedJob).",
        hint:
          "On the server: cd apps/core && npx prisma generate && npx prisma migrate deploy, then restart the dev server.",
      };
    }
    return { error: error.message };
  }

  return { error: "Unexpected server error" };
}
