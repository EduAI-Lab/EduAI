/**
 * Shared logging facade.
 *
 * This module keeps redaction and fail-open behavior in one place so new instrumentation
 * points can stay small and safe without duplicating sensitive-field handling.
 */
import {
  createAuditLog,
  createSecurityLog,
  type AuditLogCategory,
  type AuditLogOutcome,
} from "~/lib/db.auditlog.server";
import { createSystemError, type CreateSystemErrorInput } from "~/lib/db.systemlog.server";

export type LogAuditActionInput = {
  actionCode: string;
  category: AuditLogCategory;
  outcome?: AuditLogOutcome;
  actorUserId?: string | null;
  actorRole?: string | null;
  actorType?: string;
  entityType: string;
  entityId?: string | null;
  entityLabel?: string | null;
  details?: unknown;
  requestId?: string | null;
  routePath?: string | null;
  httpMethod?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type LogSecurityEventInput = Omit<LogAuditActionInput, "category">;

export type LogSystemErrorInput = CreateSystemErrorInput;

const AUDIT_SAFE_ID_KEYS = new Set(["studentid", "ubcemployeeid"]);
const REDACTED_VALUE = "[REDACTED]";
const CIRCULAR_VALUE = "[CIRCULAR]";

// Longer, reasonably unique needles matched as substrings against the alphanumerics-only
// lowercased key so compound names stay covered (`secret` → sessionSecret/clientSecret,
// `apikey` → x-api-key, `dburl`/`databaseuri` → dbUrl/databaseUri, etc.).
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
  "dsn",
  "otp",
  "signature",
  "sessionid",
  "authorization",
];

// Short / ambiguous tokens that must match a whole camelCase / snake_case / kebab segment
// rather than a raw substring — otherwise `auth` redacts authorId and `pin` redacts mapping /
// shippingAddress via includes().
const REDACT_KEY_EXACT_SEGMENTS = new Set(["auth", "pin"]);

// Bare `mfa` is secret-shaped when used as the full key, but status flags like `mfaEnabled`
// must remain visible — so match the normalized full key only, not a segment of a compound name.
const REDACT_KEY_EXACT_KEYS = new Set(["mfa"]);

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

function shouldRedactKey(key: string) {
  const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();

  // Accountability IDs must remain visible in audit details for admin investigations.
  if (AUDIT_SAFE_ID_KEYS.has(normalized)) {
    return false;
  }

  // This deny-list covers credentials and direct contact PII explicitly requested as non-loggable.
  //
  // NOTE: `email` is intentionally NOT redacted right now — full email addresses are logged
  // across all logs by current product decision. This is a temporary measure; emails will be
  // purged/redacted later for privacy. Add `"email"` to REDACT_KEY_SUBSTRINGS to restore redaction.
  if (REDACT_KEY_SUBSTRINGS.some((needle) => normalized.includes(needle))) {
    return true;
  }

  if (REDACT_KEY_EXACT_KEYS.has(normalized)) {
    return true;
  }

  return splitKeySegments(key).some((segment) => REDACT_KEY_EXACT_SEGMENTS.has(segment));
}

function sanitizeDetails(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  // Primitives, null, and Dates pass through untouched.
  if (!value || typeof value !== "object" || value instanceof Date) {
    return value;
  }

  const obj = value as object;

  // Cycle guard: a self-referential details object would otherwise overflow the stack and,
  // because callers swallow the throw, drop the entire payload. Only ancestors on the current
  // branch live in `seen` (removed on unwind), so shared-but-acyclic references (DAGs) are
  // still fully sanitized rather than mislabelled as circular.
  if (seen.has(obj)) {
    return CIRCULAR_VALUE;
  }
  seen.add(obj);

  let result: unknown;
  if (Array.isArray(value)) {
    // Arrays are recursively sanitized so nested objects cannot bypass redaction.
    result = value.map((entry) => sanitizeDetails(entry, seen));
  } else if (value instanceof Map) {
    // Maps are not enumerable via Object.entries (they'd serialize to {} and silently drop
    // their contents, bypassing redaction), so normalize to a plain object first.
    const sanitized: Record<string, unknown> = {};
    for (const [key, entry] of value.entries()) {
      const keyStr = typeof key === "string" ? key : String(key);
      sanitized[keyStr] = shouldRedactKey(keyStr) ? REDACTED_VALUE : sanitizeDetails(entry, seen);
    }
    result = sanitized;
  } else if (value instanceof Set) {
    // Sets likewise serialize to {}; treat their members like an array.
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
 * Fire-and-forget a logging promise so request handlers never pay log-write latency.
 *
 * Logging is non-critical telemetry: callers `void fireAndForget(logAuditAction(...))`
 * instead of awaiting, and the background write proceeds on the event loop while the
 * response returns. The facade helpers below already swallow their own errors, but the
 * extra `.catch` here is a safety net against any unexpected synchronous rejection so a
 * logging failure can never surface as an unhandled promise rejection.
 */
export function fireAndForget(promise: Promise<unknown>): void {
  void Promise.resolve(promise).catch((error) => {
    console.error("[LOG_FIRE_AND_FORGET_FAILED]", error);
  });
}

export async function logAuditAction(input: LogAuditActionInput): Promise<void> {
  try {
    // Audit logging must never block writes that already passed domain validation.
    await createAuditLog({
      ...input,
      details: sanitizeDetails(input.details),
    });
  } catch (error) {
    console.error("[AUDIT_LOG_WRITE_FAILED]", {
      actionCode: input.actionCode,
      category: input.category,
      error,
    });
  }
}

export async function logSecurityEvent(input: LogSecurityEventInput): Promise<void> {
  try {
    // Security helper enforces category semantics and redaction in one call.
    await createSecurityLog({
      ...input,
      details: sanitizeDetails(input.details),
    });
  } catch (error) {
    console.error("[SECURITY_LOG_WRITE_FAILED]", {
      actionCode: input.actionCode,
      error,
    });
  }
}

export async function logSystemError(input: LogSystemErrorInput): Promise<void> {
  // System logger already handles DB-down fallback internally; facade adds redaction consistency.
  await createSystemError({
    ...input,
    details: sanitizeDetails(input.details),
  });
}
