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
