import type { ActionFunctionArgs } from "react-router";

import { requireInviter } from "~/lib/auth/guards.server";
import { resendInvitation, revokeInvitation } from "~/lib/invitations/service.server";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * /api/invitations/:id (ADMIN or UNIT_ADMIN):
 *   DELETE — revoke a pending invitation.
 *   POST   — resend it (rotate token, refresh expiry, re-email); returns the
 *            new accept link.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  const gate = await requireInviter(request);
  if (gate.response) return gate.response;

  const id = params.id;
  if (!id) return new Response("Missing invitation ID", { status: 400 });

  if (request.method === "DELETE") {
    const result = await revokeInvitation(id);
    if (!result.ok) return json({ error: result.error }, result.status);
    return json({ invitation: result.invitation });
  }

  if (request.method === "POST") {
    const result = await resendInvitation(id, {
      id: gate.session.user.id,
      name: gate.session.user.name,
      role: gate.session.user.role ?? "",
    });
    if (!result.ok) return json({ error: result.error }, result.status);
    return json({
      invitation: result.invitation,
      acceptUrl: result.acceptUrl,
      emailDelivered: result.emailDelivered,
    });
  }

  return new Response("Method not allowed", { status: 405 });
}
