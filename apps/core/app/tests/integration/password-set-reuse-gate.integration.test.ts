/**
 * PICT adapter (#1185, census docs/PICT_CENSUS.md § S6): per generated row
 * from tests/models/password-set-reuse-gate.cases.json, drives the real
 * `auth` instance (no mocking, real Postgres) so the #339 before-hook in
 * `~/lib/auth/server.ts` actually runs, and asserts the observed outcome
 * against tests/models/password-set-reuse-gate.oracle.ts.
 *
 * "not-blocked" rows are asserted by the ABSENCE of this hook's own error
 * (the strength message or the reuse message) — many of them still fail for
 * an unrelated, out-of-scope reason (no session, bad reset token, wrong
 * current password, an OAuth-only account already having a credential),
 * exactly like the real hook lets those requests fall through to their own
 * downstream handling.
 */
import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import prisma from "~/lib/prisma.server";
import { auth } from "~/lib/auth/server";
import { buildAuthSubRequest } from "~/lib/auth/auth-handler-request";
import { PASSWORD_POLICY_MESSAGE } from "~/lib/auth/password-policy";
import passwordSetReuseGateCases from "../../../../../tests/models/password-set-reuse-gate.cases.json";
import {
  passwordSetReuseGateOracle,
  authPathFor,
  type PasswordSetReuseGateRow,
} from "../../../../../tests/models/password-set-reuse-gate.oracle";

const rows = passwordSetReuseGateCases as PasswordSetReuseGateRow[];

const REUSE_MESSAGE =
  "This password was used recently. Please choose a password you have not used before.";
const WEAK_PASSWORD = "weak";
const STRONG_PASSWORD_PREFIX = "Str0ng!Pass-";

function uniqueStrongPassword(): string {
  return `${STRONG_PASSWORD_PREFIX}${randomUUID().slice(0, 8)}`;
}

const emails: string[] = [];
function uniqueEmail(prefix: string): string {
  const email = `pwd-${prefix}-${randomUUID().slice(0, 8)}@ubc.ca`;
  emails.push(email);
  return email;
}

const verificationIdentifiers: string[] = [];

function cookieHeaderFrom(res: Response): string {
  const setCookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  return setCookies.map((c) => c.split(";")[0]).filter(Boolean).join("; ");
}

async function signUp(email: string, password: string): Promise<{ res: Response; cookie: string }> {
  const base = new Request("http://localhost/auth/register");
  const req = buildAuthSubRequest("/api/auth/sign-up/email", base, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Reuse Gate Test", email, password }),
  });
  const res = await auth.handler(req);
  return { res, cookie: cookieHeaderFrom(res) };
}

async function messageOf(res: Response): Promise<string | undefined> {
  try {
    const body = (await res.clone().json()) as { message?: string; error?: string };
    return body.message ?? body.error;
  } catch {
    return undefined;
  }
}

/** Assert the observed response carries neither of the hook's own error messages. */
async function expectNotBlockedByGate(res: Response) {
  const message = await messageOf(res);
  expect(message).not.toBe(PASSWORD_POLICY_MESSAGE);
  expect(message).not.toBe(REUSE_MESSAGE);
}

async function expectBlockedWeak(res: Response) {
  expect(res.status).toBe(400);
  expect(await messageOf(res)).toBe(PASSWORD_POLICY_MESSAGE);
}

async function expectBlockedReuse(res: Response) {
  expect(res.status).toBe(400);
  expect(await messageOf(res)).toBe(REUSE_MESSAGE);
}

