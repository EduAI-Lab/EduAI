/**
 * Coverage-focused route tests for assessments.js (issue #1217: assessments.js
 * had 40 uncovered statements). assessmentRbac.test.js already covers the
 * STUDENT/TA role gates and the section/variant course-id forwarding; this
 * file exercises the remaining branches: request-body validation guards, the
 * GET list/detail course-access branches, DELETE, and the question-in-
 * assessment lookup routes.
 *
 * Same mocked-DB pattern as assessmentRbac.test.js — no live Core or test DB required.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

const { svc, sectionSvc, mockCourseFindOne, mockAssessmentFindOne, mockQuestionFindOne, mockEnrollments } = vi.hoisted(() => ({
  svc: {
    createAssessment: vi.fn(),
    getAssessmentsByUser: vi.fn(),
    getAssessmentById: vi.fn(),
    updateAssessment: vi.fn(),
    deleteAssessment: vi.fn(),
    addQuestionToAssessment: vi.fn(),
    removeQuestionFromAssessment: vi.fn(),
    getQuestionsInAssessment: vi.fn(),
  },
  sectionSvc: {
    getSectionsForAssessment: vi.fn(),
    createAssessmentSection: vi.fn(),
    updateAssessmentSection: vi.fn(),
    deleteAssessmentSection: vi.fn(),
    addVariantToSection: vi.fn(),
    removeVariantFromSection: vi.fn(),
    updateVariantOrderInSection: vi.fn(),
    removeQuestionFromAllSections: vi.fn(),
    checkQuestionInAssessments: vi.fn(),
  },
  mockCourseFindOne: vi.fn(),
  mockAssessmentFindOne: vi.fn(),
  mockQuestionFindOne: vi.fn(),
  mockEnrollments: vi.fn(),
}));

vi.mock('../../src/services/authService.js', () => ({ findOrCreateUser: vi.fn().mockResolvedValue({}) }));
vi.mock('../../src/config/settings.js', () => {
  const cfg = { coreUrl: 'http://core.test', eduaiApiKey: 'k', corsOrigins: ['*'], nodeEnv: 'test', logLevel: 'silent' };
  return { config: cfg, default: cfg };
});
vi.mock('../../src/services/assessmentService.js', () => svc);
vi.mock('../../src/services/assessmentSectionService.js', () => sectionSvc);
vi.mock('../../src/services/coreApiService.js', () => ({
  getCourseEnrollmentsFromCore: mockEnrollments,
  getCourseFromCore: vi.fn().mockResolvedValue({ id: 'cuid-core-course', department: 'COSC' }),
  getMyProfileFromCore: vi.fn().mockResolvedValue({ authorizedUnits: [] }),
}));
vi.mock('../../src/config/database.js', () => ({
  prisma: {
    course: { findUnique: mockCourseFindOne },
    assessments: { findUnique: mockAssessmentFindOne },
    questionMetadata: { findUnique: mockQuestionFindOne },
    variants: {},
    assessmentSections: {},
    topics: {},
  },
}));

const { default: app } = await import('../../src/app.js');

const INSTRUCTOR = { id: 'inst-1', role: 'INSTRUCTOR', email: 'i@t.co', name: 'I' };
const COURSE = { id: 1, userId: 'owner-1', coreCourseId: 'cuid-core-course' };
// Not the course owner and not enrolled — exercises the "insufficient course access" branch.
const OUTSIDER_INSTRUCTOR = { id: 'inst-2', role: 'INSTRUCTOR', email: 'i2@t.co', name: 'I2' };

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

describe('POST /api/assessments', () => {
  it('requires type and name', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    const res = await request(app)
      .post('/api/assessments')
      .set('Cookie', 'session=v')
      .send({ courseId: 1 });
    expect(res.status).toBe(400);
    expect(svc.createAssessment).not.toHaveBeenCalled();
  });
});

describe('GET /api/assessments', () => {
  it('lists caller-scoped assessments without a courseId', async () => {
    authAs(INSTRUCTOR, null);
    svc.getAssessmentsByUser.mockResolvedValue({ items: [], total: 0 });

    const res = await request(app).get('/api/assessments').set('Cookie', 'session=v');

    expect(res.status).toBe(200);
    expect(svc.getAssessmentsByUser).toHaveBeenCalledWith(
      INSTRUCTOR.id,
      expect.objectContaining({ courseId: undefined }),
    );
  });

  it('returns 404 when the course does not exist', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    mockCourseFindOne.mockResolvedValue(null);

    const res = await request(app).get('/api/assessments?courseId=999').set('Cookie', 'session=v');

    expect(res.status).toBe(404);
  });

  it('returns 403 when the caller lacks TA access to the course', async () => {
    authAs(OUTSIDER_INSTRUCTOR, null);

    const res = await request(app).get('/api/assessments?courseId=1').set('Cookie', 'session=v');

    expect(res.status).toBe(403);
  });

  it('scopes the list by the course owner when courseId is supplied', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    svc.getAssessmentsByUser.mockResolvedValue({ items: [{ id: 5 }], total: 1 });

    const res = await request(app).get('/api/assessments?courseId=1').set('Cookie', 'session=v');

    expect(res.status).toBe(200);
    expect(svc.getAssessmentsByUser).toHaveBeenCalledWith(
      COURSE.userId,
      expect.objectContaining({ courseId: COURSE.id }),
    );
  });
});

describe('GET /api/assessments/:id', () => {
  it('returns the assessment', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    svc.getAssessmentById.mockResolvedValue({ id: 5, name: 'Midterm' });

    const res = await request(app).get('/api/assessments/5').set('Cookie', 'session=v');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ id: 5, name: 'Midterm' });
  });
});

describe('DELETE /api/assessments/:id', () => {
  it('deletes the assessment', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    svc.deleteAssessment.mockResolvedValue(true);

    const res = await request(app).delete('/api/assessments/5').set('Cookie', 'session=v');

    expect(res.status).toBe(200);
    expect(svc.deleteAssessment).toHaveBeenCalledWith('5', COURSE.userId);
  });
});

describe('POST /api/assessments/:id/questions', () => {
  it('requires questionId and orderNumber', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    const res = await request(app)
      .post('/api/assessments/5/questions')
      .set('Cookie', 'session=v')
      .send({});
    expect(res.status).toBe(400);
    expect(svc.addQuestionToAssessment).not.toHaveBeenCalled();
  });

  it('links the question on success', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    svc.addQuestionToAssessment.mockResolvedValue({ id: 3 });

    const res = await request(app)
      .post('/api/assessments/5/questions')
      .set('Cookie', 'session=v')
      .send({ questionId: 3, orderNumber: 1 });

    expect(res.status).toBe(200);
    expect(svc.addQuestionToAssessment).toHaveBeenCalledWith('5', 3, 1, COURSE.userId);
  });
});

describe('DELETE /api/assessments/:id/questions/:questionId', () => {
  it('unlinks the question', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    svc.removeQuestionFromAssessment.mockResolvedValue({ id: 3 });

    const res = await request(app).delete('/api/assessments/5/questions/3').set('Cookie', 'session=v');

    expect(res.status).toBe(200);
    expect(svc.removeQuestionFromAssessment).toHaveBeenCalledWith('5', '3', COURSE.userId);
  });
});

describe('GET /api/assessments/:id/questions', () => {
  it('returns a bounded page of questions', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    svc.getQuestionsInAssessment.mockResolvedValue([{ id: 1 }, { id: 2 }]);

    const res = await request(app).get('/api/assessments/5/questions').set('Cookie', 'session=v');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: [{ id: 1 }, { id: 2 }],
      total: 2,
      page: 1,
      pageSize: 200,
    });
    expect(svc.getQuestionsInAssessment).toHaveBeenCalledWith('5', COURSE.userId);
  });
});

describe('GET /api/assessments/:id/sections', () => {
  it('returns a bounded page of sections', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    sectionSvc.getSectionsForAssessment.mockResolvedValue([{ id: 1 }]);

    const res = await request(app).get('/api/assessments/5/sections').set('Cookie', 'session=v');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: [{ id: 1 }],
      total: 1,
      page: 1,
      pageSize: 200,
    });
    expect(sectionSvc.getSectionsForAssessment).toHaveBeenCalledWith('5', COURSE.userId);
  });
});

describe('POST /api/assessments/:assessmentId/sections/:sectionId/variants', () => {
  it('requires variantId', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    const res = await request(app)
      .post('/api/assessments/5/sections/8/variants')
      .set('Cookie', 'session=v')
      .send({});
    expect(res.status).toBe(400);
    expect(sectionSvc.addVariantToSection).not.toHaveBeenCalled();
  });
});

describe('PUT /api/assessments/:assessmentId/sections/:sectionId/variants/:variantId/order', () => {
  it('requires displayOrder', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    const res = await request(app)
      .put('/api/assessments/5/sections/8/variants/42/order')
      .set('Cookie', 'session=v')
      .send({});
    expect(res.status).toBe(400);
    expect(sectionSvc.updateVariantOrderInSection).not.toHaveBeenCalled();
  });
});

describe('GET /api/assessments/questions/:questionId/check-in-assessments', () => {
  it('returns whether the question appears in any section', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    mockQuestionFindOne.mockResolvedValue({ id: 3, course: COURSE });
    sectionSvc.checkQuestionInAssessments.mockResolvedValue({ inAssessments: true });

    const res = await request(app)
      .get('/api/assessments/questions/3/check-in-assessments')
      .set('Cookie', 'session=v');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ inAssessments: true });
    expect(sectionSvc.checkQuestionInAssessments).toHaveBeenCalledWith(3, COURSE.userId);
  });
});

describe('DELETE /api/assessments/questions/:questionId/remove-from-all-sections', () => {
  it('removes the question from every section', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    mockQuestionFindOne.mockResolvedValue({ id: 3, course: COURSE });
    sectionSvc.removeQuestionFromAllSections.mockResolvedValue({ removed: 2 });

    const res = await request(app)
      .delete('/api/assessments/questions/3/remove-from-all-sections')
      .set('Cookie', 'session=v');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ removed: 2 });
    expect(sectionSvc.removeQuestionFromAllSections).toHaveBeenCalledWith(3, COURSE.userId);
  });
});
