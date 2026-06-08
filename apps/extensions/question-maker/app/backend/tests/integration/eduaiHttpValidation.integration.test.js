/**
 * HTTP validation tests for POST /api/eduai/chat and /generate-questions (400 responses).
 * Auth is handled by stubbing global fetch for Core session validation.
 * No DB required — all 400 guards fire before any model access.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

vi.mock('../../src/services/authService.js', () => ({
  findOrCreateUser: vi.fn().mockResolvedValue({}),
}));

const { default: app } = await import('../../src/app.js');

const TEST_USER = { id: 'cuid-test-user', email: 'test@test.com', role: 'INSTRUCTOR', name: 'Test User' };

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ user: TEST_USER }),
  }));
});

afterEach(() => vi.unstubAllGlobals());

describe('EduAI HTTP validation (integration)', () => {
  describe('POST /api/eduai/chat', () => {
    it('returns 400 when messages is missing', async () => {
      const res = await request(app)
        .post('/api/eduai/chat')
        .set('Cookie', 'session=valid')
        .send({ courseCode: 'COSC_101' });
      expect(res.status).toBe(400);
      expect(String(res.body.error || '')).toMatch(/[Mm]essage/i);
    });

    it('returns 400 when courseCode is missing', async () => {
      const res = await request(app)
        .post('/api/eduai/chat')
        .set('Cookie', 'session=valid')
        .send({ messages: [{ role: 'user', content: 'Hello' }] });
      expect(res.status).toBe(400);
      expect(String(res.body.error || '')).toMatch(/course/i);
    });
  });

  describe('POST /api/eduai/generate-questions', () => {
    it('returns 400 when prompt is missing', async () => {
      const res = await request(app)
        .post('/api/eduai/generate-questions')
        .set('Cookie', 'session=valid')
        .send({ courseCode: 'TEST' });
      expect(res.status).toBe(400);
      expect(String(res.body.error || '')).toMatch(/[Pp]rompt|required/i);
    });

    it('returns 400 when courseCode is missing', async () => {
      const res = await request(app)
        .post('/api/eduai/generate-questions')
        .set('Cookie', 'session=valid')
        .send({ prompt: 'Write one MCQ' });
      expect(res.status).toBe(400);
      expect(String(res.body.error || '')).toMatch(/[Cc]ourse|required/i);
    });
  });
});
