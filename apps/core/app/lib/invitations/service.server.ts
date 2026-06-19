import type { Invitation } from "@prisma/client";

import prisma from "~/lib/prisma.server";
import { auth, authBaseURL } from "~/lib/auth/server";
import { buildAuthSubRequest } from "~/lib/auth/auth-handler-request";
import { appendAuthSetCookies } from "~/lib/auth/forward-session-cookies";
import { sendEmail } from "~/lib/email/mailer.server";
import { buildInvitationEmail } from "~/lib/email/templates/invitation";
import { generateInviteToken, hashToken } from "~/lib/invitations/token.server";
import type {
  AcceptInvitationInput,
  CreateInvitationInput,
} from "~/lib/invitations/schemas";
import { canInvite } from "~/lib/invitations/schemas";

const DEFAULT_EXPIRY_HOURS = 72;

/** Invitation shape safe to return over the API — never includes `tokenHash`. */
export type PublicInvitation = Omit<Invitation, "tokenHash"> & {
  isExpired: boolean;
};

type Inviter = { id: string; name?: string | null; role: string };

export type CreateInvitationResult =
  | {
      ok: true;
      invitation: PublicInvitation;
      /** One-time accept link (raw token) — only ever returned here. */
      acceptUrl: string;
      emailDelivered: boolean;
    }
  | { ok: false; status: number; error: string };

export type RevokeInvitationResult =
  | { ok: true; invitation: PublicInvitation }
  | { ok: false; status: number; error: string };

export type AcceptInvitationResult =
  | {
      ok: true;
      headers: Headers;
      /** The accepted invitation's id, for accountability logging. */
      invitationId: string;
      user: { id: string; email: string; role: string };
    }
  | { ok: false; status: number; error: string };

function expiryHours(): number {
  const raw = process.env.INVITE_EXPIRY_HOURS;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_EXPIRY_HOURS;
}

function buildAcceptUrl(token: string): string {
  return `${authBaseURL}/auth/accept-invitation?token=${encodeURIComponent(token)}`;
}

function toPublic(invitation: Invitation): PublicInvitation {
  const { tokenHash: _tokenHash, ...rest } = invitation;
  return { ...rest, isExpired: rest.expiresAt.getTime() < Date.now() };
}

/** Send the invitation email; never throws (a delivery failure is logged). */
async function emailInvite(
  invite: Invitation,
  acceptUrl: string,
  inviterName?: string | null,
): Promise<boolean> {
  try {
    const message = buildInvitationEmail({
      to: invite.email,
      acceptUrl,
      role: invite.role,
      inviterName,
      expiresAt: invite.expiresAt,
    });
    return (await sendEmail(message)).delivered;
  } catch (error) {
    console.error("[invitations] failed to send invitation email", error);
    return false;
  }
}

/**
 * Create an invitation for a privileged platform role and email the accept
 * link. Re-inviting an email supersedes any prior PENDING invite (its token
 * stops working). Returns the one-time accept URL so the caller can offer a
 * "copy link" affordance and so the flow still works when email is unconfigured.
 */
export async function createInvitation(
  input: CreateInvitationInput,
  invitedBy: Inviter,
): Promise<CreateInvitationResult> {
  const email = input.email.toLowerCase().trim();

  // Enforce role-gated invitations: check if inviter can invite this role
  if (!canInvite(invitedBy.role, input.role)) {
    return { ok: false, status: 403, error: "FORBIDDEN_ROLE" };
  }

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    return { ok: false, status: 409, error: "USER_EXISTS" };
  }

  // Supersede any outstanding invite for this email so only one link is live.
  await prisma.invitation.updateMany({
    where: { email, status: "PENDING" },
    data: { status: "REVOKED" },
  });

  const { token, tokenHash } = generateInviteToken();
  const expiresAt = new Date(Date.now() + expiryHours() * 60 * 60 * 1000);

  const invitation = await prisma.invitation.create({
    data: {
      email,
      name: input.name ?? null,
      role: input.role,
      authorizedUnits: input.role === "UNIT_ADMIN" ? (input.authorizedUnits ?? []) : [],
      tokenHash,
      invitedById: invitedBy.id,
      expiresAt,
    },
  });

  const acceptUrl = buildAcceptUrl(token);
  const emailDelivered = await emailInvite(invitation, acceptUrl, invitedBy.name);

  return { ok: true, invitation: toPublic(invitation), acceptUrl, emailDelivered };
}

export type ResendInvitationResult =
  | {
      ok: true;
      invitation: PublicInvitation;
      acceptUrl: string;
      emailDelivered: boolean;
    }
  | { ok: false; status: number; error: string };

/**
 * Re-issue a PENDING invitation: rotate the token (the old link stops working),
 * refresh the expiry, and re-send the email. Returns the new accept link so the
 * admin can copy it directly (useful when email is console-only).
 */