async function runRow(row: PasswordSetReuseGateRow) {
  const expected = passwordSetReuseGateOracle(row);

  if (row.Path === "sign-up") {
    const password = row.Strength === "weak" ? WEAK_PASSWORD : uniqueStrongPassword();
    const { res } = await signUp(uniqueEmail("signup"), password);
    if (expected.outcome === "blocked-weak") return expectBlockedWeak(res);
    return expectNotBlockedByGate(res);
  }

  if (row.Path === "change-password") {
    const originalPassword = uniqueStrongPassword();
    const email = uniqueEmail("change");
    const { cookie } = await signUp(email, originalPassword);

    const newPassword =
      row.Strength === "weak"
        ? WEAK_PASSWORD
        : row.Reuse === "reused"
          ? originalPassword
          : uniqueStrongPassword();

    const currentPassword =
      row.CurrentPassword === "correct"
        ? originalPassword
        : row.CurrentPassword === "incorrect"
          ? "definitely-the-wrong-password"
          : undefined;

    const body: Record<string, unknown> = { newPassword };
    if (currentPassword !== undefined) body.currentPassword = currentPassword;

    const base = new Request("http://localhost/settings");
    const req = buildAuthSubRequest("/api/auth/change-password", base, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(row.Session === "present" ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    });
    const res = await auth.handler(req);

    if (expected.outcome === "blocked-weak") return expectBlockedWeak(res);
    if (expected.outcome === "blocked-reuse") return expectBlockedReuse(res);
    return expectNotBlockedByGate(res);
  }

  if (row.Path === "reset-password") {
    const originalPassword = uniqueStrongPassword();
    const email = uniqueEmail("reset");
    await signUp(email, originalPassword);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });

    const token = randomUUID();
    if (row.ResetToken !== "missing") {
      const identifier = `reset-password:${token}`;
      verificationIdentifiers.push(identifier);
      await prisma.verification.create({
        data: {
          id: identifier,
          identifier,
          value: user.id,
          expiresAt:
            row.ResetToken === "valid"
              ? new Date(Date.now() + 60 * 60_000)
              : new Date(Date.now() - 60_000),
        },
      });
    }

    const newPassword =
      row.Strength === "weak"
        ? WEAK_PASSWORD
        : row.Reuse === "reused"
          ? originalPassword
          : uniqueStrongPassword();

    const base = new Request("http://localhost/reset-password");
    const req = buildAuthSubRequest("/api/auth/reset-password", base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newPassword, token }),
    });
    const res = await auth.handler(req);

    if (expected.outcome === "blocked-weak") return expectBlockedWeak(res);
    if (expected.outcome === "blocked-reuse") return expectBlockedReuse(res);
    return expectNotBlockedByGate(res);
  }

  // row.Path === "set-password" — server-only endpoint (see isKnownDrift):
  // callable only via auth.api.setPassword(), never over HTTP.
  const originalPassword = uniqueStrongPassword();
  const email = uniqueEmail("setpw");
  const { cookie } = await signUp(email, originalPassword);

  const newPassword =
    row.Strength === "weak"
      ? WEAK_PASSWORD
      : row.Reuse === "reused"
        ? originalPassword
        : uniqueStrongPassword();

  const headers = new Headers(row.Session === "present" ? { cookie } : {});
  let res: Response;
  try {
    const result = await auth.api.setPassword({
      body: { newPassword },
      headers,
      asResponse: true,
    });
    res = result as Response;
  } catch (err) {
    const apiErr = err as { status?: number; body?: { message?: string; code?: string } };
    res = new Response(JSON.stringify({ message: apiErr.body?.message ?? apiErr.body?.code }), {
      status: typeof apiErr.status === "number" ? apiErr.status : 400,
    });
  }

  if (expected.outcome === "blocked-weak") return expectBlockedWeak(res);
  if (expected.outcome === "blocked-reuse") return expectBlockedReuse(res);
  return expectNotBlockedByGate(res);
}

afterAll(async () => {
  await prisma.session.deleteMany({ where: { user: { email: { in: emails } } } });
  await prisma.passwordHistory.deleteMany({ where: { user: { email: { in: emails } } } });
  await prisma.account.deleteMany({ where: { user: { email: { in: emails } } } });
  await prisma.verification.deleteMany({ where: { identifier: { in: verificationIdentifiers } } });
  await prisma.user.deleteMany({ where: { email: { in: emails } } });
  await prisma.$disconnect();
});

describe.each(rows.map((row, index) => [index, row] as const))(
  "password-set-reuse-gate PICT row #%i",
  (index, row) => {
    it(
      `${row.Path}/${row.Strength}/${row.ResetToken}/${row.Session}/${row.CurrentPassword}/${row.Reuse} matches oracle`,
      async () => {
        await runRow(row);
      },
    );
  },
);
