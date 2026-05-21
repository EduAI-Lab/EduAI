import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { makeProfessor, makeAdmin, truncateAll, seedMinimalCourse, prisma } from '../helpers.js';

describe('Auth routes', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  // ── GET /api/me ───────────────────────────────────────────────────

  describe('GET /api/me', () => {
    it('returns the current user without password field', async () => {
      const prof = makeProfessor();
      await prisma.user.create({
        data: {
          id: prof.id,
          name: prof.name,
          email: prof.email,
          role: 'PROFESSOR',
        },
      });

      const app = await createApp({ mockUser: prof });
      const res = await request(app).get('/api/me');

      expect(res.status).toBe(200);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.id).toBe(prof.id);
      expect(res.body.user.name).toBe(prof.name);
      expect(res.body.user.email).toBe(prof.email);
      expect(res.body.user.role).toBe('PROFESSOR');
      // toPublicUser strips the password field
      expect(res.body.user.password).toBeUndefined();
    });
  });

  // ── Admin isolation middleware ────────────────────────────────────

  describe('Admin isolation', () => {
    let admin;
    let adminApp;

    beforeEach(async () => {
      admin = makeAdmin();
      await prisma.user.create({
        data: {
          id: admin.id,
          name: admin.name,
          email: admin.email,
          role: 'ADMIN',
        },
      });
      adminApp = await createApp({ mockUser: admin });
    });

    it('blocks admin from non-admin endpoints (GET /api/courses)', async () => {
      const res = await request(adminApp).get('/api/courses');

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/admin/i);
    });

    it('allows admin to access admin endpoints (GET /api/admin/users)', async () => {
      const res = await request(adminApp).get('/api/admin/users');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('allows admin to access /api/me (whitelisted path)', async () => {
      const res = await request(adminApp).get('/api/me');

      expect(res.status).toBe(200);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.id).toBe(admin.id);
      expect(res.body.user.role).toBe('ADMIN');
    });
  });
});
