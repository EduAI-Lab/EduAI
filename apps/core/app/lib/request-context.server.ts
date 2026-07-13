/**
 * Request context helpers.
 *
 * Centralizing extraction avoids inconsistent request metadata in logs across route actions,
 * auth guards, and background sync entry points.
 */

export type RequestContext = {
  requestId: string;
  routePath: string;
  httpMethod: string;
  ipAddress: string | null;
  userAgent: string | null;
};

export type ActorContext = {
  actorUserId: string | null;
  actorRole: string | null;
  actorType: string;
};

function buildRequestId() {
  // A generated fallback ensures every event can still be correlated when proxies omit IDs.
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// Derive the client IP from the LAST `x-forwarded-for` entry.
//
// Deployment invariant (see docs/DEPLOYMENT.md): every app sits behind exactly one trusted reverse
// proxy — Apache `ProxyPass` to Node on localhost, with no Cloudflare or second proxy in front and
// Node not directly reachable. Apache's mod_proxy appends the real socket-peer address as the last
// XFF entry, so the rightmost token is written by our own infrastructure and a client cannot forge
// it: a spoofed `X-Forwarded-For: 1.2.3.4` becomes `1.2.3.4, <real-client>` and we take the latter.
//
// Returns null when the header is absent/empty (e.g. local dev with no proxy). If a second proxy is
// ever added, this selection and its tests must be updated as part of that deployment change.
function deriveClientIp(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const tokens = value
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  return tokens[tokens.length - 1] ?? null;
}

export function getRequestContext(request: Request): RequestContext {
  // A malformed or absent URL must never throw — logging context extraction has to stay
  // fail-open so it can't break the request it is only meant to annotate.
  let routePath = "";
  try {
    routePath = new URL(request.url).pathname;
  } catch {
    routePath = typeof request.url === "string" ? request.url : "";
  }

  const requestId = request.headers.get("x-request-id")?.trim() || buildRequestId();

  // Only x-forwarded-for is trusted: our single Apache proxy sets it. `x-real-ip` /
  // `cf-connecting-ip` are not set by Apache, so honoring them would only add a client-forgeable
  // spoof vector.
  const ipAddress = deriveClientIp(request.headers.get("x-forwarded-for"));

  return {
    requestId,
    routePath,
    httpMethod: request.method,
    ipAddress,
    userAgent: request.headers.get("user-agent")?.trim() || null,
  };
}

// `role` is intentionally loose: Better Auth types session.user.role as string | null | undefined,
// so accepting that shape lets every route pass session.user directly without a cast.
export function getActorContext(user: { id: string; role?: string | null } | null): ActorContext {
  // Anonymous actor tagging lets security/audit filters separate unauthenticated traffic quickly.
  if (!user) {
    return {
      actorUserId: null,
      actorRole: null,
      actorType: "ANONYMOUS",
    };
  }

  return {
    actorUserId: user.id,
    actorRole: user.role ?? null,
    actorType: "USER",
  };
}
