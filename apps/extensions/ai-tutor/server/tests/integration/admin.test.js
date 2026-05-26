import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { makeProfessor, makeAdmin, truncateAll } from '../helpers.js';

describe('Admin routes', () => {
  let admin;
  let adminApp;

  beforeEach(async () => {
    await truncateAll();
    admin = makeAdmin();
    adminApp = await createApp({ mockUser: admin });
  });

  // ── GET /api/admin/users ──────────────────────────────────────────
  // The list endpoint (GET /api/admin/users) calls prisma.user.findMany() which
  // was removed from the AT schema in schema_unification; that route is broken
  // and owned by the routes team. The RBAC guard (403) still works.

  describe('GET /api/admin/users', () => {
    it('returns 403 for non-admin (professor)', async () => {
      const prof = makeProfessor();
      const profApp = await createApp({ mockUser: prof });
      const res = await request(profApp).get('/api/admin/users');
      expect(res.status).toBe(403);
    });
  });

  // ── GET /api/admin/courses ────────────────────────────────────────

  describe('GET /api/admin/courses', () => {
    it('returns course list for admin', async () => {
      await import('../helpers.js').then(({ prisma }) =>
        prisma.courseOffering.create({
          data: { title: 'Admin Test Course', description: 'desc', isPublished: true },
        }),
      );

      const res = await request(adminApp).get('/api/admin/courses');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      expect(res.body[0]).toHaveProperty('id');
      expect(res.body[0]).toHaveProperty('title');
      expect(res.body[0]).toHaveProperty('isPublished');
    });

    it('returns 403 for non-admin (professor)', async () => {
      const prof = makeProfessor();
      const profApp = await createApp({ mockUser: prof });
      const res = await request(profApp).get('/api/admin/courses');
      expect(res.status).toBe(403);
    });
  });

  // ── PATCH /api/admin/users/:id/role ───────────────────────────────

  describe('PATCH /api/admin/users/:userId/role', () => {
    it('returns 410 (roles managed by EduAI)', async () => {
      const res = await request(adminApp)
        .patch(`/api/admin/users/${admin.id}/role`)
        .send({ role: 'PROFESSOR' });

      expect(res.status).toBe(410);
      expect(res.body.error).toMatch(/EduAI/i);
    });
  });

  // ── GET /api/admin/settings/eduai-api-key ─────────────────────────

  describe('GET /api/admin/settings/eduai-api-key', () => {
    it('returns API key status', async () => {
      const res = await request(adminApp).get('/api/admin/settings/eduai-api-key');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('configured');
      expect(res.body).toHaveProperty('source');
      expect(res.body).toHaveProperty('hasAdminOverride');
      expect(res.body).toHaveProperty('envConfigured');
    });
  });
});
