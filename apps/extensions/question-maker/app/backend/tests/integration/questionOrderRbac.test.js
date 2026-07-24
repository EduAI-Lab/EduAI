/**
 * Route-level RBAC tests for the question-order routes (#2, §17).
 *
 * PUT /api/questions/:id/order and DELETE /api/questions/:id/order/:assessmentId write the
 * question's per-assessment `questionOrder` map — i.e. assessment composition, which §17
 * makes instructor-only (TA is view-only on assessments). They must be gated min 'instructor',
 * and the supplied assessmentId must belong to the question's own course.
 *
 * No DB / live Core: questionService, schema, and the Core reads are mocked.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

const {
  mockUpdateOrder, mockRemoveFromAssessment, mockQuestionFindOne, mockAssessmentFindOne,
  mockCourseFindOne, mockEnrollments,
} = vi.hoisted(() => ({
  mockUpdateOrder: vi.fn(),
  mockRemoveFromAssessment: vi.fn(),
  mockQuestionFindOne: vi.fn(),
  mockAssessmentFindOne: vi.fn(),
  mockCourseFindOne: vi.fn(),
  mockEnrollments: vi.fn(),
}));

vi.mock('../../src/services/authService.js', () => ({ findOrCreateUser: vi.fn().mockResolvedValue({}) }));
vi.mock('../../src/config/settings.js', () => {
  const cfg = { coreUrl: 'http://core.test', eduaiApiKey: 'k', corsOrigins: ['*'], nodeEnv: 'test', logLevel: 'silent' };
  return { config: cfg, default: cfg };
});
vi.mock('../../src/services/questionService.js', () => ({
  createQuestion: vi.fn(),
  getQuestionsByUser: vi.fn(),
  getQuestionById: vi.fn(),
  updateQuestion: vi.fn(),
  deleteQuestion: vi.fn(),
  createMultipleQuestions: vi.fn(),
  getQuestionStats: vi.fn(),
  updateQuestionOrder: mockUpdateOrder,
  removeQuestionFromAssessment: mockRemoveFromAssessment,
  saveExtractedQuestions: vi.fn(),
  normalizePrimaryTopicId: (v) => (v ? String(v) : null),
}));
vi.mock('../../src/services/aiService.js', () => ({
  generateQuestions: vi.fn(),
  extractQuestionsFromText: vi.fn(),
  AI_PROVIDERS: { GROQ: 'groq' },
}));
vi.mock('../../src/services/coreApiService.js', () => ({
  getCourseEnrollmentsFromCore: mockEnrollments,
  getCourseFromCore: vi.fn().mockResolvedValue({ id: 'cuid-core-course', department: 'COSC' }),
  getMyProfileFromCore: vi.fn().mockResolvedValue({ authorizedUnits: [] }),
}));
vi.mock('../../src/config/database.js', () => ({
  prisma: {
    course: { findUnique: mockCourseFindOne },
    questionMetadata: { findUnique: mockQuestionFindOne },
    assessments: { findUnique: mockAssessmentFindOne },
    variants: {},
    assessmentSections: {},
    topics: {},
  },
}));

const { default: app } = await import('../../src/app.js');

const TA = { id: 'ta-1', role: 'TA', email: 't@t.co', name: 'TA' };
const INSTRUCTOR = { id: 'inst-1', role: 'INSTRUCTOR', email: 'i@t.co', name: 'I' };
const COURSE = { id: 1, userId: 'owner-1', coreCourseId: 'cuid-core-course' };

function authAs(user, enrollRole) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ user }) }));
  mockEnrollments.mockResolvedValue({
    enrollments: enrollRole ? [{ studentId: user.id, role: enrollRole, isActive: true }] : [],
  });
  mockCourseFindOne.mockResolvedValue(COURSE);
  mockQuestionFindOne.mockResolvedValue({ id: 7, createdBy: user.id, course: COURSE });
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('question-order routes are instructor-only (#2, §17)', () => {
  it('TA cannot reorder a question into an assessment → 403', async () => {
    authAs(TA, 'TA');
    const res = await request(app)
      .put('/api/questions/7/order')
      .set('Cookie', 'session=v')
      .send({ assessmentId: 5, orderNumber: 1 });
    expect(res.status).toBe(403);
    expect(mockUpdateOrder).not.toHaveBeenCalled();
  });

  it('TA cannot remove a question from an assessment → 403', async () => {
    authAs(TA, 'TA');
    const res = await request(app)
      .delete('/api/questions/7/order/5')
      .set('Cookie', 'session=v');
    expect(res.status).toBe(403);
    expect(mockRemoveFromAssessment).not.toHaveBeenCalled();
  });

  it('INSTRUCTOR may reorder within their course → 200', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    mockAssessmentFindOne.mockResolvedValue({ id: 5, courseId: 1 });
    mockUpdateOrder.mockResolvedValue({ id: 7 });
    const res = await request(app)
      .put('/api/questions/7/order')
      .set('Cookie', 'session=v')
      .send({ assessmentId: 5, orderNumber: 1 });
    expect(res.status).toBe(200);
    expect(mockUpdateOrder).toHaveBeenCalled();
  });
});

describe('question-order routes validate assessmentId against the question course (#2)', () => {
  it('rejects an assessmentId from a different course → 404', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    mockAssessmentFindOne.mockResolvedValue({ id: 5, courseId: 2 }); // foreign course
    const res = await request(app)
      .put('/api/questions/7/order')
      .set('Cookie', 'session=v')
      .send({ assessmentId: 5, orderNumber: 1 });
    expect(res.status).toBe(404);
    expect(mockUpdateOrder).not.toHaveBeenCalled();
  });

  it('rejects DELETE for an assessmentId from a different course → 404', async () => {
    authAs(INSTRUCTOR, 'INSTRUCTOR');
    mockAssessmentFindOne.mockResolvedValue({ id: 5, courseId: 2 });
    const res = await request(app)
      .delete('/api/questions/7/order/5')
      .set('Cookie', 'session=v');
    expect(res.status).toBe(404);
    expect(mockRemoveFromAssessment).not.toHaveBeenCalled();
  });
});
