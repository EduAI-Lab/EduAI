import type { ActionFunctionArgs } from "react-router";

import { auth } from "~/lib/auth/server";
import { isRateLimited } from "~/lib/auth/rate-limit.server";
import prisma from "~/lib/prisma.server";
import { fireAndForget, logSecurityEvent } from "~/lib/logging.server";
import { getActorContext, getRequestContext } from "~/lib/request-context.server";

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

  if (isRateLimited(ip)) {
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

  const session = await auth.api.getSession({ headers: request.headers });

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
    }
  );
}
