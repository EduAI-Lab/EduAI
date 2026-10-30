import { createCookie, type Cookie } from "react-router";
import { z } from "zod";

/**
 * #1942: carries the address a person just typed to the next auth page, so
 * that page can prefill it without the address appearing in the URL — where
 * it would land in browser history, the proxy's access log and any Referer.
 *
 * Each cookie is scoped to the one page that reads it and lives for minutes.
 * It is not signed: it only prefills a field the person can edit anyway, and
 * the page never treats it as proof of anything.
 */
const PENDING_EMAIL_MAX_AGE_SECONDS = 15 * 60;

const pendingEmailSchema = z.string().trim().max(320).email();

function pendingEmailCookie(name: string, path: string): Cookie {
  return createCookie(name, {
    path,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: PENDING_EMAIL_MAX_AGE_SECONDS,
  });
}

/** Set by forgot-password, read by reset-password. */
export const resetEmailCookie = pendingEmailCookie("eduai_reset_email", "/auth/reset-password");

/** Set by register, read by verify-email. */
export const verifyEmailCookie = pendingEmailCookie("eduai_verify_email", "/auth/verify-email");

export function serializePendingEmail(cookie: Cookie, email: string): Promise<string> {
  return cookie.serialize(email);
}

/** The carried address, or "" when there is none or it is not an address. */
export async function readPendingEmail(cookie: Cookie, request: Request): Promise<string> {
  const value: unknown = await cookie.parse(request.headers.get("Cookie"));
  const parsed = pendingEmailSchema.safeParse(value);
  return parsed.success ? parsed.data : "";
}
