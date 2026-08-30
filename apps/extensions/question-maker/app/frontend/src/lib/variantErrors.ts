/**
 * Turns a variant mutation failure into something an instructor can act on.
 *
 * The backend answers three different lock situations with one machine code,
 * VARIANT_LOCKED, and now sends a sentence alongside it. This prefers that
 * sentence, and still translates the bare code so a surface talking to an older
 * build never shows "VARIANT_LOCKED" to a human.
 */

/** The shape QM's API errors arrive in: an axios rejection, or a plain Error. */
export interface VariantMutationError {
  response?: { data?: { error?: string; code?: string; message?: string } };
  message?: string;
}

const LOCK_FALLBACK =
  "This question is reviewed, so it is locked. Move it back to draft to reopen it for editing.";

/** Plain-English text for a machine code, or null when the code is not one of ours. */
function messageForCode(code: string | undefined): string | null {
  switch (code) {
    case "VARIANT_LOCKED":
      return LOCK_FALLBACK;
    case "VARIANT_CONFLICT":
      return "Someone else changed this question at the same time. Reload and try again.";
    case "VARIANT_ROLLBACK_FAILED":
      return "Publishing to EduAI failed and the question was left in an unclear state. Reload before trying again.";
    case "CORE_PUSH_FAILED":
      return "Could not publish this question to EduAI. It stays a draft — please retry.";
    default:
      return null;
  }
}

export function describeVariantError(error: VariantMutationError): string {
  const data = error?.response?.data;
  const serverText = data?.message ?? data?.error;

  // A bare code in the message slot is an older build talking; translate it.
  const translatedText = messageForCode(serverText);
  if (translatedText) return translatedText;
  if (serverText) return serverText;

  const translatedCode = messageForCode(data?.code);
  if (translatedCode) return translatedCode;

  return error?.message || "Something went wrong. Please try again.";
}
