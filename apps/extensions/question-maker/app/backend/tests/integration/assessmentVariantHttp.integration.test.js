/**
 * HTTP validation tests for /api/assessment-variant routes (400 responses).
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

describe('Assessment variant API validation (integration)', () => {
  it('returns 400 when PATCH /role has no studyRole in body', async () => {
    const res = await request(app)
      .patch('/api/assessment-variant/assessments/1/role')
      .set('Cookie', 'session=valid')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 400 when GET variant-readiness is missing courseId', async () => {
    const res = await request(app)
      .get('/api/assessment-variant/assessments/1/variant-readiness')
      .set('Cookie', 'session=valid');
    expect(res.status).toBe(400);
    expect(String(res.body.error || '')).toMatch(/courseId/i);
  });

  it('returns 400 when POST assemble-variants is missing required ids', async () => {
    const res = await request(app)
      .post('/api/assessment-variant/assemble-variants')
      .set('Cookie', 'session=valid')
      .send({ referenceAssessmentId: 1 });
    expect(res.status).toBe(400);
  });

  it('returns 400 when POST assemble-by-metadata is missing required ids', async () => {
    const res = await request(app)
      .post('/api/assessment-variant/assemble-by-metadata')
      .set('Cookie', 'session=valid')
      .send({ courseId: 1 });
    expect(res.status).toBe(400);
  });

  it('returns 400 when POST generate-bank-variants has empty questionIds', async () => {
    const res = await request(app)
      .post('/api/assessment-variant/generate-bank-variants')
      .set('Cookie', 'session=valid')
      .send({ courseId: 1, questionIds: [] });
    expect(res.status).toBe(400);
  });

  it('returns 400 when POST review-variant-ai is missing required ids', async () => {
    const res = await request(app)
      .post('/api/assessment-variant/review-variant-ai')
      .set('Cookie', 'session=valid')
      .send({ baselineAssessmentId: 1, courseId: 1 });
    expect(res.status).toBe(400);
  });
});
