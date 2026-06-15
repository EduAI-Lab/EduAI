import type { APIRequestContext, APIResponse } from '@playwright/test';
import { CORE_URL } from '../../playwright.config';

let _counter = 0;

/** Generate a unique email address for each test invocation. */
export function uniqueEmail(prefix = 'user'): string {
  _counter += 1;
  return `e2e-${prefix}-${_counter}-${Date.now()}@test.local`;
}

export const DEFAULT_PASSWORD = 'E2eTestPass1!';

export interface SignUpResult {
  email: string;
  password: string;
  name: string;
  response: APIResponse;
}

/**
 * Register a new user on Core and return the sign-up response.
 * The Playwright request context receives the session cookie automatically
 * (Better Auth sets autoSignIn=true, so sign-up also starts a session).
 */
export async function signUp(
  request: APIRequestContext,
  opts: { name?: string; email?: string; password?: string } = {},
): Promise<SignUpResult> {
  const email = opts.email ?? uniqueEmail('signup');
  const password = opts.password ?? DEFAULT_PASSWORD;
  const name = opts.name ?? 'E2E Test User';

  const response = await request.post(`${CORE_URL}/api/auth/sign-up/email`, {
    data: { name, email, password },
  });

  return { email, password, name, response };
}

/**
 * Sign in to Core with email/password credentials.
 * The Playwright request context receives the session cookie automatically.
 */
export async function signIn(
  request: APIRequestContext,
  opts: { email: string; password: string },
): Promise<APIResponse> {
  return request.post(`${CORE_URL}/api/auth/sign-in/email`, {
    data: { email: opts.email, password: opts.password },
  });
}

/** Sign out of Core. */
export async function signOut(request: APIRequestContext): Promise<APIResponse> {
  return request.post(`${CORE_URL}/api/auth/sign-out`, { data: {} });
}

/**
 * Extract the raw cookie string from a response's Set-Cookie headers so it
 * can be forwarded as a `Cookie:` header to extension backends.
 *
 * Playwright stores cookies per-domain, so a cookie set for `localhost` is
 * automatically sent to all `localhost:*` origins. This helper is provided
 * for explicit forwarding in cases where that automatic behaviour is not
 * sufficient (e.g. testing a service that does not share the cookie domain).
 */
export function extractSetCookies(response: APIResponse): string {
  return response
    .headersArray()
    .filter((h) => h.name.toLowerCase() === 'set-cookie')
    .map((h) => h.value.split(';')[0])
    .join('; ');
}

/**
 * Sign up and immediately return the email+password so tests can re-sign-in
 * or share credentials across services.
 */
export async function registerUser(
  request: APIRequestContext,
  opts: { name?: string; prefix?: string } = {},
): Promise<{ email: string; password: string; name: string }> {
  const email = uniqueEmail(opts.prefix ?? 'user');
  const password = DEFAULT_PASSWORD;
  const name = opts.name ?? 'E2E User';

  const res = await signUp(request, { email, password, name });
  if (!res.response.ok()) {
    const body = await res.response.json().catch(() => ({}));
    throw new Error(`Sign-up failed ${res.response.status()}: ${JSON.stringify(body)}`);
  }

  return { email, password, name };
}

/**
 * Promote an existing user to a given role via the E2E seed endpoint
 * (POST /api/e2e/promote). Requires E2E_SEED_SECRET to be configured on Core.
 *
 * Does NOT refresh the caller's session — sign out and sign back in after
 * calling this if the current request context needs to carry the new role.
 */
export async function promoteUser(
  request: APIRequestContext,
  email: string,
  role: string,
): Promise<void> {
  const secret = process.env.E2E_SEED_SECRET ?? 'e2e-seed-secret';
  const res = await request.post(`${CORE_URL}/api/e2e/promote`, {
    data: { secret, email, role },
  });
  if (!res.ok()) {
    const body = await res.text();
    throw new Error(`promoteUser(${email} → ${role}) failed ${res.status()}: ${body}`);
  }
}

/**
 * Register a new user, promote them to INSTRUCTOR, and re-authenticate so the
 * request context's session reflects the new role.
 */
export async function createInstructor(
  request: APIRequestContext,
  opts: { name?: string; prefix?: string } = {},
): Promise<{ email: string; password: string; name: string }> {
  const user = await registerUser(request, {
    name: opts.name ?? 'E2E Instructor',
    prefix: opts.prefix ?? 'instructor',
  });
  await promoteUser(request, user.email, 'INSTRUCTOR');
  await signOut(request);
  await signIn(request, { email: user.email, password: user.password });
  return user;
}

/**
 * Register a new user, promote them to ADMIN, and re-authenticate so the
 * request context's session reflects the new role.
 */
export async function createAdmin(
  request: APIRequestContext,
  opts: { name?: string; prefix?: string } = {},
): Promise<{ email: string; password: string; name: string }> {
  const user = await registerUser(request, {
    name: opts.name ?? 'E2E Admin',
    prefix: opts.prefix ?? 'admin',
  });
  await promoteUser(request, user.email, 'ADMIN');
  await signOut(request);
  await signIn(request, { email: user.email, password: user.password });
  return user;
}
