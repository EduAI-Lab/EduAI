import { describe, expect, it } from "vitest";

import {
  extractPolicyPassword,
  isStrongPassword,
  PASSWORD_POLICY_MESSAGE,
  SKIP_REUSE_PATHS,
  TOKEN_RESET_PATHS,
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

  it("rejects an 8+ char password missing only lowercase", () => {
    expect(isStrongPassword("ABCDEFG1!")).toBe(false);
  });

  it("rejects an 8+ char password missing only uppercase", () => {
    expect(isStrongPassword("abcdefg1!")).toBe(false);
  });

  it("rejects an 8+ char password missing only a digit", () => {
    expect(isStrongPassword("Abcdefgh!")).toBe(false);
  });

  it("rejects an 8+ char password missing only a symbol", () => {
    expect(isStrongPassword("Abcdefg1")).toBe(false);
  });
});

describe("PASSWORD_POLICY_MESSAGE", () => {
  it("describes both the complex-password and passphrase options", () => {
    expect(PASSWORD_POLICY_MESSAGE).toBe(
      "Password must be at least 8 characters with upper and lower case letters, " +
        "numbers, and symbols — or a passphrase of at least 16 characters.",
    );
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

  it("returns null for an unmapped path even if the body has a property literally named 'undefined'", () => {
    // Guards the early `if (!field) return null;` guard: without it, an unmapped path would
    // fall through to `body?.[undefined]`, which would read this property and leak it.
    expect(extractPolicyPassword("/sign-in/email", { undefined: "leaked-password" })).toBeNull();
  });

  it("returns the newPassword field on set-password", () => {
    expect(extractPolicyPassword("/set-password", { newPassword: "Abcdef1!" })).toBe(
      "Abcdef1!",
    );
  });
});

describe("SKIP_REUSE_PATHS", () => {
  it("includes sign-up (no prior history to check)", () => {
    expect(SKIP_REUSE_PATHS.has("/sign-up/email")).toBe(true);
  });

  it("does not include change-password or reset-password", () => {
    expect(SKIP_REUSE_PATHS.has("/change-password")).toBe(false);
    expect(SKIP_REUSE_PATHS.has("/reset-password")).toBe(false);
  });
});

describe("TOKEN_RESET_PATHS", () => {
  it("includes reset-password (resolves userId from token, not session)", () => {
    expect(TOKEN_RESET_PATHS.has("/reset-password")).toBe(true);
  });

  it("does not include change-password (that uses a session)", () => {
    expect(TOKEN_RESET_PATHS.has("/change-password")).toBe(false);
  });
});
