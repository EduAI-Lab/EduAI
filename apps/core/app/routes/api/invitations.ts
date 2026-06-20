import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";

import { requireInviter } from "~/lib/auth/guards.server";
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

/** GET /api/invitations — list all invitations (ADMIN or UNIT_ADMIN). */
export async function loader({ request }: LoaderFunctionArgs) {
  const gate = await requireInviter(request);
  if (gate.response) return gate.response;

  // UNIT_ADMINs only see invitations they created; ADMINs see all.
  const invitations = await listInvitations({
    id: gate.session.user.id,
    name: gate.session.user.name,
    role: gate.session.user.role ?? "",
  });
  return json(invitations);
}

/** POST /api/invitations — create + email an invitation (ADMIN or UNIT_ADMIN). */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const gate = await requireInviter(request);
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
    role: gate.session.user.role ?? "",
  });
  if (!created.ok) {
    return json({ error: created.error }, created.status);
  }

  fireAndForget(
    logAuditAction({
      ...getActorContext(gate.session?.user ?? null),
      ...requestContext,
      actionCode: "INVITATION_CREATED",
      category: "INVITATION",
      entityType: "Invitation",
      entityId: created.invitation.id,
      // The invited email is the subject of the event and is stored for accountability.
      entityLabel: created.invitation.email,
      details: { role: created.invitation.role, email: created.invitation.email },
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
