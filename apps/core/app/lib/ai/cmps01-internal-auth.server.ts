/** Header nginx checks for the server-managed Ollama edge on cmps01 :8001. */
export const CMPS01_INTERNAL_KEY_HEADER = "X-EduAI-Internal-Key";

/**
 * The internal-auth header, or nothing at all when no key is configured —
 * naming the one header this module can set keeps callers from treating it as
 * an open header bag they may add to.
 */
export type Cmps01AuthHeaders = { [CMPS01_INTERNAL_KEY_HEADER]?: string };

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

  const trustedBases = [process.env.OLLAMA_BASE_URL, process.env.CMPS01_INTERNAL_BASE_URL]
    .map((v) => (v ? normalizeEdgeBaseUrl(v) : null))
    .filter((v): v is string => Boolean(v));

  return trustedBases.some(
    (trusted) => normalized === trusted || normalized.startsWith(`${trusted}/`),
  );
}

/** Shared secret from infra/cmps01/.env — required when using edge paths on :8001. */
export function cmps01InternalAuthHeaders(): Cmps01AuthHeaders {
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
export function cmps01InternalAuthHeadersForUrl(baseUrl: string): Cmps01AuthHeaders {
  if (!isTrustedCmps01EdgeUrl(baseUrl)) {
    return {};
  }
  return cmps01InternalAuthHeaders();
}
