import type { RbacUser } from "~/lib/auth/course-access.server";
import { createInvitationSchema, invitableRolesFor } from "~/lib/invitations/schemas";
import {
  createInvitation,
  listInvitations,
  resendInvitation,
  revokeInvitation,
} from "~/lib/invitations/service.server";

type ToolError = { error: string; fields?: Record<string, string> };

export async function listAdminInvitations(actor: RbacUser, limit = 200) {
  if (actor.role !== "ADMIN") {
    return { error: "Forbidden" } satisfies ToolError;
  }
  const invitations = await listInvitations();
  const clamped = invitations.slice(0, Math.min(Math.max(limit, 1), 500));
  return {
    invitations: clamped,
    count: clamped.length,
    total: invitations.length,
    truncated: clamped.length < invitations.length,
  };
}

export async function createAdminInvitation(
  actor: RbacUser,
  input: {
    email: string;
    name?: string;
    role: "ADMIN" | "UNIT_ADMIN" | "INSTRUCTOR" | "STUDENT";
    authorizedUnits?: string[];
  },
) {
  if (actor.role !== "ADMIN") {
    return { error: "Forbidden" } satisfies ToolError;
  }

  const parsed = createInvitationSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    const fields: Record<string, string> = {};
    for (const [key, messages] of Object.entries(fieldErrors)) {
      if (messages?.[0]) fields[key] = messages[0];
    }
    return { error: "VALIDATION_ERROR", fields } satisfies ToolError;
  }

  if (!invitableRolesFor(actor.role).includes(parsed.data.role)) {
    return { error: "FORBIDDEN_ROLE" } satisfies ToolError;
  }

  const created = await createInvitation(parsed.data, {
    id: actor.id,
    name: actor.name,
  });
  if (!created.ok) {
    return { error: created.error } satisfies ToolError;
  }

  return {
    invitation: created.invitation,
    acceptUrl: created.acceptUrl,
    emailDelivered: created.emailDelivered,
  };
}

export async function revokeAdminInvitation(actor: RbacUser, invitationId: string) {
  if (actor.role !== "ADMIN") {
    return { error: "Forbidden" } satisfies ToolError;
  }

  const result = await revokeInvitation(invitationId);
  if (!result.ok) {
    return { error: result.error } satisfies ToolError;
  }
  return { invitation: result.invitation };
}

export async function resendAdminInvitation(actor: RbacUser, invitationId: string) {
  if (actor.role !== "ADMIN") {
    return { error: "Forbidden" } satisfies ToolError;
  }

  const result = await resendInvitation(invitationId, { id: actor.id, name: actor.name });
  if (!result.ok) {
    return { error: result.error } satisfies ToolError;
  }
  return {
    invitation: result.invitation,
    acceptUrl: result.acceptUrl,
    emailDelivered: result.emailDelivered,
  };
}
