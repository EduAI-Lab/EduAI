// @vitest-environment node
// #1728 — password reset by emailed one-time code. Covers the pure email
// template plus the server-side guards that keep the better-auth emailOTP
// plugin's extra endpoints closed and the #339 password policy enforced on
// the OTP reset path (which is not one of `PASSWORD_SETTING_PATHS`).
import { describe, expect, it, vi } from "vitest";

import { buildPasswordResetOtpEmail } from "~/lib/email/templates/password-reset-otp";
import {
  hashPasswordResetOtp,
  isDisabledEmailOtpPath,
  passwordResetOtpIdentifier,
  PASSWORD_RESET_OTP_EXPIRY_MINUTES,
  resolvePasswordResetOtpUserId,
} from "~/lib/auth/server";

describe("password reset OTP email template", () => {
  const message = buildPasswordResetOtpEmail({
    to: "student@ubc.ca",
    otp: "123456",
    expiresInMinutes: 10,
  });

  it("addresses the recipient and names the code in both bodies", () => {
    expect(message.to).toBe("student@ubc.ca");
    expect(message.subject).toContain("password reset");
    expect(message.text).toContain("123456");
    expect(message.html).toContain("123456");
  });

  it("states how long the code is valid for", () => {
    expect(message.text).toContain("10 minutes");
    expect(message.html).toContain("10 minutes");
  });

  it("tells a recipient who did not ask for it to ignore the email", () => {
    expect(message.text.toLowerCase()).toContain("ignore");
    expect(message.html.toLowerCase()).toContain("ignore");
  });

  it("carries no link, so the code is the only thing that can be acted on", () => {
    expect(message.text).not.toContain("http");
    expect(message.html).not.toContain("href=");
  });

  it("escapes the code before interpolating it into HTML", () => {
    const hostile = buildPasswordResetOtpEmail({
      to: "student@ubc.ca",
      otp: "<script>x</script>",
      expiresInMinutes: 10,
    });

    expect(hostile.html).not.toContain("<script>");
    expect(hostile.html).toContain("&lt;script&gt;");
  });
});

describe("isDisabledEmailOtpPath", () => {
  it("keeps the two password-reset endpoints open", () => {
    expect(isDisabledEmailOtpPath("/email-otp/request-password-reset")).toBe(false);
    expect(isDisabledEmailOtpPath("/email-otp/reset-password")).toBe(false);
  });

  it("closes the rest of the emailOTP surface", () => {
    // Passwordless sign-in would sidestep the public-registration gate (§6a),
    // the UBC-email rule (§567) and the deactivated-user guard (#971).
    expect(isDisabledEmailOtpPath("/sign-in/email-otp")).toBe(true);
    expect(isDisabledEmailOtpPath("/email-otp/send-verification-otp")).toBe(true);
    expect(isDisabledEmailOtpPath("/email-otp/check-verification-otp")).toBe(true);
    expect(isDisabledEmailOtpPath("/email-otp/get-verification-otp")).toBe(true);
    expect(isDisabledEmailOtpPath("/email-otp/verify-email")).toBe(true);
    expect(isDisabledEmailOtpPath("/email-otp/request-email-change")).toBe(true);
    expect(isDisabledEmailOtpPath("/email-otp/change-email")).toBe(true);
    // Deprecated alias of request-password-reset — one entry point is enough.
    expect(isDisabledEmailOtpPath("/forget-password/email-otp")).toBe(true);
  });

  it("leaves unrelated auth paths alone", () => {
    expect(isDisabledEmailOtpPath("/sign-in/email")).toBe(false);
    expect(isDisabledEmailOtpPath("/reset-password")).toBe(false);
    expect(isDisabledEmailOtpPath("/get-session")).toBe(false);
    expect(isDisabledEmailOtpPath(undefined)).toBe(false);
  });
});

