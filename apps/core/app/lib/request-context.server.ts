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

// Number of trusted proxy hops between the public internet and this app, read from
// `TRUSTED_PROXY_HOP_COUNT`. `x-forwarded-for` is appended left-to-right by each proxy, so the
// rightmost entries are the ones our own infrastructure wrote and a client cannot forge. The true
// client sits `hopCount` entries in from the right. See docs/LOGGING.md §3 and apps/core/.env.example.
//
// Default 0 = trust only the rightmost (immediate) hop — safe when the proxy count is unknown,
// because the rightmost token is non-spoofable. Values below 0 or non-numeric fall back to 0.
function resolveTrustedProxyHopCount(): number {
  const parsed = Number(process.env.TRUSTED_PROXY_HOP_COUNT);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return Math.floor(parsed);
}

// Derive the client IP from `x-forwarded-for`, counting `hopCount` trusted proxy hops from the
// right. Attacker-prepended entries on the left are ignored. Returns null when the header is
// absent/empty or when the trusted-hop offset points past the start of the chain (misconfigured
// hop count) — we fail closed rather than fall back to a spoofable leftmost token.
function deriveClientIp(value: string | null, hopCount: number): string | null {
  if (!value) {
    return null;
  }

  const tokens = value
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  if (tokens.length === 0) {
    return null;
  }

  const index = tokens.length - 1 - hopCount;
  if (index < 0) {
    return null;
  }

  return tokens[index] ?? null;
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
    deriveClientIp(request.headers.get("x-forwarded-for"), resolveTrustedProxyHopCount()) ||
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
