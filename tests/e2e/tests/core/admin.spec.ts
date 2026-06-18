/**
 * Core admin user-management and invitation flow E2E tests.
 *
 * Covers: ADMIN reads user list, promotes a user via PATCH /api/users/:id,
 * cannot change their own role; invitation happy path (create → validate token
 * → accept → sign in with new role); invitation list visible to ADMIN.
 *
 * Requires E2E_SEED_SECRET to be set on the Core service.
 */
import { test, expect } from '@playwright/test';
import { CORE_URL } from '../../playwright.config';
import {
  createAdmin,
  registerUser,
  promoteUser,
  signIn,
  signOut,
  uniqueEmail,
  DEFAULT_PASSWORD,
} from '../helpers/auth';

// ---------------------------------------------------------------------------
// Admin user list
// ---------------------------------------------------------------------------

test.describe('Core admin user list (GET /api/users)', () => {
  test('ADMIN can retrieve the full user list', async ({ request }) => {
    await createAdmin(request, { prefix: 'ul-admin' });

    const res = await request.get(`${CORE_URL}/api/users`);
    expect(res.status()).toBe(200);

    const users = await res.json();
    expect(Array.isArray(users)).toBe(true);
    expect(users.length).toBeGreaterThan(0);
  });

  test('each user entry includes id, email, role, and isActive', async ({ request }) => {
    await createAdmin(request, { prefix: 'ul-fields-admin' });

    const res = await request.get(`${CORE_URL}/api/users`);
    const users = await res.json();
    const sample = users[0];

    expect(typeof sample.id).toBe('string');
    expect(typeof sample.email).toBe('string');
    expect(typeof sample.role).toBe('string');
    expect(typeof sample.isActive).toBe('boolean');
  });

  test('ADMIN user list includes a newly registered user', async ({ playwright }) => {
    const adminCtx = await playwright.request.newContext();
    const studentCtx = await playwright.request.newContext();

    try {
      await createAdmin(adminCtx, { prefix: 'ul-new-admin' });
      const { email } = await registerUser(studentCtx, { prefix: 'ul-new-student' });

      const res = await adminCtx.get(`${CORE_URL}/api/users`);
      const users = await res.json();
      expect(users.some((u: any) => u.email === email)).toBe(true);
    } finally {
      await adminCtx.dispose();
      await studentCtx.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// Admin user role update (PATCH /api/users/:id)
// ---------------------------------------------------------------------------

test.describe('Core admin user role update (PATCH /api/users/:id)', () => {
  test('ADMIN can promote another user to INSTRUCTOR', async ({ playwright }) => {
    const adminCtx = await playwright.request.newContext();
    const targetCtx = await playwright.request.newContext();

    try {
      await createAdmin(adminCtx, { prefix: 'role-patch-admin' });
      const { email: targetEmail, password: targetPass } = await registerUser(targetCtx, {
        prefix: 'role-patch-target',
      });

      // Find the target user's id
      const usersRes = await adminCtx.get(`${CORE_URL}/api/users`);
      const users = await usersRes.json();
      const target = users.find((u: any) => u.email === targetEmail);
      expect(target).toBeDefined();

      // Promote via PATCH
      const patchRes = await adminCtx.patch(`${CORE_URL}/api/users/${target.id}`, {
        data: { role: 'INSTRUCTOR' },
      });
      expect(patchRes.status()).toBe(200);
      expect((await patchRes.json()).role).toBe('INSTRUCTOR');

      // Target signs out and back in; session should now show INSTRUCTOR
      await signOut(targetCtx);
      await signIn(targetCtx, { email: targetEmail, password: targetPass });
      const meRes = await targetCtx.get(`${CORE_URL}/api/me`);
      expect((await meRes.json()).role).toBe('INSTRUCTOR');
    } finally {
      await adminCtx.dispose();
      await targetCtx.dispose();
    }
  });

  test('ADMIN cannot change their own role (403)', async ({ request }) => {
    await createAdmin(request, { prefix: 'self-role-admin' });

    const meRes = await request.get(`${CORE_URL}/api/me`);
    const { id } = await meRes.json();

    const res = await request.patch(`${CORE_URL}/api/users/${id}`, {
      data: { role: 'STUDENT' },
    });
    expect(res.status()).toBe(403);
  });

  test('ADMIN can deactivate another user', async ({ playwright }) => {
    const adminCtx = await playwright.request.newContext();
    const targetCtx = await playwright.request.newContext();

    try {
      await createAdmin(adminCtx, { prefix: 'deactivate-admin' });
      await registerUser(targetCtx, { prefix: 'deactivate-target' });

      const { id: targetId } = await (await targetCtx.get(`${CORE_URL}/api/me`)).json();

      const patchRes = await adminCtx.patch(`${CORE_URL}/api/users/${targetId}`, {
        data: { isActive: false },
      });
      expect(patchRes.status()).toBe(200);
      expect((await patchRes.json()).isActive).toBe(false);
    } finally {
      await adminCtx.dispose();
      await targetCtx.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// Invitation happy path
// ---------------------------------------------------------------------------

test.describe('Core invitation flow', () => {
  test('ADMIN creates an invitation and invited user can accept it with the correct role', async ({
    playwright,
  }) => {
    const adminCtx = await playwright.request.newContext();
    const inviteeCtx = await playwright.request.newContext();

    try {
      await createAdmin(adminCtx, { prefix: 'inv-admin' });

      const inviteeEmail = uniqueEmail('invitee');

      // ADMIN creates invitation
      const createRes = await adminCtx.post(`${CORE_URL}/api/invitations`, {
        data: { email: inviteeEmail, role: 'INSTRUCTOR' },
      });
      expect(createRes.status()).toBe(201);

      const { invitation, acceptUrl } = await createRes.json();
      expect(invitation.email).toBe(inviteeEmail);
      expect(invitation.role).toBe('INSTRUCTOR');
      expect(typeof acceptUrl).toBe('string');

      // Extract the plain token from the accept URL
      const token = new URL(acceptUrl).searchParams.get('token');
      expect(token).toBeTruthy();

      // Validate the token by loading the accept page (GET renders it with the
      // invitee's email pre-filled and their invited role shown).
      const validateRes = await inviteeCtx.get(
        `${CORE_URL}/auth/accept-invitation?token=${encodeURIComponent(token!)}`,
      );
      expect(validateRes.status()).toBe(200);
      const validatePage = await validateRes.text();
      expect(validatePage).toContain(inviteeEmail);
      expect(validatePage).toContain('Instructor');

      // Accept the invitation — the page action creates the account, signs the
      // user in, and redirects to the dashboard.
      const acceptRes = await inviteeCtx.post(`${CORE_URL}/auth/accept-invitation`, {
        form: {
          token: token!,
          name: 'Invited Instructor',
          password: DEFAULT_PASSWORD,
          confirmPassword: DEFAULT_PASSWORD,
        },
        maxRedirects: 0,
      });
      expect(acceptRes.status()).toBe(302);
      expect(acceptRes.headers()['location']).toBe('/dashboard');

      // Invitee signs in and their session reflects INSTRUCTOR
      await signOut(inviteeCtx);
      await signIn(inviteeCtx, { email: inviteeEmail, password: DEFAULT_PASSWORD });
      const meRes = await inviteeCtx.get(`${CORE_URL}/api/me`);
      expect(meRes.status()).toBe(200);
      expect((await meRes.json()).role).toBe('INSTRUCTOR');
    } finally {
      await adminCtx.dispose();
      await inviteeCtx.dispose();
    }
  });

  test('ADMIN can list all pending invitations', async ({ request }) => {
    await createAdmin(request, { prefix: 'inv-list-admin' });

    // Create one invitation so the list is non-empty
    await request.post(`${CORE_URL}/api/invitations`, {
      data: { email: uniqueEmail('inv-list-target'), role: 'INSTRUCTOR' },
    });

    const listRes = await request.get(`${CORE_URL}/api/invitations`);
    expect(listRes.status()).toBe(200);
    const invitations = await listRes.json();
    expect(Array.isArray(invitations)).toBe(true);
    expect(invitations.length).toBeGreaterThan(0);
    // tokenHash must never be exposed
    expect(invitations[0]).not.toHaveProperty('tokenHash');
  });

  test('using a token twice is rejected after the account is accepted', async ({ playwright }) => {
    const adminCtx = await playwright.request.newContext();
    const inviteeCtx = await playwright.request.newContext();
    const secondCtx = await playwright.request.newContext();

    try {
      await createAdmin(adminCtx, { prefix: 'inv-reuse-admin' });

      const email = uniqueEmail('inv-reuse');
      const createRes = await adminCtx.post(`${CORE_URL}/api/invitations`, {
        data: { email, role: 'INSTRUCTOR' },
      });
      const { acceptUrl } = await createRes.json();
      const token = new URL(acceptUrl).searchParams.get('token')!;

      // First accept succeeds and redirects to the dashboard.
      const firstAccept = await inviteeCtx.post(`${CORE_URL}/auth/accept-invitation`, {
        form: { token, name: 'First Accept', password: DEFAULT_PASSWORD, confirmPassword: DEFAULT_PASSWORD },
        maxRedirects: 0,
      });
      expect(firstAccept.status()).toBe(302);
      expect(firstAccept.headers()['location']).toBe('/dashboard');

      // Second accept with the same token must fail — the account now exists, so
      // the page re-renders with a friendly error instead of redirecting.
      const secondAccept = await secondCtx.post(`${CORE_URL}/auth/accept-invitation`, {
        form: { token, name: 'Second Accept', password: DEFAULT_PASSWORD, confirmPassword: DEFAULT_PASSWORD },
        maxRedirects: 0,
      });
      expect(secondAccept.status()).toBe(200);
      expect(await secondAccept.text()).toMatch(/already exists/i);
    } finally {
      await adminCtx.dispose();
      await inviteeCtx.dispose();
      await secondCtx.dispose();
    }
  });

  test('ADMIN can revoke a pending invitation', async ({ request }) => {
    await createAdmin(request, { prefix: 'inv-revoke-admin' });

    const createRes = await request.post(`${CORE_URL}/api/invitations`, {
      data: { email: uniqueEmail('inv-revoke'), role: 'INSTRUCTOR' },
    });
    const { invitation } = await createRes.json();

    const revokeRes = await request.delete(`${CORE_URL}/api/invitations/${invitation.id}`);
    expect(revokeRes.status()).toBe(200);
    expect((await revokeRes.json()).invitation.status).toBe('REVOKED');
  });
});
