import { describe, expect, it } from "vitest";

import { buildEmailVerificationEmail } from "~/lib/email/templates/email-verification";

describe("email verification template", () => {
  it("includes the Better Auth verification link and escapes it in HTML", () => {
    const verificationUrl =
      "https://eduai.example/api/auth/verify-email?token=abc&callbackURL=%2Fonboarding";

    const message = buildEmailVerificationEmail({
      to: "student@ubc.ca",
      verificationUrl,
    });

    expect(message.to).toBe("student@ubc.ca");
    expect(message.text).toContain(verificationUrl);
    expect(message.html).toContain(
      "https://eduai.example/api/auth/verify-email?token=abc&amp;callbackURL=%2Fonboarding",
    );
    expect(message.html).not.toContain("token=abc&callbackURL");
  });
});
