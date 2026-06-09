/**
 * Route-level RBAC tests for assessments (#313, §17):
 *   - STUDENT blocked from viewing/authoring,
 *   - TA may VIEW (GET) but is rejected on every write,
 *   - INSTRUCTOR has the full authoring path.
 *
 * No DB / live Core: services, schema, and RBAC Core reads are mocked.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

const { svc, sectionSvc, variantSvc, mockCourseFindOne, mockAssessmentFindOne, mockEnrollments } = vi.hoisted(() => ({
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
vi.mock('../../src/services/assessmentService.js', () => svc);
vi.mock('../../src/services/assessmentSectionService.js', () => sectionSvc);
vi.mock('../../src/services/assessmentVariantService.js', () => variantSvc);
vi.mock('../../src/services/coreApiService.js', () => ({
  getCourseEnrollmentsFromCore: mockEnrollments,
  getCourseFromCore: vi.fn().mockResolvedValue({ id: 'cuid-core-course', department: 'COSC' }),
  getMyProfileFromCore: vi.fn().mockResolvedValue({ authorizedUnits: [] }),
}));
vi.mock('../../src/schema/index.js', () => ({
  Course: { findOne: mockCourseFindOne },
  Assessments: { findOne: mockAssessmentFindOne },
  Question_Metadata: {},
  Variants: {},
  AssessmentSections: {},
  Topics: {},
  sequelize: { define: vi.fn(), authenticate: vi.fn(), sync: vi.fn() },
}));

const { default: app } = await import('../../src/app.js');

const TA = { id: 'ta-1', role: 'TA', email: 't@t.co', name: 'TA' };
const INSTRUCTOR = { id: 'inst-1', role: 'INSTRUCTOR', email: 'i@t.co', name: 'I' };
const STUDENT = { id: 'stu-1', role: 'STUDENT', email: 's@t.co', name: 'S' };
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

describe('STUDENT blocked from assessments (§17)', () => {
  it.each([
    ['get', '/api/assessments/5'],
    ['post', '/api/assessments'],
  ])('%s %s → 403', async (method, path) => {
    authAs(STUDENT, null);
    const res = await request(app)[method](path).set('Cookie', 'session=v').send({});
    expect(res.status).toBe(403);
  });
});

describe('TA is view-only (§17)', () => {
  it('GET /assessments/:id → 200', async () => {
    authAs(TA, 'TA');
    svc.getAssessmentById.mockResolvedValue({ id: 5 });
    const res = await request(app).get('/api/assessments/5').set('Cookie', 'session=v');
    expect(res.status).toBe(200);
  });

  it('GET /assessments/:id/sections → 200', async () => {
    authAs(TA, 'TA');
    sectionSvc.getSectionsForAssessment.mockResolvedValue([]);
    const res = await request(app).get('/api/assessments/5/sections').set('Cookie', 'session=v');
    expect(res.status).toBe(200);
  });

  it('lists all assessments in a course they are enrolled on → owner-scoped', async () => {
    authAs(TA, 'TA');
    svc.getAssessmentsByUser.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    const res = await request(app).get('/api/assessments?courseId=1').set('Cookie', 'session=v');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(svc.getAssessmentsByUser).toHaveBeenCalledWith('owner-1', expect.objectContaining({ courseId: 1 }));
  });

  it('is forbidden from listing a course they have no access to → 403', async () => {
    authAs(TA, null); // not enrolled
    const res = await request(app).get('/api/assessments?courseId=1').set('Cookie', 'session=v');
    expect(res.status).toBe(403);
    expect(svc.getAssessmentsByUser).not.toHaveBeenCalled();
  });

  it.each([
    ['post', '/api/assessments', { type: 'EXAM', name: 'x', semester: 'F25', courseId: 1 }],
    ['put', '/api/assessments/5', { name: 'x' }],
    ['delete', '/api/assessments/5', {}],
    ['post', '/api/assessments/5/sections', { name: 'S' }],
    ['post', '/api/assessments/5/questions', { questionId: 1, orderNumber: 1 }],
    ['post', '/api/assessment-variant/assemble-variants', { referenceAssessmentId: 1, courseId: 1 }],
    ['patch', '/api/assessment-variant/assessments/5/role', { studyRole: 'x' }],
  ])('write %s %s → 403', async (method, path, body) => {
    authAs(TA, 'TA');
    const res = await request(app)[method](path).set('Cookie', 'session=v').send(body);
    expect(res.status).toBe(403);
    expect(svc.createAssessment).not.toHaveBeenCalled();
    expect(svc.updateAssessment).not.toHaveBeenCalled();
    expect(svc.deleteAssessment).not.toHaveBeenCalled();
  });
});

describe('INSTRUCTOR authoring path (§17)', () => {
  it('creates an assessment → 201 (scoped to course owner)', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    svc.createAssessment.mockResolvedValue({ id: 9 });
    const res = await request(app)
      .post('/api/assessments')
      .set('Cookie', 'session=v')
      .send({ type: 'EXAM', name: 'Midterm', semester: 'F25', courseId: 1 });
    expect(res.status).toBe(201);
    expect(svc.createAssessment).toHaveBeenCalledWith('owner-1', expect.objectContaining({ courseId: 1 }));
  });

  it('updates an assessment → 200', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    svc.updateAssessment.mockResolvedValue({ id: 5 });
    const res = await request(app).put('/api/assessments/5').set('Cookie', 'session=v').send({ name: 'New' });
    expect(res.status).toBe(200);
  });

  it('assembles variants → 201', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    variantSvc.assembleEquivalentExamVariants.mockResolvedValue({ created: [] });
    const res = await request(app)
      .post('/api/assessment-variant/assemble-variants')
      .set('Cookie', 'session=v')
      .send({ referenceAssessmentId: 1, courseId: 1 });
    expect(res.status).toBe(201);
  });
});

/**
 * Route→service wiring for cross-course scoping (#1): every section/variant write must
 * forward the authorized course id (req.qmCourse.id === 1 here) as the trailing arg, so
 * the service's course check actually fires in production. The service-level guard is
 * proven in crossCourseScoping.integration.test.js; this locks the call site.
 */
