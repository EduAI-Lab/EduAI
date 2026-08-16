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

export type PasswordRequirementStatus = {
  minimumLength: boolean;
  lowercase: boolean;
  uppercase: boolean;
  number: boolean;
  symbol: boolean;
  passphrase: boolean;
  complex: boolean;
};

/** Return each policy check so forms can explain unmet requirements live. */
export function getPasswordRequirementStatus(
  password: string,
): PasswordRequirementStatus {
  const minimumLength = password.length >= MIN_COMPLEX_PASSWORD_LENGTH;
  const lowercase = /[a-z]/.test(password);
  const uppercase = /[A-Z]/.test(password);
  const number = /[0-9]/.test(password);
  const symbol = /[^A-Za-z0-9\s]/.test(password);
  const passphrase = password.length >= MIN_PASSPHRASE_LENGTH;

  return {
    minimumLength,
    lowercase,
    uppercase,
    number,
    symbol,
    passphrase,
    complex: minimumLength && lowercase && uppercase && number && symbol,
  };
}

/**
 * Returns whether a password satisfies the UBC password policy.
 */
export function isStrongPassword(password: string): boolean {
  const status = getPasswordRequirementStatus(password);
  return status.passphrase || status.complex;
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
 * `setPassword` is declared `serverOnly`, so it has no route and `ctx.path`
 * is `undefined` for it — better-auth still gives every dispatch a stable
 * `operationId` (the `auth.api.*` map key) even when there's no path, so
 * that's the identity a server-only endpoint has to be matched on instead.
 */
const PASSWORD_SETTING_OPERATIONS: Record<string, "password" | "newPassword"> = {
  setPassword: "newPassword",
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
 * `path` is `undefined` for server-only endpoints (no route), in which case
 * `operationId` is used to identify the endpoint instead.
 */
export function extractPolicyPassword(
  path: string | undefined,
  operationId: string | undefined,
  body: unknown,
): string | null {
  const field =
    (path ? PASSWORD_SETTING_PATHS[path] : undefined) ??
    (operationId ? PASSWORD_SETTING_OPERATIONS[operationId] : undefined);
  if (!field) {
    return null;
  }
  const value = (body as Record<string, unknown> | null | undefined)?.[field];
  return typeof value === "string" ? value : null;
}
