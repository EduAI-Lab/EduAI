import { z } from "zod";
import { auth } from "./server";
import { isActiveAdminUser } from "~/lib/api-keys/access.server";
import { denyByPolicy, getPolicy } from "~/lib/policy.server";
import { fireAndForget, logSecurityEvent } from "~/lib/logging.server";
import type { LogSecurityEventInput } from "~/lib/logging.server";
import { getActorContext, getRequestContext } from "~/lib/request-context.server";
import prisma from "~/lib/prisma.server";
import { hasValidServiceKey } from "./service-key.server";
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
 * Codes the api-key plugin reports for "this key is real, but it has spent its
 * allowance" — as opposed to "this key is not valid". `RATE_LIMITED` is the
 * windowed limit; `USAGE_EXCEEDED` is the per-key `remaining` counter.
 */
const API_KEY_THROTTLE_CODES = new Set(["RATE_LIMITED", "USAGE_EXCEEDED"]);

/** Cap an advisory Retry-After so a misconfigured window cannot emit an absurd one. */
const MAX_RETRY_AFTER_SECONDS = 60 * 60 * 24;

/** The plugin's `tryAgainIn`, in milliseconds, when it is usable as a retry hint. */
const retryHintMsSchema = z.number().finite().positive();

type ApiKeyVerificationError = {
  code?: string | null;
  details?: { tryAgainIn?: unknown } | null;
} | null;

/**
 * Translate a failed `verifyApiKey` into a response that says what happened.
 *
 * #1803: every failure used to collapse into `401 Unauthorized`, so a
 * rate-limited key, a spent key, an expired key and a forged key were
 * indistinguishable — the caller had nothing to retry against and no way to
 * tell a transient denial from a permanent one. Returns null when the failure
 * is a genuine credential problem, leaving the caller's 401 path in place.
 */
