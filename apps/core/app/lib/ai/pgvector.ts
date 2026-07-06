/**
 * pgvector literal helpers for Prisma raw SQL.
 *
 * Prisma cannot reliably parameterize `number[]` for `::vector` casts (#54).
 * Pass a validated bracket literal string instead.
 */
export function formatPgVectorLiteral(embedding: number[]): string {
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error("Embedding must be a non-empty number array");
  }

  const parts: string[] = new Array(embedding.length);
  for (let i = 0; i < embedding.length; i++) {
    const value = embedding[i];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`Invalid embedding value at index ${i}`);
    }
    parts[i] = String(value);
  }

  return `[${parts.join(",")}]`;
}
