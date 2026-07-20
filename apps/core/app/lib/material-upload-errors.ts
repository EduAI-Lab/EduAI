/**
 * User-facing messages for course material upload failures (#54).
 * Full errors are still logged server-side; never expose Prisma internals in the UI.
 */
export function toMaterialUploadUserMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  if (/prisma\.\$(executeRaw|queryRaw)|PrismaClient|Raw query failed/i.test(message)) {
    return "Material indexing failed due to a database error. Please try again or contact support.";
  }

  if (/serializ|BigDecimal|Couldn't serialize/i.test(message)) {
    return "Material indexing failed while saving. Please try again.";
  }

  if (/Embedding dimension mismatch/i.test(message)) {
    return "Material indexing failed: configuration mismatch. Contact your administrator.";
  }

  if (/No embedding provider configured|Local embedding provider failed/i.test(message)) {
    return "Material indexing is unavailable. Contact your administrator.";
  }

  if (/No content chunks generated/i.test(message)) {
    return "Could not extract usable text from this file.";
  }

  if (/Failed to (extract|process) (text from|file)/i.test(message)) {
    return message;
  }

  if (message.length > 200 || /invocation:|Numeric\(Some\(/i.test(message)) {
    return "Failed to process material. Please try again.";
  }

  return message || "Failed to process material";
}
