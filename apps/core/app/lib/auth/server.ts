import type { JsonObject } from "~/lib/json-value";
import { createHmac, timingSafeEqual } from "node:crypto";
import { betterAuth } from "better-auth";
import { apiKey } from "@better-auth/api-key";
import { emailOTP } from "better-auth/plugins/email-otp";
import { createAuthMiddleware, APIError, getSessionFromCtx } from "better-auth/api";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { z } from "zod";
import prisma from "../prisma.server";
import { getPolicy, logPolicyDenial } from "../policy.server";
import { INTERNAL_INVITE_SIGNUP_HEADER } from "./auth-handler-request";
import { resolveAuthCookieDomain } from "./cookie-domain";
import { isUbcEmail, UBC_EMAIL_MESSAGE } from "./ubc-email";
import {
  extractPolicyPassword,
  isStrongPassword,
  PASSWORD_POLICY_MESSAGE,
  SKIP_REUSE_PATHS,
} from "./password-policy";
import { isPasswordReused, recordPasswordHistory } from "./password-history.server";
import { resolvePasswordReuseUserId } from "./password-reuse-guard.server";
import { invalidatePasswordExpiryCache } from "./password-expiry.server";
import { isActiveAdminUser } from "../api-keys/access.server";
import { MAX_API_KEY_EXPIRATION_DAYS } from "../api-keys/expiration";
import { asJsonObject, asText } from "~/lib/json-value";
import { fireAndForget } from "~/lib/logging.server";
import { isSmtpConfigured, sendEmail } from "../email/mailer.server";
import { buildEmailVerificationEmail } from "../email/templates/email-verification";
import { buildPasswordResetOtpEmail } from "../email/templates/password-reset-otp";
import { PASSWORD_RESET_OTP_LENGTH } from "./schemas";

export const authBaseURL =
  process.env.BETTER_AUTH_URL?.trim() ||
  import.meta.env.BETTER_AUTH_URL?.trim() ||
  "http://localhost:3000";

const cookieDomain = resolveAuthCookieDomain();
const useSecureCookies = authBaseURL.startsWith("https://");

const ADMIN_API_KEY_MANAGEMENT_PATHS = new Set([
  "/api-key/create",
  "/api-key/delete",
  "/api-key/list",
  "/api-key/update",
  "/api-key/get",
]);

const returnedSessionSchema = z.object({
  user: z.object({
    isActive: z.boolean().optional(),
    emailVerified: z.boolean().optional(),
  }),
  session: z.object({ token: z.string().min(1) }).nullish(),
});

// SMTP-less environments (E2E stack, local dev without SMTP) cannot complete
// email verification: fresh sign-ups would stay unverified and be signed out
// by the /get-session guard below. Set BETTER_AUTH_DISABLE_EMAIL_VERIFICATION=1
// to skip the verification requirement and mint new users pre-verified.
// Production must never set this.
const EMAIL_VERIFICATION_DISABLED = process.env.BETTER_AUTH_DISABLE_EMAIL_VERIFICATION === "1";

const PASSWORD_REUSE_MESSAGE =
  "This password was used recently. Please choose a password you have not used before.";

/** #1728: how long an emailed password-reset code stays usable. */
export const PASSWORD_RESET_OTP_EXPIRY_MINUTES = 10;

/** The only two emailOTP endpoints this deployment exposes (#1728). */
const PASSWORD_RESET_OTP_PATHS = new Set([
  "/email-otp/request-password-reset",
  "/email-otp/reset-password",
]);

/** emailOTP endpoints that live outside the `/email-otp/` prefix. */
const OTHER_EMAIL_OTP_PATHS = new Set([
  // Passwordless sign-in.
  "/sign-in/email-otp",
  // Deprecated alias of /email-otp/request-password-reset.
  "/forget-password/email-otp",
]);

/**
 * #1728: the emailOTP plugin is installed for one reason — password reset —
 * but it ships a whole family of endpoints with it: passwordless sign-in,
 * OTP email verification and OTP email change. Those would walk straight past
 * the controls the email+password paths are held to (public-registration gate
 * §6a, the UBC-email rule §567, the deactivated-user guard #971), and
 * `/email-otp/check-verification-otp` is a code-guessing oracle that the reset
 * flow itself does not need. Everything but the two reset endpoints is closed
 * at the boundary instead.
 */
export function isDisabledEmailOtpPath(path: string | undefined): boolean {
  if (!path) return false;
  if (PASSWORD_RESET_OTP_PATHS.has(path)) return false;
  return path.startsWith("/email-otp/") || OTHER_EMAIL_OTP_PATHS.has(path);
}

