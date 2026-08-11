import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';

vi.mock('../../src/config/database.js', () => ({
  prisma: { $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]) },
}));

vi.mock('../../src/routes/courses.js', async () => {
  const express = await import('express');
  const router = express.default.Router();
  router.post('/csrf-probe', (_req, res) => res.json({ ok: true }));
  return { default: router };
});

const { createApp } = await import('../../src/app.js');

describe('cookie-auth unsafe request CSRF gate', () => {
  it('rejects sibling-origin simple-form POSTs before routes', async () => {
    const app = await createApp({ mockUser: { id: 'student-1', role: 'STUDENT' } });
    const response = await request(app)
      .post('/api/csrf-probe')
      .set('Cookie', 'session=secret')
      .set('Origin', 'https://evil.example')
      .type('form')
      .send('value=attack');

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'Cross-origin request blocked' });
  });

  it('preserves configured trusted-origin cookie mutations', async () => {
    const app = await createApp({ mockUser: { id: 'student-1', role: 'STUDENT' } });
    const response = await request(app)
      .post('/api/csrf-probe')
      .set('Cookie', 'session=secret')
      .set('Origin', 'http://localhost:3001')
      .send({ value: 'safe' });

    expect(response.status).toBe(200);
  });

  it('preserves explicit service-auth mutations even when Origin is cross-site', async () => {
    const app = await createApp({ mockUser: { id: 'student-1', role: 'STUDENT' } });
    const response = await request(app)
      .post('/api/csrf-probe')
      .set('Cookie', 'session=secret')
      .set('Authorization', 'Bearer service-key')
      .set('Origin', 'https://service.example')
      .send({ value: 'safe' });

    expect(response.status).toBe(200);
  });
});
