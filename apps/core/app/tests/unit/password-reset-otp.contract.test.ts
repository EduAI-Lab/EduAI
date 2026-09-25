// @vitest-environment node
// #1728 — contract test for the two better-auth internals the OTP reset gate
// reads: the `verification.identifier` the emailOTP plugin files codes under,
// and the `<stored-otp>:<failed attempts>` encoding of `verification.value`.
//
// Neither is part of the plugin's public export surface. If a better-auth bump
// changes either one, `resolvePasswordResetOtpUserId` stops recognizing real
// records and returns null — which silently skips the #339 no-reuse policy
// while better-auth's own verification carries on working, so the reset still
// succeeds and nothing looks broken. The sibling suite mocks that encoding, so
// it cannot catch the drift; this one drives the installed plugin and asserts
// our helpers agree with what it actually wrote.
//
// `better-auth/adapters/memory` is a hard dependency of better-auth at the same
// pinned version, so this adds no dependency.
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { emailOTP } from "better-auth/plugins/email-otp";
import { beforeAll, describe, expect, it } from "vitest";

import {
  hashPasswordResetOtp,
  passwordResetOtpIdentifier,
  PASSWORD_RESET_OTP_ALLOWED_ATTEMPTS,
  PASSWORD_RESET_OTP_EXPIRY_MINUTES,
  resolvePasswordResetOtpUserId,
} from "~/lib/auth/server";
import { PASSWORD_RESET_OTP_LENGTH } from "~/lib/auth/schemas";

const EMAIL = "student@ubc.ca";
const OLD_PASSWORD = "Str0ng!OldPassphrase";
const NEW_PASSWORD = "Str0ng!NewPassphrase";

type MemoryDb = {
  user: { id: string; email: string }[];
  session: unknown[];
  account: unknown[];
  verification: { identifier: string; value: string; expiresAt: Date }[];
};

/**
 * A stand-alone better-auth instance configured exactly as `~/lib/auth/server`
 * configures the plugin, over an in-memory store so the rows it writes can be
 * read back directly. Deliberately not the app's own `auth` singleton — that
 * one needs Prisma, and what is under test here is the plugin's storage
 * format, not our wiring around it.
 */
function buildHarness() {
  const db: MemoryDb = { user: [], session: [], account: [], verification: [] };
  let lastOtp: string | null = null;

  const auth = betterAuth({
    baseURL: "http://localhost:3000",
    secret: "contract-test-secret-contract-test-secret",
    database: memoryAdapter(db as never),
    emailAndPassword: { enabled: true },
    plugins: [
      emailOTP({
        otpLength: PASSWORD_RESET_OTP_LENGTH,
        expiresIn: PASSWORD_RESET_OTP_EXPIRY_MINUTES * 60,
        allowedAttempts: PASSWORD_RESET_OTP_ALLOWED_ATTEMPTS,
        storeOTP: { hash: async (otp) => hashPasswordResetOtp(otp) },
        disableSignUp: true,
        sendVerificationOTP: async ({ otp }) => {
          lastOtp = otp;
        },
      }),
    ],
  });

  return {
    db,
    auth,
    otp: () => lastOtp,
    row: () => db.verification.at(-1) ?? null,
    /** The deps `resolvePasswordResetOtpUserId` takes, backed by the real rows. */
    deps: () => ({
      findOtpRecord: async (identifier: string) =>
        db.verification.filter((row) => row.identifier === identifier).at(-1) ?? null,
      findUserIdByEmail: async (email: string) =>
        db.user.find((u) => u.email === email)?.id ?? null,
    }),
  };
}

/** What `/email-otp/reset-password` answers with when it accepts a code. */
type ResetPasswordResult = { success: boolean };

function resetPassword(
  harness: ReturnType<typeof buildHarness>,
  otp: string,
): Promise<ResetPasswordResult> {
  return harness.auth.api.resetPasswordEmailOTP({
    body: { email: EMAIL, otp, password: NEW_PASSWORD },
  });
}

