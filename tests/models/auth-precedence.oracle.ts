/**
 * Oracle for tests/models/auth-precedence.pict (census docs/PICT_CENSUS.md § S6, #1185).
 *
 * Derived from the documented precedence rule (guards.server.ts:48's docstring
 * and the S6 census note), not from copying `enforceAdminIfApiKey`'s branches:
 *   - An active-ADMIN cookie always wins, even over a garbage/absent x-api-key
 *     — the fast path is checked before the key is ever verified.
 *   - No x-api-key at all is a no-op: the guard defers entirely, every time.
 *   - An invalid key defers to the cookie when one exists (any role — the
 *     guard itself doesn't care, it just steps aside and lets the caller's
 *     own session resolution run); with no cookie it's a hard 401.
 *   - A verified key owned by an inactive-or-non-admin user is always a hard
 *     403, regardless of any cookie.
 *   - A verified active-admin key admits directly.
 *
 * `Site` distinguishes the guard's own `{response, session}` contract from
 * `/api/me`, which composes the guard with its own cookie fallback
 * (`apiKeyGate.session ?? getSession()`) and only requires *some* session
 * (not ADMIN) to return 200 — own-profile reads are not admin-gated.
 */

export type AuthPrecedenceRow = {
  KeyState: "none" | "valid-admin-active" | "valid-admin-inactive" | "valid-nonadmin" | "invalid";
  CookieState: "none" | "admin-active" | "admin-inactive" | "nonadmin";
  Site: "guard" | "api-me";
};

export type GuardVerdict =
  | { outcome: "admit"; via: "cookie-fastpath" | "key" }
  | { outcome: "block"; status: 401 | 403 }
  | { outcome: "defer" };

export function guardOracle(row: AuthPrecedenceRow): GuardVerdict {
  if (row.KeyState === "none") return { outcome: "defer" };

  // Cookie fast path is checked before the key is ever verified — a garbage
  // or non-admin key never overrides an active-admin cookie.
  if (row.CookieState === "admin-active") return { outcome: "admit", via: "cookie-fastpath" };

  if (row.KeyState === "invalid") {
    return row.CookieState === "none" ? { outcome: "block", status: 401 } : { outcome: "defer" };
  }
  if (row.KeyState === "valid-admin-active") return { outcome: "admit", via: "key" };
  // valid-admin-inactive / valid-nonadmin
  return { outcome: "block", status: 403 };
}

/** GUARD site: does `enforceAdminIfApiKey` return a response, and if not, a session? */
export function expectedGuardResult(
  row: AuthPrecedenceRow,
): { hasResponse: boolean; status?: number; hasSession: boolean } {
  const verdict = guardOracle(row);
  switch (verdict.outcome) {
    case "admit":
      return { hasResponse: false, hasSession: true };
    case "block":
      return { hasResponse: true, status: verdict.status, hasSession: false };
    case "defer":
      return { hasResponse: false, hasSession: false };
  }
}

/**
 * API_ME site: the real HTTP status `GET /api/me` returns. On `defer`, the
 * endpoint falls back to the caller's own cookie session — any authenticated
 * role is enough (own-profile reads aren't admin-gated), so only a genuinely
 * absent cookie yields 401.
 */
export function expectedApiMeStatus(row: AuthPrecedenceRow): number {
  const verdict = guardOracle(row);
  switch (verdict.outcome) {
    case "admit":
      return 200;
    case "block":
      return verdict.status;
    case "defer":
      return row.CookieState === "none" ? 401 : 200;
  }
}