/** The `verification.identifier` the plugin files forget-password codes under. */
export function passwordResetOtpIdentifier(email: string): string {
  return `forget-password-otp-${email.trim().toLowerCase()}`;
}

/**
 * Keyed digest of a reset code, used both as the plugin's `storeOTP.hash` (so
 * a database leak does not hand out live codes — an unkeyed hash of six digits
 * is a million-entry rainbow table) and by the policy gate below, which has to
 * recognize the code it was given. One function, so the two can never drift.
 */
export function hashPasswordResetOtp(otp: string): string {
  return createHmac("sha256", process.env.BETTER_AUTH_SECRET ?? "")
    .update(otp)
    .digest("hex");
}

function equalsStoredOtpHash(stored: string, candidate: string): boolean {
  const storedBytes = Buffer.from(stored, "utf8");
  const candidateBytes = Buffer.from(candidate, "utf8");
  if (storedBytes.length !== candidateBytes.length) return false;
  return timingSafeEqual(storedBytes, candidateBytes);
}

export type PasswordResetOtpRecord = { value: string; expiresAt: Date };

/**
 * Resolve who a `/email-otp/reset-password` request is for — but only for a
 * caller that actually holds the emailed code (#1728).
 *
 * The reuse check below needs a userId. Resolving it from the submitted email
 * alone would turn this unauthenticated endpoint into a password-history
 * oracle ("was this password one of theirs?") for any address an attacker
 * names. So this mirrors what the token-based `/reset-password` path gets for
 * free from `resolvePasswordReuseUserId`: proof of possession first, identity
 * second. A wrong or expired code resolves to nobody, and better-auth's own
 * handler then rejects the request outright — the password is never set.
 */
export async function resolvePasswordResetOtpUserId(
  input: { email: string; otp: string },
  deps: {
    findOtpRecord: (identifier: string) => Promise<PasswordResetOtpRecord | null>;
    findUserIdByEmail: (email: string) => Promise<string | null>;
    now?: Date;
  },
): Promise<string | null> {
  if (!input.otp) return null;

  const email = input.email.trim().toLowerCase();
  const record = await deps.findOtpRecord(passwordResetOtpIdentifier(email));
  if (!record) return null;
  if (record.expiresAt.getTime() <= (deps.now ?? new Date()).getTime()) return null;

  // The plugin stores `<stored-otp>:<failed attempts>`; the code is everything
  // before the last colon.
  const separator = record.value.lastIndexOf(":");
  const storedOtp = separator === -1 ? record.value : record.value.slice(0, separator);
  if (!equalsStoredOtpHash(storedOtp, hashPasswordResetOtp(input.otp))) return null;

  return deps.findUserIdByEmail(email);
}

