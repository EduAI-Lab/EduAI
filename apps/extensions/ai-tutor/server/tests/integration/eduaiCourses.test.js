import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { makeProfessor, truncateAll } from '../helpers.js';

const listEduAiCourses = vi.fn();

vi.mock('../../src/services/eduaiClient.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    listEduAiCourses: (...args) => listEduAiCourses(...args),
  };
});

describe('GET /api/eduai/courses', () => {
  let profApp;

  beforeEach(async () => {
    await truncateAll();
    listEduAiCourses.mockReset();
    profApp = await createApp({ mockUser: makeProfessor() });
  });

  it('returns 503 with SERVICE_KEY_MISMATCH when upstream Core rejects the service key', async () => {
    listEduAiCourses.mockRejectedValue(
      Object.assign(new Error('{"error":"INVALID_SERVICE_KEY"}'), { status: 403 }),
    );

    const res = await request(profApp).get('/api/eduai/courses');

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('SERVICE_KEY_MISMATCH');
    expect(res.body.error).toContain('EDUAI_API_KEY');
  });

  it('returns filtered catalog for instructors when upstream succeeds', async () => {
    listEduAiCourses.mockResolvedValue([
      { id: 'core-1', name: 'COSC 101', code: 'COSC101' },
    ]);

    const res = await request(profApp).get('/api/eduai/courses');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'core-1', name: 'COSC 101', code: 'COSC101' }]);
  });
});
