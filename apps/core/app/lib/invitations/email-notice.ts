/**
 * Banner text for the invitations pages after an invite is created or re-sent
 * (#1860). A missed email used to show as a small grey note; now anything but
 * "SENT" is a warning that tells the admin to send the link by hand, and says
 * whether email isn't set up or the send itself failed.
 */

export type InviteEmailStatus = "SENT" | "NOT_CONFIGURED" | "FAILED";

export type InviteNotice = {
  message: string;
  link?: string;
  tone: "info" | "warning";
};

type InviteResponse = {
  emailStatus?: InviteEmailStatus;
  emailDelivered?: boolean;
  acceptUrl?: string;
};

function statusOf(data: InviteResponse): InviteEmailStatus {
  if (data.emailStatus) return data.emailStatus;
  // A server without #1860 only sends the boolean.
  return data.emailDelivered ? "SENT" : "NOT_CONFIGURED";
}

export function inviteEmailNotice(
  email: string,
  data: InviteResponse,
  action: "created" | "resent",
): InviteNotice {
  const status = statusOf(data);
  const link = data.acceptUrl;
  if (status === "SENT") {
    return {
      message:
        action === "created"
          ? `Invitation emailed to ${email}.`
          : `Invitation re-sent to ${email}.`,
      link,
      tone: "info",
    };
  }
  const reason =
    status === "FAILED"
      ? "The email server didn't accept the message."
      : "Email isn't set up on this server.";
  return {
    message: `Email couldn't be sent to ${email}. ${reason} Copy this link and send it to them manually.`,
    link,
    tone: "warning",
  };
}

export const INVITE_NETWORK_ERROR =
  "Couldn't reach the server. Check your connection and try again.";
