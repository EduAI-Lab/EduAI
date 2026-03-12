import { prismaAdapter } from "better-auth/adapters/prisma";
import { betterAuth } from "better-auth";
import { jwt } from "better-auth/plugins";
import { apiKey } from "@better-auth/api-key";
import { oauthProvider } from "@better-auth/oauth-provider";

import prisma from "../prisma.server";

const SISTER_APP_REFERENCE_ID = "eduai-sister-app-clients";

const authBaseURL =
  process.env.BETTER_AUTH_URL ??
  import.meta.env.BETTER_AUTH_URL ??
  "http://localhost:5173";

const authSecret =
  process.env.BETTER_AUTH_SECRET ??
  import.meta.env.BETTER_AUTH_SECRET ??
  (process.env.NODE_ENV === "production"
    ? undefined
    : "dev-only-better-auth-secret-change-me");

if (!authSecret) {
  throw new Error(
    "BETTER_AUTH_SECRET is required in production for stable Better Auth JWT signing.",
  );
}

const trustedOrigins = Array.from(
  new Set<string>(
    (
      process.env.BETTER_AUTH_TRUSTED_ORIGINS ??
      import.meta.env.BETTER_AUTH_TRUSTED_ORIGINS ??
      "http://localhost:5173,http://localhost:4000,https://eduai.ok.ubc.ca,https://aitutor.ok.ubc.ca"
    )
      .split(",")
      .map((origin: string) => origin.trim())
      .filter((origin: string) => origin.length > 0),
  ),
);

function getOidcClaims(user?: Record<string, unknown> | null) {
  return {
    "https://eduai.app/role":
      typeof user?.role === "string" ? user.role : "STUDENT",
    "https://eduai.app/is_active":
      typeof user?.isActive === "boolean" ? user.isActive : true,
  };
}

export const auth = betterAuth({
  secret: authSecret,
  baseURL: authBaseURL,
  basePath: "/api/auth",
  trustedOrigins,
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
  },
  plugins: [
    jwt({
      disableSettingJwtHeader: true,
      jwt: {
        issuer: authBaseURL,
      },
    }),
    apiKey({
      apiKeyHeaders: ["x-api-key"],
    }),
    oauthProvider({
      loginPage: "/auth/login",
      consentPage: "/auth/consent",
      scopes: ["openid", "profile", "email"],
      grantTypes: ["authorization_code"],
      allowDynamicClientRegistration: false,
      clientReference: ({ user }) =>
        user?.role === "ADMIN" ? SISTER_APP_REFERENCE_ID : undefined,
      advertisedMetadata: {
        claims_supported: [
          "https://eduai.app/role",
          "https://eduai.app/is_active",
        ],
      },
      customIdTokenClaims: ({ user }) => getOidcClaims(user),
      customUserInfoClaims: ({ user }) => getOidcClaims(user),
      customAccessTokenClaims: ({ user }) => getOidcClaims(user),
    }),
  ],
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
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    storeSessionInDatabase: true,
  },
  advanced: {
    crossSubDomainCookies: {
      enabled: false,
    },
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
  },
});

export type Session = typeof auth.$Infer.Session;
export type User = typeof auth.$Infer.Session.user;