export const auth = betterAuth({
  baseURL: authBaseURL,
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: [authBaseURL],
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    requireEmailVerification: !EMAIL_VERIFICATION_DISABLED,
  },
  emailVerification: {
    // All three flags only matter when verification is enforceable; in
    // SMTP-less environments they stay off so better-auth never queues a
    // verification email it cannot deliver.
    sendOnSignUp: !EMAIL_VERIFICATION_DISABLED,
    sendOnSignIn: !EMAIL_VERIFICATION_DISABLED,
    autoSignInAfterVerification: !EMAIL_VERIFICATION_DISABLED,
    sendVerificationEmail: async ({ user, url }, request) => {
      // Invitation acceptance already proves mailbox control and promotes the
      // account to emailVerified in the same flow. The marker is stripped at
      // the public auth boundary, so only the trusted server sub-request can
      // skip this otherwise automatic self-signup email.
      if (request?.headers.has(INTERNAL_INVITE_SIGNUP_HEADER)) return;

      await sendEmail(
        buildEmailVerificationEmail({
          to: user.email,
          verificationUrl: url,
        }),
      );
    },
  },
  plugins: [
    apiKey({
      apiKeyHeaders: ["x-api-key"],
      // Default: enableSessionForAPIKeys is false — x-api-key does not auto-mock
      // a session on /api/* routes. Admin automation uses enforceAdminIfApiKey.
      enableSessionForAPIKeys: false,
      keyExpiration: {
        maxExpiresIn: MAX_API_KEY_EXPIRATION_DAYS,
      },
    }),
    // #1728: password reset by emailed one-time code. Only the two
    // password-reset endpoints of this plugin are reachable — see
    // `isDisabledEmailOtpPath`, enforced in the `before` hook.
    emailOTP({
      otpLength: PASSWORD_RESET_OTP_LENGTH,
      expiresIn: PASSWORD_RESET_OTP_EXPIRY_MINUTES * 60,
      // Codes are short-lived but still credentials: keep a keyed digest, not
      // the code itself, in the `verification` table.
      storeOTP: { hash: async (otp) => hashPasswordResetOtp(otp) },
      // Belt and braces with the path block: even if an OTP sign-in request
      // somehow reached the plugin, it must never mint an account — that is
      // what §6a and §567 guard on /sign-up/email.
      disableSignUp: true,
      sendVerificationOTP: async ({ email, otp, type }) => {
        // Reset is the only flow this deployment enables.
        if (type !== "forget-password") return;

        // Deliberately not awaited. Better Auth answers a reset request
        // identically whether or not the address has an account; awaiting an
        // SMTP round trip only on the "account exists" branch would put that
        // difference back into the response time.
        fireAndForget(
          sendEmail(
            buildPasswordResetOtpEmail({
              to: email,
              otp,
              expiresInMinutes: PASSWORD_RESET_OTP_EXPIRY_MINUTES,
            }),
          ),
        );
      },
    }),
  ],
  hooks: {
    // §6a: single chokepoint for the public-registration toggle. Both public
    // sign-up entry points (the register.tsx action sub-request and a direct
    // POST to the catch-all /api/auth/*) flow through auth.handler(), so
    // enforcing here covers both. Invitation acceptance reuses the same
    // /sign-up/email endpoint but is NOT public registration — it carries an
    // internal marker (stripped from every inbound request at the /api/auth/*
    // boundary, so a browser can't forge it) and stays open regardless of the
    // toggle. OAuth/SSO are different paths and also stay open. `policy.server`
    // imports prisma + the logging facade, neither of which imports this file —
    // no cycle.
    before: createAuthMiddleware(async (ctx) => {
      // #1728: shut the emailOTP endpoints this deployment does not use.
      if (isDisabledEmailOtpPath(ctx.path)) {
        throw new APIError("NOT_FOUND", { message: "Not found" });
      }

      if (ADMIN_API_KEY_MANAGEMENT_PATHS.has(ctx.path)) {
        const session = await getSessionFromCtx(ctx);
        if (!(await isActiveAdminUser(session?.user?.id))) {
          throw new APIError("FORBIDDEN", {
            message: "API key management restricted to admin users",
          });
        }
      }

      if (ctx.path === "/api-key/create") {
        // SAFETY: better-auth types `ctx.body` as `any`; every read below is a
        // single field off a parsed JSON body, checked before it is used.
        const expiresIn = (ctx.body as JsonObject | undefined)?.expiresIn;
        if (expiresIn === undefined || expiresIn === null) {
          throw new APIError("BAD_REQUEST", {
            message: "API keys must have an expiration date",
          });
        }
      }

      // #339: enforce strength policy + no-reuse-of-last-10 on every
      // password-setting path. Runs before Zod schemas (which only guard the
      // app's own forms) so the raw /api/auth/* entry point is also covered.
      const operationId = (ctx as { operationId?: string }).operationId;
      const candidatePassword = extractPolicyPassword(ctx.path, operationId, ctx.body);
      if (candidatePassword !== null) {
        if (!isStrongPassword(candidatePassword)) {
          throw new APIError("BAD_REQUEST", { message: PASSWORD_POLICY_MESSAGE });
        }

        if (!SKIP_REUSE_PATHS.has(ctx.path)) {
          // Resolve the userId: token-based reset reads it from the Verification
          // table; all other paths (change, set) have an active session.
          const token = (ctx.body as JsonObject | undefined)?.token;
          const userId = await resolvePasswordReuseUserId({
            path: ctx.path,
            token: asText(token) ?? undefined,
            getSessionUserId: async () => (await getSessionFromCtx(ctx as any))?.user?.id ?? null,
          });

          // #225 AUTH-09: fail closed when the identity for this password-setting
          // request can't be resolved (e.g. an already-expired reset token) —
          // silently skipping the reuse check here would let a reused password
          // through instead of denying the request outright.
          if (!userId) {
            throw new APIError("UNAUTHORIZED", {
              message: "Unable to verify your identity for this request.",
            });
          }

          // For change-password: verify the current password first so that an
          // incorrect current password takes precedence over the reuse error.
          if (ctx.path === "/change-password") {
            const currentPassword = asText((ctx.body as JsonObject | undefined)?.currentPassword);
            if (currentPassword !== null) {
              const credAccount = await prisma.account.findFirst({
                where: { userId, providerId: "credential" },
                select: { password: true },
              });
              if (credAccount?.password) {
                const currentValid = await ctx.context.password.verify({
                  hash: credAccount.password,
                  password: currentPassword,
                });
                if (!currentValid) {
                  return; // wrong current password — let better-auth's handler surface the error
                }
              }
            }
          }

          const reused = await isPasswordReused({
            userId,
            candidate: candidatePassword,
            verify: ctx.context.password.verify,
          });
          if (reused) {
            throw new APIError("BAD_REQUEST", { message: PASSWORD_REUSE_MESSAGE });
          }
        }
      }

      // #1728: the OTP reset endpoint carries `{email, otp, password}` rather
      // than a reset token, so it is not one of `PASSWORD_SETTING_PATHS` and
      // the block above cannot see it. Hold it to the same #339 controls here
      // rather than widening the shared table, which would hand
      // `resolvePasswordReuseUserId` a path it has no token to work with.
      if (ctx.path === "/email-otp/reset-password") {
        // SAFETY: better-auth types `ctx.body` as `any`; `asJsonObject`
        // re-validates that it is an object and each field below is read
        // through a checked accessor.
        const body = asJsonObject(ctx.body as JsonObject | undefined) ?? {};
        const newPassword = asText(body.password) ?? "";
        if (!isStrongPassword(newPassword)) {
          throw new APIError("BAD_REQUEST", { message: PASSWORD_POLICY_MESSAGE });
        }

        const otpUserId = await resolvePasswordResetOtpUserId(
          { email: asText(body.email) ?? "", otp: asText(body.otp) ?? "" },
          {
            findOtpRecord: (identifier) =>
              prisma.verification.findFirst({
                where: { identifier },
                orderBy: { createdAt: "desc" },
                select: { value: true, expiresAt: true },
              }),
            findUserIdByEmail: async (email) =>
              (await prisma.user.findUnique({ where: { email }, select: { id: true } }))?.id ??
              null,
          },
        );

        // No resolved user means the caller did not present a live code (or
        // the address has no account). Fall through: better-auth's own handler
        // rejects it, so nothing is set — and no answer about this account's
        // password history leaks to someone who never had the code.
        if (otpUserId) {
          const reused = await isPasswordReused({
            userId: otpUserId,
            candidate: newPassword,
            verify: ctx.context.password.verify,
          });
          if (reused) {
            throw new APIError("BAD_REQUEST", { message: PASSWORD_REUSE_MESSAGE });
          }
        }
      }

      // #971: reject credential sign-in for deactivated users. Checked here
      // (before the endpoint's own credential verification) so a deactivated
      // account never gets a session in the first place — the get-session
      // after-hook below only covers sessions that already exist. A dummy
      // password hash keeps the timing profile identical to the "user not
      // found" branch in better-auth's own sign-in handler, so this check
      // can't be used to distinguish "wrong password" from "deactivated" by
      // response latency.
      if (ctx.path === "/sign-in/email") {
        const email = asText(ctx.body?.email) ?? "";
        const password = asText(ctx.body?.password) ?? "";
        const normalizedEmail = email.trim().toLowerCase();
        // Better Auth's email validator rejects surrounding whitespace. Do not
        // let the inactive-user guard change that validation outcome by
        // treating a whitespace-padded address as an existing account.
        if (email && email === email.trim()) {
          const targetUser = await prisma.user.findUnique({
            // Better Auth lowercases email before its credential lookup.
            // Normalize the same way here so case variants cannot bypass the
            // inactive-user gate.
            where: { email: normalizedEmail },
            select: { isActive: true },
          });
          if (targetUser && !targetUser.isActive) {
            await ctx.context.password.hash(password);
            throw new APIError("UNAUTHORIZED", { message: "Invalid email or password" });
          }
        }
      }

      if (ctx.path !== "/sign-up/email") return;
      if (ctx.headers?.has(INTERNAL_INVITE_SIGNUP_HEADER)) return;
      if (!(await getPolicy("auth.allowPublicRegistration"))) {
        logPolicyDenial({
          policyKey: "auth.allowPublicRegistration",
          user: null,
          action: "auth.signup",
        });
        throw new APIError("FORBIDDEN", {
          message: "Public registration is disabled",
        });
      }
      // §567: backend chokepoint for the UBC-only rule on public self-signup.
      // Invitation acceptance returned above (its email was UBC-validated at
      // invite creation), so this only guards public registration. Catches
      // direct POSTs to /sign-up/email that bypass register.tsx's zod check.
      const email = asText(ctx.body?.email) ?? "";
      if (!isUbcEmail(email)) {
        throw new APIError("BAD_REQUEST", { message: UBC_EMAIL_MESSAGE });
      }
      if (process.env.NODE_ENV === "production" && !isSmtpConfigured()) {
        throw new APIError("SERVICE_UNAVAILABLE", {
          message: "Registration is temporarily unavailable. Please try again later.",
          code: "EMAIL_DELIVERY_UNAVAILABLE",
        });
      }
    }),
    // #971: shared session-resolution guard. `/get-session` is the endpoint
    // every `auth.api.getSession()` call in the app resolves to (they all run
    // through this same hook pipeline, not just HTTP requests), so gating
    // here closes the guard for every caller at once instead of patching
    // each route individually. Handles the case where a user is deactivated
    // or an unverified user already holds a session minted before email
    // verification became mandatory: the next request treats them as signed
    // out and deletes the now-orphaned session row so a leaked or cached
    // cookie can't be replayed later.
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/get-session") return;
      const returned = returnedSessionSchema.safeParse(ctx.context.returned);
      if (!returned.success) return;
      const isBlocked =
        returned.data.user.isActive === false || returned.data.user.emailVerified === false;
      if (!isBlocked) return;

      const token = returned.data.session?.token;
      if (token) {
        await prisma.session.deleteMany({ where: { token } }).catch(() => {});
      }
      return null;
    }),
  },
  databaseHooks: {
    account: {
      create: {
        // #339: stamp passwordChangedAt on the same write as the password so
        // there's no race between the credential row and the timestamp.
        before: async (account) => {
          if (account.providerId === "credential" && account.password) {
            return { data: { ...account, passwordChangedAt: new Date() } };
          }
        },
        // #339: record the new hash in password_history after the row exists.
        after: async (account) => {
          if (account.providerId === "credential" && account.password) {
            invalidatePasswordExpiryCache(account.userId);
            await recordPasswordHistory({
              userId: account.userId,
              passwordHash: account.password,
            });
          }
        },
      },
      update: {
        before: async (account) => {
          if (account.password) {
            return { data: { ...account, passwordChangedAt: new Date() } };
          }
        },
        after: async (account) => {
          if (account.providerId === "credential" && account.password) {
            invalidatePasswordExpiryCache(account.userId);
            await recordPasswordHistory({
              userId: account.userId,
              passwordHash: account.password,
            });
          }
        },
      },
    },
    user: {
      create: {
        // SMTP-less environments (E2E stack, local dev without SMTP) cannot
        // receive verification links; mint those accounts pre-verified so
        // their sessions are not reaped by the /get-session guard above.
        before: async (user) => {
          if (!EMAIL_VERIFICATION_DISABLED) return;
          return { data: { ...user, emailVerified: true } };
        },
      },
    },
  },
  user: {
    additionalFields: {
      // input: false — these are only ever set server-side (admin/invitation
      // flows), never accepted from the client on sign-up/update-user.
      role: {
        type: "string",
        defaultValue: "STUDENT",
        required: false,
        input: false,
      },
      isActive: {
        type: "boolean",
        defaultValue: true,
        required: false,
        input: false,
      },
      authorizedUnits: {
        type: "string[]",
        defaultValue: [],
        required: false,
        input: false,
      },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // 1 day
    // Intentionally NO `cookieCache`: serving getSession() from a signed cookie
    // bypasses immediate session invalidation on deactivation (#971) / logout.
  },
  advanced: {
    useSecureCookies,
    // Only enable for a real public suffix (e.g. ".eduai.ok.ubc.ca"). Loopback
    // COOKIE_DOMAIN values are ignored — Domain=localhost plus the host-only
    // expiry on login deletes the session that was just issued.
    crossSubDomainCookies: cookieDomain
      ? { enabled: true, domain: cookieDomain }
      : { enabled: false },
  },
  rateLimit: {
    // Disable in E2E/test environments where many sign-ups happen in quick
    // succession. Set BETTER_AUTH_DISABLE_RATE_LIMIT=1 to turn this off.
    enabled: process.env.BETTER_AUTH_DISABLE_RATE_LIMIT !== "1",
    window: 60,
    max: 100,
  },
});

export type Session = typeof auth.$Infer.Session;
export type User = typeof auth.$Infer.Session.user;
