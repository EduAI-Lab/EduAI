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

// Substrings that — after stripping non-alphanumerics and lowercasing the key — mark a value
// as a credential or direct-contact PII that must never be persisted in log details. Matched as
// substrings so compound keys are covered too: `secret` catches sessionSecret/clientSecret,
// `apikey` catches x-api-key, `accesskey`/`privatekey` catch provider key fields.
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
  return REDACT_KEY_SUBSTRINGS.some((needle) => normalized.includes(needle));
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
