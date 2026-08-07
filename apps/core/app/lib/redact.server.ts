/**
 * Shared secret / PII redaction for audit logs and bug-report diagnostics.
 *
 * Key-level: object keys matching credential/PII substrings are replaced wholesale.
 * Value-level: string leaves are scrubbed for bearer tokens, token query params,
 * URL/connection-string userinfo, and credential-named `key=value` / `"key": "value"` pairs
 * serialized into the text (#976 patterns; used by bug reports #979).
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
  /([?&](?:access_token|id_token|refresh_token|client_secret|api_key|apikey|token)=)[^&\s"']+/gi;
/** Matches `://user:pass@` (scheme already scanned past). Linear in input length. */
const URL_USERINFO_RE = /\/\/[^/@\s"']+:[^@\s"']+@/g;

/**
 * Structured `key = value` / `"key": "value"` pairs embedded in free-form text.
 *
 * The header/query patterns above only fire on a fixed set of shapes, so a serialized payload
 * (`{"apiKey":"secret"}`) or an env/shell dump (`API_KEY=secret`) survived them intact — the
 * exact gap flagged in review on #1291. Cron run output is the worst case: those scripts are
 * spawned with the full `process.env`, so a `set -x` trace or crash dump prints credentials as
 * bare assignments.
 *
 * Key matching is delegated to `shouldRedactKey`, so this pass and the object-level pass share
 * one credential vocabulary and cannot drift apart.
 *
 * Matched in two steps — key+separator first, value only once the key is known to be a
 * credential. A single combined pattern cannot work: it would consume the value of every
 * ordinary key too, so `env dump: API_KEY=secret` would swallow the assignment as `dump`'s
 * value and never see the real credential. Rescanning to compensate is quadratic (a 100k
 * `a=a=a=…` blob took over a second), and cron stdout is exactly where such a blob shows up.
 * Skipping the value scan for ordinary keys keeps both branches O(1) per key.
 *
 * Group 1 is the optional key quote (backreferenced so quoting must balance), group 2 the key.
 * The lookbehind stops a key from starting mid-identifier, which also keeps the scan linear: a
 * long non-matching run is rejected at one position instead of at every offset.
 */
const SENSITIVE_KEY_PREFIX_RE =
  /(?<![A-Za-z0-9_.\-])(["']?)([A-Za-z_][A-Za-z0-9_.\-]{0,63})\1\s*[:=]\s*/g;

/**
 * The value half, matched sticky at the position the key pattern stopped.
 *
 * The quoted branch consumes backslash escapes as a unit, so a secret containing an escaped
 * quote (`{"apiKey":"sk-a\"b"}`) is matched whole. Stopping at the inner `\"` instead would
 * both leave the tail of the secret in the log and close the string early, rewriting the row
 * into malformed JSON (PR #1291 review). The two alternatives are mutually exclusive — one
 * starts with a backslash, the other excludes it — so the star cannot backtrack ambiguously
 * and the scan stays linear.
 *
 * The bare branch excludes brackets and braces so a nested literal is never half-consumed;
 * `scanBalancedStructure` handles those instead. That also means an already-redacted
 * `token=[REDACTED]` matches nothing here, which is what makes reapplication safe.
 *
 * `?` is deliberately *not* a terminator. It opened the query string of a URL that is itself the
 * value, so stopping there published the tail: `apiKey=https://host/path?foo=secret` became
 * `apiKey=[REDACTED]?foo=secret` (PR #1291 review). `&` stays a terminator because it separates
 * one query parameter from the next rather than appearing inside a single value.
 */
const SENSITIVE_VALUE_RE = /(["'])((?:\\.|(?!\1)[^\\\r\n])*)\1|[^\s,;&<>()[\]{}"']+/y;

/**
 * Characters that mean a credential key simply has no value (`apiKey=, next=1`), as opposed to a
 * value the scanner could not parse. Nothing is exposed in that case, so the fail-closed branch
 * below must not fire and swallow the rest of the line.
 */
const EMPTY_VALUE_CHARS = new Set([",", ";", "&", ")", "]", "}", ">"]);

function isEmptyValueAt(text: string, index: number): boolean {
  if (index >= text.length) return true;
  const char = text[index];
  return /\s/.test(char) || EMPTY_VALUE_CHARS.has(char);
}

/** Index of the first `\r`/`\n` at or after `start`, or the end of the text. */
function findLineEnd(text: string, start: number): number {
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (char === "\n" || char === "\r") return i;
  }
  return text.length;
}

/** Auth scheme labels the header patterns above deliberately keep visible. */
const AUTH_SCHEME_ONLY_RE = /^(?:Bearer|Basic)$/i;

/**
 * Scan the balanced `{…}` / `[…]` literal starting at `start`, returning the index just past
 * its closing bracket, or -1 when it is unterminated (a truncated cron stdout tail) or does
 * not start a literal at all.
 *
 * A credential-named key whose value is a structure (`{"credentials":{"user":"bob","value":
 * "hunter2"}}`) used to survive redaction entirely: the key/value pass skipped the literal,
 * and the nested keys it then scanned on their own — `user`, `value` — are not credential
 * names, so nothing matched (PR #1291 review). Redacting the whole literal is the correct
 * reading: the key already declared everything under it to be a credential.
 *
 * String contents are skipped so a bracket inside a quoted value cannot unbalance the depth
 * count, and escapes are consumed as a unit so `"\\"` does not read as an unterminated string.
 */
function scanBalancedStructure(text: string, start: number): number {
  const opener = text[start];
  if (opener !== "{" && opener !== "[") {
    return -1;
  }

  let depth = 0;
  let quote: string | null = null;

  for (let i = start; i < text.length; i += 1) {
    const char = text[i];

    if (quote !== null) {
      if (char === "\\") i += 1;
      else if (char === quote) quote = null;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "{" || char === "[") {
      depth += 1;
    } else if (char === "}" || char === "]") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }

  return -1;
}

/**
 * Replace the value of every credential-named `key=value` / `"key": "value"` pair, including
 * values that are whole `{…}` / `[…]` literals.
 *
 * Only the value slice is rewritten, so the key, its quoting, and the separator survive
 * byte-for-byte and stay readable in the log row.
 */
function redactSensitiveKeyValuePairs(text: string): string {
  SENSITIVE_KEY_PREFIX_RE.lastIndex = 0;

  let result = "";
  let copiedUpTo = 0;
  let keyMatch: RegExpExecArray | null;

  while ((keyMatch = SENSITIVE_KEY_PREFIX_RE.exec(text)) !== null) {
    // `lastIndex` already sits past the separator, so an ordinary key costs nothing and leaves
    // whatever follows it available to be matched as a key in its own right.
    if (!shouldRedactKey(keyMatch[2])) {
      continue;
    }

    const valueStart = SENSITIVE_KEY_PREFIX_RE.lastIndex;

    // An earlier pattern already scrubbed this pair (`?token=[REDACTED]`). Bail before the
    // structure branch, which would otherwise read the marker's own brackets as a literal.
    if (text.startsWith(REDACTED_VALUE, valueStart)) {
      continue;
    }

    // A nested literal is redacted whole: the credential-named key covers everything inside it,
    // and the inner keys are usually innocuous (`{"credentials":{"user":…,"value":…}}`).
    if (text[valueStart] === "{" || text[valueStart] === "[") {
      // Unterminated means the log line was truncated mid-structure, so everything that remains
      // is still inside the credential — redact the rest and stop. Ending the scan here is also
      // what keeps the pass linear: a successful scan skips the characters it consumed, and a
      // failed one is the last work done, so `secret={secret={secret={…` cannot be quadratic.
      const structureEnd = scanBalancedStructure(text, valueStart);
      const redactedTo = structureEnd === -1 ? text.length : structureEnd;

      result += text.slice(copiedUpTo, valueStart) + `"${REDACTED_VALUE}"`;
      copiedUpTo = redactedTo;

      if (structureEnd === -1) break;
      SENSITIVE_KEY_PREFIX_RE.lastIndex = structureEnd;
      continue;
    }

    SENSITIVE_VALUE_RE.lastIndex = valueStart;
    const valueMatch = SENSITIVE_VALUE_RE.exec(text);
    if (!valueMatch) {
      // Neither branch matched, so the value opens with a character the scanner cannot bound: an
      // unterminated quote (`apiKey="sk-live-…` truncated mid-line) or a delimiter. Leaving it
      // alone published the secret verbatim (PR #1291 review), so fail closed and redact to the
      // end of the line — a credential-named key covers everything up to the next line anyway.
      if (isEmptyValueAt(text, valueStart)) {
        continue;
      }

      const lineEnd = findLineEnd(text, valueStart);
      const openQuote = text[valueStart];
      const quoted = openQuote === '"' || openQuote === "'";

      result +=
        text.slice(copiedUpTo, valueStart) +
        (quoted ? `${openQuote}${REDACTED_VALUE}${openQuote}` : REDACTED_VALUE);
      copiedUpTo = lineEnd;
      // Resume past what was just consumed. Without this the next unparsable value would rescan
      // the same tail, making a line of `k="a k="a …` quadratic.
      SENSITIVE_KEY_PREFIX_RE.lastIndex = lineEnd;
      continue;
    }

    const valueEnd = SENSITIVE_VALUE_RE.lastIndex;
    const quote = valueMatch[1] as string | undefined;
    const value = quote === undefined ? valueMatch[0] : valueMatch[2];
    SENSITIVE_KEY_PREFIX_RE.lastIndex = valueEnd;

    if (!value) {
      continue;
    }

    // An earlier pattern already scrubbed this pair (`Cookie: [REDACTED]`, `"Authorization":
    // "Basic [REDACTED]"`). Leaving it alone keeps the richer upstream output.
    if (value.includes("REDACTED")) {
      continue;
    }

    // Same case, but the bare branch stopped at the `[` of an existing redaction, so only a
    // harmless prefix matched: in `DATABASE_URL=postgres://[REDACTED]@host/db` the value reads
    // as `postgres://`. Rewriting it would double-redact and discard the surviving host.
    if (text.startsWith(REDACTED_VALUE, valueEnd)) {
      continue;
    }

    // `Authorization: Bearer [REDACTED]` — the credential is gone and the scheme aids triage.
    if (AUTH_SCHEME_ONLY_RE.test(value)) {
      continue;
    }

    result +=
      text.slice(copiedUpTo, valueStart) +
      (quote ? `${quote}${REDACTED_VALUE}${quote}` : REDACTED_VALUE);
    copiedUpTo = valueEnd;
  }

  return copiedUpTo === 0 ? text : result + text.slice(copiedUpTo);
}

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
 *
 * Covers both unstructured shapes (headers, bearer tokens, URL query params and userinfo) and
 * structured `key=value` / `"key": "value"` pairs serialized into the text.
 *
 * The structured pass runs last so the more specific header patterns win: they keep useful
 * context such as the `Bearer` scheme that a generic key/value swap would erase.
 *
 * It errs toward over-redaction — once a key is credential-named, `token: expired` reads as
 * `token: [REDACTED]`. For a log sink that is the right direction, and the code/source/level
 * columns carry the triage signal that the value would have.
 */
export function redactSecretValuesInString(text: string): string {
  const headerScrubbed = text
    .replace(AUTH_HEADER_CREDENTIAL_RE, `$1 ${REDACTED_VALUE}`)
    .replace(STANDALONE_AUTH_TOKEN_RE, `$1 ${REDACTED_VALUE}`)
    .replace(COOKIE_HEADER_RE, (match) => {
      const prefix = match.split(":")[0] ?? "Cookie";
      return `${prefix}: ${REDACTED_VALUE}`;
    })
    .replace(X_API_KEY_HEADER_RE, `X-Api-Key: ${REDACTED_VALUE}`)
    .replace(TOKEN_QUERY_PARAM_RE, `$1${REDACTED_VALUE}`)
    .replace(URL_USERINFO_RE, `//${REDACTED_VALUE}@`);

  return redactSensitiveKeyValuePairs(headerScrubbed);
}

/**
 * Key-level redaction plus value-level scrubbing of every string leaf.
 *
 * This is the only sanitizer callers should reach for. A key-only variant used to exist
 * alongside it and was the cause of #976: a secret under an innocuous key survived intact.
 * Keeping the weaker function exported invited the same bug again, so it was removed —
 * value scrubbing is a strict superset of what it did.
 *
 * Used for audit / security / system log details and bug-report console+network captures.
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
 * Redact a caught error before it is handed to `console.error`.
 *
 * Console fallbacks are a real exfiltration path: a DB outage surfaces a driver error whose
 * message embeds the connection string (`//user:pass@host`), and fetch failures embed the
 * request URL with its query string. Logging the raw error object would put those in stdout
 * even though the DB row itself is redacted, so scrub message and stack the same way.
 *
 * Returns a plain shape rather than an `Error` because `console.error` prints an Error's own
 * (unredacted) fields rather than the properties we set on it.
 */
export function redactErrorForConsole(error: unknown): unknown {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: redactSecretValuesInString(error.message),
      stack: error.stack ? redactSecretValuesInString(error.stack) : undefined,
    };
  }

  if (typeof error === "string") {
    return redactSecretValuesInString(error);
  }

  return sanitizeSensitiveData(error);
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
