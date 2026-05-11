import { createAuthClient } from 'better-auth/client';
import { genericOAuthClient } from 'better-auth/client/plugins';
import { API_BASE } from './api';

export const authClient = createAuthClient({
  baseURL: `${API_BASE}/api/auth`,
  fetchOptions: {
    credentials: 'include',
  },
  plugins: [genericOAuthClient()],
});

/**
 * Initiates the EduAI OAuth flow.
 *
 * We set `disableRedirect: true` so Better Auth returns the provider URL
 * instead of navigating away itself. The reason: when Better Auth performs
 * the navigation internally, any backend error response is silently swallowed
 * by the in-flight redirect. Doing it manually lets us inspect `response`
 * first (and surface a thrown error to the caller for UI display) before
 * sending the user to the provider.
 */
export async function signInWithEduAi() {
  const callbackURL = `${window.location.origin}/`;
  const errorCallbackURL = `${window.location.origin}/?authError=eduai_sign_in_failed`;

  const response = await authClient.signIn.oauth2(
    {
      providerId: 'eduai',
      callbackURL,
      errorCallbackURL,
      disableRedirect: true,
    },
    {
      credentials: 'include',
    },
  );

  const url = response.data?.url;
  if (!url) {
    throw new Error('Could not start EduAI sign-in');
  }

  window.location.assign(url);
}
