import { describe, expect, it } from "vitest";

import {
  extractPolicyPassword,
  isStrongPassword,
} from "~/lib/auth/password-policy";

describe("isStrongPassword", () => {
  it("rejects passwords shorter than 8 characters", () => {
    expect(isStrongPassword("Ab1!")).toBe(false);
  });

  it("rejects an 8+ char password missing a character class", () => {
    // 8 chars but only lowercase + digit (no uppercase, no symbol)
    expect(isStrongPassword("abcdefg1")).toBe(false);
  });

  it("accepts an 8-char password with upper, lower, digit, and symbol", () => {
    expect(isStrongPassword("Abcdef1!")).toBe(true);
  });

  it("accepts a 16+ char passphrase even without digits or symbols", () => {
    expect(isStrongPassword("correct horse ba")).toBe(true); // 16 chars
  });

  it("rejects a 15-char password that is neither complex nor a passphrase", () => {
    expect(isStrongPassword("abcdefghijklmno")).toBe(false); // 15 lowercase
  });
});

describe("extractPolicyPassword", () => {
  it("returns the password field on sign-up", () => {
    expect(extractPolicyPassword("/sign-up/email", { password: "Abcdef1!" })).toBe(
      "Abcdef1!",
    );
  });

  it("returns the newPassword field on change-password", () => {
    expect(
      extractPolicyPassword("/change-password", { newPassword: "Abcdef1!" }),
    ).toBe("Abcdef1!");
  });

  it("returns the newPassword field on reset-password", () => {
    expect(
      extractPolicyPassword("/reset-password", { newPassword: "Abcdef1!" }),
    ).toBe("Abcdef1!");
  });

  it("returns null for paths that are not password-setting", () => {
    expect(extractPolicyPassword("/sign-in/email", { password: "x" })).toBeNull();
  });

  it("returns null when the expected field is absent or not a string", () => {
    expect(extractPolicyPassword("/sign-up/email", {})).toBeNull();
    expect(extractPolicyPassword("/sign-up/email", { password: 123 })).toBeNull();
    expect(extractPolicyPassword("/sign-up/email", null)).toBeNull();
  });
});
