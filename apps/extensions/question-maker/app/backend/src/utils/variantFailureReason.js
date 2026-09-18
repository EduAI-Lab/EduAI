/**
 * Turns a bank-variant generation failure into a cause the instructor can act on (#1763).
 *
 * Before this, every non-public failure collapsed to the string "Variant generation failed",
 * so provider auth, rate limits, timeouts and unparseable replies were indistinguishable in
 * the UI. `toStableUpstreamError` (utils/safeLogging.js) already classifies the transport;
 * this maps that classification onto wording and a machine code.
 *
 * Pure: no prisma, no config, no network. Reads only the allowlisted status/transport fields,
 * never a response body or a raw provider message, so nothing secret can reach the response.
 */
import { safeStatusCode, safeTransportCode } from "./safeLogging.js";

/** Reported when the model returns a variant the question already has. */
export const VARIANT_DUPLICATE_FAILURE = Object.freeze({
  code: "VARIANT_DUPLICATE",
  message:
    "The model returned a variant that duplicates one this question already has, twice in a row. Try again or pick another model.",
});

const GENERIC_FAILURE = Object.freeze({
  code: "VARIANT_GENERATION_FAILED",
  message: "Variant generation failed",
});

const TIMEOUT_CODES = new Set(["ECONNABORTED", "ETIMEDOUT"]);
const UNREACHABLE_CODES = new Set(["ECONNREFUSED", "ENETUNREACH", "ENOTFOUND", "ECONNRESET"]);

export function describeVariantFailure(error) {
  // Errors minted by the variant service (missing content, MCQ shape, admission budget)
  // already carry instructor-facing wording, so pass them through untouched.
  if (error?.isPublic === true) {
    return {
      code: typeof error.code === "string" && error.code ? error.code : GENERIC_FAILURE.code,
      message: error.message,
    };
  }

  const status = safeStatusCode(error);
  const transportCode = safeTransportCode(error);
  const reasonCode = typeof error?.reasonCode === "string" ? error.reasonCode : null;

  if (reasonCode === "PROVIDER_API_KEY_REQUIRED" || status === 401 || status === 403) {
    return {
      code: "PROVIDER_AUTH",
      message:
        "The AI provider rejected the request's credentials. Check the API key saved for this model, then try again.",
    };
  }

  if (reasonCode === "PROVIDER_MALFORMED_JSON") {
    return {
      code: "PROVIDER_MALFORMED_JSON",
      message:
        "The model's reply was not valid question JSON, even after a repair attempt. Try again or pick another model.",
    };
  }

  if (status === 429) {
    return {
      code: "PROVIDER_RATE_LIMIT",
      message: "The AI provider is rate-limiting this request. Wait a moment and try again.",
    };
  }

  if (TIMEOUT_CODES.has(transportCode)) {
    return {
      code: "PROVIDER_TIMEOUT",
      message: "The AI provider took too long to respond. Try again, or pick a faster model.",
    };
  }

  if (UNREACHABLE_CODES.has(transportCode)) {
    return {
      code: "PROVIDER_UNREACHABLE",
      message:
        "Could not reach the AI provider. Check that EduAI and the model host are running, then try again.",
    };
  }

  if (status !== null && status >= 500) {
    return {
      code: "PROVIDER_ERROR",
      message: `The AI provider returned an error (${status}). Try again shortly.`,
    };
  }

  return { ...GENERIC_FAILURE };
}
