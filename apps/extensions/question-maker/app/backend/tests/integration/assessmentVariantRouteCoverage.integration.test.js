/**
 * Coverage-focused route tests for assessmentVariant.js (issue #1217:
 * assessmentVariant.js was one of the worst-covered files at 61.9%).
 * assessmentRbac.test.js already covers the TA role-gate and one INSTRUCTOR
 * happy path (assemble-variants); this file exercises the remaining
 * validation branches and the other four endpoints' happy paths.
 *
 * Same mocked-DB pattern as assessmentRbac.test.js — no live Core or test DB required.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

const { variantSvc, mockCourseFindOne, mockAssessmentFindOne, mockEnrollments } = vi.hoisted(() => ({
  variantSvc: {
    setAssessmentStudyRole: vi.fn(),
    getBlueprintSnapshot: vi.fn(),
    getBaselineVariantReadiness: vi.fn(),
    assembleEquivalentExamVariants: vi.fn(),
    assembleExamVariantsByMetadataSimilarity: vi.fn(),
    generateBankVariantsForQuestions: vi.fn(),
    reviewVariantExamWithAi: vi.fn(),
  },
  mockCourseFindOne: vi.fn(),
  mockAssessmentFindOne: vi.fn(),
  mockEnrollments: vi.fn(),
}));

vi.mock('../../src/services/authService.js', () => ({ findOrCreateUser: vi.fn().mockResolvedValue({}) }));
vi.mock('../../src/config/settings.js', () => {
  const cfg = { coreUrl: 'http://core.test', eduaiApiKey: 'k', corsOrigins: ['*'], nodeEnv: 'test', logLevel: 'silent' };
  return { config: cfg, default: cfg };
});
vi.mock('../../src/services/assessmentVariantService.js', () => variantSvc);
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

function authAs(user, enrollRole) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ user }) }));
  mockEnrollments.mockResolvedValue({
    enrollments: enrollRole ? [{ studentId: user.id, role: enrollRole, isActive: true }] : [],
  });
  mockCourseFindOne.mockResolvedValue(COURSE);
  mockAssessmentFindOne.mockResolvedValue({ id: 5, course: COURSE });
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('PATCH /api/assessment-variant/assessments/:id/role', () => {
  it('rejects unsupported body fields', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    const res = await request(app)
      .patch('/api/assessment-variant/assessments/5/role')
      .set('Cookie', 'session=v')
      .send({ studyRole: 'BASELINE', extra: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Unsupported field/);
  });

  it('requires studyRole to be present', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    const res = await request(app)
      .patch('/api/assessment-variant/assessments/5/role')
      .set('Cookie', 'session=v')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/studyRole is required/);
  });

  it('rejects a non-string, non-null studyRole', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    const res = await request(app)
      .patch('/api/assessment-variant/assessments/5/role')
      .set('Cookie', 'session=v')
      .send({ studyRole: 42 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/must be a string or null/);
  });

  it('accepts null to clear the role', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    variantSvc.setAssessmentStudyRole.mockResolvedValue({ id: 5, blueprintConfig: {} });

    const res = await request(app)
      .patch('/api/assessment-variant/assessments/5/role')
      .set('Cookie', 'session=v')
      .send({ studyRole: null });

    expect(res.status).toBe(200);
    expect(variantSvc.setAssessmentStudyRole).toHaveBeenCalledWith(5, COURSE.userId, null);
  });

  it('surfaces the service enum validation as a 400', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    variantSvc.setAssessmentStudyRole.mockRejectedValue(new Error('Invalid studyRole'));

    const res = await request(app)
      .patch('/api/assessment-variant/assessments/5/role')
      .set('Cookie', 'session=v')
      .send({ studyRole: 'NOT_A_ROLE' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid studyRole');
  });
});

describe('GET /api/assessment-variant/assessments/:id/blueprint-snapshot', () => {
  it('returns the snapshot', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    variantSvc.getBlueprintSnapshot.mockResolvedValue({ slots: [] });

    const res = await request(app)
      .get('/api/assessment-variant/assessments/5/blueprint-snapshot')
      .set('Cookie', 'session=v');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ slots: [] });
    expect(variantSvc.getBlueprintSnapshot).toHaveBeenCalledWith(5, COURSE.userId);
  });
});

describe('GET /api/assessment-variant/assessments/:id/variant-readiness', () => {
  it('derives the course from the authorized assessment, not the query string', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    variantSvc.getBaselineVariantReadiness.mockResolvedValue({ ready: true });

    const res = await request(app)
      .get('/api/assessment-variant/assessments/5/variant-readiness?courseId=999')
      .set('Cookie', 'session=v');

    expect(res.status).toBe(200);
    expect(variantSvc.getBaselineVariantReadiness).toHaveBeenCalledWith(
      COURSE.userId,
      expect.objectContaining({ assessmentId: 5, courseId: COURSE.id }),
    );
  });
});

describe('POST /api/assessment-variant/assemble-by-metadata', () => {
  it('requires referenceAssessmentId', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    const res = await request(app)
      .post('/api/assessment-variant/assemble-by-metadata')
      .set('Cookie', 'session=v')
      .send({ courseId: 1 });
    expect(res.status).toBe(400);
  });

  it('assembles variants by metadata similarity on success', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    variantSvc.assembleExamVariantsByMetadataSimilarity.mockResolvedValue({ created: [1, 2] });

    const res = await request(app)
      .post('/api/assessment-variant/assemble-by-metadata')
      .set('Cookie', 'session=v')
      .send({ referenceAssessmentId: 7, courseId: 1, examLabels: ['A', 'B'], namePrefix: 'Exam' });

    expect(res.status).toBe(201);
    expect(variantSvc.assembleExamVariantsByMetadataSimilarity).toHaveBeenCalledWith(
      COURSE.userId,
      expect.objectContaining({ referenceAssessmentId: 7, examLabels: ['A', 'B'], namePrefix: 'Exam' }),
    );
  });
});

describe('POST /api/assessment-variant/generate-bank-variants', () => {
  it('requires a non-empty questionIds array', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    const res = await request(app)
      .post('/api/assessment-variant/generate-bank-variants')
      .set('Cookie', 'session=v')
      .send({ courseId: 1, questionIds: [] });
    expect(res.status).toBe(400);
  });

  it('generates bank variants on success', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    variantSvc.generateBankVariantsForQuestions.mockResolvedValue({ created: 3 });

    const res = await request(app)
      .post('/api/assessment-variant/generate-bank-variants')
      .set('Cookie', 'session=v')
      .send({ courseId: 1, questionIds: ['1', '2'], variantsToAdd: 2 });

    expect(res.status).toBe(201);
    expect(variantSvc.generateBankVariantsForQuestions).toHaveBeenCalledWith(
      COURSE.userId,
      expect.objectContaining({ questionIds: [1, 2], variantsToAdd: 2 }),
    );
  });
});

describe('POST /api/assessment-variant/review-variant-ai', () => {
  it('requires baselineAssessmentId and variantAssessmentId', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    const res = await request(app)
      .post('/api/assessment-variant/review-variant-ai')
      .set('Cookie', 'session=v')
      .send({ courseId: 1, baselineAssessmentId: 1 });
    expect(res.status).toBe(400);
  });

  it('reviews the variant exam on success', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    variantSvc.reviewVariantExamWithAi.mockResolvedValue({ score: 0.9 });

    const res = await request(app)
      .post('/api/assessment-variant/review-variant-ai')
      .set('Cookie', 'session=v')
      .send({ courseId: 1, baselineAssessmentId: 1, variantAssessmentId: 2, applyUsabilityPenalty: true });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ score: 0.9 });
    expect(variantSvc.reviewVariantExamWithAi).toHaveBeenCalledWith(
      COURSE.userId,
      expect.objectContaining({ baselineAssessmentId: 1, variantAssessmentId: 2, applyUsabilityPenalty: true }),
    );
  });
});
