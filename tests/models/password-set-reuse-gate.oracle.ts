/**
 * Oracle for tests/models/password-set-reuse-gate.pict (census docs/PICT_CENSUS.md § S6, #1185).
 *
 * Derived from the #339 before-hook contract (lib/auth/server.ts:92), not from
 * copying its branches:
 *   - Strength is checked first, on every password-setting path, unconditionally.
 *   - /sign-up/email is exempt from the reuse check entirely (a brand-new
 *     account has no history to reuse against).
 *   - Every other path first resolves a userId — via an unexpired reset token
 *     on /reset-password, via an active session everywhere else. No userId,
 *     no reuse check: the hook lets the request through and the real
 *     credential/token logic downstream is responsible for its own error.
 *   - Documented precedence (#339): on /change-password, a wrong current
 *     password is surfaced by the real handler, not by this hook — so it
 *     takes over before the reuse check runs, not after.
 */

export type PasswordSetReuseGateRow = {
  Path: "sign-up" | "change-password" | "reset-password" | "set-password";
  Strength: "weak" | "strong";
  ResetToken: "valid" | "expired" | "missing";
  Session: "present" | "absent";
  CurrentPassword: "correct" | "incorrect" | "missing";
  Reuse: "reused" | "not-reused";
};

export type Verdict =
  | { outcome: "blocked-weak" }
  | { outcome: "blocked-reuse" }
  | { outcome: "not-blocked" };

const AUTH_PATH: Record<PasswordSetReuseGateRow["Path"], string> = {
  "sign-up": "/sign-up/email",
  "change-password": "/change-password",
  "reset-password": "/reset-password",
  "set-password": "/set-password",
};

export function authPathFor(row: PasswordSetReuseGateRow): string {
  return AUTH_PATH[row.Path];
}

/**
 * Does this row resolve a userId at all? /sign-up/email skips reuse entirely
 * (SKIP_REUSE_PATHS), so userId is never resolved there. /reset-password
 * resolves via an unexpired Verification row; every other path needs an
 * active session.
 */
function resolvesUserId(row: PasswordSetReuseGateRow): boolean {
  if (row.Path === "sign-up") return false;
  if (row.Path === "reset-password") return row.ResetToken === "valid";
  return row.Session === "present";
}

export function passwordSetReuseGateOracle(row: PasswordSetReuseGateRow): Verdict {
  if (row.Strength === "weak") return { outcome: "blocked-weak" };
  if (row.Path === "sign-up") return { outcome: "not-blocked" };
  if (!resolvesUserId(row)) return { outcome: "not-blocked" };

  if (row.Path === "change-password" && row.CurrentPassword === "incorrect") {
    return { outcome: "not-blocked" };
  }

  if (row.Reuse === "reused") return { outcome: "blocked-reuse" };
  return { outcome: "not-blocked" };
}
