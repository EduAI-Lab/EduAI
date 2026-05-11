import { betterAuth } from 'better-auth';
import { genericOAuth } from 'better-auth/plugins';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { prisma } from './config/database.js';

const isProd = process.env.NODE_ENV === 'production';
const baseURL = process.env.BETTER_AUTH_URL || 'http://localhost:4000/api/auth';
const cookieDomain = process.env.COOKIE_DOMAIN || 'localhost';
const eduAiDiscoveryUrl =
  process.env.EDUAI_DISCOVERY_URL ||
  'http://localhost:5174/api/auth/.well-known/openid-configuration';
const eduAiClientId = process.env.EDUAI_CLIENT_ID || 'aitutor-local';
const eduAiClientSecret = process.env.EDUAI_CLIENT_SECRET || 'aitutor-local-secret';
const eduAiUserInfoUrl =
  process.env.EDUAI_USERINFO_URL || 'http://localhost:5174/api/auth/oauth2/userinfo';
const authSecret =
  process.env.BETTER_AUTH_SECRET ||
  process.env.JWT_SECRET ||
  (isProd ? undefined : 'aitutor-local-dev-secret-change-me');

if (!authSecret) {
  throw new Error('BETTER_AUTH_SECRET must be configured in production');
}

/**
 * Map an EduAI role claim onto the local `Role` enum.
 *
 * Why: EduAI may add roles or send unrecognized values; defaulting unknowns
 * to `STUDENT` is the safe failure mode (least-privilege). Any new role
 * granted by EduAI must be added here AND to the Prisma `Role` enum,
 * otherwise it silently downgrades to STUDENT.
 */
function normalizeEduAiRole(value) {
  if (value === 'ADMIN') return 'ADMIN';
  if (value === 'PROFESSOR') return 'PROFESSOR';
  if (value === 'TA') return 'TA';
  return 'STUDENT';
}

export const auth = betterAuth({
  secret: authSecret,
  // Base URL of the API server hosting the auth handler
  baseURL,

  // Allow the frontend dev origin to call auth endpoints
  trustedOrigins: ['http://localhost:5173', 'https://aitutor.ok.ubc.ca'],

  // Use Prisma as the database adapter (PostgreSQL in this repo)
  database: prismaAdapter(prisma, {
    provider: 'postgresql',
  }),

  user: {
    additionalFields: {
      role: {
        type: 'string',
        required: false,
        input: false,
        defaultValue: 'STUDENT',
        returned: true,
      },
    },
  },
  emailAndPassword: {
    enabled: false,
  },
  account: {
    accountLinking: {
      trustedProviders: ['eduai'],
      updateUserInfoOnLink: true,
    },
  },

  // Cookie settings for sessions
  cookies: {
    domain: cookieDomain,
    secure: isProd,
    sameSite: 'lax',
  },
  plugins: [
    genericOAuth({
      config: [
        {
          providerId: 'eduai',
          clientId: eduAiClientId,
          clientSecret: eduAiClientSecret,
          discoveryUrl: eduAiDiscoveryUrl,
          scopes: ['openid', 'profile', 'email', 'offline_access'],
          pkce: true,
          requireIssuerValidation: true,
          // Always re-fetch userinfo from EduAI rather than relying on the
          // ID token claims. EduAI mutates roles server-side and we want the
          // freshest value at link/update time.
          overrideUserInfo: true,
          getUserInfo: async (tokens) => {
            const response = await fetch(eduAiUserInfoUrl, {
              headers: {
                Authorization: `Bearer ${tokens.accessToken}`,
              },
            });

            if (!response.ok) {
              throw new Error(`Failed to fetch EduAI user info: ${response.status}`);
            }

            const profile = await response.json();

            return {
              id: String(profile.sub),
              email: String(profile.email || '').toLowerCase(),
              name: String(profile.name || profile.email || 'EduAI User'),
              image: typeof profile.picture === 'string' ? profile.picture : undefined,
              emailVerified: Boolean(profile.email_verified),
              role: normalizeEduAiRole(profile['https://eduai.app/role']),
            };
          },
        },
      ],
    }),
  ],
});
