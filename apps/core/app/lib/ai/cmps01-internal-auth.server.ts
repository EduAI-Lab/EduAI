/** Header nginx checks for /energy/ and /ollama/ on cmps01 :8001 edge proxy. */
export const CMPS01_INTERNAL_KEY_HEADER = "X-EduAI-Internal-Key";

/** Shared secret from infra/cmps01/.env — required when using edge paths on :8001. */
let warnedMissingInternalKey = false;

export function cmps01InternalAuthHeaders(): Record<string, string> {
  const key = process.env.CMPS01_INTERNAL_KEY?.trim();
  if (!key) {
    if (!warnedMissingInternalKey) {
      warnedMissingInternalKey = true;
      console.warn(
        "CMPS01_INTERNAL_KEY not set — sidecar requests will be rejected by nginx (403)",
      );
    }
    return {};
  }
  return { [CMPS01_INTERNAL_KEY_HEADER]: key };
}
