import { checkRateLimit, parseEnvInt } from "./rate-limit.server";
import { getRequestContext } from "~/lib/request-context.server";

/**
 * #1728: `/email-otp/request-password-reset` makes the server send mail to an
 * address the caller names, so it is throttled on both sides of that pair — the
 * IP doing the asking, and the mailbox being aimed at. Better Auth's own
 * limiter only covers the former. Defaults are per 15 minutes; overridable per
 * deployment.
 */
export function passwordResetRequestLimits() {
  return {
    windowMs: parseEnvInt(process.env.PASSWORD_RESET_RATE_LIMIT_WINDOW_MS, 15 * 60_000),
    perEmail: parseEnvInt(process.env.PASSWORD_RESET_RATE_LIMIT_PER_EMAIL, 3),
    perIp: parseEnvInt(process.env.PASSWORD_RESET_RATE_LIMIT_PER_IP, 10),
  };
}

export type PasswordResetThrottle = { limited: false } | { limited: true; retryAfter: number };

/**
 * Charges both buckets for one reset-code request. Called from the Better Auth
 * `before` hook so that every way into the endpoint pays — the form action and
 * a direct `POST /api/auth/email-otp/request-password-reset` alike.
 *
 * Charged before anything looks the address up, so the throttle can never
 * become the thing that tells an attacker an account exists. The mailbox bucket
 * is skipped, not the IP one, when the body carries no usable address.
 */
export async function chargePasswordResetRequest(
  request: Request | undefined,
  email: string | null | undefined,
): Promise<PasswordResetThrottle> {
  const { windowMs, perEmail, perIp } = passwordResetRequestLimits();
  const ipAddress = (request && getRequestContext(request).ipAddress) ?? "unknown";

  const byIp = await checkRateLimit(`password-reset-request:ip:${ipAddress}`, perIp, windowMs);
  if (byIp.limited) return { limited: true, retryAfter: byIp.retryAfter };

  const mailbox = email?.trim().toLowerCase();
  if (mailbox) {
    const byEmail = await checkRateLimit(
      `password-reset-request:email:${mailbox}`,
      perEmail,
      windowMs,
    );
    if (byEmail.limited) return { limited: true, retryAfter: byEmail.retryAfter };
  }
  return { limited: false };
}
