/**
 * One-click sign-in as a few non-admin test accounts on the shared dev server
 * (#1900).
 *
 * The local-only demo buttons (`deployment-safety.server.ts`) put the shared
 * seed password into the page, which is fine on a developer's own machine but
 * would hand it to anyone who opens dev's login page, and that password also
 * opens the seeded admin accounts. This path never sends a password to the
 * browser: a button names an account by key, and the server signs in with a
 * password it keeps.
 *
 * Guard rails:
 * - Only the accounts below. There is no admin or unit-admin entry, and the
 *   account's role is re-checked in the database at sign-in.
 * - Off unless `EDUAI_DEV_QUICK_LOGIN=true` and `EDUAI_DEV_QUICK_LOGIN_PASSWORD`
 *   are set, and only when Core's own address (`BETTER_AUTH_URL`) is the dev
 *   host or a loopback address. Production's address is never on that list, so
 *   copying the setting into prod's env does nothing but log a warning.
 */
import prisma from "~/lib/prisma.server";

export const DEV_QUICK_LOGIN_ACCOUNTS = [
  { key: "student", label: "Student", email: "student1@eduai.local" },
  { key: "ta", label: "TA", email: "ta.cs@eduai.local" },
  { key: "instructor", label: "Instructor", email: "instructor.cs@eduai.local" },
] as const;

export type DevQuickLoginKey = (typeof DEV_QUICK_LOGIN_ACCOUNTS)[number]["key"];

/** Hosts where quick login may run: the shared dev server and a developer's machine. */
const ALLOWED_HOSTS = new Set(["dev.eduai.ok.ubc.ca", "localhost", "127.0.0.1", "::1"]);

/** Roles that must never be reachable this way, whatever an account has become. */
const REFUSED_ROLES = new Set(["ADMIN", "UNIT_ADMIN"]);

export type DevQuickLoginEnvironment = {
  EDUAI_DEV_QUICK_LOGIN?: string;
  EDUAI_DEV_QUICK_LOGIN_PASSWORD?: string;
  BETTER_AUTH_URL?: string;
};

function authHost(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    // Userinfo can hide the real host behind an allowed-looking one.
    if (url.username || url.password) return null;
    return url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return null;
  }
}

let warnedMisconfigured = false;

/** The server-side password for quick login, or null when it is not allowed here. */
export function devQuickLoginPassword(
  environment: DevQuickLoginEnvironment = process.env,
): string | null {
  if (environment.EDUAI_DEV_QUICK_LOGIN?.trim().toLowerCase() !== "true") return null;
  const host = authHost(environment.BETTER_AUTH_URL);
  if (!host || !ALLOWED_HOSTS.has(host)) {
    if (!warnedMisconfigured) {
      warnedMisconfigured = true;
      console.warn(
        `[dev-quick-login] EDUAI_DEV_QUICK_LOGIN is set but BETTER_AUTH_URL's host (${host ?? "none"}) is not a dev host; quick login stays off.`,
      );
    }
    return null;
  }
  const password = environment.EDUAI_DEV_QUICK_LOGIN_PASSWORD?.trim();
  return password ? password : null;
}

/** The buttons to show on the login page (keys and labels only), or null. */
export function devQuickLoginOptions(
  environment: DevQuickLoginEnvironment = process.env,
): Array<{ key: DevQuickLoginKey; label: string }> | null {
  if (devQuickLoginPassword(environment) === null) return null;
  return DEV_QUICK_LOGIN_ACCOUNTS.map(({ key, label }) => ({ key, label }));
}

export type DevQuickLoginResolution =
  | { ok: true; email: string; password: string }
  | { ok: false; error: string };

/**
 * The credentials for a quick-login button, after re-checking everything on
 * the server: quick login allowed here, a known key, and an active account that
 * isn't an admin or unit admin.
 */
export async function resolveDevQuickLogin(
  key: string,
  environment: DevQuickLoginEnvironment = process.env,
): Promise<DevQuickLoginResolution> {
  const password = devQuickLoginPassword(environment);
  if (password === null) return { ok: false, error: "Quick login isn't available here." };

  const account = DEV_QUICK_LOGIN_ACCOUNTS.find((entry) => entry.key === key);
  if (!account) return { ok: false, error: "Unknown quick-login account." };

  const user = await prisma.user.findUnique({
    where: { email: account.email },
    select: { role: true, isActive: true },
  });
  if (!user || !user.isActive) {
    return { ok: false, error: `The ${account.label} test account doesn't exist or is inactive.` };
  }
  if (REFUSED_ROLES.has(user.role)) {
    return { ok: false, error: "Quick login is never available for admin accounts." };
  }
  return { ok: true, email: account.email, password };
}

/** Tests only: allow the misconfiguration warning to fire again. */
export function resetDevQuickLoginWarningForTests(): void {
  warnedMisconfigured = false;
}
