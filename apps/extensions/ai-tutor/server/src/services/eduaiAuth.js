/**
 * @file Bridge between Better Auth's account/token store and the EduAI
 *   OAuth provider linkage.
 *
 * Responsibility: Resolve a user's currently-valid EduAI access token via
 *   Better Auth (handling refresh transparently) and translate Better Auth's
 *   error vocabulary into a stable `(message, status)` shape suitable for
 *   route handlers.
 * Callers: Anything that needs to call EduAI on behalf of a user — primarily
 *   `routes/activities.js` (chat/tutoring), course import/sync routes, and
 *   `enrollmentSync.js`.
 * Gotchas:
 *   - `EDUAI_PROVIDER_ID = 'eduai'` is the exact string Better Auth uses to
 *     index the social-OAuth account row; must stay in sync with
 *     `auth.js`'s social provider config.
 *   - Better Auth surfaces several distinct failure modes
 *     (`UNAUTHORIZED`, `ACCOUNT_NOT_FOUND`, `REFRESH_TOKEN_NOT_FOUND`, plus
 *     a generic "Failed to get a valid access token") that all mean the
 *     same thing to our callers — "the user hasn't linked / re-link
 *     required". They collapse into a single 401 with a friendly message.
 *   - Other Better Auth errors retain their numeric status if present,
 *     otherwise default to 502 (we treat the auth backend as upstream).
 * Related: `../auth.js`, `routes/activities.js`, `enrollmentSync.js`.
 */

import { auth } from '../auth.js';

export const EDUAI_PROVIDER_ID = 'eduai';

function createStatusError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

/**
 * Map Better Auth error strings to a clean 401/502. Anything resembling
 * "no linked EduAI account" or "refresh failed" becomes a uniform 401 so
 * the frontend can prompt the user to (re)link without distinguishing
 * between the underlying auth-backend states.
 */
function normalizeAuthApiError(error) {
  const message = error?.message || 'Failed to get a valid EduAI access token';

  if (
    message.includes('UNAUTHORIZED') ||
    message.includes('ACCOUNT_NOT_FOUND') ||
    message.includes('REFRESH_TOKEN_NOT_FOUND') ||
    message.includes('Failed to get a valid access token')
  ) {
    return createStatusError('EduAI account is not linked for this user', 401);
  }

  return createStatusError(message, Number.isInteger(error?.status) ? error.status : 502);
}

/**
 * Fetch a fresh EduAI access token for a logged-in AiTutor user. Better Auth
 * handles refresh internally — we only see a token or an error. The returned
 * string is safe to forward as `Authorization: Bearer <token>` to EduAI.
 *
 * Throws Error w/ `status` set: 401 (caller missing or account not linked),
 * 502 (auth backend returned an unexpectedly empty token).
 */
export async function getEduAiAccessTokenForUser(userId) {
  if (!userId) {
    throw createStatusError('Authentication required', 401);
  }

  try {
    const tokens = await auth.api.getAccessToken({
      body: {
        providerId: EDUAI_PROVIDER_ID,
        userId,
      },
    });

    const accessToken = typeof tokens?.accessToken === 'string' ? tokens.accessToken.trim() : '';

    if (!accessToken) {
      throw createStatusError('EduAI token endpoint returned an invalid access token', 502);
    }

    return accessToken;
  } catch (error) {
    throw normalizeAuthApiError(error);
  }
}
