/**
 * Core registration and session lifecycle E2E tests.
 *
 * Covers: sign-up, sign-in, GET /api/me, session validation, and sign-out
 * against a real Core instance. All users are registered fresh per test to
 * avoid state bleed between parallel-unsafe suites.
 */
import { test, expect } from '@playwright/test';
import { CORE_URL } from '../../playwright.config';
import {
  uniqueEmail,
  DEFAULT_PASSWORD,
  signUp,
  signIn,
  signOut,
} from '../helpers/auth';

// ---------------------------------------------------------------------------
// Sign-up
// ---------------------------------------------------------------------------

test.describe('POST /api/auth/sign-up/email', () => {
  test('creates a STUDENT account and auto-signs-in', async ({ request }) => {
    const email = uniqueEmail('reg');
    const res = await signUp(request, { email, name: 'New Student' });

    expect(res.response.status()).toBe(200);
    const body = await res.response.json();
    expect(body).toHaveProperty('user');
    expect(body.user.email).toBe(email);
    // All self-registered users receive the STUDENT role.
    expect(body.user.role ?? 'STUDENT').toBe('STUDENT');
  });

  test('rejects duplicate email', async ({ request }) => {
    const email = uniqueEmail('dup');
    await signUp(request, { email });

    // Second request from a fresh context (no session cookie needed for sign-up)
    const res2 = await request.post(`${CORE_URL}/api/auth/sign-up/email`, {
      data: { name: 'Dup User', email, password: DEFAULT_PASSWORD },
    });
    // Better Auth returns 400 or 422 depending on the error type
    expect([400, 422]).toContain(res2.status());
  });

  test('rejects a password shorter than 8 characters', async ({ request }) => {
    const res = await signUp(request, {
      email: uniqueEmail('shortpw'),
      password: 'short',
    });
    expect([400, 422]).toContain(res.response.status());
  });

  test('rejects an invalid email format', async ({ request }) => {
    const res = await signUp(request, {
      email: 'not-an-email',
      password: DEFAULT_PASSWORD,
    });
    expect([400, 422]).toContain(res.response.status());
  });
});

// ---------------------------------------------------------------------------
// Sign-in
// ---------------------------------------------------------------------------

test.describe('POST /api/auth/sign-in/email', () => {
  test('returns 200 and user object for valid credentials', async ({ request }) => {
    const email = uniqueEmail('signin');
    await signUp(request, { email, name: 'Sign In User' });

    // Sign out first so the sign-in test starts clean
    await signOut(request);

    const res = await signIn(request, { email, password: DEFAULT_PASSWORD });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('user');
    expect(body.user.email).toBe(email);
  });

  test('returns 401 for wrong password', async ({ request }) => {
    const email = uniqueEmail('badpw');
    await signUp(request, { email });
    await signOut(request);

    const res = await signIn(request, { email, password: 'WrongPassword99!' });
    expect(res.status()).toBe(401);
  });

  test('returns 401 for an email that does not exist', async ({ request }) => {
    const res = await signIn(request, {
      email: uniqueEmail('ghost'),
      password: DEFAULT_PASSWORD,
    });
    expect(res.status()).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET /api/me — own-profile access
// ---------------------------------------------------------------------------

test.describe('GET /api/me', () => {
  test('returns 401 when unauthenticated', async ({ request }) => {
    // Fresh context — no session cookie present
    const res = await request.get(`${CORE_URL}/api/me`);
    expect(res.status()).toBe(401);
  });

  test('returns the authenticated user profile after sign-up', async ({ request }) => {
    const email = uniqueEmail('me');
    const { name } = await signUp(request, { email, name: 'Me User' });

    const res = await request.get(`${CORE_URL}/api/me`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.email).toBe(email);
    expect(body.name).toBe(name);
    expect(body).toHaveProperty('role');
    expect(body).toHaveProperty('id');
    expect(body).toHaveProperty('isActive');
    expect(body).toHaveProperty('createdAt');
  });

  test('returns the user after explicit sign-in', async ({ request }) => {
    const email = uniqueEmail('me-login');
    await signUp(request, { email, name: 'Login Me User' });
    await signOut(request);

    await signIn(request, { email, password: DEFAULT_PASSWORD });
    const res = await request.get(`${CORE_URL}/api/me`);
    expect(res.status()).toBe(200);
    expect((await res.json()).email).toBe(email);
  });

  test('returns 401 after sign-out', async ({ request }) => {
    const email = uniqueEmail('me-out');
    await signUp(request, { email });

    await signOut(request);

    const res = await request.get(`${CORE_URL}/api/me`);
    expect(res.status()).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/me — profile update
// ---------------------------------------------------------------------------

test.describe('PATCH /api/me', () => {
  test('updates name and returns the updated profile', async ({ request }) => {
    const email = uniqueEmail('patch-me');
    await signUp(request, { email, name: 'Original Name' });

    const res = await request.patch(`${CORE_URL}/api/me`, {
      data: { name: 'Updated Name' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('Updated Name');
    expect(body.email).toBe(email);
  });

  test('rejects unknown fields (strips them silently) and preserves role', async ({ request }) => {
    const email = uniqueEmail('patch-rbac');
    await signUp(request, { email, name: 'Safe User' });

    const res = await request.patch(`${CORE_URL}/api/me`, {
      data: { name: 'Still Safe', role: 'ADMIN' },
    });
    // The update succeeds but role change is ignored
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.role).toBe('STUDENT');
  });

  test('returns 401 without authentication', async ({ request }) => {
    const res = await request.patch(`${CORE_URL}/api/me`, {
      data: { name: 'Ghost' },
    });
    expect(res.status()).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /api/sessions/validate
// ---------------------------------------------------------------------------

test.describe('POST /api/sessions/validate', () => {
  test('returns 200 with user when session is valid', async ({ request }) => {
    const email = uniqueEmail('validate');
    await signUp(request, { email, name: 'Validate User' });

    const res = await request.post(`${CORE_URL}/api/sessions/validate`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('user');
    expect(body.user.email).toBe(email);
    expect(body.user).toHaveProperty('role');
    expect(body.user).toHaveProperty('id');
  });

  test('returns 401 without a session cookie', async ({ request }) => {
    const res = await request.post(`${CORE_URL}/api/sessions/validate`);
    expect(res.status()).toBe(401);
  });

  test('returns 4xx for non-POST methods', async ({ request }) => {
    const res = await request.get(`${CORE_URL}/api/sessions/validate`);
    // React Router returns 400 for GET on action-only routes; 405 also accepted
    expect([400, 405]).toContain(res.status());
  });
});

// ---------------------------------------------------------------------------
// Sign-out
// ---------------------------------------------------------------------------

test.describe('POST /api/auth/sign-out', () => {
  test('sign-out invalidates the session', async ({ request }) => {
    const email = uniqueEmail('logout');
    await signUp(request, { email });

    // Confirm we have a valid session before logout
    const beforeRes = await request.get(`${CORE_URL}/api/me`);
    expect(beforeRes.status()).toBe(200);

    await signOut(request);

    // Session should now be gone
    const afterRes = await request.get(`${CORE_URL}/api/me`);
    expect(afterRes.status()).toBe(401);
  });
});
