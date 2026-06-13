import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";

import { requireAdmin } from "~/lib/auth/guards.server";
import { createInvitationSchema } from "~/lib/invitations/schemas";
import { createInvitation, listInvitations } from "~/lib/invitations/service.server";
import { fireAndForget, logAuditAction } from "~/lib/logging.server";
import { getActorContext, getRequestContext } from "~/lib/request-context.server";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** GET /api/invitations — list all invitations (ADMIN). */
export async function loader({ request }: LoaderFunctionArgs) {
  const gate = await requireAdmin(request);
  if (gate.response) return gate.response;

  const invitations = await listInvitations();
  return json(invitations);
}

/** POST /api/invitations — create + email an invitation (ADMIN). */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const gate = await requireAdmin(request);
  if (gate.response) return gate.response;

  const requestContext = getRequestContext(request);

  const body = await request.json().catch(() => null);
  const result = createInvitationSchema.safeParse(body);
  if (!result.success) {
    return json({ error: "Invalid input", details: result.error.flatten() }, 400);
  }

  const created = await createInvitation(result.data, {
    id: gate.session.user.id,
    name: gate.session.user.name,
  });
  if (!created.ok) {
    return json({ error: created.error }, created.status);
  }

  const emailDomain = created.invitation.email.split("@")[1] ?? null;
  fireAndForget(
    logAuditAction({
      ...getActorContext(gate.session?.user ?? null),
      ...requestContext,
      actionCode: "INVITATION_CREATED",
      category: "INVITATION",
      entityType: "Invitation",
      entityId: created.invitation.id,
      entityLabel: emailDomain ?? created.invitation.role,
      details: { role: created.invitation.role, emailDomain },
    }),
  );

  return json(
    {
      invitation: created.invitation,
      acceptUrl: created.acceptUrl,
      emailDelivered: created.emailDelivered,
    },
    201,
  );
}