export async function resendInvitation(
  id: string,
  invitedBy?: Inviter,
): Promise<ResendInvitationResult> {
  const invitation = await prisma.invitation.findUnique({ where: { id } });
  if (!invitation) return { ok: false, status: 404, error: "NOT_FOUND" };
  if (invitation.status !== "PENDING") {
    return { ok: false, status: 409, error: "NOT_PENDING" };
  }

  const { token, tokenHash } = generateInviteToken();
  const expiresAt = new Date(Date.now() + expiryHours() * 60 * 60 * 1000);
  const updated = await prisma.invitation.update({
    where: { id },
    data: { tokenHash, expiresAt },
  });

  const acceptUrl = buildAcceptUrl(token);
  const emailDelivered = await emailInvite(updated, acceptUrl, invitedBy?.name);

  return { ok: true, invitation: toPublic(updated), acceptUrl, emailDelivered };
}

export async function listInvitations(): Promise<PublicInvitation[]> {
  const invitations = await prisma.invitation.findMany({
    orderBy: { createdAt: "desc" },
  });
  return invitations.map(toPublic);
}

export async function revokeInvitation(id: string): Promise<RevokeInvitationResult> {
  const invitation = await prisma.invitation.findUnique({ where: { id } });
  if (!invitation) {
    return { ok: false, status: 404, error: "NOT_FOUND" };
  }
  if (invitation.status !== "PENDING") {
    return { ok: false, status: 409, error: "NOT_PENDING" };
  }
  const updated = await prisma.invitation.update({
    where: { id },
    data: { status: "REVOKED" },
  });
  return { ok: true, invitation: toPublic(updated) };
}

/** Validate a raw token for the accept page; never reveals the token hash. */
export async function getInvitationByToken(
  token: string,
): Promise<{ ok: true; invitation: PublicInvitation } | { ok: false; status: number; error: string }> {
  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
  });
  if (!invitation) return { ok: false, status: 404, error: "INVALID_TOKEN" };
  if (invitation.status !== "PENDING") {
    return {
      ok: false,
      status: 410,
      error: invitation.status === "REVOKED" ? "INVITATION_REVOKED" : "INVITATION_USED",
    };
  }
  if (invitation.expiresAt.getTime() < Date.now()) {
    return { ok: false, status: 410, error: "INVITATION_EXPIRED" };
  }
  return { ok: true, invitation: toPublic(invitation) };
}

/**
 * Accept an invitation: create a real account (with a password, via Better
 * Auth sign-up so an `Account` row is written), promote it to the invited
 * role, mark the invite accepted, and return the session Set-Cookie headers so
 * the invitee is logged in immediately.
 */
export async function acceptInvitation(
  input: AcceptInvitationInput,
  request: Request,
): Promise<AcceptInvitationResult> {
  const lookup = await getInvitationByToken(input.token);
  if (!lookup.ok) return lookup;
  const invite = lookup.invitation;

  // Race guard: someone may have registered this email since the invite was sent.
  const existingUser = await prisma.user.findUnique({ where: { email: invite.email } });
  if (existingUser) {
    return { ok: false, status: 409, error: "USER_EXISTS" };
  }

  // Create the credential account + session through Better Auth.
  const authRequest = buildAuthSubRequest("/api/auth/sign-up/email", request, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: input.name,
      email: invite.email,
      password: input.password,
    }),
  });

  const response = await auth.handler(authRequest);
  if (!response.ok) {
    const detail = (await response.json().catch(() => ({}))) as {
      message?: string;
      code?: string;
    };
    return {
      ok: false,
      status: response.status === 422 ? 409 : response.status,
      error: detail.code || detail.message || "SIGNUP_FAILED",
    };
  }

  // Sign-up just created the user; fetch it by its unique email to get the id.
  const created = await prisma.user.findUnique({ where: { email: invite.email } });
  if (!created) {
    return { ok: false, status: 500, error: "ACCOUNT_NOT_CREATED" };
  }

  // Promote the account and consume the invite. If this fails after sign-up
  // succeeded, roll the new user back (account/sessions cascade) so the invite
  // stays usable — otherwise a retry would dead-end on USER_EXISTS as STUDENT.
  let updatedUser: { id: string; email: string; role: string };
  try {
    updatedUser = await prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: created.id },
        data: {
          role: invite.role,
          authorizedUnits: invite.authorizedUnits,
          emailVerified: true,
        },
        select: { id: true, email: true, role: true },
      });
      await tx.invitation.update({
        where: { id: invite.id },
        data: {
          status: "ACCEPTED",
          acceptedAt: new Date(),
          acceptedUserId: user.id,
        },
      });
      return user;
    });
  } catch (error) {
    console.error("[invitations] promote failed — rolling back sign-up", error);
    await prisma.user
      .delete({ where: { id: created.id } })
      .catch((cleanupError) =>
        console.error("[invitations] rollback of invited account failed", cleanupError),
      );
    return { ok: false, status: 500, error: "SIGNUP_FAILED" };
  }

  const headers = new Headers();
  appendAuthSetCookies(response, headers);

  return { ok: true, headers, invitationId: invite.id, user: updatedUser };
}
