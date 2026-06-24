/**
 * Shared, pure password-policy rules (UBC, issue #339). Importable from both
 * client (Zod form validation) and server (better-auth hooks), so this file
 * must stay free of server-only imports.
 */

/** Minimum length for a complex password that mixes character classes. */
export const MIN_COMPLEX_PASSWORD_LENGTH = 8;
/** Minimum length for a passphrase that need not mix character classes. */
export const MIN_PASSPHRASE_LENGTH = 16;

/** User-facing message describing the policy; reused by Zod and API errors. */
export const PASSWORD_POLICY_MESSAGE =
  "Password must be at least 8 characters with upper and lower case letters, " +
  "numbers, and symbols — or a passphrase of at least 16 characters.";

/**
 * True when the password satisfies the UBC policy: either a complex password
 * (>= 8 chars with lower, upper, digit, and a non-alphanumeric symbol) or a
 * passphrase (>= 16 chars, no class requirement).
 */
export function isStrongPassword(password: string): boolean {
  if (password.length >= MIN_PASSPHRASE_LENGTH) {
    return true;
  }

  if (password.length < MIN_COMPLEX_PASSWORD_LENGTH) {
    return false;
  }

  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasDigit = /[0-9]/.test(password);
  const hasSymbol = /[^A-Za-z0-9\s]/.test(password);

  return hasLower && hasUpper && hasDigit && hasSymbol;
}

/**
 * Maps a better-auth endpoint path to the request-body field that carries the
 * password being set. The Zod schemas only guard the app's own forms; the raw
 * `/api/auth/*` handler bypasses them, so the auth `before` hook uses this to
 * find and policy-check the password regardless of entry point.
 */
const PASSWORD_SETTING_PATHS: Record<string, "password" | "newPassword"> = {
  "/sign-up/email": "password",
  "/change-password": "newPassword",
  "/reset-password": "newPassword",
  "/set-password": "newPassword",
};

/**
 * Paths where a userId can be resolved from a reset token rather than a
 * session. The token lives in the body and maps to a Verification row whose
 * `value` is the userId.
 */
export const TOKEN_RESET_PATHS = new Set(["/reset-password"]);

/**
 * Paths where reuse history should NOT be checked (first-time password set —
 * no prior history exists to compare against).
 */
export const SKIP_REUSE_PATHS = new Set(["/sign-up/email"]);

/**
 * Returns the policy-checkable password string for an auth path, or null when
 * the path does not set a password or the field is missing/non-string.
 */
export function extractPolicyPassword(path: string, body: unknown): string | null {
  const field = PASSWORD_SETTING_PATHS[path];
  if (!field) {
    return null;
  }
  const value = (body as Record<string, unknown> | null | undefined)?.[field];
  return typeof value === "string" ? value : null;
}
