import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";

import { acceptInvitationSchema } from "~/lib/invitations/schemas";
import { acceptInvitation, getInvitationByToken } from "~/lib/invitations/service.server";
import { fireAndForget, logAuditAction } from "~/lib/logging.server";
import { getActorContext, getRequestContext } from "~/lib/request-context.server";

function json(data: unknown, status = 200, headers?: HeadersInit): Response {
  const h = new Headers(headers);
  h.set("Content-Type", "application/json");
  return new Response(JSON.stringify(data), { status, headers: h });
}

/**
 * GET /api/invitations/accept?token=... — validate a token for the accept
 * page. Public (the token is the credential). Returns the invited email/role
 * so the page can render, or a 4xx with a stable error code.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const token = new URL(request.url).searchParams.get("token");
  if (!token) return json({ error: "MISSING_TOKEN" }, 400);

  const result = await getInvitationByToken(token);
  if (!result.ok) return json({ error: result.error }, result.status);

  const { email, role, name } = result.invitation;
  return json({ email, role, name });
}

/**
 * POST /api/invitations/accept — accept an invitation: set a password, create
 * the account, promote it to the invited role, and log the user in (the
 * response carries the session Set-Cookie headers). Public.
 */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const requestContext = getRequestContext(request);

  const body = await request.json().catch(() => null);
  const parsed = acceptInvitationSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: "Invalid input", details: parsed.error.flatten() }, 400);
  }

  const result = await acceptInvitation(parsed.data, request);
  if (!result.ok) {
    return json({ error: result.error }, result.status);
  }

  const emailDomain = result.user.email.split("@")[1] ?? null;
  fireAndForget(
    logAuditAction({
      ...getActorContext(null),
      ...requestContext,
      actionCode: "INVITATION_ACCEPTED",
      category: "INVITATION",
      entityType: "Invitation",
      entityId: result.user.id,
      entityLabel: emailDomain ?? result.user.role,
      details: { role: result.user.role, emailDomain },
    }),
  );

  return json({ user: result.user }, 201, result.headers);
}
