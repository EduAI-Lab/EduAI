import { betterAuth } from "better-auth";
import { createAuthMiddleware, APIError, getSessionFromCtx } from "better-auth/api";
import { prismaAdapter } from "better-auth/adapters/prisma";
import prisma from "../prisma.server";
import { getPolicy, logPolicyDenial } from "../policy.server";
import { INTERNAL_INVITE_SIGNUP_HEADER } from "./auth-handler-request";
import { isUbcEmail, UBC_EMAIL_MESSAGE } from "./ubc-email";
import {
  extractPolicyPassword,
  isStrongPassword,
  PASSWORD_POLICY_MESSAGE,
  SKIP_REUSE_PATHS,
  TOKEN_RESET_PATHS,
} from "./password-policy";
import {
  isPasswordReused,
  recordPasswordHistory,
} from "./password-history.server";
import { invalidatePasswordExpiryCache } from "./password-expiry.server";

export const authBaseURL =
  process.env.BETTER_AUTH_URL?.trim() ||
  import.meta.env.BETTER_AUTH_URL?.trim() ||
  "http://localhost:3000";

const cookieDomain = process.env.COOKIE_DOMAIN?.trim();
const useSecureCookies = authBaseURL.startsWith("https://");

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
  },
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
      // #339: enforce strength policy + no-reuse-of-last-10 on every
      // password-setting path. Runs before Zod schemas (which only guard the
      // app's own forms) so the raw /api/auth/* entry point is also covered.
      const candidatePassword = extractPolicyPassword(ctx.path, ctx.body);
      if (candidatePassword !== null) {
        if (!isStrongPassword(candidatePassword)) {
          throw new APIError("BAD_REQUEST", { message: PASSWORD_POLICY_MESSAGE });
        }

        if (!SKIP_REUSE_PATHS.has(ctx.path)) {
          // Resolve the userId: token-based reset reads it from the Verification
          // table; all other paths (change, set) have an active session.
          let userId: string | null = null;
          if (TOKEN_RESET_PATHS.has(ctx.path)) {
            const token = (ctx.body as Record<string, unknown>)?.token;
            if (typeof token === "string") {
              const verificationId = `reset-password:${token}`;
              const verification = await prisma.verification.findUnique({
                where: { id: verificationId },
                select: { value: true, expiresAt: true },
              });
              if (verification && verification.expiresAt > new Date()) {
                userId = verification.value;
              }
            }
          } else {
            const session = await getSessionFromCtx(ctx as any);
            userId = session?.user?.id ?? null;
          }

          if (userId) {
            // For change-password: verify the current password first so that an
            // incorrect current password takes precedence over the reuse error.
            if (ctx.path === "/change-password") {
              const currentPassword = (ctx.body as Record<string, unknown>)?.currentPassword;
              if (typeof currentPassword === "string") {
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
              throw new APIError("BAD_REQUEST", {
                message:
                  "This password was used recently. Please choose a password you have not used before.",
              });
            }
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
      const email = typeof ctx.body?.email === "string" ? ctx.body.email : "";
      if (!isUbcEmail(email)) {
        throw new APIError("BAD_REQUEST", { message: UBC_EMAIL_MESSAGE });
      }
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
  },
  user: {
    additionalFields: {
      role: {
        type: "string",
        defaultValue: "STUDENT",
        required: false,
      },
      isActive: {
        type: "boolean",
        defaultValue: true,
        required: false,
      },
      authorizedUnits: {
        type: "string[]",
        defaultValue: [],
        required: false,
      },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // 1 day
    // Serve the session from a short-lived signed cookie so getSession() does not
    // hit Postgres on every call. A single logged-out nav previously ran up to 4
    // serial session lookups (root → dashboard → redirect → root → login); with
    // this they read the cookie instead. Tradeoff: role/isActive/ban changes take
    // up to maxAge seconds to propagate (revalidated against the DB after that).
    cookieCache: { enabled: true, maxAge: 60 },
  },
  advanced: {
    useSecureCookies,
    // Only enable when COOKIE_DOMAIN is set (e.g. ".eduai.ok.ubc.ca" in prod).
    // On dev without it, cross-subdomain derivation can break session cookies.
    crossSubDomainCookies: cookieDomain
      ? { enabled: true, domain: cookieDomain }
      : { enabled: false },
  },
  rateLimit: {
    // Disable in E2E/test environments where many sign-ups happen in quick
    // succession. Set BETTER_AUTH_DISABLE_RATE_LIMIT=1 to turn this off.
    enabled: process.env.BETTER_AUTH_DISABLE_RATE_LIMIT !== '1',
    window: 60,
    max: 100,
  },
});

export type Session = typeof auth.$Infer.Session;
export type User = typeof auth.$Infer.Session.user;
