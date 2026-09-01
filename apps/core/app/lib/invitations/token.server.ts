import { createHash, randomBytes } from "node:crypto";

/**
 * Invitation tokens: the raw token is the credential handed to the invitee
 * (in the email link); only its sha256 hash is persisted. Lookups on accept
 * hash the incoming token and match against `Invitation.tokenHash`, so a DB
 * leak never exposes a usable token.
 */

/** sha256 hex digest of a raw token. Deterministic — used for lookups. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** A freshly minted invite token and its digest: mail the token, store the hash. */
export type InviteToken = { token: string; tokenHash: string };

/** Mint a fresh URL-safe token and its hash. Persist only the hash. */
export function generateInviteToken(): InviteToken {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}
