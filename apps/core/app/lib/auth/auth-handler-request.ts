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
