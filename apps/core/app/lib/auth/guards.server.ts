import { createHash, timingSafeEqual } from "node:crypto";
import { auth } from "./server";
import { fireAndForget, logSecurityEvent } from "~/lib/logging.server";
import { getActorContext, getRequestContext } from "~/lib/request-context.server";
import type { Session } from "./server";

const ALLOWED_PROD_SUFFIX = ".eduai.ok.ubc.ca";
const ALLOWED_PROD_APEX = "eduai.ok.ubc.ca";

/**
 * Validates a redirect URL from the `?redirect=` query param.
 * Accepts relative paths (starting with /) and absolute URLs whose origin is
 * localhost (dev) or under .eduai.ok.ubc.ca (prod). All other values fall back
 * to /dashboard to prevent open-redirect attacks.
 */
export function validateRedirectUrl(url: string | null): string {
  if (!url) return "/dashboard";
  // Browsers normalize backslashes to forward slashes, so `/\evil.com` becomes the
  // protocol-relative `//evil.com`. Normalize before the same-origin check so the
  // backslash variant cannot bypass the `//` open-redirect guard.
  const normalized = url.replace(/\\/g, "/");
  if (normalized.startsWith("/") && !normalized.startsWith("//")) return normalized;
  try {
    const { hostname } = new URL(url);
    if (hostname === "localhost" || hostname === "127.0.0.1") return url;
    if (hostname === ALLOWED_PROD_APEX || hostname.endsWith(ALLOWED_PROD_SUFFIX)) return url;
  } catch {
    // unparseable — fall through
  }
  return "/dashboard";
}

type AdminGate =
  | { response: Response; session: null }
  | { response: null; session: Session };

/**
 * Resolve an ADMIN session for an admin-only endpoint.
 * Returns `{ response }` (403/forbidden) when the caller is not an active ADMIN,
 * otherwise `{ session }`.
 */
export async function requireAdmin(request: Request): Promise<AdminGate> {
  const resolved = await auth.api.getSession(request);
  if (!resolved?.user || resolved.user.role !== "ADMIN") {
    fireAndForget(
      logSecurityEvent({
        ...getActorContext(resolved?.user ?? null),
        ...getRequestContext(request),
        actionCode: "ADMIN_ACCESS_DENIED",
        outcome: "DENIED",
        entityType: "Auth",
        entityId: resolved?.user?.id ?? null,
        entityLabel: resolved?.user?.email ?? null,
        ...(resolved?.user?.email ? { details: { email: resolved.user.email } } : {}),
      }),
    );
    return {
      response: new Response(
        JSON.stringify({ error: "Forbidden: Admins only" }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      ),
      session: null,
    };
  }
  return { response: null, session: resolved };
}

/**
 * Enforce: request must carry `Authorization: Bearer <EDUAI_API_KEY>` for
 * server-to-server calls from AI Tutor and Question Maker.
 *
 * Returns `null` if the service key is present and valid (caller may proceed).
 * Returns 401 { "error": "MISSING_SERVICE_KEY" } if the header is absent.
 * Returns 403 { "error": "INVALID_SERVICE_KEY" } if the token does not match.
 */
export async function requireServiceKey(request: Request): Promise<Response | null> {
  const authHeader = request.headers.get("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    fireAndForget(
      logSecurityEvent({
        ...getActorContext(null),
        ...getRequestContext(request),
        actionCode: "SERVICE_KEY_MISSING",
        outcome: "DENIED",
        entityType: "Auth",
      }),
    );
    return new Response(
      JSON.stringify({ error: "MISSING_SERVICE_KEY" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  const token = authHeader.slice(7);
  const envKey = process.env.EDUAI_API_KEY;

  if (!envKey) {
    fireAndForget(
      logSecurityEvent({
        ...getActorContext(null),
        ...getRequestContext(request),
        actionCode: "SERVICE_KEY_INVALID",
        outcome: "DENIED",
        entityType: "Auth",
      }),
    );
    return new Response(
      JSON.stringify({ error: "INVALID_SERVICE_KEY" }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }

  const tokenHash = createHash("sha256").update(token).digest();
  const keyHash   = createHash("sha256").update(envKey).digest();

  if (!timingSafeEqual(tokenHash, keyHash)) {
    fireAndForget(
      logSecurityEvent({
        ...getActorContext(null),
        ...getRequestContext(request),
        actionCode: "SERVICE_KEY_INVALID",
        outcome: "DENIED",
        entityType: "Auth",
      }),
    );
    return new Response(
      JSON.stringify({ error: "INVALID_SERVICE_KEY" }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }

  return null;
}
