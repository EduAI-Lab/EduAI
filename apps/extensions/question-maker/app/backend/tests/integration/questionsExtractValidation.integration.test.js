/**
 * HTTP validation tests for POST /api/questions/extract and /extract/save.
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

describe('Questions extract HTTP validation (integration)', () => {
  describe('POST /api/questions/extract', () => {
    it('returns 400 when text is missing', async () => {
      const res = await request(app)
        .post('/api/questions/extract')
        .set('Cookie', 'session=valid')
        .send({ courseId: 1, text: '' });
      expect(res.status).toBe(400);
      expect(String(res.body.error || '')).toMatch(/text/i);
    });

    it('returns 400 when courseId is missing', async () => {
      const res = await request(app)
        .post('/api/questions/extract')
        .set('Cookie', 'session=valid')
        .send({ text: 'Some question text for extraction' });
      expect(res.status).toBe(400);
      expect(String(res.body.error || '')).toMatch(/courseId/i);
    });

    it('returns 400 when courseId is not an integer', async () => {
      const res = await request(app)
        .post('/api/questions/extract')
        .set('Cookie', 'session=valid')
        .send({ text: 'Q?', courseId: 'nope' });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/questions/extract/save', () => {
    it('returns 400 when courseId is missing', async () => {
      const res = await request(app)
        .post('/api/questions/extract/save')
        .set('Cookie', 'session=valid')
        .send({ questions: [{ description: 'Q1' }] });
      expect(res.status).toBe(400);
      expect(String(res.body.error || '')).toMatch(/courseId/i);
    });

    it('returns 400 when questions is empty', async () => {
      const res = await request(app)
        .post('/api/questions/extract/save')
        .set('Cookie', 'session=valid')
        .send({ courseId: 1, questions: [] });
      expect(res.status).toBe(400);
      expect(String(res.body.error || '')).toMatch(/question/i);
    });

    it('returns 400 when questions is not a non-empty array', async () => {
      const res = await request(app)
        .post('/api/questions/extract/save')
        .set('Cookie', 'session=valid')
        .send({ courseId: 1, questions: 'not-an-array' });
      expect(res.status).toBe(400);
    });
  });
});
