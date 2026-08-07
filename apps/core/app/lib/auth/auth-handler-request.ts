/**
 * Marks an internally-built sign-up sub-request as an invitation acceptance,
 * which is exempt from the public-registration gate (the invitee was vetted by
 * an admin/unit-admin, so `auth.allowPublicRegistration` must not block them).
 *
 * Presence alone is the signal — it is NOT spoofable from outside because the
 * public auth catch-all (`/api/auth/$`) strips it from every inbound request
 * via `stripInternalAuthHeaders`, and every other `auth.handler()` caller is a
 * server-side sub-request that never sets it. Only `acceptInvitation` attaches
 * it.
 */
export const INTERNAL_INVITE_SIGNUP_HEADER = "x-eduai-invite-signup";

/**
 * Remove internal-only auth markers from an externally-originated request so a
 * browser cannot forge them. Applied at the public `/api/auth/*` boundary.
 */
export function stripInternalAuthHeaders(request: Request): Request {
  if (!request.headers.has(INTERNAL_INVITE_SIGNUP_HEADER)) return request;
  const headers = new Headers(request.headers);
  headers.delete(INTERNAL_INVITE_SIGNUP_HEADER);
  return new Request(request, { headers });
}

/**
 * Build an internal Request for `auth.handler()` from an incoming browser request.
 */
export function buildAuthSubRequest(
  authPath: string,
  request: Request,
  init: RequestInit & { body?: BodyInit | null },
  options?: { forwardCookies?: boolean },
): Request {
  const url = new URL(authPath, request.url);
  const headers = new Headers(init.headers);

  if (options?.forwardCookies) {
    const cookie = request.headers.get("cookie");
    if (cookie) headers.set("cookie", cookie);
  }

  const origin = request.headers.get("origin");
  if (origin) headers.set("origin", origin);

  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) headers.set("x-forwarded-for", forwardedFor);

  const forwardedProto = request.headers.get("x-forwarded-proto");
  if (forwardedProto) headers.set("x-forwarded-proto", forwardedProto);

  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedHost) headers.set("x-forwarded-host", forwardedHost);

  return new Request(url, {
    ...init,
    headers,
  });
}
