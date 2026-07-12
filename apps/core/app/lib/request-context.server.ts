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

function readFirstForwardedIp(value: string | null): string | null {
  if (!value) {
    return null;
  }

  // Only the first hop represents the originating client; later hops are intermediary proxies.
  const firstHop = value.split(",")[0]?.trim();
  return firstHop || null;
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

  const ipAddress =
    readFirstForwardedIp(request.headers.get("x-forwarded-for")) ||
    request.headers.get("x-real-ip")?.trim() ||
    request.headers.get("cf-connecting-ip")?.trim() ||
    null;

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
