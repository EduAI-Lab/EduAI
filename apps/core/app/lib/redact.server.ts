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

// Longer, reasonably unique needles matched as substrings against the alphanumerics-only
// lowercased key so compound names stay covered (`secret` → sessionSecret/clientSecret,
// `apikey` → x-api-key, `dburl`/`databaseuri` → dbUrl/databaseUri, etc.).
// Short tokens (`otp`/`dsn`/`auth`/`pin`/`mfa`/`totp`) live in REDACT_KEY_EXACT_SEGMENTS
// instead — substring matching would false-positive on hotPath/footprint/fieldsName/etc.
const REDACT_KEY_SUBSTRINGS = [
  "password",
  "passwd",
  "passcode",
  "passphrase",
  "jwt",
  "pwd",
  "token",
  "cookie",
  "phone",
  "bearer",
  "secret",
  "apikey",
  "accesskey",
  "privatekey",
  "encryptionkey",
  "credential",
  "databaseurl",
  "databaseuri",
  "dburl",
  "connectionstring",
  "signature",
  "sessionid",
  "authorization",
  // Explicit MFA secret compounds (segment `mfa` also covers these; aliases keep intent clear
  // and catch unusual spellings that may not split cleanly).
  "mfacode",
  "mfarecoverycode",
  "mfarecovery",
];

// Short / ambiguous tokens that must match a whole camelCase / snake_case / kebab segment
// rather than a raw substring — otherwise `auth` redacts authorId, `pin` redacts mapping /
// shippingAddress, `otp` redacts hotPath/footprint, and `dsn` redacts fieldsName /
// needsNormalization via includes().
const REDACT_KEY_EXACT_SEGMENTS = new Set(["auth", "pin", "otp", "dsn", "totp", "mfa"]);

// Status / non-secret flags that contain a redact segment (e.g. `mfa`) but must stay visible.
const REDACT_KEY_SAFE_NORMALIZED = new Set([
  "mfaenabled",
  "mfarequired",
  "mfaenrolled",
  "mfastatus",
]);

/** Split a key into lowercased segments on non-alphanumerics and camelCase boundaries. */
function splitKeySegments(key: string): string[] {
  const parts = key.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const segments: string[] = [];
  for (const part of parts) {
    const camelParts = part.split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/);
    for (const camel of camelParts) {
      if (camel) segments.push(camel.toLowerCase());
    }
  }
  return segments;
}

// Value-level patterns for secrets embedded under innocuous keys or in free-form log text.
// Keep these linear-time: unbounded `\w+` / `[a-z]*` before a literal causes ReDoS on long blobs.
//
// Bearer/Basic are anchored so console prose like "Basic setup complete" or
// "Bearer of bad news" is not mangled (#1116 review):
//   1. In an `Authorization:` header context (plain or JSON-quoted), any
//      credential after the scheme is redacted regardless of length.
//   2. Standalone `Bearer/Basic <token>` is only redacted when the token is
//      long enough (16+ chars) to be a credential rather than English words.
const AUTH_HEADER_CREDENTIAL_RE =
  /\b(Authorization["']?\s*[:=]\s*["']?(?:Bearer|Basic))\s+[A-Za-z0-9\-._~+/]+=*/gi;
const STANDALONE_AUTH_TOKEN_RE = /\b(Bearer|Basic)\s+[A-Za-z0-9\-._~+/]{16,}=*/gi;
/** Raw Cookie / Set-Cookie header lines in console or network text captures. */
const COOKIE_HEADER_RE = /\b(?:Cookie|Set-Cookie)\s*:\s*[^\r\n]*/gi;
/** Common API-key header lines (HAR / fetch dumps). */
const X_API_KEY_HEADER_RE = /\bX-Api-Key\s*:\s*[^\r\n]*/gi;
const TOKEN_QUERY_PARAM_RE =
  /([?&](?:access_token|id_token|refresh_token|api_key|apikey|token)=)[^&\s"']+/gi;
/** Matches `://user:pass@` (scheme already scanned past). Linear in input length. */
const URL_USERINFO_RE = /\/\/[^/@\s"']+:[^@\s"']+@/g;

/**
 * HAR / DevTools network captures often store headers as `{ name, value }` instead of
 * `{ Cookie: "…" }`. Key-level scrubbing only sees `name`/`value`, so we treat a sensitive
 * `name` as if the key itself were that header.
 */
function isHarHeaderEntry(
  value: Record<string, unknown>,
): value is { name: string; value: unknown } {
  // Real HAR cookie rows also carry domain/path/httpOnly/secure/expires — match
  // on string name + string value rather than a strict key allowlist.
  return typeof value.name === "string" && typeof value.value === "string";
}

export function shouldRedactKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();

  // Accountability IDs must remain visible in audit details for admin investigations.
  if (AUDIT_SAFE_ID_KEYS.has(normalized)) {
    return false;
  }

  // Known-safe status flags that would otherwise match a redact segment (e.g. mfaEnabled).
  if (REDACT_KEY_SAFE_NORMALIZED.has(normalized)) {
    return false;
  }

  // NOTE: `email` is intentionally NOT redacted right now — full email addresses are logged
  // across all logs by current product decision. Add `"email"` to REDACT_KEY_SUBSTRINGS to
  // restore redaction later.
  if (REDACT_KEY_SUBSTRINGS.some((needle) => normalized.includes(needle))) {
    return true;
  }

  return splitKeySegments(key).some((segment) => REDACT_KEY_EXACT_SEGMENTS.has(segment));
}

/**
 * Scrub secret-shaped substrings from a free-form string (log lines, URLs, messages).
 */
export function redactSecretValuesInString(text: string): string {
  return text
    .replace(AUTH_HEADER_CREDENTIAL_RE, `$1 ${REDACTED_VALUE}`)
    .replace(STANDALONE_AUTH_TOKEN_RE, `$1 ${REDACTED_VALUE}`)
    .replace(COOKIE_HEADER_RE, (match) => {
      const prefix = match.split(":")[0] ?? "Cookie";
      return `${prefix}: ${REDACTED_VALUE}`;
    })
    .replace(X_API_KEY_HEADER_RE, `X-Api-Key: ${REDACTED_VALUE}`)
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
    const record = value as Record<string, unknown>;
    // HAR-style header rows: `{ name: "Cookie", value: "session=…" }`
    if (isHarHeaderEntry(record) && shouldRedactKey(record.name)) {
      result = {
        ...Object.fromEntries(
          Object.entries(record).map(([key, entry]) =>
            key === "value"
              ? [key, REDACTED_VALUE]
              : [key, typeof entry === "string" ? redactSecretValuesInString(entry) : entry],
          ),
        ),
      };
    } else {
      const sanitized: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(record)) {
        sanitized[key] = shouldRedactKey(key)
          ? REDACTED_VALUE
          : sanitizeSensitiveData(entry, seen);
      }
      result = sanitized;
    }
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
