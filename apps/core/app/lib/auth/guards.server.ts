import { createHash, timingSafeEqual } from "node:crypto";
import { auth } from "./server";
import { isActiveAdminUser } from "~/lib/api-keys/access.server";
import { denyByPolicy, getPolicy } from "~/lib/policy.server";
import { fireAndForget, logSecurityEvent } from "~/lib/logging.server";
import { getActorContext, getRequestContext } from "~/lib/request-context.server";
import prisma from "~/lib/prisma.server";
import type { Session } from "./server";
import { getRequestSession } from "./request-session.server";

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

type GuardResult = {
  response: Response | null;
  session: Session | null;
};

/**
 * Enforce: if request includes `x-api-key`, only ADMIN users may proceed.
 * Returns `{ response, session }` so callers can reuse the fetched session.
 *
 * With `enableSessionForAPIKeys: false`, Better Auth will not auto-mock a
 * session from x-api-key; this guard verifies the key and loads the owner.
 */
export async function enforceAdminIfApiKey(request: Request): Promise<GuardResult> {
  const apiKeyHeader = request.headers.get("x-api-key")?.trim();
  if (!apiKeyHeader) {
    return { response: null, session: null };
  }

  const cookieSession = await getRequestSession(request);
  if (cookieSession?.user?.role === "ADMIN" && (await isActiveAdminUser(cookieSession.user.id))) {
    return { response: null, session: cookieSession };
  }

  const verification = await auth.api.verifyApiKey({
    body: { key: apiKeyHeader },
  });

  if (!verification?.valid || !verification.key?.referenceId) {
    if (cookieSession?.user) {
      return { response: null, session: null };
    }
    fireAndForget(
      logSecurityEvent({
        ...getActorContext(cookieSession?.user ?? null),
        ...getRequestContext(request),
        actionCode: "API_KEY_DENIED",
        outcome: "DENIED",
        entityType: "Auth",
        entityId: cookieSession?.user?.id ?? null,
        entityLabel: cookieSession?.user?.email ?? null,
      }),
    );
    return {
      response: new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
      session: null,
    };
  }

  const user = await prisma.user.findUnique({
    where: { id: verification.key.referenceId },
    select: {
      id: true,
      email: true,
      name: true,
      image: true,
      role: true,
      isActive: true,
      emailVerified: true,
      authorizedUnits: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!user || user.role !== "ADMIN" || !user.isActive) {
    fireAndForget(
      logSecurityEvent({
        ...getActorContext(user ?? cookieSession?.user ?? null),
        ...getRequestContext(request),
        actionCode: "API_KEY_DENIED",
        outcome: "DENIED",
        entityType: "Auth",
        entityId: user?.id ?? cookieSession?.user?.id ?? null,
        entityLabel: user?.email ?? cookieSession?.user?.email ?? null,
        ...(user?.email ? { details: { email: user.email } } : {}),
      }),
    );
    return {
      response: new Response(
        JSON.stringify({ error: "Forbidden: x-api-key access restricted to admin users" }),
        {
          status: 403,
          headers: { "Content-Type": "application/json" },
        },
      ),
      session: null,
    };
  }

  const session = {
    user,
    session: {
      id: verification.key.id,
      token: apiKeyHeader,
      userId: user.id,
      createdAt: verification.key.createdAt,
      updatedAt: verification.key.updatedAt,
      expiresAt: verification.key.expiresAt,
    },
  } as Session;

  return { response: null, session };
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
  const resolved = await getRequestSession(request);
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
 * Resolve a session for an invitation endpoint: the actor must be an active
 * ADMIN, or a UNIT_ADMIN with the `unitAdmins.canInvite` policy flag on. The
 * flag is enforced HERE, not by callers, so no invitation endpoint can
 * accidentally skip it — ADMIN is always allowed. `action` tags the
 * policy-denial audit line (e.g. "invitation.create").
 */
export async function requireInviter(
  request: Request,
  action: string,
): Promise<AdminGate> {
  const resolved = await getRequestSession(request);
  const role = resolved?.user?.role;

  let inviter = resolved;
  let inviterRole = role;

  if (!resolved?.user || (role !== "ADMIN" && role !== "UNIT_ADMIN")) {
    let admittedViaServiceKey = false;
    if (!resolved?.user) {
      const serviceKeyError = await requireServiceKey(request);
      if (!serviceKeyError) {
        // AUTH-02 (#225 SECURITY): a service-key caller delegates on behalf
        // of an unvetted downstream actor and must never mint ADMIN or
        // UNIT_ADMIN invitations. Synthesize it as a capped UNIT_ADMIN-tier
        // inviter so it falls through to the same `unitAdmins.canInvite`
        // policy gate below and `invitableRolesFor("UNIT_ADMIN")`'s role cap
        // — not an implicit, policy-bypassing platform ADMIN.
        inviter = {
          user: { id: "service", name: "Service", role: "UNIT_ADMIN" },
        } as unknown as Session;
        inviterRole = "UNIT_ADMIN";
        admittedViaServiceKey = true;
      }
    }

    if (!admittedViaServiceKey) {
      fireAndForget(
        logSecurityEvent({
          ...getActorContext(resolved?.user ?? null),
          ...getRequestContext(request),
          actionCode: "INVITATION_ACCESS_DENIED",
          outcome: "DENIED",
          entityType: "Auth",
          entityId: resolved?.user?.id ?? null,
          entityLabel: resolved?.user?.email ?? null,
          ...(resolved?.user?.email ? { details: { email: resolved.user.email } } : {}),
        }),
      );
      return {
        response: new Response(
          JSON.stringify({ error: "Forbidden" }),
          { status: 403, headers: { "Content-Type": "application/json" } },
        ),
        session: null,
      };
    }
  }

  // A UNIT_ADMIN (real or the capped service-key stand-in above) additionally
  // needs the `unitAdmins.canInvite` flag.
  if (inviterRole !== "ADMIN" && !(await getPolicy("unitAdmins.canInvite"))) {
    return {
      response: denyByPolicy({
        policyKey: "unitAdmins.canInvite",
        user: inviter!.user,
        action,
        request,
      }),
      session: null,
    };
  }

  return { response: null, session: inviter as Session };
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
