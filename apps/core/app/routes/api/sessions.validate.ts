import type { ActionFunctionArgs } from "react-router";

import { isRateLimited, parseEnvInt } from "~/lib/auth/rate-limit.server";
import prisma from "~/lib/prisma.server";
import { fireAndForget, logSecurityEvent } from "~/lib/logging.server";
import { getActorContext, getRequestContext } from "~/lib/request-context.server";
import { getRequestSession } from "~/lib/auth/request-session.server";

const PREAUTH_RATE_LIMIT = parseEnvInt(
  process.env.SESSION_VALIDATE_PREAUTH_RATE_LIMIT,
  1_200,
);

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Derive the IP once from the shared request-context helper so the rate-limit
  // key, the logged `ipAddress`, and `details.ip` all agree (the helper takes the
  // last, trusted-proxy-written x-forwarded-for entry).
  const requestContext = getRequestContext(request);
  const ip = requestContext.ipAddress ?? "unknown";

  // Reject abusive sources before Better Auth touches its session store. This
  // IP identity comes only from the trusted proxy-appended rightmost XFF entry;
  // it is an admission bound, not the authenticated caller identity.
  if (isRateLimited(`session-validate:preauth:${ip}`, PREAUTH_RATE_LIMIT)) {
    fireAndForget(
      logSecurityEvent({
        ...getActorContext(null),
        ...requestContext,
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
        ...requestContext,
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
}
