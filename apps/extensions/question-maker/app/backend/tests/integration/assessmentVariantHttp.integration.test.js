/**
 * HTTP validation tests for /api/assessment-variant routes.
 *
 * These routes are instructor-gated (§17), so authorization runs before payload
 * validation: an enrolled INSTRUCTOR with an accessible course still hits the
 * 400 payload guards, while a request that omits courseId 404s at the gate
 * (no course to authorize). Schema + Core reads are mocked so the gate resolves
 * without a DB.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

const { mockCourseFindOne, mockAssessmentFindOne, mockEnrollments } = vi.hoisted(() => ({
  mockCourseFindOne: vi.fn(),
  mockAssessmentFindOne: vi.fn(),
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

vi.mock('../../src/config/database.js', () => ({
  prisma: {
    course: { findUnique: mockCourseFindOne },
    assessments: { findUnique: mockAssessmentFindOne },
    questionMetadata: {},
    variants: {},
    assessmentSections: {},
    topics: {},
  },
}));

const { default: app } = await import('../../src/app.js');

const TEST_USER = { id: 'cuid-test-user', email: 'test@test.com', role: 'INSTRUCTOR', name: 'Test User' };
const COURSE = { id: 1, userId: 'cuid-test-user', coreCourseId: 'cuid-core-course' };

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ user: TEST_USER }),
  }));
  mockCourseFindOne.mockResolvedValue(COURSE);
  mockAssessmentFindOne.mockResolvedValue({ id: 1, course: COURSE });
  mockEnrollments.mockResolvedValue({
    enrollments: [{ studentId: TEST_USER.id, role: 'INSTRUCTOR', isActive: true }],
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('Assessment variant API validation (integration)', () => {
  it('returns 400 when PATCH /role has no studyRole in body', async () => {
    const res = await request(app)
      .patch('/api/assessment-variant/assessments/1/role')
      .set('Cookie', 'session=valid')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  // variant-readiness derives courseId from the authorized assessment (req.qmCourse),
  // so there is no client-supplied courseId to validate here — see variantReadinessScope.test.js.

  it('returns 404 when POST assemble-variants omits courseId (no course to authorize)', async () => {
    const res = await request(app)
      .post('/api/assessment-variant/assemble-variants')
      .set('Cookie', 'session=valid')
      .send({ referenceAssessmentId: 1 });
    expect(res.status).toBe(404);
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
