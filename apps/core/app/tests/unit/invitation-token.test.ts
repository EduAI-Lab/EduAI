import { describe, it, expect } from "vitest";
import { generateInviteToken, hashToken } from "~/lib/invitations/token.server";

describe("hashToken", () => {
  it("is deterministic", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
  });

  it("produces a 64-char hex sha256 digest", () => {
    expect(hashToken("abc")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("maps distinct tokens to distinct hashes", () => {
    expect(hashToken("abc")).not.toBe(hashToken("abd"));
  });
});

describe("generateInviteToken", () => {
  it("returns a URL-safe token whose hash matches hashToken", () => {
    const { token, tokenHash } = generateInviteToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/); // base64url charset
    expect(tokenHash).toBe(hashToken(token));
  });

  it("returns a fresh token each call", () => {
    expect(generateInviteToken().token).not.toBe(generateInviteToken().token);
  });
});
