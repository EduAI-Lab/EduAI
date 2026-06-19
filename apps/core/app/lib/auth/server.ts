import { betterAuth } from "better-auth";
import { apiKey } from "better-auth/plugins";
import { createAuthMiddleware, APIError } from "better-auth/api";
import { prismaAdapter } from "better-auth/adapters/prisma";
import prisma from "../prisma.server";
import { getPolicy, logPolicyDenial } from "../policy.server";

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
  plugins: [
    apiKey({
      apiKeyHeaders: ["x-api-key"],
    }),
  ],
  hooks: {
    // §6a: single chokepoint for the public-registration toggle. Both sign-up
    // entry points (the register.tsx action sub-request and a direct POST to
    // the catch-all /api/auth/*) flow through auth.handler(), so enforcing here
    // covers both. Invitation acceptance and OAuth/SSO are different paths and
    // stay open. `policy.server` imports only prisma — no cycle with this file.
    before: createAuthMiddleware(async (ctx) => {
      if (
        ctx.path === "/sign-up/email" &&
        !(await getPolicy("auth.allowPublicRegistration"))
      ) {
        logPolicyDenial({
          policyKey: "auth.allowPublicRegistration",
          userId: null,
          role: null,
          action: "auth.signup",
        });
        throw new APIError("FORBIDDEN", {
          message: "Public registration is disabled",
        });
      }
    }),
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
