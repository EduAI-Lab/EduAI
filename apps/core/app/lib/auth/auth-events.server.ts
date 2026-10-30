import { fireAndForget, logSecurityEvent, type LogSecurityEventInput } from "~/lib/logging.server";
import type { AuditLogOutcome } from "~/lib/db.auditlog.server";
import { getActorContext, getRequestContext } from "~/lib/request-context.server";

/**
 * #1942: account lifecycle events Better Auth runs on its own — sign-up, the
 * verification email, a password reset — written to Admin → Logs → Security.
 * Called from the auth hooks, which only run for a real account, so a public
 * form that answers "maybe" to every address gains nothing from these rows.
 */
export type AuthLifecycleEvent =
  | "USER_REGISTERED"
  | "VERIFICATION_EMAIL_SENT"
  | "VERIFICATION_EMAIL_FAILED"
  | "PASSWORD_RESET_REQUESTED"
  | "PASSWORD_RESET_COMPLETED";

export function recordAuthEvent(input: {
  actionCode: AuthLifecycleEvent;
  outcome: AuditLogOutcome;
  user: { id?: string | null; email: string; role?: string | null };
  request?: Request | null;
}): void {
  const { actionCode, outcome, user, request } = input;
  const event: LogSecurityEventInput = {
    ...getActorContext(user.id ? { id: user.id, role: user.role ?? null } : null),
    actionCode,
    outcome,
    entityType: "Auth",
    entityId: user.id ?? null,
    entityLabel: user.email,
  };
  // Some hooks run without a Request (e.g. a server-side API call).
  if (request) Object.assign(event, getRequestContext(request));
  fireAndForget(logSecurityEvent(event));
}
