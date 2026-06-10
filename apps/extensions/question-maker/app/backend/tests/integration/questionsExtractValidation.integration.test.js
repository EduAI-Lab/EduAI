/**
 * HTTP validation tests for POST /api/questions/extract and /extract/save.
 *
 * These routes are now course-access gated (§16), so authorization runs before
 * payload validation: an INSTRUCTOR with an accessible course still hits the
 * 400 payload guards, while an unresolvable course id 404s at the gate. The
 * schema + Core reads are mocked so the gate resolves without a DB.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

const { mockCourseFindOne, mockEnrollments } = vi.hoisted(() => ({
  mockCourseFindOne: vi.fn(),
  mockEnrollments: vi.fn(),
}));

vi.mock('../../src/services/authService.js', () => ({
  findOrCreateUser: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../src/config/settings.js', () => {
  const cfg = { coreUrl: 'http://core.test', eduaiApiKey: 'k', corsOrigins: ['*'], nodeEnv: 'test', logLevel: 'silent' };
  return { config: cfg, default: cfg };
});

vi.mock('../../src/services/coreApiService.js', () => ({
  getCourseEnrollmentsFromCore: mockEnrollments,
  getCourseFromCore: vi.fn().mockResolvedValue({ id: 'cuid-core-course', department: 'COSC' }),
  getMyProfileFromCore: vi.fn().mockResolvedValue({ authorizedUnits: [] }),
}));

vi.mock('../../src/schema/index.js', () => ({
  Course: { findOne: mockCourseFindOne },
  Variants: {},
  Question_Metadata: {},
  Assessments: {},
  AssessmentSections: {},
  Topics: {},
  sequelize: { define: vi.fn(), authenticate: vi.fn(), sync: vi.fn() },
}));

const { default: app } = await import('../../src/app.js');

const TEST_USER = { id: 'cuid-test-user', email: 'test@test.com', role: 'INSTRUCTOR', name: 'Test User' };

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ user: TEST_USER }),
  }));
  // Course 1 is linked + the caller is an enrolled instructor → access granted.
  mockCourseFindOne.mockResolvedValue({ id: 1, userId: 'cuid-test-user', coreCourseId: 'cuid-core-course' });
  mockEnrollments.mockResolvedValue({
    enrollments: [{ studentId: TEST_USER.id, role: 'INSTRUCTOR', isActive: true }],
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('Questions extract HTTP validation (integration)', () => {
  describe('POST /api/questions/extract', () => {
    it('returns 400 when text is missing (course accessible)', async () => {
      const res = await request(app)
        .post('/api/questions/extract')
        .set('Cookie', 'session=valid')
        .send({ courseId: 1, text: '' });
      expect(res.status).toBe(400);
      expect(String(res.body.error || '')).toMatch(/text/i);
    });

    it('returns 404 when courseId is missing (no course to authorize)', async () => {
      const res = await request(app)
        .post('/api/questions/extract')
        .set('Cookie', 'session=valid')
        .send({ text: 'Some question text for extraction' });
      expect(res.status).toBe(404);
    });

    it('returns 404 when courseId is not an integer (unresolvable course)', async () => {
      const res = await request(app)
        .post('/api/questions/extract')
        .set('Cookie', 'session=valid')
        .send({ text: 'Q?', courseId: 'nope' });
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/questions/extract/save', () => {
    it('returns 404 when courseId is missing (no course to authorize)', async () => {
      const res = await request(app)
        .post('/api/questions/extract/save')
        .set('Cookie', 'session=valid')
        .send({ questions: [{ description: 'Q1' }] });
      expect(res.status).toBe(404);
    });

    it('returns 400 when questions is empty (course accessible)', async () => {
      const res = await request(app)
        .post('/api/questions/extract/save')
        .set('Cookie', 'session=valid')
        .send({ courseId: 1, questions: [] });
      expect(res.status).toBe(400);
      expect(String(res.body.error || '')).toMatch(/question/i);
    });

    it('returns 400 when questions is not a non-empty array (course accessible)', async () => {
      const res = await request(app)
        .post('/api/questions/extract/save')
        .set('Cookie', 'session=valid')
        .send({ courseId: 1, questions: 'not-an-array' });
      expect(res.status).toBe(400);
    });
  });
});
