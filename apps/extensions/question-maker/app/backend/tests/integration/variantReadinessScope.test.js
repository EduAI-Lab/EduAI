/**
 * Route-level test for variant-readiness course scoping (#6).
 *
 * GET /api/assessment-variant/assessments/:id/variant-readiness authorizes via
 * requireAssessmentAccess on :id (pinning req.qmCourse to the assessment's real course).
 * The handler must derive courseId from req.qmCourse.id, NOT re-trust the client-supplied
 * ?courseId= query param the middleware already resolved.
 *
 * No DB / live Core: assessmentVariantService, schema, and the RBAC Core reads are mocked.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

const { mockGetReadiness, mockCourseFindOne, mockAssessmentFindOne, mockEnrollments } = vi.hoisted(() => ({
  mockGetReadiness: vi.fn(),
  mockCourseFindOne: vi.fn(),
  mockAssessmentFindOne: vi.fn(),
  mockEnrollments: vi.fn(),
}));

vi.mock('../../src/services/authService.js', () => ({ findOrCreateUser: vi.fn().mockResolvedValue({}) }));
vi.mock('../../src/config/settings.js', () => {
  const cfg = { coreUrl: 'http://core.test', eduaiApiKey: 'k', corsOrigins: ['*'], nodeEnv: 'test', logLevel: 'silent' };
  return { config: cfg, default: cfg };
});
vi.mock('../../src/services/assessmentVariantService.js', () => ({
  setAssessmentStudyRole: vi.fn(),
  getBlueprintSnapshot: vi.fn(),
  getBaselineVariantReadiness: mockGetReadiness,
  assembleEquivalentExamVariants: vi.fn(),
  assembleExamVariantsByMetadataSimilarity: vi.fn(),
  generateBankVariantsForQuestions: vi.fn(),
  reviewVariantExamWithAi: vi.fn(),
}));
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

const INSTRUCTOR = { id: 'inst-1', role: 'INSTRUCTOR', email: 'i@t.co', name: 'I' };
const COURSE = { id: 1, userId: 'owner-1', coreCourseId: 'cuid-core-course' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ user: INSTRUCTOR }) }));
  mockEnrollments.mockResolvedValue({ enrollments: [{ studentId: INSTRUCTOR.id, role: 'INSTRUCTOR', isActive: true }] });
  mockCourseFindOne.mockResolvedValue(COURSE);
  mockAssessmentFindOne.mockResolvedValue({ id: 5, course: COURSE });
  mockGetReadiness.mockResolvedValue({ ready: true });
});
afterEach(() => vi.restoreAllMocks());

describe('variant-readiness derives courseId from the authorized course (#6)', () => {
  it('ignores a mismatched ?courseId= and uses req.qmCourse.id', async () => {
    const res = await request(app)
      .get('/api/assessment-variant/assessments/5/variant-readiness?courseId=999')
      .set('Cookie', 'session=v');

    expect(res.status).toBe(200);
    expect(mockGetReadiness).toHaveBeenCalledWith('owner-1', { assessmentId: 5, courseId: 1 });
  });

  it('works without a courseId query param (no longer required)', async () => {
    const res = await request(app)
      .get('/api/assessment-variant/assessments/5/variant-readiness')
      .set('Cookie', 'session=v');

    expect(res.status).toBe(200);
    expect(mockGetReadiness).toHaveBeenCalledWith('owner-1', { assessmentId: 5, courseId: 1 });
  });
});
