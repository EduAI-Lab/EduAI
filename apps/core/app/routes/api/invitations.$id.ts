import type { ActionFunctionArgs } from "react-router";

import { requireAdmin } from "~/lib/auth/guards.server";
import { resendInvitation, revokeInvitation } from "~/lib/invitations/service.server";
import { fireAndForget, logAuditAction } from "~/lib/logging.server";
import { getActorContext, getRequestContext } from "~/lib/request-context.server";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * /api/invitations/:id (ADMIN):
 *   DELETE — revoke a pending invitation.
 *   POST   — resend it (rotate token, refresh expiry, re-email); returns the
 *            new accept link.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  const gate = await requireAdmin(request);
  if (gate.response) return gate.response;

  const requestContext = getRequestContext(request);

  const id = params.id;
  if (!id) return new Response("Missing invitation ID", { status: 400 });

  if (request.method === "DELETE") {
    const result = await revokeInvitation(id);
    if (!result.ok) return json({ error: result.error }, result.status);

    const emailDomain = result.invitation.email.split("@")[1] ?? null;
    fireAndForget(
      logAuditAction({
        ...getActorContext(gate.session?.user ?? null),
        ...requestContext,
        actionCode: "INVITATION_REVOKED",
        category: "INVITATION",
        entityType: "Invitation",
        entityId: result.invitation.id,
        entityLabel: emailDomain ?? result.invitation.role,
        details: { role: result.invitation.role, emailDomain },
      }),
    );

    return json({ invitation: result.invitation });
  }

  if (request.method === "POST") {
    const result = await resendInvitation(id, {
      id: gate.session.user.id,
      name: gate.session.user.name,
    });
    if (!result.ok) return json({ error: result.error }, result.status);

    const emailDomain = result.invitation.email.split("@")[1] ?? null;
    fireAndForget(
      logAuditAction({
        ...getActorContext(gate.session?.user ?? null),
        ...requestContext,
        actionCode: "INVITATION_RESENT",
        category: "INVITATION",
        entityType: "Invitation",
        entityId: result.invitation.id,
        entityLabel: emailDomain ?? result.invitation.role,
        details: { role: result.invitation.role, emailDomain },
      }),
    );

    return json({
      invitation: result.invitation,
      acceptUrl: result.acceptUrl,
      emailDelivered: result.emailDelivered,
    });
  }

  return new Response("Method not allowed", { status: 405 });
}
