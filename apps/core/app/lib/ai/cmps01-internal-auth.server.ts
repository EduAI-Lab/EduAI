/** Header nginx checks for the server-managed Ollama edge on cmps01 :8001. */
export const CMPS01_INTERNAL_KEY_HEADER = "X-EduAI-Internal-Key";

let warnedMissingInternalKey = false;

/** Normalize Ollama/LiteLLM base URLs for trusted-host comparison. */
function normalizeEdgeBaseUrl(raw: string): string | null {
  try {
    const trimmed = raw.trim().replace(/\/$/, "");
    const withScheme = trimmed.includes("://") ? trimmed : `http://${trimmed}`;
    const url = new URL(withScheme);
    const path = url.pathname.replace(/\/api$/, "").replace(/\/$/, "");
    return `${url.protocol}//${url.host}${path}`;
  } catch {
    return null;
  }
}

/** True when the URL matches an independently configured CMPS edge allowlist. */
export function isTrustedCmps01EdgeUrl(baseUrl: string): boolean {
  const normalized = normalizeEdgeBaseUrl(baseUrl);
  if (!normalized) return false;

  const trustedBases = [
    process.env.OLLAMA_BASE_URL,
    process.env.CMPS01_INTERNAL_BASE_URL,
  ]
    .map((v) => (v ? normalizeEdgeBaseUrl(v) : null))
    .filter((v): v is string => Boolean(v));

  return trustedBases.some(
    (trusted) => normalized === trusted || normalized.startsWith(`${trusted}/`),
  );
}

/** Shared secret from infra/cmps01/.env — required when using edge paths on :8001. */
export function cmps01InternalAuthHeaders(): Record<string, string> {
  const key = process.env.CMPS01_INTERNAL_KEY?.trim();
  if (!key) {
    if (!warnedMissingInternalKey) {
      warnedMissingInternalKey = true;
      console.warn(
        "CMPS01_INTERNAL_KEY not set — cmps01 Ollama edge requests will be rejected by nginx (403)",
      );
    }
    return {};
  }
  return { [CMPS01_INTERNAL_KEY_HEADER]: key };
}

/** Attach internal key only for trusted cmps01 edge URLs (never user-controlled hosts). */
export function cmps01InternalAuthHeadersForUrl(
  baseUrl: string,
): Record<string, string> {
  if (!isTrustedCmps01EdgeUrl(baseUrl)) {
    return {};
  }
  return cmps01InternalAuthHeaders();
}
