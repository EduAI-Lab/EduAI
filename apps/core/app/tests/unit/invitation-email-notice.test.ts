import { describe, expect, it } from "vitest";

import { inviteEmailNotice } from "~/lib/invitations/email-notice";

const LINK = "https://eduai.example/accept-invitation?token=t";

describe("inviteEmailNotice (#1860)", () => {
  it("is an info banner when the email was sent", () => {
    expect(
      inviteEmailNotice("a@ubc.ca", { emailStatus: "SENT", acceptUrl: LINK }, "created"),
    ).toEqual({
      message: "Invitation emailed to a@ubc.ca.",
      link: LINK,
      tone: "info",
    });
    expect(
      inviteEmailNotice("a@ubc.ca", { emailStatus: "SENT", acceptUrl: LINK }, "resent").message,
    ).toBe("Invitation re-sent to a@ubc.ca.");
  });

  it("warns and offers the link when email isn't set up", () => {
    const notice = inviteEmailNotice(
      "a@ubc.ca",
      { emailStatus: "NOT_CONFIGURED", acceptUrl: LINK },
      "created",
    );
    expect(notice.tone).toBe("warning");
    expect(notice.link).toBe(LINK);
    expect(notice.message).toContain("Email isn't set up on this server.");
    expect(notice.message).toContain("send it to them manually");
  });

  it("says the send failed when the relay rejected it", () => {
    const notice = inviteEmailNotice(
      "a@ubc.ca",
      { emailStatus: "FAILED", acceptUrl: LINK },
      "resent",
    );
    expect(notice.tone).toBe("warning");
    expect(notice.message).toContain("The email server didn't accept the message.");
  });

  it("falls back to emailDelivered when the server sends no emailStatus", () => {
    expect(inviteEmailNotice("a@ubc.ca", { emailDelivered: true }, "created").tone).toBe("info");
    expect(inviteEmailNotice("a@ubc.ca", { emailDelivered: false }, "created").tone).toBe(
      "warning",
    );
  });
});
