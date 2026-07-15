/**
 * HTTP validation tests for POST /api/questions/generate (400 responses).
 * Auth is stubbed via Core session fetch; no DB or AI provider calls needed
 * for the maxQuestions guard.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

vi.mock('../../src/services/authService.js', () => ({
  findOrCreateUser: vi.fn().mockResolvedValue({}),
}));

const { default: app } = await import('../../src/app.js');
const { config } = await import('../../src/config/settings.js');

const TEST_USER = { id: 'cuid-test-user', email: 'test@test.com', role: 'INSTRUCTOR', name: 'Test User' };

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ user: TEST_USER }),
  }));
});

afterEach(() => vi.unstubAllGlobals());

describe('Questions generate HTTP validation (integration)', () => {
  describe('POST /api/questions/generate', () => {
    it('returns 400 when prompt is missing', async () => {
      const res = await request(app)
        .post('/api/questions/generate')
        .set('Cookie', 'session=valid')
        .send({ numQuestions: 5 });
      expect(res.status).toBe(400);
      expect(String(res.body.error || '')).toMatch(/[Pp]rompt|required/i);
    });

    it('returns 400 when numQuestions exceeds maxQuestions', async () => {
      const res = await request(app)
        .post('/api/questions/generate')
        .set('Cookie', 'session=valid')
        .send({ prompt: 'Write many MCQs', numQuestions: config.maxQuestions + 1 });
      expect(res.status).toBe(400);
      expect(String(res.body.error || '')).toMatch(/numQuestions|exceed|max/i);
    });
  });
});
