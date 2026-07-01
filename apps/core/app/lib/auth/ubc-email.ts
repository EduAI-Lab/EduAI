/**
 * UBC email-domain gate (#567). Every account-creation entry point — public
 * self-registration and admin/unit-admin invitations — must target a UBC
 * address. "UBC" means the domain is exactly `ubc.ca` or any subdomain of it
 * (`student.ubc.ca`, `mail.ubc.ca`, `alumni.ubc.ca`, `cs.ubc.ca`, …), covering
 * both students and non-students. The `=== "ubc.ca" || endsWith(".ubc.ca")`
 * form rejects look-alikes such as `ubc.ca.evil.com` and `notubc.ca`.
 */
export const UBC_EMAIL_MESSAGE =
  "Email must be a UBC address (e.g. you@student.ubc.ca or you@ubc.ca)";

export function isUbcEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  const at = normalized.indexOf("@");
  if (at < 0) return false;
  const domain = normalized.slice(at + 1);
  if (domain.includes("@")) return false; // malformed — multiple @ signs
  return domain === "ubc.ca" || domain.endsWith(".ubc.ca");
}