function throttleResponseForApiKeyError(error: ApiKeyVerificationError): Response | null {
  const code = error?.code;
  if (!code || !API_KEY_THROTTLE_CODES.has(code)) return null;

  // `tryAgainIn` is milliseconds remaining in the window. It is absent for
  // USAGE_EXCEEDED (a spent key does not refill on a timer) and arrives from a
  // third-party plugin, so it is parsed here at its boundary rather than
  // trusted: a zero, negative or non-numeric value yields no retry hint at all,
  // which is honest, instead of a misleading `Retry-After: 0`.
  const retryAfterMs = retryHintMsSchema.safeParse(error?.details?.tryAgainIn);
  const retryAfter = retryAfterMs.success
    ? Math.min(Math.ceil(retryAfterMs.data / 1000), MAX_RETRY_AFTER_SECONDS)
    : null;

  if (retryAfter === null) {
    return new Response(JSON.stringify({ error: code }), {
      status: 429,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ error: code, retryAfter }), {
    status: 429,
    headers: {
      "Content-Type": "application/json",
      "Retry-After": String(retryAfter),
    },
  });
}

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

    // A throttled key is a real credential that has spent its allowance, not a
    // rejected one. Answer 429 with a Retry-After and audit it under its own
    // action code, so it stops reading as a credential failure in the logs
    // (#1803).
    const throttled = throttleResponseForApiKeyError(
      (verification as { error?: ApiKeyVerificationError })?.error ?? null,
    );
    if (throttled) {
      fireAndForget(
        logSecurityEvent({
          ...getActorContext(cookieSession?.user ?? null),
          ...getRequestContext(request),
          actionCode: "API_KEY_RATE_LIMITED",
          outcome: "DENIED",
          entityType: "Auth",
          entityId: cookieSession?.user?.id ?? null,
          entityLabel: cookieSession?.user?.email ?? null,
        }),
      );
      return { response: throttled, session: null };
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
    // An anonymous denial has no email to record, and the entry must not carry
    // a `details` key at all in that case.
    const event: LogSecurityEventInput = {
      ...getActorContext(user ?? cookieSession?.user ?? null),
      ...getRequestContext(request),
      actionCode: "API_KEY_DENIED",
      outcome: "DENIED",
      entityType: "Auth",
      entityId: user?.id ?? cookieSession?.user?.id ?? null,
      entityLabel: user?.email ?? cookieSession?.user?.email ?? null,
    };
    if (user?.email) event.details = { email: user.email };
    fireAndForget(logSecurityEvent(event));
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

type AdminGate = { response: Response; session: null } | { response: null; session: Session };

/**
 * Resolve an ADMIN session for an admin-only endpoint.
 * Returns `{ response }` (403/forbidden) when the caller is not an active ADMIN,
 * otherwise `{ session }`.
 */
export async function requireAdmin(request: Request): Promise<AdminGate> {
  const resolved = await getRequestSession(request);
  // Re-check `isActive` against the DB, not just the session's cached role
  // (#1571): deactivating an admin must revoke access on their next request,
  // not only after their session expires. Mirrors the x-api-key admin path,
  // which already gates on `isActiveAdminUser`.
  if (
    !resolved?.user ||
    resolved.user.role !== "ADMIN" ||
    !(await isActiveAdminUser(resolved.user.id))
  ) {
    // An anonymous denial has no email to record, and the entry must not carry
    // a `details` key at all in that case.
    const event: LogSecurityEventInput = {
      ...getActorContext(resolved?.user ?? null),
      ...getRequestContext(request),
      actionCode: "ADMIN_ACCESS_DENIED",
      outcome: "DENIED",
      entityType: "Auth",
      entityId: resolved?.user?.id ?? null,
      entityLabel: resolved?.user?.email ?? null,
    };
    if (resolved?.user?.email) event.details = { email: resolved.user.email };
    fireAndForget(logSecurityEvent(event));
    return {
      response: new Response(JSON.stringify({ error: "Forbidden: Admins only" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
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
export async function requireInviter(request: Request, action: string): Promise<AdminGate> {
  const resolved = await getRequestSession(request);
  const role = resolved?.user?.role;

  let inviter = resolved;
  let inviterRole = role;

  const isPrivilegedRole = role === "ADMIN" || role === "UNIT_ADMIN";
  // Re-check `isActive` against the DB, not just the session's cached role
  // (#1571 pattern, same fix as `requireAdmin` below): a deactivated
  // ADMIN/UNIT_ADMIN's still-live session must lose invitation authority
  // (create/list/revoke/resend) on their very next request, not only once
  // that session naturally expires.
  const isActiveInviter =
    isPrivilegedRole && resolved?.user
      ? (
          await prisma.user.findUnique({
            where: { id: resolved.user.id },
            select: { isActive: true },
          })
        )?.isActive === true
      : false;

  if (!resolved?.user || !isPrivilegedRole || !isActiveInviter) {
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
        } as Session;
        inviterRole = "UNIT_ADMIN";
        admittedViaServiceKey = true;
      }
    }

    if (!admittedViaServiceKey) {
      // An anonymous denial has no email to record, and the entry must not
      // carry a `details` key at all in that case.
      const event: LogSecurityEventInput = {
        ...getActorContext(resolved?.user ?? null),
        ...getRequestContext(request),
        actionCode: "INVITATION_ACCESS_DENIED",
        outcome: "DENIED",
        entityType: "Auth",
        entityId: resolved?.user?.id ?? null,
        entityLabel: resolved?.user?.email ?? null,
      };
      if (resolved?.user?.email) event.details = { email: resolved.user.email };
      fireAndForget(logSecurityEvent(event));
      return {
        response: new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        }),
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
    return new Response(JSON.stringify({ error: "MISSING_SERVICE_KEY" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

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
    return new Response(JSON.stringify({ error: "INVALID_SERVICE_KEY" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!hasValidServiceKey(request)) {
    fireAndForget(
      logSecurityEvent({
        ...getActorContext(null),
        ...getRequestContext(request),
        actionCode: "SERVICE_KEY_INVALID",
        outcome: "DENIED",
        entityType: "Auth",
      }),
    );
    return new Response(JSON.stringify({ error: "INVALID_SERVICE_KEY" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  return null;
}

// Defined in service-key.server so trust-elevation callers can import the pure
// predicate without the guard machinery; re-exported here for existing callers.
export { hasValidServiceKey };
