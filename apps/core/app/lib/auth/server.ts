import { betterAuth } from "better-auth";
import { apiKey } from "@better-auth/api-key";
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
} from "./password-policy";
import {
  isPasswordReused,
  recordPasswordHistory,
} from "./password-history.server";
import { resolvePasswordReuseUserId } from "./password-reuse-guard.server";
import { invalidatePasswordExpiryCache } from "./password-expiry.server";
import { isActiveAdminUser } from "../api-keys/access.server";
import { MAX_API_KEY_EXPIRATION_DAYS } from "../api-keys/expiration";

export const authBaseURL =
  process.env.BETTER_AUTH_URL?.trim() ||
  import.meta.env.BETTER_AUTH_URL?.trim() ||
  "http://localhost:3000";

const cookieDomain = process.env.COOKIE_DOMAIN?.trim();
const useSecureCookies = authBaseURL.startsWith("https://");

const ADMIN_API_KEY_MANAGEMENT_PATHS = new Set([
  "/api-key/create",
  "/api-key/delete",
  "/api-key/list",
  "/api-key/update",
  "/api-key/get",
]);

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
      if (ADMIN_API_KEY_MANAGEMENT_PATHS.has(ctx.path)) {
        const session = await getSessionFromCtx(ctx);
        if (!(await isActiveAdminUser(session?.user?.id))) {
          throw new APIError("FORBIDDEN", {
            message: "API key management restricted to admin users",
          });
        }
      }

      if (ctx.path === "/api-key/create") {
        const expiresIn = (ctx.body as Record<string, unknown> | undefined)?.expiresIn;
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
          const token = (ctx.body as Record<string, unknown>)?.token;
          const userId = await resolvePasswordReuseUserId({
            path: ctx.path,
            token: typeof token === "string" ? token : undefined,
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

      // #971: reject credential sign-in for deactivated users. Checked here
      // (before the endpoint's own credential verification) so a deactivated
      // account never gets a session in the first place — the get-session
      // after-hook below only covers sessions that already exist. A dummy
      // password hash keeps the timing profile identical to the "user not
      // found" branch in better-auth's own sign-in handler, so this check
      // can't be used to distinguish "wrong password" from "deactivated" by
      // response latency.
      if (ctx.path === "/sign-in/email") {
        const email = typeof ctx.body?.email === "string" ? ctx.body.email : "";
        const password = typeof ctx.body?.password === "string" ? ctx.body.password : "";
        if (email) {
          const targetUser = await prisma.user.findUnique({
            where: { email },
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
      const email = typeof ctx.body?.email === "string" ? ctx.body.email : "";
      if (!isUbcEmail(email)) {
        throw new APIError("BAD_REQUEST", { message: UBC_EMAIL_MESSAGE });
      }
    }),
    // #971: shared session-resolution guard. `/get-session` is the endpoint
    // every `auth.api.getSession()` call in the app resolves to (they all run
    // through this same hook pipeline, not just HTTP requests), so gating
    // here closes the guard for every caller at once instead of patching
    // each route individually. Handles the case where a user is deactivated
    // *after* already holding a valid session: the next request treats them
    // as signed out and the now-orphaned session row is deleted so a leaked
    // or cached cookie can't be replayed later.
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/get-session") return;
      const returned = ctx.context.returned as
        | { session?: { token?: string }; user?: { isActive?: boolean } }
        | null
        | undefined;
      if (!returned?.user || returned.user.isActive !== false) return;
      const token = returned.session?.token;
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
