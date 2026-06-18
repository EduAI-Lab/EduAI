import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";

import { requireInviter } from "~/lib/auth/guards.server";
import { createInvitationSchema } from "~/lib/invitations/schemas";
import { createInvitation, listInvitations } from "~/lib/invitations/service.server";

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

  const invitations = await listInvitations();
  return json(invitations);
}

/** POST /api/invitations — create + email an invitation (ADMIN or UNIT_ADMIN). */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const gate = await requireInviter(request);
  if (gate.response) return gate.response;

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

  return json(
    {
      invitation: created.invitation,
      acceptUrl: created.acceptUrl,
      emailDelivered: created.emailDelivered,
    },
    201,
  );
}