/** The part of better-auth's thrown `APIError` these tests assert on. */
type BetterAuthApiError = { body?: { code?: string } };

/** The error code `call` rejected with, or `undefined` if it resolved. */
async function rejectionCode(
  call: () => Promise<ResetPasswordResult>,
): Promise<string | undefined> {
  try {
    await call();
  } catch (error) {
    // SAFETY: better-auth throws `APIError`, which carries the plugin's error
    // code on `body.code`; the optional chain below covers anything else that
    // could reach this catch by returning undefined rather than throwing.
    return (error as BetterAuthApiError).body?.code;
  }
  return undefined;
}

describe("emailOTP storage contract (installed better-auth)", () => {
  let harness: ReturnType<typeof buildHarness>;

  beforeAll(async () => {
    harness = buildHarness();
    await harness.auth.api.signUpEmail({
      body: { email: EMAIL, password: OLD_PASSWORD, name: "Student" },
    });
    await harness.auth.api.requestPasswordResetEmailOTP({ body: { email: EMAIL } });
  });

  it("files the code under the identifier `passwordResetOtpIdentifier` builds", () => {
    expect(harness.row()?.identifier).toBe(passwordResetOtpIdentifier(EMAIL));
  });

  it("stores the code as `<storeOTP.hash output>:<attempts>`", () => {
    const value = harness.row()?.value ?? "";
    const otp = harness.otp();

    expect(otp).toMatch(new RegExp(`^\\d{${PASSWORD_RESET_OTP_LENGTH}}$`));
    // The split rule `resolvePasswordResetOtpUserId` applies, spelled out here
    // so a change to either half of the encoding fails this assertion.
    expect(value.slice(0, value.lastIndexOf(":"))).toBe(hashPasswordResetOtp(otp as string));
    expect(value.slice(value.lastIndexOf(":") + 1)).toBe("0");
  });

  it("stores no recoverable copy of the code itself", () => {
    expect(harness.row()?.value).not.toContain(harness.otp() as string);
  });

  it("resolves the user from the row the plugin really wrote", async () => {
    await expect(
      resolvePasswordResetOtpUserId({ email: EMAIL, otp: harness.otp() as string }, harness.deps()),
    ).resolves.toBe(harness.db.user[0]?.id);
  });
});

describe("emailOTP attempt budget (installed better-auth)", () => {
  let harness: ReturnType<typeof buildHarness>;

  beforeAll(async () => {
    harness = buildHarness();
    await harness.auth.api.signUpEmail({
      body: { email: EMAIL, password: OLD_PASSWORD, name: "Student" },
    });
    await harness.auth.api.requestPasswordResetEmailOTP({ body: { email: EMAIL } });
  });

  it("increments the attempts suffix on each wrong guess", async () => {
    for (let guess = 1; guess <= PASSWORD_RESET_OTP_ALLOWED_ATTEMPTS; guess += 1) {
      const code = await rejectionCode(() =>
        resetPassword(harness, "0".repeat(PASSWORD_RESET_OTP_LENGTH)),
      );
      expect(code).toBe("INVALID_OTP");

      const value = harness.row()?.value ?? "";
      expect(value.slice(value.lastIndexOf(":") + 1)).toBe(String(guess));
    }
  });

  it("then refuses even the correct code, and our gate agrees", async () => {
    // Recorded before the call: the plugin consumes the row on rejection.
    const spent = harness.row();
    const otp = harness.otp() as string;

    expect(await rejectionCode(() => resetPassword(harness, otp))).toBe("TOO_MANY_ATTEMPTS");

    // The point of the #1728 attempt check: on that same row the gate must
    // also resolve nobody, so the reuse check cannot answer "password was used
    // recently" for a request better-auth refuses outright.
    await expect(
      resolvePasswordResetOtpUserId(
        { email: EMAIL, otp },
        { ...harness.deps(), findOtpRecord: async () => spent },
      ),
    ).resolves.toBeNull();
  });
});
