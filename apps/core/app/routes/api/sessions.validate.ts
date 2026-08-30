import { isIP } from "node:net";
import type { ActionFunctionArgs } from "react-router";

import { isRateLimited, parseEnvInt } from "~/lib/auth/rate-limit.server";
import { hasValidServiceKey, requireServiceKey } from "~/lib/auth/guards.server";
import prisma from "~/lib/prisma.server";
import { fireAndForget, logSecurityEvent } from "~/lib/logging.server";
import { getActorContext, getRequestContext } from "~/lib/request-context.server";
import { getRequestSession } from "~/lib/auth/request-session.server";
import { withErrorResponse } from "~/lib/errors.server";

const PREAUTH_RATE_LIMIT = parseEnvInt(process.env.SESSION_VALIDATE_PREAUTH_RATE_LIMIT, 1_200);

const INVALID_SERVICE_AUTH_AUDIT_LIMIT = 1;

export async function action({ request }: ActionFunctionArgs) {
  return withErrorResponse(
    async () => {
      if (request.method !== "POST") {
        return new Response(JSON.stringify({ error: "Method not allowed" }), {
          status: 405,
          headers: { "Content-Type": "application/json" },
        });
      }

      const requestContext = getRequestContext(request);

      // Verify cheaply before invoking the persistent guard. Invalid callers get
      // one audited denial per trusted direct-client IP per window; once exhausted,
      // return 429 without another audit write or session-store lookup. Valid
      // extensions never enter or consume this invalid-auth bucket.
      if (!hasValidServiceKey(request)) {
        const directIp = requestContext.ipAddress ?? "unknown";
        if (
          isRateLimited(
            `session-validate:invalid-service-auth:${directIp}`,
            INVALID_SERVICE_AUTH_AUDIT_LIMIT,
          )
        ) {
          return new Response(JSON.stringify({ error: "Too Many Requests" }), {
            status: 429,
            headers: { "Content-Type": "application/json" },
          });
        }
        const denial = await requireServiceKey(request);
        return (
          denial ??
          new Response(JSON.stringify({ error: "INVALID_SERVICE_KEY" }), {
            status: 403,
            headers: { "Content-Type": "application/json" },
          })
        );
      }

      // The verified extension identity wins; direct service-authenticated Core
      // callers fall back to the trusted proxy-appended rightmost XFF entry.
      const forwardedClientIp = request.headers.get("x-eduai-client-ip")?.trim() ?? "";
      const ip =
        (isIP(forwardedClientIp) ? forwardedClientIp : null) ??
        requestContext.ipAddress ??
        "unknown";
      const clientRequestContext = { ...requestContext, ipAddress: ip };

      // Reject abusive sources before Better Auth touches its session store. This
      // identity is service-authenticated extension data or trusted-proxy data;
      // it is an admission bound, not the authenticated user identity.
      if (isRateLimited(`session-validate:preauth:${ip}`, PREAUTH_RATE_LIMIT)) {
        fireAndForget(
          logSecurityEvent({
            ...getActorContext(null),
            ...clientRequestContext,
            actionCode: "RATE_LIMIT_EXCEEDED",
            outcome: "DENIED",
            entityType: "Session",
            details: { ip, stage: "preauth" },
          }),
        );
        return new Response(JSON.stringify({ error: "Too Many Requests" }), {
          status: 429,
          headers: { "Content-Type": "application/json" },
        });
      }

      const session = await getRequestSession(request);
      const rateLimitKey = session?.user
        ? `session-validate:user:${session.user.id}`
        : `session-validate:anonymous:${ip}`;

      if (isRateLimited(rateLimitKey)) {
        fireAndForget(
          logSecurityEvent({
            ...getActorContext(null),
            ...clientRequestContext,
            actionCode: "RATE_LIMIT_EXCEEDED",
            outcome: "DENIED",
            entityType: "Session",
            details: { ip },
          }),
        );
        return new Response(JSON.stringify({ error: "Too Many Requests" }), {
          status: 429,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (!session?.user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      const { id, email, name, image, role } = session.user;

      // Better Auth sessions don't reliably hydrate custom array fields, so read
      // authorizedUnits from the DB for UNIT_ADMINs. Extensions (AI Tutor) depend on
      // this to scope a unit admin's courses to their authorized departments.
      let authorizedUnits: string[] = [];
      if (role === "UNIT_ADMIN") {
        const dbUser = await prisma.user.findUnique({
          where: { id },
          select: { authorizedUnits: true },
        });
        authorizedUnits = dbUser?.authorizedUnits ?? [];
      }

      return new Response(
        JSON.stringify({
          user: { id, email, name, image, role: role ?? "STUDENT", authorizedUnits },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    },
    { request },
  );
}
