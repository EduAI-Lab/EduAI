import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";

import { requireInviter } from "~/lib/auth/guards.server";
import { createInvitationSchema, invitableRolesFor } from "~/lib/invitations/schemas";
import { createInvitation, listInvitations } from "~/lib/invitations/service.server";
import { denyByPolicy, getPolicy } from "~/lib/policy.server";
import { fireAndForget, logAuditAction } from "~/lib/logging.server";
import { getActorContext, getRequestContext } from "~/lib/request-context.server";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * GET /api/invitations — list invitations. ADMIN sees all; a UNIT_ADMIN (when
 * `unitAdmins.canInvite` is on) sees only the invitations they sent.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const gate = await requireInviter(request);
  if (gate.response) return gate.response;

  const user = gate.session.user;
  const isAdmin = user.role === "ADMIN";
  if (!isAdmin && !(await getPolicy("unitAdmins.canInvite"))) {
    return denyByPolicy({
      policyKey: "unitAdmins.canInvite",
      user,
      action: "invitation.list",
      request,
    });
  }

  const invitations = await listInvitations(
    isAdmin ? undefined : { invitedById: user.id },
  );
  return json(invitations);
}

/**
 * POST /api/invitations — create + email an invitation. ADMIN may invite
 * admins, unit admins, and instructors; a UNIT_ADMIN (when `unitAdmins.canInvite`
 * is on) may invite instructors and students only.
 */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const gate = await requireInviter(request);
  if (gate.response) return gate.response;

  const user = gate.session.user;
  const isAdmin = user.role === "ADMIN";
  if (!isAdmin && !(await getPolicy("unitAdmins.canInvite"))) {
    return denyByPolicy({
      policyKey: "unitAdmins.canInvite",
      user,
      action: "invitation.create",
      request,
    });
  }

  const requestContext = getRequestContext(request);

  const body = await request.json().catch(() => null);
  const result = createInvitationSchema.safeParse(body);
  if (!result.success) {
    return json({ error: "Invalid input", details: result.error.flatten() }, 400);
  }

  // Restrict which roles this actor may issue an invitation for.
  if (!invitableRolesFor(user.role).includes(result.data.role)) {
    return json({ error: "FORBIDDEN_ROLE" }, 403);
  }

  const created = await createInvitation(result.data, {
    id: user.id,
    name: user.name,
  });
  if (!created.ok) {
    return json({ error: created.error }, created.status);
  }

  fireAndForget(
    logAuditAction({
      ...getActorContext(user),
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
