/**
 * Shared secret / PII redaction for audit logs and bug-report diagnostics.
 *
 * Key-level: object keys matching credential/PII substrings are replaced wholesale.
 * Value-level: string leaves are scrubbed for bearer tokens, token query params,
 * and URL/connection-string userinfo (#976 patterns; used by bug reports #979).
 */

export const REDACTED_VALUE = "[REDACTED]";
const CIRCULAR_VALUE = "[CIRCULAR]";

const AUDIT_SAFE_ID_KEYS = new Set(["studentid", "ubcemployeeid"]);

// Substrings that — after stripping non-alphanumerics and lowercasing the key — mark a value
// as a credential or direct-contact PII. Matched as substrings so compound keys are covered
// too: `secret` catches sessionSecret/clientSecret, `apikey` catches x-api-key.
const REDACT_KEY_SUBSTRINGS = [
  "password",
  "token",
  "cookie",
  "phone",
  "authorization",
  "secret",
  "apikey",
  "accesskey",
  "privatekey",
  "credential",
];

// Value-level patterns for secrets embedded under innocuous keys or in free-form log text.
// Keep these linear-time: unbounded `\w+` / `[a-z]*` before a literal causes ReDoS on long blobs.
const BEARER_TOKEN_RE = /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi;
const TOKEN_QUERY_PARAM_RE =
  /([?&](?:access_token|id_token|refresh_token|api_key|apikey|token)=)[^&\s"']+/gi;
/** Matches `://user:pass@` (scheme already scanned past). Linear in input length. */
const URL_USERINFO_RE = /\/\/[^/@\s"']+:[^@\s"']+@/g;

export function shouldRedactKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();

  // Accountability IDs must remain visible in audit details for admin investigations.
  if (AUDIT_SAFE_ID_KEYS.has(normalized)) {
    return false;
  }

  // NOTE: `email` is intentionally NOT redacted right now — full email addresses are logged
  // across all logs by current product decision. Add `"email"` to REDACT_KEY_SUBSTRINGS to
  // restore redaction later.
  return REDACT_KEY_SUBSTRINGS.some((needle) => normalized.includes(needle));
}

/**
 * Scrub secret-shaped substrings from a free-form string (log lines, URLs, messages).
 */
export function redactSecretValuesInString(text: string): string {
  return text
    .replace(BEARER_TOKEN_RE, `Bearer ${REDACTED_VALUE}`)
    .replace(TOKEN_QUERY_PARAM_RE, `$1${REDACTED_VALUE}`)
    .replace(URL_USERINFO_RE, `//${REDACTED_VALUE}@`);
}

/**
 * Key-level sanitize used by the logging facade. Object keys on the deny-list are replaced;
 * string leaves are left untouched (callers that need value scrubbing should use
 * {@link sanitizeSensitiveData}).
 */
export function sanitizeDetails(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (!value || typeof value !== "object" || value instanceof Date) {
    return value;
  }

  const obj = value as object;

  // Cycle guard: only ancestors on the current branch live in `seen` (removed on unwind),
  // so shared-but-acyclic references (DAGs) are still fully sanitized.
  if (seen.has(obj)) {
    return CIRCULAR_VALUE;
  }
  seen.add(obj);

  let result: unknown;
  if (Array.isArray(value)) {
    result = value.map((entry) => sanitizeDetails(entry, seen));
  } else if (value instanceof Map) {
    // Maps are not enumerable via Object.entries (they'd serialize to {} and silently drop
    // their contents), so normalize to a plain object first.
    const sanitized: Record<string, unknown> = {};
    for (const [key, entry] of value.entries()) {
      const keyStr = typeof key === "string" ? key : String(key);
      sanitized[keyStr] = shouldRedactKey(keyStr) ? REDACTED_VALUE : sanitizeDetails(entry, seen);
    }
    result = sanitized;
  } else if (value instanceof Set) {
    result = Array.from(value, (entry) => sanitizeDetails(entry, seen));
  } else {
    const sanitized: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      sanitized[key] = shouldRedactKey(key) ? REDACTED_VALUE : sanitizeDetails(entry, seen);
    }
    result = sanitized;
  }

  seen.delete(obj);
  return result;
}

/**
 * Key-level redaction plus value-level scrubbing of every string leaf.
 * Use for bug-report console/network logs and context JSON before persist.
 */
export function sanitizeSensitiveData(
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
): unknown {
  if (typeof value === "string") {
    return redactSecretValuesInString(value);
  }

  if (!value || typeof value !== "object" || value instanceof Date) {
    return value;
  }

  const obj = value as object;
  if (seen.has(obj)) {
    return CIRCULAR_VALUE;
  }
  seen.add(obj);

  let result: unknown;
  if (Array.isArray(value)) {
    result = value.map((entry) => sanitizeSensitiveData(entry, seen));
  } else if (value instanceof Map) {
    const sanitized: Record<string, unknown> = {};
    for (const [key, entry] of value.entries()) {
      const keyStr = typeof key === "string" ? key : String(key);
      sanitized[keyStr] = shouldRedactKey(keyStr)
        ? REDACTED_VALUE
        : sanitizeSensitiveData(entry, seen);
    }
    result = sanitized;
  } else if (value instanceof Set) {
    result = Array.from(value, (entry) => sanitizeSensitiveData(entry, seen));
  } else {
    const sanitized: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      sanitized[key] = shouldRedactKey(key)
        ? REDACTED_VALUE
        : sanitizeSensitiveData(entry, seen);
    }
    result = sanitized;
  }

  seen.delete(obj);
  return result;
}

/**
 * Redact a diagnostic log string that is typically JSON (console/network capture).
 * Parses when possible so key-level redaction applies; always runs value-level scrubbing.
 */
export function redactDiagnosticLogString(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return raw;

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const sanitized = sanitizeSensitiveData(parsed);
    return JSON.stringify(sanitized);
  } catch {
    return redactSecretValuesInString(raw);
  }
}
