/**
 * Public cookie Domain for Better Auth cross-subdomain sessions.
 *
 * Loopback values are ignored. `COOKIE_DOMAIN=localhost` (often copied from
 * `.env.test`) turns on `crossSubDomainCookies`, so the session is issued with
 * `Domain=localhost`, and the login action then expires the host-only cookie of
 * the same name. On localhost those are the same cookie: sign-in 302s to
 * `/dashboard` with no form error, and the next request has no session.
 */
export function resolveAuthCookieDomain(
  raw: string | undefined = process.env.COOKIE_DOMAIN,
): string | undefined {
  const domain = raw?.trim();
  if (!domain) return undefined;
  const host = domain.replace(/^\./, "").toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1") {
    return undefined;
  }
  return domain;
}

/** Better Auth's own default cookie prefix. */
export const DEFAULT_AUTH_COOKIE_PREFIX = "better-auth";

/**
 * Prefix for the auth cookie names (#2129). Dev and prod both set
 * `COOKIE_DOMAIN=.eduai.ok.ubc.ca`, so with the same prefix each one's session
 * cookie overwrites the other's in the browser. Dev sets
 * `COOKIE_PREFIX=eduai-dev`; unset keeps Better Auth's default, so prod is
 * unchanged. Anything but letters, digits, `-` and `_` throws at startup rather
 * than quietly falling back to the shared name.
 */
export function resolveAuthCookiePrefix(
  raw: string | undefined = process.env.COOKIE_PREFIX,
): string {
  const prefix = raw?.trim();
  if (!prefix) return DEFAULT_AUTH_COOKIE_PREFIX;
  if (!/^[A-Za-z0-9_-]+$/.test(prefix)) {
    throw new Error(`COOKIE_PREFIX must use only letters, digits, "-" and "_" (got "${prefix}")`);
  }
  return prefix;
}