describe('section/variant writes forward req.qmCourse.id to the service (#1)', () => {
  beforeEach(() => authAs(INSTRUCTOR, 'INSTRUCTOR'));

  it('addVariantToSection gets the authorized course id', async () => {
    sectionSvc.addVariantToSection.mockResolvedValue({ id: 1 });
    const res = await request(app)
      .post('/api/assessments/5/sections/8/variants')
      .set('Cookie', 'session=v')
      .send({ variantId: 42 });
    expect(res.status).toBe(201);
    expect(sectionSvc.addVariantToSection).toHaveBeenCalledWith('8', 'owner-1', 42, expect.anything(), 1);
  });

  it('updateAssessmentSection gets the authorized course id', async () => {
    sectionSvc.updateAssessmentSection.mockResolvedValue({ id: 8 });
    const res = await request(app)
      .put('/api/assessments/5/sections/8')
      .set('Cookie', 'session=v')
      .send({ name: 'x' });
    expect(res.status).toBe(200);
    expect(sectionSvc.updateAssessmentSection).toHaveBeenCalledWith('8', 'owner-1', expect.anything(), 1);
  });

  it('deleteAssessmentSection gets the authorized course id', async () => {
    sectionSvc.deleteAssessmentSection.mockResolvedValue(true);
    const res = await request(app)
      .delete('/api/assessments/5/sections/8')
      .set('Cookie', 'session=v');
    expect(res.status).toBe(200);
    expect(sectionSvc.deleteAssessmentSection).toHaveBeenCalledWith('8', 'owner-1', 1);
  });

  it('removeVariantFromSection gets the authorized course id', async () => {
    sectionSvc.removeVariantFromSection.mockResolvedValue(true);
    const res = await request(app)
      .delete('/api/assessments/5/sections/8/variants/42')
      .set('Cookie', 'session=v');
    expect(res.status).toBe(200);
    expect(sectionSvc.removeVariantFromSection).toHaveBeenCalledWith('8', 'owner-1', 42, 1);
  });

  it('updateVariantOrderInSection gets the authorized course id', async () => {
    sectionSvc.updateVariantOrderInSection.mockResolvedValue({ id: 1 });
    const res = await request(app)
      .put('/api/assessments/5/sections/8/variants/42/order')
      .set('Cookie', 'session=v')
      .send({ displayOrder: 3 });
    expect(res.status).toBe(200);
    expect(sectionSvc.updateVariantOrderInSection).toHaveBeenCalledWith('8', 'owner-1', 42, 3, 1);
  });
});
