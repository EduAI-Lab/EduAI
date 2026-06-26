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
 * Returns whether a password satisfies the UBC password policy.
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
 * Maps auth paths to the password field in the request body.
 */
const PASSWORD_SETTING_PATHS: Record<string, "password" | "newPassword"> = {
  "/sign-up/email": "password",
  "/change-password": "newPassword",
  "/reset-password": "newPassword",
  "/set-password": "newPassword",
};

/**
 * Auth paths that resolve a user via a reset token instead of a session.
 */
export const TOKEN_RESET_PATHS = new Set(["/reset-password"]);

/**
 * Auth paths that skip password reuse checks.
 */
export const SKIP_REUSE_PATHS = new Set(["/sign-up/email"]);

/**
 * Returns the password from a password-setting auth request, if present.
 */
export function extractPolicyPassword(path: string, body: unknown): string | null {
  const field = PASSWORD_SETTING_PATHS[path];
  if (!field) {
    return null;
  }
  const value = (body as Record<string, unknown> | null | undefined)?.[field];
  return typeof value === "string" ? value : null;
}