describe("hashPasswordResetOtp", () => {
  it("never stores the code itself", () => {
    expect(hashPasswordResetOtp("123456")).not.toContain("123456");
  });

  it("is stable for the same code and differs for another", () => {
    expect(hashPasswordResetOtp("123456")).toBe(hashPasswordResetOtp("123456"));
    expect(hashPasswordResetOtp("123456")).not.toBe(hashPasswordResetOtp("123457"));
  });
});

describe("passwordResetOtpIdentifier", () => {
  it("matches the identifier the emailOTP plugin writes", () => {
    expect(passwordResetOtpIdentifier("Student@UBC.ca")).toBe("forget-password-otp-student@ubc.ca");
  });
});

function deps(record: { value: string; expiresAt: Date } | null, userId: string | null = "u1") {
  return {
    findOtpRecord: vi.fn().mockResolvedValue(record),
    findUserIdByEmail: vi.fn().mockResolvedValue(userId),
  };
}

describe("resolvePasswordResetOtpUserId", () => {
  const future = new Date(Date.now() + 60_000);

  it("resolves the user when the submitted code matches the stored one", async () => {
    const d = deps({ value: `${hashPasswordResetOtp("123456")}:0`, expiresAt: future });

    await expect(
      resolvePasswordResetOtpUserId({ email: " Student@UBC.ca ", otp: "123456" }, d),
    ).resolves.toBe("u1");
    expect(d.findOtpRecord).toHaveBeenCalledWith("forget-password-otp-student@ubc.ca");
    expect(d.findUserIdByEmail).toHaveBeenCalledWith("student@ubc.ca");
  });

  it("tolerates the plugin's attempt counter suffix", async () => {
    const d = deps({ value: `${hashPasswordResetOtp("123456")}:2`, expiresAt: future });

    await expect(
      resolvePasswordResetOtpUserId({ email: "student@ubc.ca", otp: "123456" }, d),
    ).resolves.toBe("u1");
  });

  it("refuses to identify anyone from a wrong code", async () => {
    const d = deps({ value: `${hashPasswordResetOtp("123456")}:0`, expiresAt: future });

    await expect(
      resolvePasswordResetOtpUserId({ email: "student@ubc.ca", otp: "999999" }, d),
    ).resolves.toBeNull();
    // Never looked the account up: this is what stops the endpoint from
    // becoming a password-history oracle for anyone without the code.
    expect(d.findUserIdByEmail).not.toHaveBeenCalled();
  });

  it("refuses an expired code", async () => {
    const d = deps({
      value: `${hashPasswordResetOtp("123456")}:0`,
      expiresAt: new Date(Date.now() - 1),
    });

    await expect(
      resolvePasswordResetOtpUserId({ email: "student@ubc.ca", otp: "123456" }, d),
    ).resolves.toBeNull();
    expect(d.findUserIdByEmail).not.toHaveBeenCalled();
  });

  it("refuses when no code was ever issued, or none was submitted", async () => {
    await expect(
      resolvePasswordResetOtpUserId({ email: "student@ubc.ca", otp: "123456" }, deps(null)),
    ).resolves.toBeNull();
    await expect(
      resolvePasswordResetOtpUserId(
        { email: "student@ubc.ca", otp: "" },
        deps({ value: `${hashPasswordResetOtp("")}:0`, expiresAt: future }),
      ),
    ).resolves.toBeNull();
  });

  it("returns null when the address has no account", async () => {
    const d = deps({ value: `${hashPasswordResetOtp("123456")}:0`, expiresAt: future }, null);

    await expect(
      resolvePasswordResetOtpUserId({ email: "student@ubc.ca", otp: "123456" }, d),
    ).resolves.toBeNull();
  });
});

describe("PASSWORD_RESET_OTP_EXPIRY_MINUTES", () => {
  it("is a short, whole number of minutes", () => {
    expect(Number.isInteger(PASSWORD_RESET_OTP_EXPIRY_MINUTES)).toBe(true);
    expect(PASSWORD_RESET_OTP_EXPIRY_MINUTES).toBeGreaterThan(0);
    expect(PASSWORD_RESET_OTP_EXPIRY_MINUTES).toBeLessThanOrEqual(15);
  });
});
