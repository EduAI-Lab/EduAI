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
import { sanitizeDetails } from "~/lib/redact.server";

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
